// UI composition root: URL, filter state, worker responses and rendering.

import { createAnalysisClient } from './analysis-client.js';
import { createAnalysisState } from './analysis-state.js';
import { AbortError } from '../src/parse/errors.js';
import { emptyFilterState, RANGE_PRESETS } from '../src/filters.js';
import { setupInput } from './input.js';
import { renderView, rankCardHTML, receiptText, emptyFiltersHTML, footerMetaText, calendarYearGridHTML } from './views.js';
import { exportExploreTableCSV, exportFilename } from '../src/export.js';
import { queryCatalog } from '../src/query.js';
import { describeCatalogQuery, catalogOrderLabel } from './catalog-query.js';
import { esc, fmtNum } from '../src/charts.js';
import { filterBarHTML, isFilterActive, BLOCKS, chipsHTML, isoDateToDay, locToISODate, rangeFromYear, rangeFromMonth, syncRangeShortcuts, normalizeRangeDays, filterStatusMessage, filterParams, portableFilterParams, resolvePortableFilters, advancedFilterCount } from './filter-ui.js';
import { clear as cacheClear, cacheSummary, isAvailable as cacheAvailable, persist as cachePersist } from './storage.js';
import { resolveMetric, parseQueryParams, serializeMetricParam, METRIC_STORAGE_KEY, DEFAULT_METRIC } from './state-metric.js';
import { parseRoute, resolveRoute, formatSemanticRoute, mergeExploreParams } from './routes.js';
import { captureHistoryState, restoreHistoryState } from './history-state.js';
import { contextBarHTML } from './context-bar.js';
import { parseCalendarState, calendarQuery } from './calendar-ui.js';

const appRoot = document.getElementById('app-root');
const siteHeader = document.querySelector('.site-header');
const headerActions = document.getElementById('header-actions');
const siteFooter = document.querySelector('.site-footer');
const footerMeta = document.getElementById('footer-meta');
const tagline = document.querySelector('.tagline');

const LIMITS_STORAGE_KEY = 'scrobbleview:tableLimits';
const VALID_LIMITS = new Set([10, 25, 50, 100]);

function loadStoredLimits() {
  const map = new Map();
  let rankTopN = 10;
  try {
    const raw = localStorage.getItem(LIMITS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          const num = Number(v);
          if (!VALID_LIMITS.has(num)) continue;
          if (k === '__rank__') rankTopN = num;
          else map.set(k, num);
        }
      }
    }
  } catch {
    // localStorage may be disabled or unavailable in private contexts.
  }
  return { map, rankTopN };
}

