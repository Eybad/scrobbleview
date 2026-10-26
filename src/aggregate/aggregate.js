// aggregate.js — aggregate(ds, opts) → StatsModel
//
// Pura, síncrona, determinista (byte-idéntico para mismo input). Un pase único
// sobre los eventos ordenados por timestamp UTC con objeto ev reutilizable;
// post-proceso: streak, tables (rankings precalculados), resolución de nombres.

import { derive, civilFromDays } from './impl/derive.js';
import { computeTotals } from './impl/totals.js';
import { createGroupsAcc, trackKey } from './impl/groups.js';
import { createTemporalAcc } from './impl/temporal.js';
import { createSessionsAcc } from './impl/sessions.js';
import { createBehaviorAcc } from './impl/behavior.js';
import { createTransitionsAcc } from './impl/transitions.js';
import { computeConcentration } from './impl/concentration.js';

const TOP_N = 100;
const TOP_RATE_N = 100;
const TOP_OBSESSION_N = 100;
const TOP_SESSIONS_N = 100;
const TOP_DISCOVERY_N = 100;
const MIN_PLAYS_FOR_RATE = 20;
const MIN_PLAYS_FOR_OBSESSION = 15;
const MIN_MONTHS_FOR_CONSTANCY = 6;
const MIN_ONE_HIT_SHARE = 0.8;

export function aggregate(ds, opts = {}) {
  const tz = opts.tz;
  if (!tz || typeof tz.offsetMinutes !== 'function') {
    throw new TypeError('aggregate: se requiere tz (puerto offsetMinutes(t))');
  }
  const minMs = opts.minMs ?? 30000;
  const skipThresholdMs = opts.skipThresholdMs ?? 10000;
  const now = opts.now ?? Math.floor(Date.now() / 1000);

  const derived = derive(ds, tz);
  const cols = {
    t: derived.t, loc: derived.loc, hour: derived.hour, dow: derived.dow,
    ymd: derived.ymd, day: derived.day, isSkipped: derived.isSkipped, ms: derived.ms
  };
  const order = derived.order;
  const totals = computeTotals(ds, minMs, skipThresholdMs);

  const groups = createGroupsAcc(ds);
  const temporal = createTemporalAcc(minMs);
  const sessions = createSessionsAcc({ tz });
  const behavior = createBehaviorAcc();
  const transitions = createTransitionsAcc();

  const n = ds.meta.count;
  const ev = {};
  for (let k = 0; k < n; k++) {
    const i = order[k];
    ev.k = k;
    ev.t = cols.t[k];
    ev.loc = cols.loc[k];
    ev.hour = cols.hour[k];
    ev.dow = cols.dow[k];
    ev.ymd = cols.ymd[k];
    ev.day = cols.day[k];
    ev.isSkipped = cols.isSkipped[k];
    ev.ms = cols.ms[k];
    ev.tr = ds.tr[i];
    ev.ar = ds.ar[i];
    ev.al = ds.al[i];
    ev.rs = ds.rs[i];
    ev.re = ds.re[i];
    ev.flags = ds.flags[i];
    groups.onEvent(ev);
    temporal.onEvent(ev);
    sessions.onEvent(ev);
    behavior.onEvent(ev);
    transitions.onEvent(ev);
  }

  const g = groups.finalize();
  const t = temporal.finalize();
  const s = sessions.finalize();
  const b = behavior.finalize();
  const tr = transitions.finalize();
  const concentration = computeConcentration(g);

  return buildStats({
    ds, tz, now, minMs, skipThresholdMs,
    cols, localOrder: derived.localOrder, totals, groups: g, temporal: t, sessions: s, behavior: b,
    transitions: tr, concentration
  });
}

function rankByLowSkipRate(entities) {
  return entities
    .filter((entity) => entity.plays >= MIN_PLAYS_FOR_RATE)
    .sort((first, second) => first.skips / first.plays - second.skips / second.plays || second.plays - first.plays || second.ms - first.ms)
    .slice(0, TOP_RATE_N);
}

