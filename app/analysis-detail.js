import { createSessionsAcc } from '../src/aggregate/impl/sessions.js';
import { trackKey, albumKey } from '../src/aggregate/impl/groups.js';

function pageOptions(page = 1, pageSize = 25) {
  if (!Number.isSafeInteger(page) || page < 1 || ![25, 50, 100].includes(pageSize)) {
    throw new RangeError('Página o tamaño de página inválido.');
  }
  return { page, pageSize };
}

function dayNumber(id) {
  if (typeof id === 'number' && Number.isSafeInteger(id)) return id;
  if (typeof id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(id)) throw new RangeError('Día inválido.');
  const time = Date.parse(`${id}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== id) throw new RangeError('Día inválido.');
  return time / 86400000;
}

function sessionData(ds, derived, tz) {
  const accumulator = createSessionsAcc({ tz, membership: true, compact: true });
  for (let k = 0; k < derived.order.length; k++) {
    const i = derived.order[k];
    accumulator.onEvent({ k, t: derived.t[k], loc: derived.loc[k], ms: ds.m[i], flags: ds.flags[i], tr: ds.tr[i], ar: ds.ar[i] });
  }
  return accumulator.finalize();
}

function eventRow(ds, derived, k) {
  const i = derived.order[k];
  return {
    utc: derived.t[k], local: derived.loc[k], ms: ds.m[i], durationKnown: !(ds.flags[i] & 8),
    track: ds.dicts.tracks.get(ds.tr[i]),
    artist: ds.dicts.artists.get(ds.ar[i]) || '(Desconocido)',
    album: ds.dicts.albums.get(ds.al[i]) || '(Sin álbum)',
    trackId: trackKey(ds.tr[i], ds.ar[i]),
    albumId: ds.al[i] ? albumKey(ds.ar[i], ds.al[i]) : 0
  };
}

export function getEventDetail(ds, derived, tz, type, id, page, pageSize) {
  ({ page, pageSize } = pageOptions(page, pageSize));
  const sessions = sessionData(ds, derived, tz);
  const day = type === 'day' ? dayNumber(id) : null;
  const sessionId = type === 'session' ? Number(id) : null;
  if (type === 'session' && (!Number.isSafeInteger(sessionId) || sessionId < 0 || !sessions.sessions[sessionId])) return null;
  const rows = [];
  const artists = new Map(), tracks = new Map(), albums = new Map(), sessionIds = new Set();
  let total = 0, ms = 0;
  for (let k = 0; k < derived.order.length; k++) {
    if (type === 'day' ? derived.day[k] !== day : sessions.sessionByPosition[k] !== sessionId) continue;
    const row = eventRow(ds, derived, k);
    total++;
    ms += row.ms;
    sessionIds.add(sessions.sessionByPosition[k]);
    for (const [map, key, name] of [[artists, ds.ar[derived.order[k]], row.artist], [tracks, row.trackId, row.track], [albums, row.albumId, row.album]]) {
      const item = map.get(key) ?? { id: key, name, plays: 0, ms: 0 };
      item.plays++;
      item.ms += row.ms;
      map.set(key, item);
    }
    if (total > (page - 1) * pageSize && rows.length < pageSize) rows.push(row);
  }
  if (page > Math.max(1, Math.ceil(total / pageSize))) throw new RangeError('Página fuera de rango.');
  const top = map => [...map.values()].sort((a, b) => b.plays - a.plays || b.ms - a.ms).slice(0, 15);
  return {
    total, ms, page, pageSize, startRow: total ? (page - 1) * pageSize + 1 : 0,
    endRow: Math.min(page * pageSize, total), rows, artists: top(artists), tracks: top(tracks), albums: top(albums),
    sessionCount: sessionIds.size, sessions: [...sessionIds].slice(0, 15).map(index => sessions.sessions[index]),
    summary: type === 'session' ? sessions.sessions[sessionId] : null,
    order: 'utc'
  };
}