function saveStoredLimits() {
  try {
    const obj = { __rank__: rankUI.topN };
    for (const [k, v] of tableLimits.entries()) obj[k] = v;
    localStorage.setItem(LIMITS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage quota or security errors.
  }
}

const initialLimits = loadStoredLimits();
let model = null; // modelo completo (sin filtros)
let current = null; // modelo activo (filtrado o completo)
let currentPrev = null;
let currentDetail = null, detailContext = null, detailPage = 1, detailPageSize = 25;
let unresolvedFilter = false;
let initializing = false;
let state = emptyFilterState();
let activeMetric = resolveMetric(null, typeof localStorage !== 'undefined' ? localStorage.getItem(METRIC_STORAGE_KEY) : null);
let rankUI = { tab: 'artists', metric: activeMetric, topN: initialLimits.rankTopN, query: '' };
const tableLimits = initialLimits.map;
let cacheOffer = null; // null | 'save' | 'saved' | 'loaded' | 'error'
let advState = null;
let popReturnState = null;
const chartSelections = new Map();

// Toast para títulos de gráficos en táctil (se crea una vez: sobrevive a los
// re-renders porque vive fuera de #app-root; el texto va por textContent).
const toast = document.createElement('div');
toast.id = 'chart-toast';
toast.className = 'toast';
toast.setAttribute('role', 'status');
toast.setAttribute('aria-atomic', 'true');
toast.hidden = true;
document.body.appendChild(toast);
let toastTimer = 0;

// Región viva única para cambios asíncronos que no se anuncian solos
// (WCAG 4.1.3): re-agregado por filtros, resultados de búsqueda, copia de
// recibo. Persistente fuera de #app-root: sobrevive a los re-renders.
const liveRegion = document.createElement('p');
liveRegion.id = 'live-status';
liveRegion.className = 'visually-hidden';
liveRegion.setAttribute('role', 'status');
liveRegion.setAttribute('aria-atomic', 'true');
document.body.appendChild(liveRegion);

function announce(text) {
  liveRegion.textContent = text;
}

function chartPoints(card) {
  try {
    const points = JSON.parse(card.dataset.chartPoints ?? '[]');
    return Array.isArray(points) ? points : [];
  } catch {
    return [];
  }
}

function selectChartPoint(card, index) {
  const points = chartPoints(card);
  if (!points.length) return;
  const selectedIndex = Math.max(0, Math.min(points.length - 1, index));
  const point = points[selectedIndex];
  chartSelections.set(card.dataset.chartId, { index: selectedIndex, key: point.date || point.label });
  const inspector = card.querySelector('.chart-inspector');
  if (!inspector) return;
  inspector.querySelector('.chart-inspector__label').textContent = point.date || point.label;
  inspector.querySelector('.chart-inspector__value').textContent = point.valueText;
  inspector.querySelector('.chart-inspector__pct').textContent = point.shareText ? ` · ${point.shareText}` : '';
  inspector.hidden = false;
  const status = card.querySelector('.chart-nav__status');
  if (status) status.textContent = `${selectedIndex + 1} de ${points.length}: ${point.label}`;
  card.querySelectorAll('[data-chart-step]').forEach((button) => {
    const direction = Number(button.dataset.dir);
    button.disabled = direction < 0 ? selectedIndex === 0 : selectedIndex === points.length - 1;
  });
  card.querySelectorAll('[data-chart-index]').forEach((item) => {
    item.classList.toggle('is-selected', Number(item.dataset.chartIndex) === selectedIndex);
  });
}

function restoreChartSelections() {
  appRoot.querySelectorAll('.chart-card[data-chart-id]').forEach((card) => {
    const selection = chartSelections.get(card.dataset.chartId);
    if (!selection) return;
    const points = chartPoints(card);
    const matchingIndex = points.findIndex((point) => (point.date || point.label) === selection.key);
    if (matchingIndex >= 0) selectChartPoint(card, matchingIndex);
    else chartSelections.delete(card.dataset.chartId);
  });
}

function chartIndexAt(svg, chart, event, points) {
  const rect = svg.getBoundingClientRect();
  if (chart.dataset.chartType === 'grid' || chart.dataset.chartType === 'stacked') {
    const matrix = svg.getScreenCTM();
    if (!matrix) return 0;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const position = cursor.matrixTransform(matrix.inverse());
    if (chart.dataset.chartType === 'stacked') {
      const rowHeight = (svg.viewBox.baseVal.height - 4) / points.length;
      return Math.max(0, Math.min(points.length - 1, Math.floor(position.y / rowHeight)));
    }
    const cols = Number(svg.dataset.gridCols);
    const rows = Number(svg.dataset.gridRows);
    const labelWidth = Number(svg.dataset.gridLabelWidth);
    const labelTop = Number(svg.dataset.gridLabelTop ?? 0);
    const cellWidth = Number(svg.dataset.gridCellWidth);
    const cellHeight = Number(svg.dataset.gridCellHeight);
    const gap = Number(svg.dataset.gridGap);
    const x = Math.max(0, Math.min(cols - 1, Math.floor((position.x - labelWidth) / (cellWidth + gap))));
    const y = Math.max(0, Math.min(rows - 1, Math.floor((position.y - labelTop) / (cellHeight + gap))));
    return points.findIndex((point) => point.extra?.x === x && point.extra?.y === y);
  }
  if (rect.width <= 0) return 0;
  const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(position * (points.length - 1));
}

function announceFilters() {
  if (!current) return;
  announce(filterStatusMessage(current.totals));
}

const analysisClient = createAnalysisClient();
const analysisState = createAnalysisState(analysisClient);
const processing = document.getElementById('processing');
const processingStatus = document.getElementById('processing-status');
const processingProgress = document.getElementById('processing-progress');
const cancelProcessing = document.getElementById('cancel-processing');
const retryProcessing = document.getElementById('retry-processing');
const jobs = new Map();
let nextJob = 0, processingError = null, processingErrorType = null;

function updateProcessing() {
  const job = [...jobs.values()].at(-1);
  processing.hidden = !job && !processingError;
  processingStatus.setAttribute('role', processingError && !job ? 'alert' : 'status');
  processingStatus.textContent = job ? `${job.label}… ${Math.round(job.fraction * 100)}%` : processingError ?? '';
  processingProgress.hidden = !job;
  if (job) processingProgress.value = job.fraction;
  cancelProcessing.hidden = !job;
  retryProcessing.hidden = Boolean(job) || processingErrorType !== 'filter' || !analysisState.getFailed() || !analysisState.getConfirmed().context;
}

function beginProcessing(label, type = 'general') {
  const id = ++nextJob;
  processingError = null;
  processingErrorType = null;
  jobs.set(id, { label, fraction: 0, type });
  updateProcessing();
  return {
    progress(fraction, nextLabel) { if (jobs.has(id)) { jobs.set(id, { fraction, label: nextLabel, type }); updateProcessing(); } },
    finish() { jobs.delete(id); updateProcessing(); }
  };
}

function reportProcessingError(error, type = 'general') {
  if (error.code === 'E_ABORT') return;
  processingErrorType = type;
  if (type === 'filter') {
    processingError = `${error.message} Reintentá o restablecé los filtros.`;
  } else if (type === 'export') {
    processingError = `${error.message} Reintentá la exportación.`;
  } else {
    processingError = `${error.message} Podés volver a cargar los archivos.`;
  }
  updateProcessing();
}

async function initializeAnalysis(result) {
  model = result.model;
  current = model;
  currentPrev = null;
  currentDetail = null; detailContext = null; detailPage = 1; detailPageSize = 25;
  analysisState.initialize(model);
  rankUI = { tab: 'artists', metric: activeMetric, topN: rankUI.topN, query: '' };
  initializing = true;
  try {
    let restored, hash;
    do {
      hash = location.hash;
      restored = await applyHashParams();
      if (!model) throw new AbortError();
    } while (!restored || hash !== location.hash);
  } finally { initializing = false; }
  return { model };
}

async function analyze(input, { onProgress } = {}) {
  const job = beginProcessing('Leyendo archivos', 'import');
  try {
    const result = await analysisClient.request('load', input, { onProgress(fraction, label) {
      job.progress(fraction, label); onProgress?.(fraction, label);
    } });
    await initializeAnalysis(result);
    cacheOffer = cacheAvailable() ? 'save' : null;
    return result;
  } finally { job.finish(); }
}

async function loadCached() {
  const job = beginProcessing('Cargando datos guardados', 'import');
  try {
    const result = await analysisClient.request('cached', {}, { onProgress: job.progress });
    if (!result) return null;
    await initializeAnalysis(result);
    cacheOffer = 'loaded';
    return result;
  } finally { job.finish(); }
}

async function clearCached() {
  if (!await cacheClear()) return false;
  cacheOffer = null;
  updateCacheToast();
  inputApi.showCachedButtons(false);
  return true;
}

function setFilterBusy(busy) {
  appRoot.setAttribute('aria-busy', String(busy));
  appRoot.classList.toggle('app--updating', busy);
  for (const selector of ['#filter-bar', '#view-root']) {
    appRoot.querySelector(selector)?.toggleAttribute('inert', busy);
  }
}

async function refreshModel() {
  if (!model) return false;
  const [view, id, originQuery] = parseHash();
  const nextDetailContext = (view === 'day' || view === 'session' || view === 'track') ? JSON.stringify([view, id, filterParams(state)]) : null;
  if (nextDetailContext !== detailContext) {
    detailContext = nextDetailContext;
    detailPage = 1;
    detailPageSize = 25;
  }
  const requestedHash = location.hash;
  const job = beginProcessing('Actualizando estadísticas', 'filter');
  setFilterBusy(true);
  try {
    const result = await analysisState.update(state, { view, id, originQuery, page: detailPage, pageSize: detailPageSize, context: { hash: requestedHash || '#/dashboard', metric: activeMetric }, onProgress: job.progress });
    if (!result || requestedHash !== location.hash) return false;
    current = result.model;
    currentPrev = result.prev;
    currentDetail = result.detail;
    return true;
  } catch (error) {
    if (error.code !== 'E_ABORT') {
      if (!initializing) restoreConfirmedContext();
      reportProcessingError(error, 'filter');
    }
    if (initializing) throw error;
    return false;
  } finally {
    job.finish();
    setFilterBusy([...jobs.values()].some(item => item.type === 'filter'));
  }
}

function restoreConfirmedContext(confirmed = analysisState.getConfirmed()) {
  if (!confirmed?.context) return false;
  state = confirmed.context.state;
  activeMetric = confirmed.context.metric;
  rankUI.metric = activeMetric;
  current = confirmed.model;
  currentPrev = confirmed.prev;
  currentDetail = confirmed.detail;
  detailPage = confirmed.context.page;
  detailPageSize = confirmed.context.pageSize;
  detailContext = (confirmed.context.view === 'day' || confirmed.context.view === 'session' || confirmed.context.view === 'track')
    ? JSON.stringify([confirmed.context.view, confirmed.context.id, filterParams(state)]) : null;
  if (location.hash !== confirmed.context.hash) history.replaceState(history.state, '', confirmed.context.hash);
  unresolvedFilter = false;
  render();
  return true;
}

function parseHash() {
  const parsed = parseRoute(location.hash);
  const resolved = resolveRoute(parsed, model || current);
  return [resolved.view, resolved.id, parsed.query, resolved];
}

// La URL refleja el estado de filtros (deep-link + reload). replaceState: sin
// entrada de historial por cada chip (el Back queda para navegar vistas; al
// volver, los params del hash de esa entrada restauran sus filtros).
function syncHash() {
  const [name, id, , resolved] = parseHash();
  const fParams = portableFilterParams(state, model);
  const mParam = serializeMetricParam(activeMetric);
  const queryStr = fParams ? `${fParams}&${mParam}` : `?${mParam}`;
  const [, , rawQuery] = parseHash();
  let hash;
  if (name === 'explore') {
    const merged = mergeExploreParams(queryStr, rawQuery);
    hash = `#/v1/explore${merged ? `?${merged}` : ''}`;
  } else if (name === 'calendar') {
    const merged = calendarQuery(queryStr, state.calMonth, state.normalizeYears);
    hash = formatSemanticRoute('calendar', id, merged);
  } else if (resolved?.entity && (name === 'artist' || name === 'track' || name === 'album')) {
    const merged = new URLSearchParams(queryStr.replace(/^\?/, ''));
    if (name === 'track') {
      const existing = new URLSearchParams(rawQuery);
      for (const key of ['originArtist', 'originAlbum']) if (existing.has(key)) merged.set(key, existing.get(key));
    }
    hash = formatSemanticRoute(name, resolved.entity, `?${merged}`);
  } else {
    hash = `#/${name}${id != null ? `/${id}` : ''}${queryStr}`;
  }
  if (location.hash !== hash) history.replaceState(history.state, '', hash);
}

// The URL is authoritative on load, Back/Forward and manual hash changes.
// Restore state and its model together before any view reads either one.
async function applyHashParams() {
  const [, , query] = parseHash();
  const parsed = parseQueryParams(query);
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(METRIC_STORAGE_KEY) : null;
  activeMetric = resolveMetric(parsed.metric, stored);
  rankUI.metric = activeMetric;
  const restored = resolvePortableFilters(query, model);
  state = restored.state;
  Object.assign(state, parseCalendarState(query));
  unresolvedFilter = restored.unresolved;
  return refreshModel();
}

const FAVORITES_STORAGE_KEY = 'scrobbleview:favorites';
const SECTION_NAMES = {
  dashboard: 'Resumen',
  explore: 'Explorar',
  compare: 'Comparar',
  hours: 'Horarios',
  habits: 'Hábitos',
  sessions: 'Sesiones',
  discovery: 'Descubrimiento',
  yearly: 'Años',
  calendar: 'Calendario',
  wrapped: 'Resumen del período'
};

function loadStoredFavorites() {
  const set = new Set();
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) for (const x of arr) if (typeof x === 'string') set.add(x);
    }
  } catch (_) {}
  return set;
}

function saveStoredFavorites(favs) {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...favs]));
  } catch (_) {}
}

const favorites = loadStoredFavorites();