function findDominantTrack(artist, tracksByKey) {
  let dominantTrack = null;
  for (const tk of artist.tracks) {
    const candidate = tracksByKey.get(tk);
    if (!candidate) continue;
    const isHigher = !dominantTrack ||
      candidate.plays > dominantTrack.plays ||
      (candidate.plays === dominantTrack.plays && candidate.ms > dominantTrack.ms);
    if (isHigher) dominantTrack = candidate;
  }
  return dominantTrack;
}

function rankOneHitWonders(artistList, tracksByKey) {
  return artistList
    .filter((artist) => artist.plays >= MIN_PLAYS_FOR_RATE && artist.tracks.size > 0)
    .map((artist) => {
      const dominant = findDominantTrack(artist, tracksByKey);
      if (!dominant) return null;
      const share = artist.plays > 0 ? dominant.plays / artist.plays : 0;
      if (share < MIN_ONE_HIT_SHARE) return null;
      return {
        id: artist.id,
        name: artist.name,
        plays: artist.plays,
        ms: artist.ms,
        trackCount: artist.tracks.size,
        topTrack: { tk: dominant.tk, name: dominant.name, plays: dominant.plays, ms: dominant.ms },
        share,
        shareMs: artist.ms > 0 ? dominant.ms / artist.ms : 0
      };
    })
    .filter(Boolean)
    .sort((first, second) => second.share - first.share || second.plays - first.plays || second.ms - first.ms)
    .slice(0, TOP_N);
}

function rankDeepCatalog(artistList) {
  return [...artistList]
    .sort((first, second) => second.tracks.size - first.tracks.size || second.albums.size - first.albums.size || second.plays - first.plays || second.ms - first.ms)
    .slice(0, TOP_N);
}

function rankForgottenEntities(entities) {
  return entities
    .filter((entity) => entity.plays >= MIN_PLAYS_FOR_OBSESSION && entity.lastTs != null)
    .sort((first, second) => first.lastUtc - second.lastUtc || second.plays - first.plays || second.ms - first.ms)
    .slice(0, TOP_N);
}

// Meses absolutos (y*12+m-1) para medir distancias: restar índices YYYYMM
// (y*100+m) cruza mal el año (202401 − 202312 + 1 = 90 en vez de 2).
function absoluteMonths(loc) {
  const c = civilFromDays(Math.floor(loc / 86400));
  return c.y * 12 + (c.m - 1);
}

function longestStreak(days) {
  if (days.size === 0) return { len: 0, start: null, end: null };
  const sorted = [...days].sort((a, b) => a - b);
  let bestLen = 1;
  let curLen = 1;
  let bestStart = sorted[0];
  let curStart = sorted[0];
  let bestEnd = sorted[0];
  let curEnd = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      curLen++;
      curEnd = sorted[i];
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
        bestEnd = curEnd;
      }
    } else {
      curLen = 1;
      curStart = sorted[i];
      curEnd = sorted[i];
    }
  }
  return { len: bestLen, start: bestStart, end: bestEnd };
}

