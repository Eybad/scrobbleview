import { albumKey, trackKey } from './aggregate/impl/groups.js';
import { civilFromDays } from './aggregate/impl/derive.js';
import { computeConcentration } from './aggregate/impl/concentration.js';

function chronologicalOrder(ds, order) {
  return order ?? Uint32Array.from(ds.t, (_, i) => i).sort((a, b) => ds.t[a] - ds.t[b]);
}

export function computeComebacks(ds, { thresholdDays = 30, range = null, entityType = 'both', order = null, selected = null, onProgress = null } = {}) {
  const thresholdSec = thresholdDays * 86400;
  const tsMin = ds.meta?.tsMin ?? 0;
  const lastSeenTrack = new Map();
  const lastSeenArtist = new Map();
  const tracks = [];
  const artists = [];

  const checkTrack = entityType === 'both' || entityType === 'tracks';
  const checkArtist = entityType === 'both' || entityType === 'artists';

  const events = chronologicalOrder(ds, order);
  for (let position = 0; position < events.length; position++) {
    if (position % 8192 === 0) onProgress?.(events.length ? position / events.length : 1);
    const i = events[position];
    const t = tsMin + ds.t[i];
    const tr = ds.tr[i];
    const ar = ds.ar[i];

    if (checkTrack) {
      const tk = trackKey(tr, ar);
      const prevT = lastSeenTrack.get(tk);
      if (prevT !== undefined) {
        const gapSec = t - prevT;
        if (gapSec >= thresholdSec) {
          if ((!selected || selected.has(i)) && (!range || (t >= range.startUtc && t <= range.endUtc))) {
            tracks.push({
              id: tk,
              name: ds.dicts.tracks.get(tr) || '(Desconocido)',
              artist: ar > 0 ? (ds.dicts.artists.get(ar) || '(Desconocido)') : '(Desconocido)',
              lastSeenUtc: prevT,
              returnUtc: t,
              gapDays: Math.floor(gapSec / 86400)
            });
          }
        }
      }
      lastSeenTrack.set(tk, t);
    }

    if (checkArtist && ar > 0) {
      const prevT = lastSeenArtist.get(ar);
      if (prevT !== undefined) {
        const gapSec = t - prevT;
        if (gapSec >= thresholdSec) {
          if ((!selected || selected.has(i)) && (!range || (t >= range.startUtc && t <= range.endUtc))) {
            artists.push({
              id: ar,
              name: ds.dicts.artists.get(ar) || '(Desconocido)',
              lastSeenUtc: prevT,
              returnUtc: t,
              gapDays: Math.floor(gapSec / 86400)
            });
          }
        }
      }
      lastSeenArtist.set(ar, t);
    }
  }

  tracks.sort((a, b) => b.gapDays - a.gapDays || b.returnUtc - a.returnUtc);
  artists.sort((a, b) => b.gapDays - a.gapDays || b.returnUtc - a.returnUtc);
  onProgress?.(1);

  return { tracks, artists };
}

export function computeRetention(ds, { days = 30, entityType = 'tracks', order = null, selected = null } = {}) {
  const n = ds.t.length;
  if (n === 0) {
    return { total: 0, eligible: 0, insufficient: 0, returned: 0, rate: null, days };
  }

  const tsMin = ds.meta?.tsMin ?? 0;
  let maxDatasetUtc = -Infinity;
  for (let i = 0; i < n; i++) {
    const absT = tsMin + ds.t[i];
    if (absT > maxDatasetUtc) maxDatasetUtc = absT;
  }

  const isArtists = entityType === 'artists';
  const firstMap = new Map();
  const subsequentMap = new Map();
  const cohort = selected ? new Set() : null;

  for (const i of chronologicalOrder(ds, order)) {
    const id = isArtists ? ds.ar[i] : trackKey(ds.tr[i], ds.ar[i]);
    if (isArtists && id === 0) continue;
    const t = tsMin + ds.t[i];

    if (!firstMap.has(id)) {
      firstMap.set(id, t);
    } else {
      let list = subsequentMap.get(id);
      if (!list) {
        list = [];
        subsequentMap.set(id, list);
      }
      list.push(t);
    }
    if (cohort && selected.has(i) && t === firstMap.get(id)) cohort.add(id);
  }

  const windowSec = days * 86400;
  let eligible = 0;
  let insufficient = 0;
  let returned = 0;

  for (const [id, firstUtc] of firstMap.entries()) {
    if (cohort && !cohort.has(id)) continue;
    if (maxDatasetUtc - firstUtc >= windowSec) {
      eligible++;
      const subs = subsequentMap.get(id);
      if (subs && subs.some((t) => t > firstUtc && t <= firstUtc + windowSec)) {
        returned++;
      }
    } else {
      insufficient++;
    }
  }

  const total = eligible + insufficient;
  const rate = eligible > 0 ? returned / eligible : null;

  return { total, eligible, insufficient, returned, rate, days };
}

