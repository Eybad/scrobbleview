// dataset.js — contrato Dataset + helpers de inspección
//
// El Dataset es columnar (typed arrays) pero la interfaz es por nombre de campo:
// ds.get(i, 't') — un typo en el campo lanza, no da undefined silencioso.
// peek/describeDataset/assertDataset permiten inspeccionar sin debugger.

export const FIELDS = ['t', 'm', 'tr', 'ar', 'al', 'rs', 're', 'flags'];

export function get(ds, i, field) {
  if (!FIELDS.includes(field)) {
    throw new Error(`Campo desconocido: "${field}". Campos válidos: ${FIELDS.join(', ')}`);
  }
  return ds[field][i];
}

export function peek(ds, i) {
  if (i < 0 || i >= ds.meta.count) throw new RangeError(`Índice fuera de rango: ${i}`);
  return {
    t: ds.t[i] + ds.meta.tsMin,
    m: ds.m[i],
    track: ds.dicts.tracks.get(ds.tr[i]),
    artist: ds.dicts.artists.get(ds.ar[i]),
    album: ds.dicts.albums.get(ds.al[i]),
    reasonStart: ds.dicts.reasons.get(ds.rs[i]),
    reasonEnd: ds.dicts.reasons.get(ds.re[i]),
    shuffle: ds.flags[i] & 16 ? null : (ds.flags[i] & 1) !== 0,
    skipped: ds.flags[i] & 32 ? null : (ds.flags[i] & 2) !== 0,
    offline: ds.flags[i] & 64 ? null : (ds.flags[i] & 4) !== 0,
    msUnknown: (ds.flags[i] & 8) !== 0
  };
}

export function describeDataset(ds) {
  const first = ds.meta.count > 0 ? peek(ds, 0) : null;
  const last = ds.meta.count > 0 ? peek(ds, ds.meta.count - 1) : null;
  return {
    count: ds.meta.count,
    range: first && last
      ? { from: new Date(first.t * 1000).toISOString(), to: new Date(last.t * 1000).toISOString() }
      : null,
    tracks: ds.dicts.tracks.size - 1,
    artists: ds.dicts.artists.size - 1,
    albums: ds.dicts.albums.size - 1,
    reasons: ds.dicts.reasons.size - 1,
    warnings: ds.meta.warnings.length,
    bytesRead: ds.meta.bytesRead,
    sources: ds.meta.sources
  };
}

export function assertDataset(ds) {
  if (!ds || typeof ds !== 'object') throw new TypeError('Dataset inválido');
  const n = ds.meta?.count;
  if (typeof n !== 'number' || n < 0) throw new TypeError('meta.count inválido');
  for (const f of FIELDS) {
    const arr = ds[f];
    if (!arr || arr.length < n) throw new TypeError(`Columna "${f}" inválida`);
  }
  for (const k of ['tracks', 'artists', 'albums', 'reasons']) {
    const dict = ds.dicts?.[k];
    if (!dict || typeof dict.get !== 'function') throw new TypeError(`Dict "${k}" inválido`);
  }
  if (typeof ds.meta.tsMin !== 'number') throw new TypeError('meta.tsMin inválido');
  return true;
}