function buildStats({ ds, tz, now, minMs, skipThresholdMs, cols, localOrder, totals, groups, temporal, sessions, behavior, transitions, concentration }) {
  const { artists, tracks, albums } = groups;
  const n = ds.meta.count;

  const allDays = new Set(temporal.daily.keys());
  const streak = longestStreak(allDays);
  const yearlyStreaks = new Map();
  for (const day of allDays) {
    const year = civilFromDays(day).y;
    let set = yearlyStreaks.get(year);
    if (!set) { set = new Set(); yearlyStreaks.set(year, set); }
    set.add(day);
  }
  for (const [year, set] of yearlyStreaks) yearlyStreaks.set(year, longestStreak(set));

  const starts = new Map();
  for (const [rs, count] of behavior.starts) starts.set(ds.dicts.reasons.get(rs), count);
  const ends = new Map();
  for (const [re, count] of behavior.ends) ends.set(ds.dicts.reasons.get(re), count);
  const pairs = [];
  for (const [key, count] of behavior.pairs) {
    pairs.push({
      start: ds.dicts.reasons.get(key >> 8),
      end: ds.dicts.reasons.get(key & 255),
      count
    });
  }
  pairs.sort((a, b) => b.count - a.count);

  const artistName = (ar) => (ar > 0 && artists.has(ar) ? artists.get(ar).name : '(Desconocido)');
  const transitionTop = transitions.top.map(({ from, to, count }) => ({
    from, to,
    fromName: artistName(from),
    toName: artistName(to),
    repeat: from === to,
    count
  }));

  const tables = buildTables({ groups, temporal, sessions, behavior, transitions, streak });

  return {
    meta: {
      tzId: tz.id,
      generatedAt: now,
      minMs,
      skipThresholdMs,
      records: n,
      firstTs: n ? cols.loc[localOrder[0]] : null,
      lastTs: n ? cols.loc[localOrder[n - 1]] : null,
      datedEvents: n,
      sources: ds.meta.sources,
      warnings: ds.meta.warnings,
      bytesRead: ds.meta.bytesRead
    },
    cols,
    totals,
    artists: { byId: artists, top: tables.artists },
    tracks: { byId: tracks, top: tables.tracks },
    albums: { byId: albums, top: tables.albums },
    yearly: temporal.yearly,
    monthly: temporal.monthly,
    monthlyDiscovery: temporal.monthlyDiscovery,
    monthlyTrackMs: temporal.monthlyTrackMs,
    monthlyTrackPlays: temporal.monthlyTrackPlays,
    monthlyArtistMs: temporal.monthlyArtistMs,
    monthlyArtistPlays: temporal.monthlyArtistPlays,
    monthlyBehavior: temporal.monthlyBehavior,
    weekday: temporal.weekday,
    hour: temporal.hour,
    dayHour: temporal.dayHour,
    dayHourMs: temporal.dayHourMs,
    blocks: temporal.blocks,
    daily: temporal.daily,
    zeroDays: temporal.zeroDays,
    hourTracks: temporal.hourTracks,
    hourTracksMs: temporal.hourTracksMs,
    dayFirst: temporal.dayFirst,
    dayLast: temporal.dayLast,
    sessions: sessions.sessions,
    sessionsStats: sessions.sessionsStats,
    intraSession: sessions.intraSession,
    streak,
    yearlyStreaks,
    starts,
    ends,
    pairs,
    maxRun: behavior.maxRun,
    concentration,
    transitions: { pairs: transitions.pairs, top: transitionTop, auto: transitions.auto },
    tables
  };
}