export function computeMonthlyLongitudinal(ds, tz, { indices = null, onProgress = null } = {}) {
  const n = indices?.length ?? ds.t.length;
  const tsMin = ds.meta?.tsMin ?? 0;
  const monthly = new Map();

  function createMonth(month) {
    return {
      month,
      plays: 0,
      ms: 0,
      skips: 0,
      skipKnown: 0,
      shuffle: 0,
      shuffleKnown: 0,
      offline: 0,
      offlineKnown: 0,
      entities: { artists: new Map(), tracks: new Map(), albums: new Map() }
    };
  }

  function addEntity(entities, id, isDurationKnown, ms) {
    let entity = entities.get(id);
    if (!entity) {
      entity = { ms: 0, durationKnown: 0 };
      entities.set(id, entity);
    }
    if (isDurationKnown) {
      entity.ms += ms;
      entity.durationKnown++;
    }
  }

  for (let position = 0; position < n; position++) {
    if (position % 8192 === 0) onProgress?.(n ? position / n : 1);
    const i = indices ? indices[position] : position;
    const t = tsMin + ds.t[i];
    const off = tz ? tz.offsetMinutes(t) * 60 : 0;
    const loc = t + off;
    const day = Math.floor(loc / 86400);
    const c = civilFromDays(day);
    const mi = c.y * 100 + c.m;

    let mo = monthly.get(mi);
    if (!mo) { mo = createMonth(mi); monthly.set(mi, mo); }

    const flags = ds.flags[i];
    const isDurationKnown = !(flags & 8);
    const ar = ds.ar[i];
    const tr = ds.tr[i];
    const al = ds.al[i];
    mo.plays++;
    mo.ms += ds.m[i];

    if (!(flags & 32)) {
      mo.skipKnown++;
      if (flags & 2) mo.skips++;
    }

    if (!(flags & 16)) {
      mo.shuffleKnown++;
      if (flags & 1) mo.shuffle++;
    }

    if (!(flags & 64)) {
      mo.offlineKnown++;
      if (flags & 4) mo.offline++;
    }

    addEntity(mo.entities.tracks, trackKey(tr, ar), isDurationKnown, ds.m[i]);
    if (ar > 0) {
      addEntity(mo.entities.artists, ar, isDurationKnown, ds.m[i]);
    }
    if (al > 0) addEntity(mo.entities.albums, albumKey(ar, al), isDurationKnown, ds.m[i]);
  }

  for (const mo of monthly.values()) {
    mo.skipUnknown = mo.plays - mo.skipKnown;
    mo.shuffleUnknown = mo.plays - mo.shuffleKnown;
    mo.offlineUnknown = mo.plays - mo.offlineKnown;
    mo.skipRate = mo.skipKnown > 0 ? mo.skips / mo.skipKnown : null;
    mo.shuffleRate = mo.shuffleKnown > 0 ? mo.shuffle / mo.shuffleKnown : null;
    mo.offlineRate = mo.offlineKnown > 0 ? mo.offline / mo.offlineKnown : null;

    const concentration = computeConcentration(mo.entities);
    for (const [kind, result] of Object.entries(concentration)) {
      const values = [...mo.entities[kind].values()]
        .filter((entity) => entity.durationKnown > 0)
        .map((entity) => entity.ms)
        .sort((a, b) => b - a);
      const totalMs = values.reduce((sum, value) => sum + value, 0);
      result.knownMs = totalMs;
      if (totalMs === 0) {
        result.hhi = null;
        result.gini = null;
        result.entropy = null;
        result.effective = null;
      }
      result.top1Share = totalMs > 0 ? (values[0] ?? 0) / totalMs : null;
      result.top5Share = totalMs > 0 ? values.slice(0, 5).reduce((sum, value) => sum + value, 0) / totalMs : null;
      result.top10Share = totalMs > 0 ? values.slice(0, 10).reduce((sum, value) => sum + value, 0) / totalMs : null;
    }
    mo.concentration = concentration;
    mo.hhi = concentration.artists.hhi;
    mo.effectiveArtists = concentration.artists.effective;
    mo.top1Share = concentration.artists.top1Share;
    mo.top5Share = concentration.artists.top5Share;
    mo.top10Share = concentration.artists.top10Share;
    delete mo.entities;
  }
  onProgress?.(1);

  return monthly;
}