function resetPreferences() {
  try {
    localStorage.removeItem(METRIC_STORAGE_KEY);
    localStorage.removeItem(LIMITS_STORAGE_KEY);
    localStorage.removeItem(FAVORITES_STORAGE_KEY);
    localStorage.removeItem('scrobbleview:density');
    for (const tab of ['artists', 'tracks', 'albums']) {
      localStorage.removeItem(`scrobbleview:cols:${tab}`);
    }
  } catch (_) {}
  activeMetric = 'ms';
  rankUI.metric = 'ms';
  tableLimits.clear();
  rankUI.topN = 10;
  favorites.clear();
  announce('Preferencias restablecidas a los valores predeterminados.');
  render();
}

function navHTML(active) {
  const fParams = portableFilterParams(state, model);
  const mParam = serializeMetricParam(activeMetric);
  const queryStr = fParams ? `${fParams}&${mParam}` : `?${mParam}`;
  const link = (hash, label, view) => `<a href="#/${hash}${esc(queryStr)}"${active === view ? ' aria-current="page"' : ''}>${label}</a>`;

  let favsHTML = '';
  if (favorites.size > 0) {
    const favLinks = [...favorites]
      .filter((v) => SECTION_NAMES[v])
      .map((v) => `<a href="#/${v}${esc(queryStr)}" class="nav-fav-chip${active === v ? ' active' : ''}">${SECTION_NAMES[v]}</a>`)
      .join('');
    if (favLinks) {
      favsHTML = `<div class="app-nav-favorites" aria-label="Accesos rápidos favoritos"><span class="nav-fav-title">Favoritos:</span>${favLinks}</div>`;
    }
  }

  return `${favsHTML}<nav class="app-nav" aria-label="Secciones">
    ${link('dashboard', 'Resumen', 'dashboard')}
    ${link('explore', 'Explorar', 'explore')}
    ${link('compare', 'Comparar', 'compare')}
    ${link('hours', 'Horarios', 'hours')}
    ${link('habits', 'Hábitos', 'habits')}
    ${link('sessions', 'Sesiones', 'sessions')}
    ${link('discovery', 'Descubrimiento', 'discovery')}
    ${link('yearly', 'Años', 'yearly')}
    ${link('calendar', 'Calendario', 'calendar')}
    ${link('wrapped', 'Resumen del período', 'wrapped')}
  </nav>`;
}

// Toast del guardado local: vive fuera de #app-root (sobrevive a los
// re-renders) y flotante (no consume fold: el banner en línea empujaba los
// datos más de media pantalla en móvil). La oferta 'save' es persistente
// hasta responder; 'saved'/'loaded'/'error' son transitorios y reinician
// el estado para que el próximo render no los reviva.
const cacheToast = document.createElement('div');
cacheToast.id = 'cache-toast';
cacheToast.className = 'cache-toast';
cacheToast.setAttribute('role', 'status');
cacheToast.setAttribute('aria-atomic', 'true');
cacheToast.hidden = true;
document.body.appendChild(cacheToast);
let cacheTimer = 0;

function updateCacheToast() {
  clearTimeout(cacheTimer);
  if (cacheOffer === 'save') {
    cacheToast.innerHTML = `<p>¿Guardar en este dispositivo? Se escribe tu historial completo (fechas, artistas, canciones) en claro en el disco, hasta que lo borres.</p>
      <div class="cache-actions">
        <button type="button" class="btn btn-primary" data-cache="save">Guardar</button>
        <button type="button" class="btn btn-link btn-quiet" data-cache="dismiss">No por ahora</button>
      </div>`;
    cacheToast.hidden = false;
    return;
  }
  if (cacheOffer === 'saved') cacheToast.innerHTML = `<p>Datos guardados en este dispositivo.</p>`;
  else if (cacheOffer === 'loaded') cacheToast.innerHTML = `<p>Mostrando los datos guardados en este dispositivo.</p>`;
  else if (cacheOffer === 'error') cacheToast.innerHTML = `<p>No se pudo guardar en este dispositivo (cuota o navegador). Podés seguir sin guardar.</p>`;
  else {
    cacheToast.hidden = true;
    return;
  }
  cacheToast.hidden = false;
  cacheTimer = setTimeout(() => { cacheOffer = null; cacheToast.hidden = true; }, 4000);
}

// Delegación única: los botones del toast se re-crean con cada estado.
cacheToast.addEventListener('click', async (e) => {
  const btn = e.target.closest?.('[data-cache]');
  if (!btn) return;
  if (btn.dataset.cache === 'save') {
    let ok;
    try { ok = await analysisClient.request('save'); }
    catch (error) { if (error.code === 'E_ABORT') return; ok = false; }
    if (!model) return;
    if (ok) {
      cacheOffer = 'saved';
      cachePersist(); // best-effort: pedir al SO que no evicte la caché
    } else {
      // Si falló y había caché previa, borrarla: datos viejos engañarían.
      await cacheClear();
      cacheOffer = 'error';
    }
  } else {
    cacheOffer = null; // No por ahora
  }
  updateCacheToast();
});

function buildViewContext(viewName) {
  const fParams = portableFilterParams(state, model);
  const mParam = serializeMetricParam(activeMetric);
  const queryStr = fParams ? `${fParams}&${mParam}` : `?${mParam}`;
  const [, , rawQuery] = parseHash();

  let exploreState = null;
  if (viewName === 'explore') {
    const [, , rawQ] = parseHash();
    const cleanQ = (rawQ || '').replace(/^\?/, '');
    const p = new URLSearchParams(cleanQ);
    const tab = p.get('tab') || 'artists';
    const storedDensity = typeof localStorage !== 'undefined' ? localStorage.getItem('scrobbleview:density') : null;
    const storedColsRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(`scrobbleview:cols:${tab}`) : null;
    let visibleCols = null;
    if (storedColsRaw) {
      try { visibleCols = new Set(JSON.parse(storedColsRaw)); } catch (_) {}
    }

    exploreState = {
      tab,
      query: p.get('q') || '',
      sortBy: p.get('sort') || 'metric',
      sortDir: p.get('dir') || null,
      page: Number(p.get('page')) || 1,
      pageSize: Number(p.get('pageSize')) || 25,
      minPlays: p.get('minPlays') != null ? Number(p.get('minPlays')) : null,
      minMonths: p.get('minMonths') != null ? Number(p.get('minMonths')) : null,
      density: storedDensity || 'comfortable',
      visibleCols
    };
  }

  return {
    years: state.years,
    range: state.range,
    prev: viewName === 'dashboard' ? currentPrev : null,
    limits: tableLimits,
    metric: activeMetric,
    rankUI,
    query: queryStr,
    exploreState,
    detail: currentDetail,
    rawQuery,
    detailRequested: viewName === 'day' || viewName === 'session' || viewName === 'track',
    normalizeYears: state.normalizeYears ?? false,
    calMonth: state.calMonth,
    month: state.calMonth?.month,
    comparePreset: state.comparePreset || 'equal_previous'
  };
}