function buildTables({ groups, temporal, sessions, behavior, transitions, streak }) {
  const { artists, tracks, albums } = groups;
  const artistList = [...artists.values()];
  const trackList = [...tracks.values()];
  const albumList = [...albums.values()];

  const byPlays = (list) => [...list].sort((a, b) => b.plays - a.plays || b.ms - a.ms);
  const byMs = (list) => [...list].sort((a, b) => b.ms - a.ms || b.plays - a.plays);

  const artistsTop = { byPlays: byPlays(artistList).slice(0, TOP_N), byMs: byMs(artistList).slice(0, TOP_N) };
  const tracksTop = { byPlays: byPlays(trackList).slice(0, TOP_N), byMs: byMs(trackList).slice(0, TOP_N) };
  const albumsTop = { byPlays: byPlays(albumList).slice(0, TOP_N), byMs: byMs(albumList).slice(0, TOP_N) };

  const rate = (list) => list
    .filter((x) => x.plays >= MIN_PLAYS_FOR_RATE)
    .sort((a, b) => b.skips / b.plays - a.skips / a.plays || b.plays - a.plays)
    .slice(0, TOP_RATE_N);
  const skipRate = { artists: rate(artistList), tracks: rate(trackList) };
  const lowSkipRate = { artists: rankByLowSkipRate(artistList), tracks: rankByLowSkipRate(trackList) };
  const oneHitWonders = rankOneHitWonders(artistList, tracks);
  const deepCatalog = rankDeepCatalog(artistList);
  const forgotten = { artists: rankForgottenEntities(artistList), tracks: rankForgottenEntities(trackList) };

  // Obsesión: intensidad = plays / días activos (mín. MIN_PLAYS_FOR_OBSESSION).
  const obsession = trackList
    .filter((t) => t.plays >= MIN_PLAYS_FOR_OBSESSION && t.days.size > 0)
    .map((t) => ({ ...t, intensity: t.plays / t.days.size }))
    .sort((a, b) => b.intensity - a.intensity || b.plays - a.plays)
    .slice(0, TOP_OBSESSION_N);

  // Binge: rachas consecutivas de la misma canción.
  const binge = [...behavior.maxRun.entries()]
    .map(([tk, run]) => ({ tk, run, track: tracks.get(tk) }))
    .filter((x) => x.track)
    .sort((a, b) => b.run - a.run || b.track.plays - a.track.plays)
    .slice(0, TOP_RATE_N);

  // Primera/última canción del día: el v2 keyea por tk (track+artista).
  const countByTrack = (map) => {
    const c = new Map();
    for (const tk of map.values()) c.set(tk, (c.get(tk) || 0) + 1);
    return [...c.entries()]
      .map(([tk, count]) => ({ tk, count, track: tracks.get(tk) }))
      .filter((x) => x.track)
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_N);
  };
  const dayFirst = countByTrack(temporal.dayFirst);
  const dayLast = countByTrack(temporal.dayLast);

  const sessByDuration = [...sessions.sessions]
    .sort((a, b) => b.duration - a.duration || b.ms - a.ms)
    .slice(0, TOP_SESSIONS_N);
  const sessByPlays = [...sessions.sessions]
    .sort((a, b) => b.plays - a.plays || b.ms - a.ms)
    .slice(0, TOP_SESSIONS_N);

  const disc = [...temporal.monthlyDiscovery.entries()];
  const discAbs = [...disc]
    .sort((a, b) => b[1].new - a[1].new || b[1].plays - a[1].plays)
    .slice(0, TOP_DISCOVERY_N);
  const discRel = disc
    .filter(([, x]) => x.plays > 0)
    .sort((a, b) => b[1].new / b[1].plays - a[1].new / a[1].plays || b[1].new - a[1].new)
    .slice(0, TOP_DISCOVERY_N);

  // Constancia: meses activos / meses del intervalo (mín. MIN_MONTHS_FOR_CONSTANCY).
  const constancy = artistList
    .filter((a) => a.months.size >= MIN_MONTHS_FOR_CONSTANCY && a.firstTs != null && a.lastTs != null)
    .map((a) => {
      const span = Math.max(1, absoluteMonths(a.lastTs) - absoluteMonths(a.firstTs) + 1);
      return { ...a, coverage: a.months.size / span };
    })
    .sort((a, b) => b.coverage - a.coverage || b.months.size - a.months.size || b.years.size - a.years.size || b.days.size - a.days.size || b.plays - a.plays)
    .slice(0, TOP_N);

  const longevity = [...artistList]
    .sort((a, b) => b.years.size - a.years.size || b.months.size - a.months.size || b.days.size - a.days.size || b.plays - a.plays)
    .slice(0, TOP_N);

  return {
    artists: artistsTop,
    tracks: tracksTop,
    albums: albumsTop,
    skipRate,
    lowSkipRate,
    oneHitWonders,
    deepCatalog,
    forgotten,
    obsession,
    binge,
    dayFirst,
    dayLast,
    sessions: { byDuration: sessByDuration, byPlays: sessByPlays },
    discovery: { absolute: discAbs, relative: discRel },
    constancy,
    longevity
  };
}
