// src/export.js — modelo procesado → JSON plano (backup) y tablas CSV (análisis)
//
// Seam puro: modelToJSON(model, { now }) → objeto sin Map/Set/typed arrays,
// listo para JSON.stringify. Exporta el modelo COMPLETO (ignora filtros).
// Las claves de Map numéricas se serializan como strings de objeto (igual
// que JSON haría de todos modos); los Set salen como arrays ordenados.
// modelToTables(model) aplana los maps a filas relacionales para el export
// de análisis (un CSV por tabla, clave foránea artist_id en tracks/albums).

import { civilFromDays } from './aggregate/impl/derive.js';

export const EXPORT_FORMAT = 'scrobbleview-export';
export const EXPORT_VERSION = 1;

function toPlain(v) {
  if (v instanceof Map) {
    const o = {};
    for (const [k, x] of v) o[String(k)] = toPlain(x);
    return o;
  }
  if (v instanceof Set) {
    const arr = [...v].map(toPlain);
    // Sets del modelo guardan números (días, meses, ids): ordenados.
    if (arr.every((x) => typeof x === 'number')) arr.sort((a, b) => a - b);
    return arr;
  }
  if (ArrayBuffer.isView(v)) return Array.from(v, (x) => toPlain(x));
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'function' || x === undefined) continue;
      o[k] = toPlain(x);
    }
    return o;
  }
  return v;
}

export function modelToJSON(model, { now = Math.floor(Date.now() / 1000) } = {}) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    model: toPlain(model)
  };
}

// exportedAt (epoch s, UTC) → 'scrobbleview-YYYYMMDD-HHMMSS.json'.
export function exportFilename(exportedAt) {
  const d = new Date(exportedAt * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `scrobbleview-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`;
}

// epoch-local (s) → 'YYYY-MM-DD HH:MM': legible en Sheets/Excel sin fórmulas.
function locISO(loc) {
  const c = civilFromDays(Math.floor(loc / 86400));
  const sec = ((loc % 86400) + 86400) % 86400;
  const p = (n) => String(n).padStart(2, '0');
  return `${c.y}-${p(c.m)}-${p(c.d)} ${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}`;
}

const TRACK_KEY_ARTIST = 4294967296; // 2^32: tk = tr*2^32 + ar

export function modelToTables(model) {
  // tracks.album_id is 0 unless every event has the same known album.
  // album_tracks carries exact attribution; session duration_s is estimated,
  // start is local display time and start_utc/end_utc are epoch seconds.
  const tables = [{ name: 'totals', headers: ['metric', 'value'], rows: Object.entries(model.totals).filter(([, value]) => value === null || typeof value === 'number') }];
  const artists = [...model.artists.byId.entries()].sort((a, b) => a[0] - b[0]);
  tables.push({
    name: 'artists',
    headers: ['id', 'name', 'plays', 'ms', 'skips', 'days', 'first_ts', 'last_ts', 'skip_known'],
    rows: artists.map(([id, a]) => [id, a.name, a.plays, a.ms, a.skips, a.days.size, locISO(a.firstTs), locISO(a.lastTs), a.skipKnown])
  });
  const tracks = [...model.tracks.byId.entries()].sort((a, b) => a[0] - b[0]);
  tables.push({
    name: 'tracks',
    headers: ['id', 'artist_id', 'name', 'artist', 'album_id', 'plays', 'ms', 'skips', 'days', 'first_ts', 'last_ts', 'skip_known'],
    rows: tracks.map(([tk, t]) => [tk, tk % TRACK_KEY_ARTIST, t.name, t.artist, t.ak, t.plays, t.ms, t.skips, t.days.size, locISO(t.firstTs), locISO(t.lastTs), t.skipKnown])
  });
  const albums = [...model.albums.byId.entries()].sort((a, b) => a[0] - b[0]);
  tables.push({
    name: 'albums',
    headers: ['id', 'artist_id', 'name', 'artist', 'plays', 'ms', 'tracks', 'days', 'first_ts', 'last_ts'],
    rows: albums.map(([ak, al]) => [ak, Math.floor(ak / TRACK_KEY_ARTIST), al.name, al.artist, al.plays, al.ms, al.tracks.size, al.days.size, locISO(al.firstTs), locISO(al.lastTs)])
  });
  tables.push({
    name: 'album_tracks',
    headers: ['album_id', 'track_id', 'plays', 'ms', 'skips', 'days', 'first_ts', 'last_ts', 'skip_known'],
    rows: albums.flatMap(([ak, album]) => [...album.trackStats.values()]
      .sort((first, second) => first.tk - second.tk)
      .map(track => [ak, track.tk, track.plays, track.ms, track.skips, track.days.size, locISO(track.firstTs), locISO(track.lastTs), track.skipKnown]))
  });
  tables.push({
    name: 'sessions',
    headers: ['start', 'duration_s', 'plays', 'ms', 'start_utc', 'end_utc'],
    rows: model.sessions.map((s) => [locISO(s.start), s.duration, s.plays, s.ms, s.startUtc, s.endUtc])
  });
  tables.push({
    name: 'monthly',
    headers: ['month', 'plays', 'ms'],
    rows: [...model.monthly.entries()].sort((a, b) => a[0] - b[0]).map(([mi, v]) => [mi, v.plays, v.ms])
  });
  return tables;
}