function render() {
  if (!current) return;
  const [name, id, , resolved] = parseHash();
  // Reconstruir el HTML resetea el scroll de la fila: se conserva y restaura
  // para que navegar no pegue un salto brusco (el bug se veía al tocar una
  // sección con el nav deslizado a la derecha).
  const navX = appRoot.querySelector('.app-nav')?.scrollLeft ?? 0;
  const isEmpty = isFilterActive(state) && current.totals.records === 0;
  const viewCtx = buildViewContext(name);
  let viewContent;
  if (resolved?.notFound) {
    const tab = name === 'artist' ? 'artists' : name === 'track' ? 'tracks' : 'albums';
    const params = new URLSearchParams(viewCtx.query.replace(/^\?/, ''));
    params.set('tab', tab);
    viewContent = `<div class="empty-state">
      <p class="empty">${name === 'artist' ? 'Artista no encontrado.' : name === 'track' ? 'Canción no encontrada.' : 'Álbum no encontrado.'}</p>
      <p class="empty-hint">${resolved.legacy ? 'Este enlace antiguo no identifica la entidad de forma verificable en este historial.' : 'No hay coincidencias en el historial cargado.'}</p>
      <p><a href="#/v1/explore?${esc(params.toString())}" class="btn btn-secondary">Buscar en Explorar</a></p>
      <p><a href="#/dashboard" class="btn btn-primary">← Volver al resumen</a></p>
    </div>`;
  } else {
    viewContent = isEmpty ? emptyFiltersHTML() : renderView(name, current, id, viewCtx);
  }
  const filterWarning = unresolvedFilter ? `<div class="card" id="filter-resolution-warning" role="alert"><p>Un filtro de entidad del enlace no pudo asociarse con este historial. Buscá la entidad para seleccionarla de nuevo.</p><a href="#/v1/explore${esc(viewCtx.query)}">Buscar en Explorar</a></div>` : '';
  appRoot.innerHTML = navHTML(name) + filterBarHTML(model, state) + contextBarHTML({ state, model, metric: activeMetric }) + filterWarning + `<div id="view-root">${viewContent}</div>`;
  restoreChartSelections();
  updateCacheToast();
  announceFilters();
  const nav = appRoot.querySelector('.app-nav');
  if (nav) {
    nav.scrollLeft = navX;
    // Fade izquierdo solo con scroll real: en reposo atenuaría la 1ra sección.
    const syncNavFade = () => {
      nav.classList.toggle('is-scrolled', nav.scrollLeft > 0);
      nav.classList.toggle('is-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
    };
    syncNavFade();
    nav.addEventListener('scroll', syncNavFade, { passive: true });
    // La sección activa entra en vista solo si no se ve (nearest = sin
    // movimiento cuando ya está visible; nunca scrollea la página).
    nav.querySelector('a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // Header actions y footer solo en la vista app: en inicio el footer repite
  // el aviso de privacidad y las acciones no aplican. La tagline también se
  // oculta: junto al nav compite con el título de la vista (el reload del
  // botón "Cargar archivos" la restaura).
  siteHeader?.classList.remove('site-header--home');
  headerActions?.removeAttribute('hidden');
  siteFooter?.removeAttribute('hidden');
  if (footerMeta && model) {
    footerMeta.textContent = footerMetaText(model);
    footerMeta.hidden = false;
  }
  tagline?.setAttribute('hidden', '');
  wireFilters();
  wireView();
}

// Cambio de filtro: re-agrega y actualiza SOLO la vista + los dinámicos de la
// barra (presets, meses, fechas, chips, fila de Limpiar). La barra persiste: no
// se pierde el foco ni el estado del <details> de avanzados.
async function applyAndRenderView(focusSelector = null) {
  unresolvedFilter = false;
  appRoot.querySelector('#filter-resolution-warning')?.remove();
  syncHash();
  updateFilterDynamics();
  if (!await refreshModel()) return;
  const [name, id] = parseHash();
  const root = document.getElementById('view-root');
  if (root) {
    const isEmpty = isFilterActive(state) && current.totals.records === 0;
    const viewCtx = buildViewContext(name);
    root.innerHTML = isEmpty ? emptyFiltersHTML() : renderView(name, current, id, viewCtx);
  }
  updateFilterDynamics();
  announceFilters();
  syncHash();
  wireView();
  if (focusSelector) appRoot.querySelector(focusSelector)?.focus();
}

// Sincroniza los controles de la barra con el estado (sin re-renderizarla).
function updateFilterDynamics() {
  const bar = document.getElementById('filter-bar');
  if (!bar || !model || !current) return;
  const last = model.meta.lastTs ?? 0;
  bar.querySelectorAll('[data-preset]').forEach((btn) => {
    const p = RANGE_PRESETS.find((x) => x.id === btn.dataset.preset);
    const active = p.id === 'all'
      ? !state.range
      : state.range != null && state.range.from === last - p.days * 86400 && state.range.to === last;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  // Los shortcuts de año/mes reflejan el rango vigente (sync inverso): match
  // exacto → el valor, rango arbitrario → "Personalizado", sin rango →
  // placeholder. Nunca hay dos verdades sobre el período activo.
  syncRangeShortcuts(bar.querySelector('[data-filter="year"]'), document.getElementById('filter-month'), state.range);
  bar.querySelectorAll('[data-dow]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(state.dows?.has(Number(btn.dataset.dow)) ?? false));
  });
  bar.querySelectorAll('[data-block]').forEach((btn) => {
    const b = BLOCKS.find((x) => x.id === Number(btn.dataset.block));
    const on = state.hours != null && b.hours.every((h) => state.hours.has(h));
    btn.setAttribute('aria-pressed', String(on));
  });
  bar.querySelectorAll('[data-toggle3]').forEach((sel) => {
    const key = sel.dataset.toggle3;
    sel.value = state[key] === true ? 'yes' : state[key] === false ? 'no' : state[key] === 'unknown' ? 'unknown' : '';
  });
  const badge = document.getElementById('filter-adv-badge');
  if (badge) {
    const activeAdvCount = advancedFilterCount(state, last);
    badge.textContent = String(activeAdvCount);
    badge.hidden = activeAdvCount === 0;
  }
  const from = bar.querySelector('[data-filter="from"]');
  if (from) from.value = state.range ? locToISODate(state.range.from) : '';
  const to = bar.querySelector('[data-filter="to"]');
  if (to) to.value = state.range ? locToISODate(state.range.to) : '';
  const chips = document.getElementById('filter-chips');
  if (chips) chips.innerHTML = chipsHTML(model, state);
}

function wireFilters() {
  const adv = appRoot.querySelector('.filter-advanced');
  if (adv) {
    adv.addEventListener('toggle', () => { advState = adv.open; });
    adv.open = advState ?? false;
  }

  appRoot.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = RANGE_PRESETS.find((x) => x.id === btn.dataset.preset);
      if (p.id === 'all') {
        state.range = null;
      } else {
        const last = model.meta.lastTs;
        state.range = { from: last - p.days * 86400, to: last };
      }
      applyAndRenderView();
    });
  });

  appRoot.querySelectorAll('[data-filter="year"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (!v) return;
      state.range = rangeFromYear(Number(v));
      applyAndRenderView();
    });
  });
  appRoot.querySelectorAll('[data-filter="month"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (!v) return;
      state.range = rangeFromMonth(Number(v));
      applyAndRenderView();
    });
  });

  // Rango personalizado con fechas (from/to en época local). `edited` dice qué
  // input disparó el cambio: si el par queda invertido, colapsa al día editado.
  const fromInput = appRoot.querySelector('[data-filter="from"]');
  const toInput = appRoot.querySelector('[data-filter="to"]');
  const onDate = (edited) => {
    const f = fromInput ? isoDateToDay(fromInput.value) : null;
    const t = toInput ? isoDateToDay(toInput.value) : null;
    if (f == null && t == null) {
      state.range = null;
    } else {
      const norm = normalizeRangeDays(f, t, edited);
      const first = model.meta.firstTs ?? 0;
      const lastTs = model.meta.lastTs ?? 0;
      state.range = {
        from: norm.fromDay != null ? norm.fromDay * 86400 : first,
        to: norm.toDay != null ? norm.toDay * 86400 + 86399 : lastTs
      };
    }
    applyAndRenderView();
  };
  if (fromInput) fromInput.addEventListener('change', () => onDate('from'));
  if (toInput) toInput.addEventListener('change', () => onDate('to'));

  appRoot.querySelectorAll('[data-dow]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.dow);
      const wasOn = state.dows?.has(d) ?? false;
      if (!state.dows) state.dows = new Set();
      if (!wasOn) state.dows.add(d);
      else state.dows.delete(d);
      if (state.dows.size === 7 || state.dows.size === 0) state.dows = null;
      applyAndRenderView();
    });
  });

  appRoot.querySelectorAll('[data-block]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = BLOCKS.find((x) => x.id === Number(btn.dataset.block));
      const wasOn = state.hours != null && b.hours.every((h) => state.hours.has(h));
      if (!state.hours) state.hours = new Set();
      if (!wasOn) b.hours.forEach((h) => state.hours.add(h));
      else b.hours.forEach((h) => state.hours.delete(h));
      if (state.hours.size === 24 || state.hours.size === 0) state.hours = null;
      applyAndRenderView();
    });
  });

  // Flag filters distinguish all, true, false and unknown values.
  appRoot.querySelectorAll('[data-toggle3]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const k = sel.dataset.toggle3;
      if (k !== 'skip' && k !== 'shuffle' && k !== 'offline') return;
      state[k] = sel.value === '' ? null : sel.value === 'unknown' ? 'unknown' : sel.value === 'yes';
      applyAndRenderView();
    });
  });
}

// La vista se re-renderiza sin tocar la barra de filtros (persistencia de la barra).

let searchTimer = 0;

function syncTallTables(root) {
  root.querySelectorAll('.table-scroll--tall').forEach((wrap) => {
    const tenthRow = wrap.querySelector('tbody')?.rows?.[9];
    if (tenthRow) {
      const hBar = Math.max(0, wrap.offsetHeight - wrap.clientHeight);
      wrap.style.maxHeight = `${tenthRow.offsetTop + tenthRow.offsetHeight + hBar}px`;
    } else {
      wrap.style.removeProperty('max-height');
    }
  });
}

