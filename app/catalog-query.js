const TABS = new Set(['artists', 'tracks', 'albums']);
const SORTS = new Set(['metric', 'rank', 'name', 'artist', 'plays', 'ms', 'days', 'months', 'firstTs', 'lastTs', 'intensity', 'skipRate', 'lowSkipRate', 'constancy', 'longevity', 'dominance', 'deepCatalog', 'forgotten']);
const SORT_LABELS = { metric: 'métrica principal', rank: 'posición', name: 'nombre', artist: 'artista', plays: 'reproducciones', ms: 'tiempo', days: 'días activos', months: 'meses activos', firstTs: 'primera escucha', lastTs: 'última escucha', intensity: 'intensidad', skipRate: 'tasa de salto', lowSkipRate: 'tasa de salto', constancy: 'constancia', longevity: 'longevidad', dominance: 'concentración en una canción', deepCatalog: 'canciones distintas', forgotten: 'última escucha' };
const EXPLORE_QUERY_FIELDS = new Set(['tab', 'q', 'sort', 'dir', 'page', 'pageSize', 'minPlays', 'minMonths', 'minKnownSkips']);

function boundedInteger(value, min, max, fallback = null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

export function parseExploreState(query, presentation = {}) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  const tab = params.get('tab');
  const sort = params.get('sort');
  const sortBy = SORTS.has(sort) ? sort : 'metric';
  const minPlays = boundedInteger(params.get('minPlays'), 1, 10000);
  const rawMinKnownSkips = boundedInteger(params.get('minKnownSkips'), 1, 10000);
  const visibleCols = presentation.visibleCols instanceof Set
    ? presentation.visibleCols
    : Array.isArray(presentation.visibleCols) ? new Set(presentation.visibleCols) : null;

  return {
    tab: TABS.has(tab) ? tab : 'artists',
    q: params.get('q') || '',
    sort: sortBy,
    dir: ['asc', 'desc'].includes(params.get('dir')) ? params.get('dir') : null,
    page: boundedInteger(params.get('page'), 1, Number.MAX_SAFE_INTEGER, 1),
    pageSize: params.get('pageSize') === 'all'
      ? 'all'
      : [25, 50, 100].includes(Number(params.get('pageSize'))) ? Number(params.get('pageSize')) : 25,
    minPlays,
    minMonths: boundedInteger(params.get('minMonths'), 1, 120),
    minKnownSkips: rawMinKnownSkips ?? (sortBy === 'skipRate' || sortBy === 'lowSkipRate' ? minPlays : null),
    density: presentation.density === 'compact' ? 'compact' : 'comfortable',
    visibleCols
  };
}

export function patchExploreQuery(query, patch = {}) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  for (const [key, value] of Object.entries(patch)) {
    if (!EXPLORE_QUERY_FIELDS.has(key)) continue;
    if (value == null) params.delete(key);
    else params.set(key, String(value));
  }

  if (Object.hasOwn(patch, 'minKnownSkips')) {
    const isSkipRate = params.get('sort') === 'skipRate' || params.get('sort') === 'lowSkipRate';
    if (patch.minKnownSkips != null || isSkipRate) params.delete('minPlays');
  }

  return params.toString();
}

export function describeCatalogQuery(model, ctx = {}) {
  const state = ctx.exploreState ?? {};
  const tab = TABS.has(state.tab) ? state.tab : 'artists';
  const metric = ctx.metric === 'plays' ? 'plays' : 'ms';
  let sortBy = SORTS.has(state.sort ?? state.sortBy) ? state.sort ?? state.sortBy : 'metric';
  if ((sortBy === 'dominance' || sortBy === 'deepCatalog') && tab !== 'artists') sortBy = 'metric';
  const sortDir = ['asc', 'desc'].includes(state.dir ?? state.sortDir) ? state.dir ?? state.sortDir : null;
  const pageSize = state.pageSize === 'all'
    ? 'all'
    : [25, 50, 100].includes(Number(state.pageSize)) ? Number(state.pageSize) : 25;
  const isSkipRate = sortBy === 'skipRate' || sortBy === 'lowSkipRate';
  const threshold = boundedInteger(isSkipRate ? state.minKnownSkips ?? state.minPlays : state.minPlays, 1, 10000);
  const minMonths = boundedInteger(state.minMonths, 1, 120, sortBy === 'constancy' ? 6 : null);
  const options = {
    metric,
    totalMetric: metric === 'ms' ? model.totals.ms : model.totals.records,
    query: typeof (state.q ?? state.query) === 'string' ? state.q ?? state.query : '',
    searchFields: tab === 'artists' ? ['name'] : ['name', 'artist'],
    sortBy, sortDir,
    page: boundedInteger(state.page, 1, Number.MAX_SAFE_INTEGER, 1), pageSize,
    minPlays: isSkipRate ? null : threshold ?? (sortBy === 'dominance' ? 20 : sortBy === 'forgotten' ? 15 : sortBy === 'intensity' ? 5 : null),
    minMonths,
    minKnownSkips: isSkipRate ? threshold ?? 20 : null
  };
  let pool = [...model[tab].byId.values()];
  if (sortBy === 'dominance' && tab === 'artists') {
    pool = pool.map(artist => {
      let dominant = null;
      for (const id of artist.tracks ?? []) {
        const track = model.tracks.byId.get(id);
        if (track && (!dominant || track.plays > dominant.plays || (track.plays === dominant.plays && track.ms > dominant.ms))) dominant = track;
      }
      return { ...artist, dominantTrack: dominant, dominance: dominant && artist.plays ? dominant.plays / artist.plays : 0 };
    });
  }
  if (sortBy === 'forgotten') {
    pool = pool.map(entity => ({
      ...entity,
      daysSinceEnd: model.meta.lastLoadedUtc != null && entity.lastUtc != null ? Math.max(0, Math.floor((model.meta.lastLoadedUtc - entity.lastUtc) / 86400)) : null,
      daysSinceNow: model.meta.generatedAt != null && entity.lastUtc != null ? Math.max(0, Math.floor((model.meta.generatedAt - entity.lastUtc) / 86400)) : null
    }));
  }
  return { tab, pool, options };
}

export function catalogOrderLabel(sortBy, direction) {
  return `${SORT_LABELS[sortBy] ?? 'métrica principal'}, ${direction === 'asc' ? 'ascendente' : 'descendente'}`;
}
