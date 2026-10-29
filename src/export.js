import { civilFromDays } from './aggregate/impl/derive.js';
import { queryCatalog } from './query.js';
import { toCSV } from './export/csv.js';

export const EXPORT_FORMAT = 'scrobbleview-export';
export const EXPORT_VERSION = 1;
const ALL_ROWS_PAGE_SIZE = Number.MAX_SAFE_INTEGER;

function toPlain(v) {
  if (v instanceof Map) {
    const o = {};
    for (const [k, x] of v) o[String(k)] = toPlain(x);
    return o;
  }
  if (v instanceof Set) {
    const arr = [...v].map(toPlain);
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

export function exportFilename(exportedAt) {
  const d = new Date(exportedAt * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `scrobbleview-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`;
}

function locISO(loc) {
  const c = civilFromDays(Math.floor(loc / 86400));
  const sec = ((loc % 86400) + 86400) % 86400;
  const p = (n) => String(n).padStart(2, '0');
  return `${c.y}-${p(c.m)}-${p(c.d)} ${p(Math.floor(sec / 3600))}:${p(Math.floor((sec % 3600) / 60))}`;
}

const TRACK_KEY_ARTIST = 2 ** 32;

export function modelToTables(model) {
  const tables = [{ name: 'totals', headers: ['metric', 'value'], rows: Object.entries(model.totals).filter(([, value]) => value === null || typeof value === 'number') }];
  const artists = [...model.artists.byId.entries()].sort((a, b) => a[0] - b[0]);
  tables.push({
    name: 'artists',
    headers: ['id', 'name', 'plays', 'ms', 'skips', 'days', 'first_ts', 'last_ts', 'skip_known', 'duration_known'],
    rows: artists.map(([id, a]) => [id, a.name, a.plays, a.ms, a.skips, a.days.size, locISO(a.firstTs), locISO(a.lastTs), a.skipKnown, a.durationKnown])
  });
  const tracks = [...model.tracks.byId.entries()].sort((a, b) => a[0] - b[0]);
  tables.push({
    name: 'tracks',
    headers: ['id', 'artist_id', 'name', 'artist', 'album_id', 'plays', 'ms', 'skips', 'days', 'first_ts', 'last_ts', 'skip_known', 'duration_known'],
    rows: tracks.map(([tk, t]) => [tk, tk % TRACK_KEY_ARTIST, t.name, t.artist, t.ak, t.plays, t.ms, t.skips, t.days.size, locISO(t.firstTs), locISO(t.lastTs), t.skipKnown, t.durationKnown])
  });
  const albums = [...model.albums.byId.entries()].sort((a, b) => a[0] - b[0]);
  tables.push({
    name: 'albums',
    headers: ['id', 'artist_id', 'name', 'artist', 'plays', 'ms', 'tracks', 'days', 'first_ts', 'last_ts', 'duration_known'],
    rows: albums.map(([ak, al]) => [ak, Math.floor(ak / TRACK_KEY_ARTIST), al.name, al.artist, al.plays, al.ms, al.tracks.size, al.days.size, locISO(al.firstTs), locISO(al.lastTs), al.durationKnown])
  });
  tables.push({
    name: 'album_tracks',
    headers: ['album_id', 'track_id', 'plays', 'ms', 'skips', 'days', 'first_ts', 'last_ts', 'skip_known', 'duration_known'],
    rows: albums.flatMap(([ak, album]) => [...album.trackStats.values()]
      .sort((first, second) => first.tk - second.tk)
      .map(track => [ak, track.tk, track.plays, track.ms, track.skips, track.days.size, locISO(track.firstTs), locISO(track.lastTs), track.skipKnown, track.durationKnown]))
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

export function exportExploreTableCSV(items, queryOpts = {}, tab = 'artists') {
  const result = queryCatalog(items, { ...queryOpts, page: 1, pageSize: ALL_ROWS_PAGE_SIZE });
  let headers = [];
  let rows = [];

  if (tab === 'artists') {
    headers = ['#', 'Artista', 'Tiempo (ms)', 'duration_known', 'Reproducciones', 'Cuota (%)', 'Días activos', 'Meses activos', 'Primera escucha', 'Última escucha'];
    rows = result.rows.map((entry) => {
      const a = entry.item;
      return [
        entry.metricRank,
        a.name,
        a.ms,
        a.durationKnown ?? '',
        a.plays,
        (entry.share * 100).toFixed(2),
        a.days?.size ?? a.days ?? 0,
        a.months?.size ?? a.months ?? 0,
        locISO(a.firstTs),
        locISO(a.lastTs)
      ];
    });
  } else if (tab === 'tracks') {
    headers = ['#', 'Canción', 'Artista', 'Tiempo (ms)', 'duration_known', 'Reproducciones', 'Cuota (%)', 'Días activos', 'Primera escucha', 'Última escucha'];
    rows = result.rows.map((entry) => {
      const tr = entry.item;
      return [
        entry.metricRank,
        tr.name,
        tr.artist,
        tr.ms,
        tr.durationKnown ?? '',
        tr.plays,
        (entry.share * 100).toFixed(2),
        tr.days?.size ?? tr.days ?? 0,
        locISO(tr.firstTs),
        locISO(tr.lastTs)
      ];
    });
  } else {
    headers = ['#', 'Álbum', 'Artista', 'Tiempo (ms)', 'duration_known', 'Reproducciones', 'Cuota (%)', 'Canciones', 'Días activos', 'Primera escucha', 'Última escucha'];
    rows = result.rows.map((entry) => {
      const al = entry.item;
      return [
        entry.metricRank,
        al.name,
        al.artist,
        al.ms,
        al.durationKnown ?? '',
        al.plays,
        (entry.share * 100).toFixed(2),
        al.tracks?.size ?? al.tracks ?? 0,
        al.days?.size ?? al.days ?? 0,
        locISO(al.firstTs),
        locISO(al.lastTs)
      ];
    });
  }

  return {
    totalMatches: result.totalMatches,
    totalItems: result.totalItems,
    effectiveDir: result.effectiveDir,
    csv: `\uFEFF${toCSV(headers, rows)}`
  };
}