function updateRankCard(focusSel = null) {
  const card = document.getElementById('rank-card');
  if (!card || !current) return;
  // Mismo caso que el nav: conservar el scroll de las filas de tabs.
  const tabsX = [...card.querySelectorAll('.tabs')].map((t) => t.scrollLeft);
  card.innerHTML = rankCardHTML(current, { ...rankUI, contextQuery: buildViewContext('dashboard').query });
  card.querySelectorAll('.tabs').forEach((t, i) => { t.scrollLeft = tabsX[i] ?? 0; });
  wireRankCard();
  syncTallTables(card);
  // El re-render destruye el control activado: devolverle el foco (teclado).
  if (focusSel) card.querySelector(focusSel)?.focus();
}

function wireRankCard() {
  const card = document.getElementById('rank-card');
  if (!card) return;
  card.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankUI.tab = btn.dataset.tab;
      updateRankCard(`[data-tab="${rankUI.tab}"]`);
    });
  });
  card.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeMetric = btn.dataset.metric;
      rankUI.metric = activeMetric;
      try { localStorage.setItem(METRIC_STORAGE_KEY, activeMetric); } catch (_) {}
      syncHash();
      render();
      const newBtn = appRoot.querySelector(`[data-metric="${activeMetric}"]`);
      if (newBtn) newBtn.focus();
    });
  });
  const sel = card.querySelector('[data-topn]');
  if (sel) sel.addEventListener('change', () => {
    const nextTopN = Number(sel.value);
    if (!VALID_LIMITS.has(nextTopN)) return;
    rankUI.topN = nextTopN;
    saveStoredLimits();
    updateRankCard('[data-topn]');
  });
  // Flechas del tablist (APG, activación automática): la selección sigue al
  // foco; el re-render reposiciona el foco en el tab activado.
  const tablist = card.querySelector('[role="tablist"][aria-label="Rankings"]');
  if (tablist) tablist.addEventListener('keydown', (e) => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === 'Home' ? tabs[0]
      : e.key === 'End' ? tabs[tabs.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    next.click();
  });
  const input = card.querySelector('[data-search]');
  if (input) input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const v = input.value;
    searchTimer = setTimeout(() => {
      rankUI.query = v;
      updateRankCard('[data-search]');
      const again = card.querySelector('[data-search]');
      if (again) again.setSelectionRange(again.value.length, again.value.length);
      // El cambio de tabla no se anuncia solo: la región viva da el conteo.
      const q = v.trim();
      if (q) {
        const n = card.querySelectorAll('tbody tr').length;
        announce(n > 0 ? `${n} ${n === 1 ? 'resultado' : 'resultados'} de “${q}”` : 'Sin resultados.');
      }
    }, 200);
  });
}

function wireExploreView() {
  const card = document.getElementById('explore-card');
  if (!card) return;

  const getExploreQuery = () => {
    const [, , q] = parseHash();
    return new URLSearchParams(q ? q.replace(/^\?/, '') : '');
  };

  const updateExploreQuery = (updater, focusSelector = null, selection = null) => {
    const tableScroll = card.querySelector('.table-scroll');
    const scrollLeft = tableScroll?.scrollLeft ?? 0;
    const scrollTop = tableScroll?.scrollTop ?? 0;
    const columnsOpen = card.querySelector('.col-picker')?.open ?? false;
    const params = getExploreQuery();
    updater(params);
    const [, id] = parseHash();
    const queryStr = params.toString() ? `?${params.toString()}` : '';
    const hash = formatSemanticRoute('explore', null, queryStr);
    history.replaceState(history.state, '', hash);
    analysisState.updatePresentation({ hash: location.hash, metric: activeMetric });
    const root = document.getElementById('view-root');
    if (root && current) {
      const viewCtx = buildViewContext('explore');
      root.innerHTML = renderView('explore', current, id, viewCtx);
      wireView();
      const nextScroll = root.querySelector('.table-scroll');
      if (nextScroll) { nextScroll.scrollLeft = scrollLeft; nextScroll.scrollTop = scrollTop; }
      const columns = root.querySelector('.col-picker');
      if (columns) columns.open = columnsOpen;
      const target = focusSelector && root.querySelector(focusSelector);
      const focusTarget = !focusSelector ? null : target && !target.disabled ? target : root.querySelector('[data-explore-search]');
      focusTarget?.focus({ preventScroll: true });
      if (selection && target && typeof target.setSelectionRange === 'function') {
        target.setSelectionRange(selection.start, selection.end, selection.direction);
      }
    }
  };

  card.querySelectorAll('[data-explore-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.exploreTab;
      updateExploreQuery((p) => {
        p.set('tab', tab);
        p.delete('page');
        p.delete('sort');
        p.delete('dir');
        p.delete('minPlays');
        p.delete('minMonths');
      }, `[data-explore-tab="${tab}"]`);
    });
  });

  const tablist = card.querySelector('[role="tablist"][aria-label="Explorar catálogo"]');
  tablist?.addEventListener('keydown', (event) => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : null;
    if (!next) return;
    event.preventDefault();
    next.click();
  });

  let exploreSearchTimer;
  const searchInput = card.querySelector('[data-explore-search]');
  if (searchInput) {
    let composing = false;
    const scheduleSearch = () => {
      clearTimeout(exploreSearchTimer);
      exploreSearchTimer = setTimeout(() => {
        if (!searchInput.isConnected) return;
        const v = searchInput.value;
        const wasFocused = document.activeElement === searchInput;
        const selection = { start: searchInput.selectionStart, end: searchInput.selectionEnd, direction: searchInput.selectionDirection };
        updateExploreQuery((p) => {
          if (v) p.set('q', v);
          else p.delete('q');
          p.delete('page');
        }, wasFocused ? '[data-explore-search]' : null, wasFocused && selection.start != null && selection.end != null ? selection : null);
      }, 200);
    };
    searchInput.addEventListener('compositionstart', () => { composing = true; clearTimeout(exploreSearchTimer); });
    searchInput.addEventListener('compositionend', () => { composing = false; scheduleSearch(); });
    searchInput.addEventListener('input', (event) => { if (!composing && !event.isComposing) scheduleSearch(); });
  }

  card.querySelectorAll('[data-clear-search]').forEach((btn) => {
    btn.addEventListener('click', () => {
      updateExploreQuery((p) => {
        p.delete('q');
        p.delete('page');
      }, '[data-explore-search]');
    });
  });

  card.querySelectorAll('.btn-sort').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort;
      const dir = btn.dataset.dir;
      updateExploreQuery((p) => {
        p.set('sort', sort);
        p.set('dir', dir);
        p.delete('page');
      }, `[data-sort="${sort}"]`);
    });
  });

  card.querySelectorAll('[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const page = Number(btn.dataset.page);
      if (!page || page < 1) return;
      updateExploreQuery((p) => {
        p.set('page', String(page));
      }, `[data-page-action="${btn.dataset.pageAction}"]`);
    });
  });

  const pageSizeSelect = card.querySelector('[data-page-size]');
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      const size = Number(pageSizeSelect.value);
      updateExploreQuery((p) => {
        p.set('pageSize', String(size));
        p.delete('page');
      }, '[data-page-size]');
    });
  }

  card.querySelectorAll('[data-density]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = btn.dataset.density;
      if (typeof localStorage !== 'undefined') localStorage.setItem('scrobbleview:density', d);
      updateExploreQuery(() => {}, `[data-density="${d}"]`);
    });
  });

  card.querySelectorAll('[data-col-toggle]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const col = chk.dataset.colToggle;
      const [, , q] = parseHash();
      const p = new URLSearchParams(q ? q.replace(/^\?/, '') : '');
      const tab = p.get('tab') || 'artists';
      const set = new Set([...card.querySelectorAll('[data-col-toggle]:checked')].map(input => input.dataset.colToggle));
      if (typeof localStorage !== 'undefined') localStorage.setItem(`scrobbleview:cols:${tab}`, JSON.stringify([...set]));
      updateExploreQuery(() => {}, `[data-col-toggle="${col}"]`);
    });
  });

  card.querySelectorAll('[data-reset-cols]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [, , q] = parseHash();
      const p = new URLSearchParams(q ? q.replace(/^\?/, '') : '');
      const tab = p.get('tab') || 'artists';
      if (typeof localStorage !== 'undefined') localStorage.removeItem(`scrobbleview:cols:${tab}`);
      updateExploreQuery(() => {}, '[data-reset-cols]');
    });
  });

  card.querySelectorAll('[data-expand-name]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cell = btn.closest('.col-name');
      const nameSpan = cell?.querySelector('.cell-name');
      if (nameSpan) {
        nameSpan.classList.toggle('is-expanded');
        btn.textContent = nameSpan.classList.contains('is-expanded') ? '▼' : '▶';
      }
    });
  });

  const minPlaysInput = card.querySelector('[data-min-plays]');
  if (minPlaysInput) {
    minPlaysInput.addEventListener('change', () => {
      const val = Math.max(1, Math.min(10000, Number(minPlaysInput.value) || 1));
      updateExploreQuery((p) => {
        p.set('minPlays', String(val));
        p.delete('page');
      }, '[data-min-plays]');
    });
  }

  const minMonthsInput = card.querySelector('[data-min-months]');
  if (minMonthsInput) {
    minMonthsInput.addEventListener('change', () => {
      const val = Math.max(1, Math.min(120, Number(minMonthsInput.value) || 1));
      updateExploreQuery((p) => {
        p.set('minMonths', String(val));
        p.delete('page');
      }, '[data-min-months]');
    });
  }

  card.querySelectorAll('[data-action="export-table"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      exportCurrentExploreTable();
    });
  });
}

