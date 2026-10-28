// app/routes.js — Semantic versioned routes and state separation (Etapa 2)
//
// Rutas semánticas v1:
// - #/v1/dashboard, #/v1/hours, #/v1/habits, #/v1/sessions, #/v1/discovery, #/v1/yearly, #/v1/calendar, #/v1/wrapped
// - #/v1/calendar/:year
// - #/v1/artist/:artist
// - #/v1/track/:artist/:title
// - #/v1/album/:artist/:title
//
// Manejo de rutas legadas (#/artist/:id, #/track/:tk, #/album/:id) y recuperación de no encontrados.

export function encodeRouteSegment(str) {
  return encodeURIComponent(String(str ?? ''));
}

export function decodeRouteSegment(str) {
  try {
    return decodeURIComponent(String(str ?? ''));
  } catch (_) {
    return String(str ?? '');
  }
}

export function parseRoute(hash) {
  if (!hash || hash === '#' || hash === '#main-content') {
    return { version: 'v1', view: 'dashboard', params: {}, query: '', isLegacy: false, raw: hash };
  }
  const clean = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = clean.split('?');
  const segments = pathPart.split('/').map(decodeRouteSegment);

  let version = null;
  let offset = 0;
  if (segments[0] === 'v1') {
    version = 'v1';
    offset = 1;
  }

  const primary = segments[offset] || 'dashboard';

  if (primary === 'artist') {
    const isLegacy = version !== 'v1';
    return {
      version: version || 'legacy',
      view: 'artist',
      params: isLegacy
        ? { legacyId: segments[offset + 1] || null }
        : { artist: segments[offset + 1] || '' },
      query: queryPart,
      isLegacy,
      raw: hash
    };
  }

  if (primary === 'track') {
    const isLegacy = version !== 'v1';
    return {
      version: version || 'legacy',
      view: 'track',
      params: isLegacy
        ? { legacyId: segments[offset + 1] || null }
        : { artist: segments[offset + 1] || '', title: segments[offset + 2] || '' },
      query: queryPart,
      isLegacy,
      raw: hash
    };
  }

  if (primary === 'album') {
    const isLegacy = version !== 'v1';
    return {
      version: version || 'legacy',
      view: 'album',
      params: isLegacy
        ? { legacyId: segments[offset + 1] || null }
        : { artist: segments[offset + 1] || '', title: segments[offset + 2] || '' },
      query: queryPart,
      isLegacy,
      raw: hash
    };
  }

  if (primary === 'calendar') {
    return {
      version: version || 'v1',
      view: 'calendar',
      params: { year: segments[offset + 1] || null },
      query: queryPart,
      isLegacy: false,
      raw: hash
    };
  }

  if (primary === 'session') {
    return {
      version: version || 'v1',
      view: 'session',
      params: { id: segments[offset + 1] ?? '0' },
      query: queryPart,
      isLegacy: version !== 'v1',
      raw: hash
    };
  }

  if (primary === 'day') {
    return {
      version: version || 'v1',
      view: 'day',
      params: { date: segments[offset + 1] || '' },
      query: queryPart,
      isLegacy: version !== 'v1',
      raw: hash
    };
  }

  return {
    version: version || 'v1',
    view: primary,
    params: {},
    query: queryPart,
    isLegacy: false,
    raw: hash
  };
}

export function resolveRoute(parsed, model) {
  if (!model) {
    return { view: parsed.view, id: null, entity: null, notFound: false, query: parsed.query };
  }

  const { view, params, isLegacy, query } = parsed;

  if (view === 'artist') {
    if (!isLegacy) {
      const name = params.artist;
      let match = null;
      for (const a of model.artists.byId.values()) {
        if (a.name === name) { match = a; break; }
      }
      if (match) return { view: 'artist', id: match.id, entity: match, notFound: false, query };
      return { view: 'artist', id: null, entity: null, notFound: true, searchedName: name, query };
    } else {
      const id = Number(params.legacyId);
      const match = model.artists.byId.get(id);
      if (match) return { view: 'artist', id: match.id, entity: match, notFound: false, legacy: true, query };
      return { view: 'artist', id: null, entity: null, notFound: true, legacy: true, searchedName: `ID ${params.legacyId}`, query };
    }
  }

  if (view === 'track') {
    if (!isLegacy) {
      const { artist, title } = params;
      let match = null;
      for (const tr of model.tracks.byId.values()) {
        if (tr.name === title && tr.artist === artist) { match = tr; break; }
      }
      if (match) return { view: 'track', id: match.tk, entity: match, notFound: false, query };
      return { view: 'track', id: null, entity: null, notFound: true, searchedArtist: artist, searchedTitle: title, query };
    } else {
      const raw = params.legacyId;
      const tkNum = Number(raw);
      let match = model.tracks.byId.get(tkNum);
      if (!match) {
        try { match = model.tracks.byId.get(BigInt(raw)); } catch (_) {}
      }
      if (match) return { view: 'track', id: match.tk, entity: match, notFound: false, legacy: true, query };
      return { view: 'track', id: null, entity: null, notFound: true, legacy: true, searchedTitle: `ID ${raw}`, query };
    }
  }

  if (view === 'album') {
    if (!isLegacy) {
      const { artist, title } = params;
      let match = null;
      for (const al of model.albums.byId.values()) {
        if (al.name === title && al.artist === artist) { match = al; break; }
      }
      if (match) return { view: 'album', id: match.id, entity: match, notFound: false, query };
      return { view: 'album', id: null, entity: null, notFound: true, searchedArtist: artist, searchedTitle: title, query };
    } else {
      const id = Number(params.legacyId);
      const match = model.albums.byId.get(id);
      if (match) return { view: 'album', id: match.id, entity: match, notFound: false, legacy: true, query };
      return { view: 'album', id: null, entity: null, notFound: true, legacy: true, searchedTitle: `ID ${params.legacyId}`, query };
    }
  }

  if (view === 'calendar') {
    return { view: 'calendar', id: params.year, entity: null, notFound: false, query };
  }

  if (view === 'session') {
    return { view: 'session', id: params.id, entity: null, notFound: false, query };
  }

  if (view === 'day') {
    return { view: 'day', id: params.date, entity: null, notFound: false, query };
  }

  return { view, id: null, entity: null, notFound: false, query };
}

export function formatSemanticRoute(view, entityOrParams, query = '') {
  const cleanQ = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  if (view === 'artist') {
    const name = typeof entityOrParams === 'string' ? entityOrParams : entityOrParams?.name;
    return `#/v1/artist/${encodeRouteSegment(name)}${cleanQ}`;
  }
  if (view === 'track') {
    const artist = entityOrParams?.artist;
    const title = entityOrParams?.name || entityOrParams?.title;
    return `#/v1/track/${encodeRouteSegment(artist)}/${encodeRouteSegment(title)}${cleanQ}`;
  }
  if (view === 'album') {
    const artist = entityOrParams?.artist;
    const title = entityOrParams?.name || entityOrParams?.title;
    return `#/v1/album/${encodeRouteSegment(artist)}/${encodeRouteSegment(title)}${cleanQ}`;
  }
  if (view === 'calendar' && entityOrParams) {
    return `#/v1/calendar/${encodeRouteSegment(entityOrParams)}${cleanQ}`;
  }
  if (view === 'session' && entityOrParams != null) {
    return `#/v1/session/${encodeRouteSegment(entityOrParams)}${cleanQ}`;
  }
  if (view === 'day' && entityOrParams != null) {
    return `#/v1/day/${encodeRouteSegment(entityOrParams)}${cleanQ}`;
  }
  return `#/v1/${view}${cleanQ}`;
}
