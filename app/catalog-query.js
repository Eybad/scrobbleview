const TABS = new Set(['artists', 'tracks', 'albums']);
const SORTS = new Set(['metric', 'rank', 'name', 'artist', 'plays', 'ms', 'days', 'months', 'firstTs', 'lastTs', 'intensity', 'skipRate', 'lowSkipRate', 'constancy', 'longevity']);
const SORT_LABELS = { metric: 'métrica principal', rank: 'posición', name: 'nombre', artist: 'artista', plays: 'reproducciones', ms: 'tiempo', days: 'días activos', months: 'meses activos', firstTs: 'primera escucha', lastTs: 'última escucha', intensity: 'intensidad', skipRate: 'tasa de salto', lowSkipRate: 'tasa de salto', constancy: 'constancia', longevity: 'longevidad' };

function boundedInteger(value, min, max, fallback = null) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

export function describeCatalogQuery(model, ctx = {}) {
  const state = ctx.exploreState ?? {};
  const tab = TABS.has(state.tab) ? state.tab : 'artists';
  const metric = ctx.metric === 'plays' ? 'plays' : 'ms';
  const sortBy = SORTS.has(state.sortBy) ? state.sortBy : 'metric';
  const sortDir = ['asc', 'desc'].includes(state.sortDir) ? state.sortDir : null;
  const pageSize = [25, 50, 100].includes(Number(state.pageSize)) ? Number(state.pageSize) : 25;
  const threshold = boundedInteger(state.minPlays, 1, 10000);
  const minMonths = boundedInteger(state.minMonths, 1, 120, sortBy === 'constancy' ? 6 : null);
  const isSkipRate = sortBy === 'skipRate' || sortBy === 'lowSkipRate';
  const options = {
    metric,
    totalMetric: metric === 'ms' ? model.totals.ms : model.totals.records,
    query: typeof state.query === 'string' ? state.query : '',
    searchFields: tab === 'artists' ? ['name'] : ['name', 'artist'],
    sortBy, sortDir,
    page: boundedInteger(state.page, 1, Number.MAX_SAFE_INTEGER, 1), pageSize,
    minPlays: isSkipRate ? null : threshold ?? (sortBy === 'intensity' ? 5 : null),
    minMonths,
    minKnownSkips: isSkipRate ? threshold ?? 20 : null
  };
  return { tab, pool: [...model[tab].byId.values()], options };
}

export function catalogOrderLabel(sortBy, direction) {
  return `${SORT_LABELS[sortBy] ?? 'métrica principal'}, ${direction === 'asc' ? 'ascendente' : 'descendente'}`;
}