function wireView() {
  wireRankCard();
  wireExploreView();
  syncTallTables(appRoot);

  appRoot.querySelectorAll('[data-detail-page]').forEach((button) => {
    button.addEventListener('click', () => {
      detailPage = Number(button.dataset.detailPage);
      applyAndRenderView('[data-detail-size]');
    });
  });
  appRoot.querySelector('[data-detail-size]')?.addEventListener('change', (event) => {
    detailPageSize = Number(event.target.value);
    detailPage = 1;
    applyAndRenderView('[data-detail-size]');
  });

  appRoot.querySelectorAll('select[data-table-limit]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.tableLimit;
      const limit = Number(sel.value);
      if (!key || !VALID_LIMITS.has(limit)) return;
      tableLimits.set(key, limit);
      saveStoredLimits();
      applyAndRenderView(`select[data-table-limit="${key}"]`);
    });
  });

  // Filtro cruzado por entidad desde las fichas (el foco va al chip creado).
  appRoot.querySelectorAll('[data-filter-entity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [kind, raw] = btn.dataset.filterEntity.split(':');
      const id = Number(raw);
      if (!Number.isFinite(id)) return;
      state.artistId = state.trackId = state.albumId = null;
      if (kind === 'artist') state.artistId = id;
      else if (kind === 'track') state.trackId = id;
      else if (kind === 'album') state.albumId = id;
      else return;
      applyAndRenderView();
      document.querySelector('#filter-chips [data-unset]')?.focus();
    });
  });

  // Copiar resumen en texto plano (con fallback a copia manual).
  appRoot.querySelectorAll('[data-action="copy-receipt"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = receiptText(current, buildViewContext('wrapped'));
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '¡Copiado!';
        announce('Resumen copiado al portapapeles.');
      } catch {
        const pre = document.getElementById('receipt-text');
        if (pre) {
          pre.textContent = text;
          pre.hidden = false;
        }
        btn.textContent = 'Copiá el texto de abajo';
        announce('No se pudo copiar automáticamente; copiá el texto de abajo.');
      }
    });
  });

  appRoot.querySelectorAll('details.calendar-year').forEach((det) => {
    det.addEventListener('toggle', () => {
      if (det.open) {
        const deferred = det.querySelector('[data-deferred-year]');
        if (deferred) {
          const y = Number(deferred.dataset.deferredYear);
          deferred.innerHTML = calendarYearGridHTML(current, y, buildViewContext('calendar'));
          delete deferred.dataset.deferredYear;
        }
      }
    });
  });

  const viewHeaderH1 = appRoot.querySelector('.view-header h1');
  const [currentViewName] = parseHash();
  if (viewHeaderH1 && SECTION_NAMES[currentViewName] && !appRoot.querySelector('[data-action="toggle-fav"]')) {
    const isFav = favorites.has(currentViewName);
    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = `btn-fav ${isFav ? 'is-fav' : ''}`;
    favBtn.dataset.action = 'toggle-fav';
    favBtn.dataset.favView = currentViewName;
    favBtn.setAttribute('aria-label', isFav ? 'Quitar de favoritos' : 'Agregar a favoritos');
    favBtn.title = isFav ? 'Quitar de favoritos' : 'Agregar a favoritos';
    favBtn.textContent = isFav ? '★' : '☆';
    favBtn.addEventListener('click', () => {
      if (favorites.has(currentViewName)) favorites.delete(currentViewName);
      else favorites.add(currentViewName);
      saveStoredFavorites(favorites);
      render();
    });
    viewHeaderH1.appendChild(favBtn);
  }

  document.querySelectorAll('[data-action="reset-preferences"]').forEach((btn) => {
    btn.onclick = () => resetPreferences();
  });
}

