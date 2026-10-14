// filters.js — lógica pura de filtros sobre el Dataset
//
// applyFilters(ds, state, tz, derived?) → { indices, counts }: índices de filas
// que cumplen el estado de filtro (rango + cruzados). Si se pasa `derived`
// (resultado de derive(ds, tz) ya calculado), se usa tal cual en vez de
// re-ejecutar derive + order.sort() en cada cambio de filtro. El derived
// pertenece a ese (ds, tz): si no corresponde, el resultado no corresponde.
// filterDataset(ds, indices)
// → Dataset subconjunto (mismos dicts, columnas recortadas) listo para
// re-agregar: las vistas renderizan un StatsModel filtrado con el MISMO código
// que el modelo completo. Nunca se re-parsea.
//
// El estado de filtro es un objeto plano (serializable a URL si se quiere):
//   range: { from: loc, to: loc } | null   (null = todo; loc = epoch local)
//   years: Set<year> | null, months: Set<yyyymm> | null
//   hours: Set<hour> | null, dows: Set<dow> | null
//   artistId: ar | null, trackId: tk (tr*2^32+ar) | null, albumId: ak | null
//   skip/shuffle/offline: boolean | null (null = sin filtro)

import { derive, civilFromDays } from './aggregate/impl/derive.js';

export const RANGE_PRESETS = [
  { id: '4w', label: '4 semanas', days: 28 },
  { id: '6m', label: '6 meses', days: 182 },
  { id: '1y', label: '1 año', days: 365 },
  { id: 'all', label: 'Todo', days: Infinity }
];

export function emptyFilterState() {
  return {
    range: null,
    years: null,
    months: null,
    hours: null,
    dows: null,
    artistId: null,
    trackId: null,
    albumId: null,
    skip: null,
    shuffle: null,
    offline: null
  };
}

// Primer índice k con loc[k] >= target (loc está ordenado por local).
function lowerBound(loc, from, to, target) {
  let lo = from;
  let hi = to;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (loc[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countRange(ds, order, lo, hi) {
  let records = 0;
  let ms = 0;
  let skipped = 0;
  let shuffle = 0;
  let offline = 0;
  for (let k = lo; k < hi; k++) {
    const i = order[k];
    records++;
    ms += ds.m[i];
    if (ds.flags[i] & 2) skipped++;
    if (ds.flags[i] & 1) shuffle++;
    if (ds.flags[i] & 4) offline++;
  }
  return { records, ms, skipped, shuffle, offline };
}

export function applyFilters(ds, state, tz, derived = null) {
  const d = derived ?? derive(ds, tz);
  const n = ds.meta.count;
  const { loc, hour, dow, ymd, day } = d;
  const order = d.order;

  let lo = 0;
  let hi = n;
  if (state.range) {
    lo = lowerBound(loc, 0, n, state.range.from);
    hi = lowerBound(loc, lo, n, state.range.to + 1);
  }

  const years = state.years;
  const months = state.months;
  const hours = state.hours;
  const dows = state.dows;
  const artistId = state.artistId;
  const trackId = state.trackId;
  const albumId = state.albumId;
  const skip = state.skip;
  const shuffle = state.shuffle;
  const offline = state.offline;

  const hasCross = years || months || hours || dows ||
    artistId != null || trackId != null || albumId != null ||
    skip != null || shuffle != null || offline != null;

  if (!hasCross) {
    const indices = new Uint32Array(hi - lo);
    for (let k = lo; k < hi; k++) indices[k - lo] = order[k];
    return { indices, counts: countRange(ds, order, lo, hi) };
  }

  const tmp = [];
  let records = 0;
  let ms = 0;
  let skipped = 0;
  let shuffleC = 0;
  let offlineC = 0;
  for (let k = lo; k < hi; k++) {
    const i = order[k];
    if (years && !years.has(civilFromDays(day[k]).y)) continue;
    if (months && !months.has((ymd[k] / 100) | 0)) continue;
    if (hours && !hours.has(hour[k])) continue;
    if (dows && !dows.has(dow[k])) continue;
    if (artistId != null && ds.ar[i] !== artistId) continue;
    if (trackId != null && ds.tr[i] * 4294967296 + ds.ar[i] !== trackId) continue;
    if (albumId != null && ds.ar[i] * 4294967296 + ds.al[i] !== albumId) continue;
    if (skip != null && ((ds.flags[i] & 2) !== 0) !== skip) continue;
    if (shuffle != null && ((ds.flags[i] & 1) !== 0) !== shuffle) continue;
    if (offline != null && ((ds.flags[i] & 4) !== 0) !== offline) continue;
    tmp.push(i);
    records++;
    ms += ds.m[i];
    if (ds.flags[i] & 2) skipped++;
    if (ds.flags[i] & 1) shuffleC++;
    if (ds.flags[i] & 4) offlineC++;
  }
  return {
    indices: Uint32Array.from(tmp),
    counts: { records, ms, skipped, shuffle: shuffleC, offline: offlineC }
  };
}

// Subconjunto del Dataset: mismas columnas y dicts, count recortado.
// El subconjunto de un dataset ya ordenado por local conserva el orden.
export function filterDataset(ds, indices) {
  const n = indices.length;
  const t = new Int32Array(n);
  const m = new Uint32Array(n);
  const tr = new Uint32Array(n);
  const ar = new Uint32Array(n);
  const al = new Uint32Array(n);
  const rs = new Uint8Array(n);
  const re = new Uint8Array(n);
  const flags = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = indices[k];
    t[k] = ds.t[i];
    m[k] = ds.m[i];
    tr[k] = ds.tr[i];
    ar[k] = ds.ar[i];
    al[k] = ds.al[i];
    rs[k] = ds.rs[i];
    re[k] = ds.re[i];
    flags[k] = ds.flags[i];
  }
  return {
    t, m, tr, ar, al, rs, re, flags,
    dicts: ds.dicts,
    meta: { ...ds.meta, count: n }
  };
}