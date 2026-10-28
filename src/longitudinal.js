import { trackKey } from './aggregate/impl/groups.js';
import { civilFromDays } from './aggregate/impl/derive.js';

function chronologicalOrder(ds, order) {
  return order ?? Uint32Array.from(ds.t, (_, i) => i).sort((a, b) => ds.t[a] - ds.t[b]);
}

export function computeComebacks(ds, { thresholdDays = 30, range = null, entityType = 'both', order = null, selected = null } = {}) {
  const thresholdSec = thresholdDays * 86400;
  const tsMin = ds.meta?.tsMin ?? 0;
  const lastSeenTrack = new Map();
  const lastSeenArtist = new Map();
  const tracks = [];
  const artists = [];

  const checkTrack = entityType === 'both' || entityType === 'tracks';
  const checkArtist = entityType === 'both' || entityType === 'artists';

  for (const i of chronologicalOrder(ds, order)) {
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

  return { tracks, artists };
}

export function computeRetention(ds, { days = 30, entityType = 'tracks', order = null } = {}) {
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
  }

  const windowSec = days * 86400;
  let eligible = 0;
  let insufficient = 0;
  let returned = 0;

  for (const [id, firstUtc] of firstMap.entries()) {
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

export function computeMonthlyLongitudinal(ds, tz) {
  const n = ds.t.length;
  const tsMin = ds.meta?.tsMin ?? 0;
  const monthly = new Map();

  for (let i = 0; i < n; i++) {
    const t = tsMin + ds.t[i];
    const off = tz ? tz.offsetMinutes(t) * 60 : 0;
    const loc = t + off;
    const day = Math.floor(loc / 86400);
    const c = civilFromDays(day);
    const mi = c.y * 100 + c.m;

    let mo = monthly.get(mi);
    if (!mo) {
      mo = {
        month: mi,
        plays: 0,
        ms: 0,
        skips: 0,
        skipKnown: 0,
        shuffle: 0,
        shuffleKnown: 0,
        offline: 0,
        offlineKnown: 0,
        artists: new Map()
      };
      monthly.set(mi, mo);
    }

    const flags = ds.flags[i];
    mo.plays++;
    mo.ms += ds.m[i];

    if (flags & 2) mo.skips++;
    if (!(flags & 32)) mo.skipKnown++;

    if (flags & 1) mo.shuffle++;
    if (!(flags & 16)) mo.shuffleKnown++;

    if (flags & 4) mo.offline++;
    if (!(flags & 64)) mo.offlineKnown++;

    const ar = ds.ar[i];
    if (ar > 0) {
      mo.artists.set(ar, (mo.artists.get(ar) || 0) + 1);
    }
  }

  for (const mo of monthly.values()) {
    mo.skipRate = mo.skipKnown > 0 ? mo.skips / mo.skipKnown : 0;
    mo.shuffleRate = mo.shuffleKnown > 0 ? mo.shuffle / mo.shuffleKnown : 0;
    mo.offlineRate = mo.offlineKnown > 0 ? mo.offline / mo.offlineKnown : 0;

    let sumSq = 0;
    const totalP = mo.plays;
    for (const p of mo.artists.values()) {
      const s = p / totalP;
      sumSq += s * s;
    }
    mo.hhi = sumSq;
    mo.effectiveArtists = sumSq > 0 ? 1 / sumSq : 0;

    const sortedP = [...mo.artists.values()].sort((a, b) => b - a);
    mo.top1Share = sortedP[0] ? sortedP[0] / totalP : 0;
    mo.top5Share = sortedP.slice(0, 5).reduce((acc, v) => acc + v, 0) / (totalP || 1);
    mo.top10Share = sortedP.slice(0, 10).reduce((acc, v) => acc + v, 0) / (totalP || 1);
  }

  return monthly;
}