function exportCurrentExploreTable() {
  if (!current) return;
  const viewCtx = buildViewContext('explore');
  const { tab, pool, options } = describeCatalogQuery(current, viewCtx);
  const exported = exportExploreTableCSV(pool, options, tab);

  const blob = new Blob([exported.csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `scrobbleview-${tab}-${exportFilename(Math.floor(Date.now() / 1000)).replace(/\.json$/, '')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`Exportadas ${exported.totalMatches} filas a CSV.`);
}

async function exportModel(scope = 'all') {
  if (!model) return;
  const label = scope === 'selection' ? 'Exportando selección analítica' : 'Preparando exportación';
  const job = beginProcessing(label, 'export');
  let result;
  try {
    const payload = {
      scope,
      filterState: scope === 'selection' ? state : undefined
    };
    result = await analysisClient.request('export', payload, { onProgress: job.progress });
  }
  finally { job.finish(); }
  if (!result || !result.bytes) return;
  const blob = new Blob([result.bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const exportDialog = document.getElementById('dialog-export');
const exportForm = document.getElementById('export-form');

headerActions?.querySelectorAll('[data-action="export"]').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    if (!model) return;
    if (exportDialog && typeof exportDialog.showModal === 'function') {
      const allDesc = document.getElementById('export-all-desc');
      if (allDesc) allDesc.textContent = `${fmtNum(model.totals.records)} reproducciones totales.`;

      const optSelection = document.getElementById('export-opt-selection');
      const selDesc = document.getElementById('export-selection-desc');
      const hasFilters = isFilterActive(state);
      if (optSelection && selDesc) {
        if (hasFilters && current) {
          optSelection.classList.remove('is-disabled');
          optSelection.querySelector('input').disabled = false;
          selDesc.textContent = `${fmtNum(current.totals.records)} reproducciones calculadas con los filtros activos.`;
        } else {
          optSelection.classList.add('is-disabled');
          optSelection.querySelector('input').disabled = true;
          selDesc.textContent = 'No hay filtros activos (coincide con todo el historial).';
        }
      }

      const [viewName] = parseHash();
      const optTable = document.getElementById('export-opt-table');
      const tableDesc = document.getElementById('export-table-desc');
      if (optTable) {
        if (viewName === 'explore' && current) {
          optTable.hidden = false;
          const viewCtx = buildViewContext('explore');
          const { tab, pool, options } = describeCatalogQuery(current, viewCtx);
          const tabName = tab === 'artists' ? 'artistas' : tab === 'tracks' ? 'canciones' : 'álbumes';
          const qRes = queryCatalog(pool, options);
          if (tableDesc) tableDesc.textContent = `${fmtNum(qRes.totalMatches)} ${tabName} coincidentes; orden: ${catalogOrderLabel(options.sortBy, qRes.effectiveDir)}. Formato CSV.`;
        } else {
          optTable.hidden = true;
          const tableRadio = optTable.querySelector('input');
          if (tableRadio && tableRadio.checked) {
            const allRadio = exportDialog.querySelector('input[value="all"]');
            if (allRadio) allRadio.checked = true;
          }
        }
      }

      exportDialog.showModal();
      return;
    }

    const b = e.currentTarget;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await exportModel('all');
    } catch (error) {
      if (error.code !== 'E_ABORT') reportProcessingError(error, 'export');
    } finally {
      b.disabled = false;
    }
  });
});

if (exportDialog) {
  exportDialog.querySelector('[data-action="close-export"]')?.addEventListener('click', () => {
    exportDialog.close();
  });
  exportForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(exportForm);
    const scope = data.get('export-scope') || 'all';
    exportDialog.close();
    try {
      if (scope === 'table') {
        exportCurrentExploreTable();
      } else {
        await exportModel(scope);
      }
    } catch (error) {
      if (error.code !== 'E_ABORT') reportProcessingError(error, 'export');
    }
  });
}
headerActions?.querySelectorAll('[data-action="reset"]').forEach((btn) => {
  btn.addEventListener('click', () => location.reload());
});

const inputApi = setupInput({
  analyze,
  onReady() {
    // Deep-link: un hash existente (posiblemente con params de filtro) manda;
    // solo la entrada sin hash aterriza en el dashboard.
    if (!location.hash) location.hash = '#/dashboard';
    render();
  },
  onError() {
    // El error ya se muestra en la vista de inicio (input.js).
  },
  onLoadCached: loadCached,
  onClearCached: clearCached
});

cancelProcessing.addEventListener('click', () => {
  const [activeJobId, activeJob] = [...jobs.entries()].at(-1) ?? [];
  if (activeJob?.type === 'filter' && !initializing) {
    const confirmed = analysisState.cancelUpdate();
    restoreConfirmedContext(confirmed);
    jobs.delete(activeJobId);
    processingError = 'Actualización cancelada. Podés reintentarla.';
    processingErrorType = 'filter';
    setFilterBusy([...jobs.values()].some(item => item.type === 'filter'));
    updateProcessing();
    return;
  }
  if (activeJob?.type === 'export') {
    analysisClient.cancelExport();
    jobs.delete(activeJobId);
    processingError = null;
    processingErrorType = null;
    updateProcessing();
    return;
  }
  analysisState.clear();
  analysisClient.cancel();
  model = null; current = null; currentPrev = null; currentDetail = null; detailContext = null; cacheOffer = null;
  appRoot.replaceChildren();
  jobs.clear(); processingError = null; processingErrorType = null;
  appRoot.setAttribute('aria-busy', 'false');
  appRoot.classList.remove('app--updating');
  updateProcessing(); updateCacheToast();
  headerActions?.setAttribute('hidden', '');
  siteFooter?.setAttribute('hidden', '');
  siteHeader?.classList.add('site-header--home');
  tagline?.removeAttribute('hidden');
  inputApi.reset('Procesamiento cancelado. Volvé a seleccionar los archivos para continuar.');
});

retryProcessing.addEventListener('click', async () => {
  const failed = analysisState.getFailed();
  if (!failed) return;
  state = failed.state;
  activeMetric = failed.metric;
  rankUI.metric = activeMetric;
  detailPage = failed.page;
  detailPageSize = failed.pageSize;
  detailContext = (failed.view === 'day' || failed.view === 'session' || failed.view === 'track')
    ? JSON.stringify([failed.view, failed.id, filterParams(state)]) : null;
  history.replaceState(history.state, '', failed.hash);
  if (await refreshModel()) render();
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) analysisClient.cancel(); });

if (cacheAvailable()) {
  cacheSummary().then((summary) => inputApi.showCachedButtons(summary));
}

let lastRoute = location.hash.split('?')[0];
let pendingCalendarFocus = null;
function focusMainContent() {
  const main = document.getElementById('main-content');
  main.focus({ preventScroll: true });
  main.scrollIntoView({ block: 'start' });
}
document.querySelector('.skip-link').addEventListener('click', (event) => {
  event.preventDefault();
  focusMainContent();
});
window.addEventListener('popstate', (event) => {
  if (event.state?.returnState) {
    popReturnState = event.state.returnState;
  }
});

window.addEventListener('hashchange', async () => {
  if (location.hash === '#main-content') { focusMainContent(); return; }
  if (initializing || !model) return;
  const [name] = parseHash();
  const route = location.hash.split('?')[0];
  if (!await applyHashParams()) return;
  render();
  if (popReturnState) {
    restoreHistoryState(popReturnState);
    popReturnState = null;
    pendingCalendarFocus = null;
  } else if (pendingCalendarFocus) {
    appRoot.querySelector(`[data-cal-nav="${pendingCalendarFocus}"]`)?.focus({ preventScroll: true });
    pendingCalendarFocus = null;
  } else if (route !== lastRoute) {
    if (name === 'artist' || name === 'track' || name === 'album' || name === 'day' || name === 'session') {
      const h = appRoot.querySelector('.view-header h1, .view-header');
      if (h) {
        h.setAttribute('tabindex', '-1');
        h.focus({ preventScroll: true });
      }
      window.scrollTo(0, 0);
    } else {
      window.scrollTo(0, 0);
    }
  }
  lastRoute = route;
});

// Chips para quitar filtros activos + "Borrar todo". Delegado una sola vez:
// #filter-chips se re-renderiza en cada cambio (los listeners directos morirían
// al primero). El foco va a la fila de chips (tabindex -1).
appRoot.addEventListener('click', (e) => {
  const clearBtn = e.target.closest?.('[data-action="clear"]');
  if (clearBtn && appRoot.contains(clearBtn)) {
    state = emptyFilterState();
    applyAndRenderView();
    document.getElementById('filter-chips')?.focus();
    return;
  }
  const btn = e.target.closest?.('[data-unset]');
  if (!btn || !appRoot.contains(btn)) return;
  const k = btn.dataset.unset;
  if (k !== 'artistId' && k !== 'trackId' && k !== 'albumId' && k !== 'years' &&
    k !== 'months' && k !== 'range' && k !== 'skip' && k !== 'shuffle' && k !== 'offline' &&
    k !== 'dows' && k !== 'hours') return;
  state[k] = null;
  applyAndRenderView();
  document.getElementById('filter-chips')?.focus();
});

// Context bar: selector de métrica compartido con el ranking y foco a filtros
appRoot.addEventListener('click', (e) => {
  const metricBtn = e.target.closest?.('.context-bar [data-metric]');
  if (metricBtn && appRoot.contains(metricBtn)) {
    activeMetric = metricBtn.dataset.metric;
    rankUI.metric = activeMetric;
    try { localStorage.setItem(METRIC_STORAGE_KEY, activeMetric); } catch (_) {}
    syncHash();
    analysisState.updatePresentation({ hash: location.hash, metric: activeMetric });
    render();
    const newBtn = appRoot.querySelector(`.context-bar [data-metric="${activeMetric}"]`);
    if (newBtn) newBtn.focus();
    return;
  }
  const focusBtn = e.target.closest?.('[data-action="focus-filters"]');
  if (focusBtn && appRoot.contains(focusBtn)) {
    const chips = document.getElementById('filter-chips');
    if (chips) chips.focus();
    return;
  }
});

// Los enlaces internos llevan los filtros y métrica vigentes en el hash: el click los
// reescribe antes de navegar (deep-link y Back coherentes entre vistas).
// Captura el estado de retorno en history.state antes de navegar.
appRoot.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (!a || !appRoot.contains(a)) return;
  const returnState = captureHistoryState();
  if (returnState) {
    history.replaceState({ ...history.state, returnState }, '', location.href);
  }
  const fParams = portableFilterParams(state, model);
  const mParam = serializeMetricParam(activeMetric);
  const queryStr = fParams ? `${fParams}&${mParam}` : `?${mParam}`;
  const [base, destinationQuery = ''] = a.getAttribute('href').split('?');
  const merged = new URLSearchParams(queryStr.replace(/^\?/, ''));
  for (const [key, value] of new URLSearchParams(destinationQuery)) merged.set(key, value);
  a.setAttribute('href', `${base}?${merged}`);
});

// Títulos de gráficos en táctil: el <title> del SVG no se muestra al toque.
// Delegado una sola vez (sobrevive a los re-renders). Solo sin hover.
appRoot.addEventListener('click', (e) => {
  if (!window.matchMedia('(hover: none)').matches) return;
  if (e.target.closest?.('.chart-card .chart-interactive-wrap')) return;
  const svg = e.target.closest?.('svg.chart');
  if (!svg) return;
  const holder = e.target.closest('g') ?? e.target;
  const title = holder.querySelector?.('title');
  if (!title || !title.textContent) return;
  toast.textContent = title.textContent;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
});

// Selector de rango e inspector sobre el calendario
let calAnchor = null;
appRoot.addEventListener('click', (e) => {
  const dayEl = e.target.closest?.('[data-day]');
  if (dayEl && appRoot.contains(dayEl)) {
    const day = Number(dayEl.dataset.day);
    if (Number.isFinite(day)) {
      if (e.shiftKey && calAnchor != null) {
        const [a, b] = calAnchor <= day ? [calAnchor, day] : [day, calAnchor];
        state.range = { from: a * 86400, to: b * 86400 + 86399 };
        calAnchor = null;
        applyAndRenderView();
        return;
      }
      calAnchor = day;
      const iso = dayEl.dataset.date || new Date(day * 86400000).toISOString().slice(0, 10);
      const valLabel = dayEl.dataset.label || dayEl.querySelector?.('title')?.textContent || dayEl.getAttribute?.('aria-label') || '';

      const selDate = appRoot.querySelector('#cal-selected-date');
      const selVal = appRoot.querySelector('#cal-selected-value');
      const btnFilter = appRoot.querySelector('#btn-cal-filter-day');
      const detailLink = appRoot.querySelector('#cal-day-detail');
      const btnStart = appRoot.querySelector('#btn-cal-set-start');
      const btnEnd = appRoot.querySelector('#btn-cal-set-end');
      const fromInput = appRoot.querySelector('#cal-range-from');
      const toInput = appRoot.querySelector('#cal-range-to');

      if (selDate) selDate.textContent = iso;
      if (detailLink) {
        const params = new URLSearchParams(portableFilterParams(state, model).replace(/^\?/, ''));
        params.set('m', activeMetric);
        detailLink.href = formatSemanticRoute('day', iso, `?${params}`);
        detailLink.hidden = false;
      }
      if (selVal) selVal.textContent = valLabel ? `· ${valLabel}` : '';
      if (btnFilter) btnFilter.disabled = false;
      if (btnStart) btnStart.disabled = false;
      if (btnEnd) btnEnd.disabled = false;
      if (fromInput && !fromInput.value) fromInput.value = iso;
      if (toInput && fromInput?.value && !toInput.value) toInput.value = iso;

      appRoot.querySelectorAll('.cal-month-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
      if (dayEl.classList.contains('cal-month-cell')) dayEl.classList.add('is-selected');
    }
  }

  const calAction = e.target.closest?.('[data-cal-action]');
  if (calAction && appRoot.contains(calAction)) {
    const act = calAction.dataset.calAction;
    if (act === 'filter-day' && calAnchor != null) {
      state.range = { from: calAnchor * 86400, to: calAnchor * 86400 + 86399 };
      applyAndRenderView();
      return;
    }
    if (act === 'set-start' && calAnchor != null) {
      const fromInput = appRoot.querySelector('#cal-range-from');
      if (fromInput) fromInput.value = new Date(calAnchor * 86400000).toISOString().slice(0, 10);
      return;
    }
    if (act === 'set-end' && calAnchor != null) {
      const toInput = appRoot.querySelector('#cal-range-to');
      if (toInput) toInput.value = new Date(calAnchor * 86400000).toISOString().slice(0, 10);
      return;
    }
    if (act === 'apply-range') {
      const fromInput = appRoot.querySelector('#cal-range-from');
      const toInput = appRoot.querySelector('#cal-range-to');
      if (fromInput?.value && toInput?.value) {
        const startSec = Math.floor(new Date(fromInput.value + 'T00:00:00Z').getTime() / 1000);
        const endSec = Math.floor(new Date(toInput.value + 'T23:59:59Z').getTime() / 1000);
        if (Number.isFinite(startSec) && Number.isFinite(endSec)) {
          state.range = { from: Math.min(startSec, endSec), to: Math.max(startSec, endSec) };
          applyAndRenderView();
          return;
        }
      }
    }
  }

  const calNav = e.target.closest?.('[data-cal-nav]');
  if (calNav && appRoot.contains(calNav)) {
    state.calMonth = {
      year: Number(calNav.dataset.calYear),
      month: Number(calNav.dataset.calMonth)
    };
    const [view, year] = parseHash();
    const fParams = portableFilterParams(state, model);
    const query = calendarQuery(`${fParams || '?'}${fParams ? '&' : ''}${serializeMetricParam(activeMetric)}`, state.calMonth, state.normalizeYears);
    pendingCalendarFocus = calNav.dataset.calNav;
    location.hash = formatSemanticRoute('calendar', view === 'calendar' && year != null ? state.calMonth.year : null, query);
    return;
  }

  const scaleToggle = e.target.closest?.('[data-action="toggle-cal-scale"]');
  if (scaleToggle && appRoot.contains(scaleToggle)) {
    state.normalizeYears = scaleToggle.dataset.normalize === 'true';
    syncHash();
    analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
    render();
    appRoot.querySelector('[data-action="toggle-cal-scale"]')?.focus({ preventScroll: true });
    return;
  }

  const compPresetBtn = e.target.closest?.('[data-compare-preset]');
  if (compPresetBtn && appRoot.contains(compPresetBtn)) {
    state.comparePreset = compPresetBtn.dataset.comparePreset;
    render();
    return;
  }

  const chartStep = e.target.closest?.('[data-chart-step]');
  if (chartStep && appRoot.contains(chartStep)) {
    const chart = chartStep.closest('.chart-card');
    const selected = chartSelections.get(chart.dataset.chartId)?.index;
    const direction = Number(chartStep.dataset.dir);
    const start = selected ?? (direction > 0 ? -1 : 1);
    selectChartPoint(chart, start + direction);
    return;
  }

  const chartPage = e.target.closest?.('[data-chart-page]');
  if (chartPage && appRoot.contains(chartPage)) {
    const chart = chartPage.closest('.chart-card');
    const controls = chartPage.closest('[data-chart-table]');
    const rows = [...chart.querySelectorAll('[data-chart-row]')];
    const pageSize = Number(controls.dataset.pageSize);
    const pageCount = Math.ceil(rows.length / pageSize);
    const page = Math.max(0, Math.min(pageCount - 1, Number(controls.dataset.page) + Number(chartPage.dataset.dir)));
    const start = page * pageSize;
    rows.forEach((row, index) => { row.hidden = index < start || index >= start + pageSize; });
    controls.dataset.page = String(page);
    controls.querySelector('.chart-table-status').textContent = `Mostrando ${start + 1}–${Math.min(start + pageSize, rows.length)} de ${rows.length}`;
    controls.querySelector('[data-dir="-1"]').disabled = page === 0;
    controls.querySelector('[data-dir="1"]').disabled = page >= pageCount - 1;
    return;
  }

  const chartListPoint = e.target.closest?.('.chart-card[data-chart-type="list"] [data-chart-index]');
  if (chartListPoint) {
    const chart = chartListPoint.closest('.chart-card');
    selectChartPoint(chart, Number(chartListPoint.dataset.chartIndex));
    return;
  }

  const chartWrap = e.target.closest?.('.chart-card .chart-interactive-wrap');
  const clickedChart = e.target.closest?.('svg.chart');
  if (chartWrap && clickedChart) {
    const svg = clickedChart;
    const chart = chartWrap.closest('.chart-card');
    const points = chartPoints(chart);
    if (points.length) {
      const selectedIndex = chartIndexAt(svg, chart, e, points);
      if (selectedIndex >= 0) selectChartPoint(chart, selectedIndex);
    }
    return;
  }

  const closeInspector = e.target.closest?.('[data-action="close-inspector"]');
  if (closeInspector && appRoot.contains(closeInspector)) {
    const card = closeInspector.closest?.('.chart-card');
    const inspector = card?.querySelector('.chart-inspector');
    if (inspector) {
      inspector.hidden = true;
      chartSelections.delete(card.dataset.chartId);
      card.querySelectorAll('[data-chart-index]').forEach((item) => item.classList.remove('is-selected'));
      const status = card.querySelector('.chart-nav__status');
      if (status) status.textContent = `Tocar o usar flechas para inspeccionar (${chartPoints(card).length} puntos)`;
      card.querySelector('[data-chart-step][data-dir="-1"]')?.setAttribute('disabled', '');
      card.querySelector('[data-chart-step][data-dir="1"]')?.removeAttribute('disabled');
    }
    return;
  }
});

appRoot.addEventListener('keydown', (e) => {
  const nav = e.target.closest?.('.chart-nav');
  if (!nav || !appRoot.contains(nav) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const chart = nav.closest('.chart-card');
  const points = chartPoints(chart);
  if (!points.length) return;
  const selected = chartSelections.get(chart.dataset.chartId)?.index;
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (selected ?? (e.key === 'ArrowRight' ? -1 : points.length)) + (e.key === 'ArrowRight' ? 1 : -1)));
  e.preventDefault();
  selectChartPoint(chart, next);
  const activeStep = e.target.closest('[data-chart-step]');
  if (activeStep?.disabled) chart.querySelector(`[data-dir="${-Number(activeStep.dataset.dir)}"]`)?.focus();
});

window.addEventListener('resize', () => syncTallTables(appRoot), { passive: true });
