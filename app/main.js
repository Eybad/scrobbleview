// UI composition root: URL, filter state, worker responses and rendering.

import { createAnalysisClient } from './analysis-client.js';
import { createAnalysisState } from './analysis-state.js';
import { AbortError } from '../src/parse/errors.js';
import { emptyFilterState, RANGE_PRESETS } from '../src/filters.js';
import { setupInput } from './input.js';
import { renderView, rankCardHTML, receiptTextFromConfirmed, emptyFiltersHTML, footerMetaText, calendarYearGridHTML } from './views.js';
import { describeCatalogQuery, catalogOrderLabel } from './catalog-query.js';
import { esc, fmtNum, fmtMs, lineChart, barChart } from '../src/charts.js';
import { filterBarHTML, isFilterActive, BLOCKS, chipsHTML, isoDateToDay, locToISODate, rangeFromYear, rangeFromMonth, syncRangeShortcuts, normalizeRangeDays, filterStatusMessage, filterParams, portableFilterParams, resolvePortableFilters, advancedFilterCount } from './filter-ui.js';
import { clear as cacheClear, cacheSummary, isAvailable as cacheAvailable, persist as cachePersist } from './storage.js';
import { resolveMetric, parseQueryParams, serializeMetricParam, METRIC_STORAGE_KEY, DEFAULT_METRIC } from './state-metric.js';
import { parseRoute, resolveRoute, formatSemanticRoute, mergeExploreParams } from './routes.js';
import { captureHistoryState, restoreHistoryState } from './history-state.js';
import { resetPresentationPreferences } from './presentation-preferences.js';
import { contextBarHTML } from './context-bar.js';
import { parseCalendarState, parseCalendarSelection, calendarQuery, calendarGridTargetDate } from './calendar-ui.js';
import { parseCompareState, compareQuery, compareDateRange, compareDateAt, compareEntityKey, normalizeCompareEntities } from './compare-state.js';
import { calculateCompareRange } from '../src/compare.js';

const appRoot = document.getElementById('app-root');
const siteHeader = document.querySelector('.site-header');
const headerActions = document.getElementById('header-actions');
const siteFooter = document.querySelector('.site-footer');
const footerMeta = document.getElementById('footer-meta');
const tagline = document.querySelector('.tagline');

const LIMITS_STORAGE_KEY = 'scrobbleview:tableLimits';
const PROCESSING_INDICATOR_DELAY_MS = 180;
const VALID_LIMITS = new Set([10, 25, 50, 100]);
const LONGITUDINAL_THRESHOLDS = new Set([30, 90, 180]);
const LONGITUDINAL_PAGE_SIZES = new Set([25, 50, 100]);

function parseDiscoveryState(query) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  const threshold = Number(params.get('cb'));
  const pageSize = Number(params.get('lps'));
  const page = (key) => {
    const value = Number(params.get(key));
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  };
  return {
    comebackThresholdDays: LONGITUDINAL_THRESHOLDS.has(threshold) ? threshold : 30,
    longitudinalPageSize: LONGITUDINAL_PAGE_SIZES.has(pageSize) ? pageSize : 25,
    longitudinalPages: {
      comebackTracks: page('ctp'),
      comebackArtists: page('cap'),
      firstTracks: page('ftp'),
      firstArtists: page('fap')
    }
  };
}

function discoveryQuery(query, state) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  const pages = state.longitudinalPages ?? {};
  params.set('cb', String(LONGITUDINAL_THRESHOLDS.has(state.comebackThresholdDays) ? state.comebackThresholdDays : 30));
  params.set('lps', String(LONGITUDINAL_PAGE_SIZES.has(state.longitudinalPageSize) ? state.longitudinalPageSize : 25));
  for (const [key, field] of [['ctp', 'comebackTracks'], ['cap', 'comebackArtists'], ['ftp', 'firstTracks'], ['fap', 'firstArtists']]) {
    const value = Number(pages[field]);
    if (Number.isSafeInteger(value) && value > 1) params.set(key, String(value));
    else params.delete(key);
  }
  return params.toString();
}

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
let compareResult = null;
let compareResultKey = null;
let compareStatus = 'idle';
let compareLoadError = null;
let compareInFlight = false;
let compareActiveKey = null;
let comparePending = null;
let longitudinalResult = null;
let longitudinalResultKey = null;
let longitudinalLoadError = null;
let longitudinalRevision = 0;
let state = emptyFilterState();
let activeMetric = resolveMetric(null, typeof localStorage !== 'undefined' ? localStorage.getItem(METRIC_STORAGE_KEY) : null);
let rankUI = { tab: 'artists', metric: activeMetric, topN: initialLimits.rankTopN, query: '' };
const tableLimits = initialLimits.map;
let cacheOffer = null; // null | 'save' | 'saved' | 'loaded' | 'error'
let advState = null;
let popReturnState = null;
const chartSelections = new Map();
let calAnchor = null;

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

function resizeContractCharts() {
  appRoot.querySelectorAll('.chart-card[data-chart-type="line"], .chart-card[data-chart-type="bar"]').forEach((card) => {
    const svg = card.querySelector('svg.chart');
    const chart = card.dataset.chartType;
    const width = Math.floor(svg?.parentElement?.clientWidth ?? 0);
    const points = chartPoints(card);
    if (!svg || width <= 0 || points.length === 0) return;
    const format = card.dataset.chartUnit === 'tiempo escuchado' ? fmtMs : fmtNum;
    const markup = chart === 'line'
      ? lineChart({ points: points.map((point) => ({ label: point.label, y: point.value })), format, width })
      : barChart({ data: points.map((point) => ({ label: point.label, value: point.value })), format, width, showValue: svg.querySelector('.chart-value') != null });
    svg.outerHTML = markup;
  });
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

function restoreCalendarInspector() {
  const dateOutput = appRoot.querySelector('#cal-selected-date');
  if (!dateOutput) return;
  const fromInput = appRoot.querySelector('#cal-range-from');
  const toInput = appRoot.querySelector('#cal-range-to');
  if (fromInput) fromInput.value = state.calRangeFrom ?? '';
  if (toInput) toInput.value = state.calRangeTo ?? '';
  const iso = state.calDate;
  if (!iso) {
    calAnchor = null;
    syncCalendarGridSelection(null);
    return;
  }
  const day = Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000);
  calAnchor = day;
  dateOutput.textContent = iso;
  const matchingCells = [...appRoot.querySelectorAll('[data-day]')].filter((cell) => Number(cell.dataset.day) === day);
  const title = matchingCells[0]?.dataset.label || matchingCells[0]?.querySelector('title')?.textContent;
  const record = current.daily?.get(day);
  const firstDay = current.meta.firstTs == null ? null : Math.floor(current.meta.firstTs / 86400);
  const lastDay = current.meta.lastTs == null ? null : Math.floor(current.meta.lastTs / 86400);
  const isOutOfData = firstDay == null || day < firstDay || day > lastDay;
  const value = record?.[activeMetric === 'ms' ? 'ms' : 'plays'] ?? 0;
  const label = title || (isOutOfData ? 'sin datos' : (value > 0 ? (activeMetric === 'ms' ? fmtMs(value) : fmtNum(value)) : 'sin actividad'));
  const valueOutput = appRoot.querySelector('#cal-selected-value');
  if (valueOutput) valueOutput.textContent = `· ${label}`;
  appRoot.querySelector('#btn-cal-filter-day')?.removeAttribute('disabled');
  appRoot.querySelector('#btn-cal-set-start')?.removeAttribute('disabled');
  appRoot.querySelector('#btn-cal-set-end')?.removeAttribute('disabled');
  const detailLink = appRoot.querySelector('#cal-day-detail');
  if (detailLink) {
    const params = new URLSearchParams(portableFilterParams(state, model).replace(/^\?/, ''));
    params.set('m', activeMetric);
    const query = calendarQuery(`?${params}`, state.calMonth, state.normalizeYears, {
      date: state.calDate,
      rangeFrom: state.calRangeFrom,
      rangeTo: state.calRangeTo
    });
    detailLink.href = formatSemanticRoute('day', iso, query);
    detailLink.hidden = false;
  }
  appRoot.querySelectorAll('[data-day].is-selected').forEach((cell) => cell.classList.remove('is-selected'));
  matchingCells.forEach((cell) => cell.classList.add('is-selected'));
  syncCalendarGridSelection(iso);
}

function syncCalendarGridSelection(selectedDate) {
  const cells = [...appRoot.querySelectorAll('.calendar-month__table [data-date]')];
  const selectedCell = cells.find((cell) => cell.dataset.date === selectedDate);
  const tabStop = selectedCell ?? cells[0];
  for (const cell of cells) {
    const selected = cell === selectedCell;
    cell.tabIndex = cell === tabStop ? 0 : -1;
    cell.parentElement?.setAttribute('aria-selected', String(selected));
    cell.classList.toggle('is-selected', selected);
  }
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
  const job = [...jobs.values()].filter((item) => item.visible).at(-1);
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
  const job = { label, fraction: 0, type, visible: false, timer: 0 };
  jobs.set(id, job);
  job.timer = setTimeout(() => {
    const activeJob = jobs.get(id);
    if (!activeJob) return;
    activeJob.visible = true;
    updateProcessing();
  }, PROCESSING_INDICATOR_DELAY_MS);
  updateProcessing();
  return {
    progress(fraction, nextLabel) {
      const activeJob = jobs.get(id);
      if (!activeJob) return;
      activeJob.fraction = fraction;
      activeJob.label = nextLabel;
      if (activeJob.visible) updateProcessing();
    },
    finish() {
      clearTimeout(job.timer);
      jobs.delete(id);
      updateProcessing();
    }
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
  compareResult = null;
  compareResultKey = null;
  compareStatus = 'idle';
  compareLoadError = null;
  comparePending = null;
  longitudinalResult = null;
  longitudinalResultKey = null;
  longitudinalLoadError = null;
  longitudinalRevision++;
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
  const requestLongitudinal = view === 'habits' || view === 'discovery';
  const currentLongitudinalKey = JSON.stringify([filterParams(state), state.comebackThresholdDays ?? 30, state.longitudinalPages, state.longitudinalPageSize]);
  const requestedLongitudinalRevision = requestLongitudinal ? ++longitudinalRevision : longitudinalRevision;
  const job = beginProcessing('Actualizando estadísticas', 'filter');
  setFilterBusy(true);
  try {
    const result = await analysisState.update(state, { view, id, originQuery, page: detailPage, pageSize: detailPageSize, context: { hash: requestedHash || '#/dashboard', metric: activeMetric }, onProgress: job.progress });
    if (!result || requestedHash !== location.hash) return false;
    if (requestLongitudinal && longitudinalResultKey !== currentLongitudinalKey) {
      let nextLongitudinal;
      try {
        nextLongitudinal = await analysisClient.request('longitudinal', {
          state,
          filterKey: filterParams(state),
          thresholdDays: state.comebackThresholdDays ?? 30,
          pages: state.longitudinalPages,
          pageSize: state.longitudinalPageSize
        }, { onProgress: job.progress });
      } catch (error) {
        longitudinalLoadError = error.message;
        throw error;
      }
      if (requestedHash !== location.hash || requestedLongitudinalRevision !== longitudinalRevision) return false;
      longitudinalResult = nextLongitudinal;
      longitudinalResultKey = currentLongitudinalKey;
      longitudinalLoadError = null;
    }
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
    const merged = calendarQuery(queryStr, state.calMonth, state.normalizeYears, {
      date: state.calDate,
      rangeFrom: state.calRangeFrom,
      rangeTo: state.calRangeTo
    });
    hash = formatSemanticRoute('calendar', id, merged);
  } else if (name === 'compare') {
    hash = formatSemanticRoute('compare', null, compareQuery(queryStr, state));
  } else if (name === 'discovery') {
    hash = formatSemanticRoute('discovery', null, discoveryQuery(queryStr, state));
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

function pushCompareHash() {
  const fParams = portableFilterParams(state, model);
  const query = fParams ? `${fParams}&${serializeMetricParam(activeMetric)}` : `?${serializeMetricParam(activeMetric)}`;
  const hash = formatSemanticRoute('compare', null, compareQuery(query, state));
  if (location.hash !== hash) history.pushState(history.state, '', hash);
}

function pushDiscoveryHash() {
  const fParams = portableFilterParams(state, model);
  const query = fParams ? `${fParams}&${serializeMetricParam(activeMetric)}` : `?${serializeMetricParam(activeMetric)}`;
  const hash = formatSemanticRoute('discovery', null, discoveryQuery(query, state));
  if (location.hash !== hash) history.pushState(history.state, '', hash);
}

async function updateDiscoveryView(focusSelector) {
  pushDiscoveryHash();
  if (!await refreshModel()) return;
  render();
  appRoot.querySelector(focusSelector)?.focus({ preventScroll: true });
}

// The URL is authoritative on load, Back/Forward and manual hash changes.
// Restore state and its model together before any view reads either one.
async function applyHashParams() {
  const [view, id, query] = parseHash();
  const parsed = parseQueryParams(query);
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(METRIC_STORAGE_KEY) : null;
  activeMetric = resolveMetric(parsed.metric, stored);
  rankUI.metric = activeMetric;
  const restored = resolvePortableFilters(query, model);
  state = restored.state;
  Object.assign(state, parseCompareState(query));
  Object.assign(state, parseDiscoveryState(query));
  const calendarState = parseCalendarState(query);
  if (view === 'calendar' && id != null && Number(id) >= 100 && Number(id) <= 9999) {
    calendarState.calMonth = {
      year: Number(id),
      month: calendarState.calMonth?.month ?? (new Date().getMonth() + 1)
    };
  }
  Object.assign(state, calendarState, parseCalendarSelection(query));
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
    activeMetric = resetPresentationPreferences(localStorage, { favorites, tableLimits, rankUI });
  } catch {
    announce('No se pudieron borrar las preferencias guardadas. No se aplicaron los valores predeterminados.');
    return;
  }
  syncHash();
  analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
  render();
  announce('Preferencias restablecidas a los valores predeterminados.');
}

function navHTML(active) {
  const fParams = portableFilterParams(state, model);
  const mParam = serializeMetricParam(activeMetric);
  const queryStr = fParams ? `${fParams}&${mParam}` : `?${mParam}`;
  const link = (hash, label, view) => {
    const query = view === 'compare' && active === 'compare' ? `?${compareQuery(queryStr, state)}`
      : view === 'discovery' && active === 'discovery' ? `?${discoveryQuery(queryStr, state)}`
        : queryStr;
    return `<a href="#/${hash}${esc(query)}"${active === view ? ' aria-current="page"' : ''}>${label}</a>`;
  };

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
document.getElementById('cache-toast-mount').appendChild(cacheToast);
let cacheTimer = 0;

function updateCacheToast() {
  clearTimeout(cacheTimer);
  if (cacheOffer === 'save') {
    cacheToast.innerHTML = `<p>El historial completo se guarda sin cifrar en este dispositivo hasta que lo borres.</p>
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

  const contextQuery = viewName === 'calendar' || viewName === 'day'
    ? `?${calendarQuery(queryStr, state.calMonth, state.normalizeYears, {
      date: state.calDate,
      rangeFrom: state.calRangeFrom,
      rangeTo: state.calRangeTo
    })}`
    : queryStr;
  const query = viewName === 'discovery' ? `?${discoveryQuery(contextQuery, state)}` : contextQuery;
  const longitudinalKey = JSON.stringify([filterParams(state), state.comebackThresholdDays ?? 30, state.longitudinalPages, state.longitudinalPageSize]);

  const observedRange = model?.meta?.firstTs == null ? null : {
    from: Math.floor(model.meta.firstTs / 86400) * 86400,
    to: Math.floor(model.meta.lastTs / 86400) * 86400 + 86399
  };
  const defaultCompareRange = state.range ?? observedRange;
  const compareFrom = state.compareFrom ?? compareDateAt(defaultCompareRange, 'from');
  const compareTo = state.compareTo ?? compareDateAt(defaultCompareRange, 'to');
  const compareRangeA = compareDateRange(compareFrom, compareTo);
  const compareRefRange = compareDateRange(state.compareRefFrom, state.compareRefTo);
  const compareDataRange = model?.meta?.firstTs == null ? null : { minSec: model.meta.firstTs, maxSec: model.meta.lastTs };
  let compareRangeB = compareRefRange;
  let compareWarning = '';
  let compareError = '';
  if (compareRangeA && state.comparePreset !== 'manual') {
    try {
      const calculated = calculateCompareRange(state.comparePreset, compareRangeA, compareDataRange);
      compareRangeB = calculated.rangeB;
      compareWarning = calculated.warning;
    } catch (error) {
      compareError = error.message;
    }
  } else if (compareRangeA && state.comparePreset === 'manual' && compareRefRange) {
    try {
      const calculated = calculateCompareRange('manual', compareRangeA, compareDataRange, compareRefRange);
      compareWarning = calculated.warning;
    } catch (error) {
      compareError = error.message;
    }
  }
  if (!compareRangeA) compareError ||= 'Elegí fechas válidas para el período A.';
  if (state.comparePreset === 'manual' && !compareRefRange) compareError ||= 'Elegí fechas válidas para el período B.';

  return {
    years: state.years,
    range: state.range,
    prev: viewName === 'dashboard' ? currentPrev : null,
    limits: tableLimits,
    metric: activeMetric,
    rankUI,
    query,
    exploreState,
    detail: currentDetail,
    rawQuery,
    detailRequested: viewName === 'day' || viewName === 'session' || viewName === 'track',
    normalizeYears: state.normalizeYears ?? false,
    calMonth: state.calMonth,
    calDate: state.calDate,
    month: state.calMonth?.month ?? (new Date().getMonth() + 1),
    comparePreset: state.comparePreset,
    compareGranularity: state.compareGranularity,
    compareEntities: state.compareEntities,
    compareEntityMode: state.compareEntityMode,
    comebackThresholdDays: state.comebackThresholdDays ?? 30,
    longitudinalPages: state.longitudinalPages,
    longitudinalPageSize: state.longitudinalPageSize,
    longitudinal: longitudinalResultKey === longitudinalKey ? longitudinalResult : null,
    longitudinalError: longitudinalLoadError,
    compareFrom,
    compareTo,
    compareRefFrom: state.compareRefFrom,
    compareRefTo: state.compareRefTo,
    compareRangeA,
    compareRangeB,
    compareDataRange,
    compareWarning,
    compareError,
    compareResult,
    compareStatus,
    compareLoadError
  };
}

function dispatchComparison(job) {
  compareInFlight = true;
  compareActiveKey = job.key;
  analysisClient.request('compare', job.payload).then((result) => {
    if (job.key !== compareResultKey) return;
    if (parseHash()[0] !== 'compare') {
      compareResultKey = null;
      compareStatus = 'idle';
      return;
    }
    compareResult = result;
    compareStatus = 'ready';
    compareLoadError = null;
    render();
  }).catch((error) => {
    if (job.key !== compareResultKey) return;
    if (error.code === 'E_ABORT' || parseHash()[0] !== 'compare') {
      compareResultKey = null;
      compareStatus = 'idle';
      return;
    }
    compareStatus = 'error';
    compareLoadError = error.message;
    render();
  }).finally(() => {
    compareInFlight = false;
    compareActiveKey = null;
    const next = comparePending;
    comparePending = null;
    if (next && parseHash()[0] === 'compare') dispatchComparison(next);
    else if (next && next.key === compareResultKey) {
      compareResultKey = null;
      compareStatus = 'idle';
    }
  });
}

function prepareComparison(context) {
  if (!context.compareRangeA || !context.compareRangeB) {
    compareResultKey = null;
    compareResult = null;
    compareStatus = 'idle';
    comparePending = null;
    context.compareResult = null;
    context.compareStatus = 'idle';
    context.compareLoadError = null;
    return;
  }
  const filterState = { ...state, range: null, years: null, months: null, dows: null, hours: null };
  const key = JSON.stringify([
    filterParams(filterState),
    context.comparePreset,
    context.compareRangeA,
    context.compareRangeB
  ]);
  if (key !== compareResultKey) {
    compareResultKey = key;
    compareResult = null;
    compareLoadError = null;
    compareStatus = 'loading';
    const job = {
      key,
      payload: {
        state: filterState,
        preset: context.comparePreset,
        rangeA: context.compareRangeA,
        rangeB: context.compareRangeB
      }
    };
    if (compareInFlight && key === compareActiveKey) comparePending = null;
    else if (compareInFlight) comparePending = job;
    else dispatchComparison(job);
  }
  context.compareResult = compareResult;
  context.compareStatus = compareStatus;
  context.compareLoadError = compareLoadError;
}

function render() {
  if (!current) return;
  const [name, id, , resolved] = parseHash();
  // Reconstruir el HTML resetea el scroll de la fila: se conserva y restaura
  // para que navegar no pegue un salto brusco (el bug se veía al tocar una
  // sección con el nav deslizado a la derecha).
  const navX = appRoot.querySelector('.app-nav')?.scrollLeft ?? 0;
  const isEmpty = name !== 'compare' && isFilterActive(state) && current.totals.records === 0;
  const viewCtx = buildViewContext(name);
  if (name === 'compare') prepareComparison(viewCtx);
  else comparePending = null;
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
  resizeContractCharts();
  restoreChartSelections();
  restoreCalendarInspector();
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
    const isEmpty = name !== 'compare' && isFilterActive(state) && current.totals.records === 0;
    const viewCtx = buildViewContext(name);
    if (name === 'compare') prepareComparison(viewCtx);
    root.innerHTML = isEmpty ? emptyFiltersHTML() : renderView(name, current, id, viewCtx);
    resizeContractCharts();
    restoreChartSelections();
    restoreCalendarInspector();
  }
  updateFilterDynamics();
  announceFilters();
  syncHash();
  wireView();
  if (focusSelector) (appRoot.querySelector(focusSelector) ?? appRoot.querySelector('#filter-chips'))?.focus();
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
        const isExpanded = nameSpan.classList.toggle('is-expanded');
        const label = isExpanded ? 'Contraer nombre' : 'Expandir nombre';
        btn.classList.toggle('is-expanded', isExpanded);
        btn.setAttribute('aria-expanded', String(isExpanded));
        btn.setAttribute('aria-label', label);
        btn.title = label;
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
    btn.addEventListener('click', async () => {
      if (openExportDialog('table')) return;
      try {
        await exportModel('table', captureExportContext());
      } catch (error) {
        if (error.code !== 'E_ABORT') reportProcessingError(error, 'export');
      }
    });
  });
}

function wireView() {
  wireRankCard();
  wireExploreView();
  syncTallTables(appRoot);

  const compareForm = appRoot.querySelector('#compare-form');
  compareForm?.querySelector('[data-compare-field="preset"]')?.addEventListener('change', (event) => {
    state.compareFrom = compareForm.querySelector('[data-compare-field="fromA"]').value || null;
    state.compareTo = compareForm.querySelector('[data-compare-field="toA"]').value || null;
    state.compareRefFrom = compareForm.querySelector('[data-compare-field="fromB"]').value || null;
    state.compareRefTo = compareForm.querySelector('[data-compare-field="toB"]').value || null;
    state.comparePreset = event.target.value;
    pushCompareHash();
    render();
    appRoot.querySelector('[data-compare-field="preset"]')?.focus();
  });
  compareForm?.querySelector('[data-compare-field="granularity"]')?.addEventListener('change', (event) => {
    state.compareFrom = compareForm.querySelector('[data-compare-field="fromA"]').value || null;
    state.compareTo = compareForm.querySelector('[data-compare-field="toA"]').value || null;
    state.compareRefFrom = compareForm.querySelector('[data-compare-field="fromB"]').value || null;
    state.compareRefTo = compareForm.querySelector('[data-compare-field="toB"]').value || null;
    state.compareGranularity = event.target.value;
    pushCompareHash();
    render();
    appRoot.querySelector('[data-compare-field="granularity"]')?.focus();
  });
  appRoot.querySelector('[data-compare-entity-mode]')?.addEventListener('change', (event) => {
    state.compareEntityMode = event.target.value === 'share' ? 'share' : 'absolute';
    pushCompareHash();
    render();
    appRoot.querySelector('[data-compare-entity-mode]')?.focus();
  });
  appRoot.querySelector('[data-comeback-threshold]')?.addEventListener('change', (event) => {
    const threshold = Number(event.target.value);
    if (!LONGITUDINAL_THRESHOLDS.has(threshold)) return;
    state.comebackThresholdDays = threshold;
    state.longitudinalPages = { ...state.longitudinalPages, comebackTracks: 1, comebackArtists: 1 };
    updateDiscoveryView('[data-comeback-threshold]');
  });
  appRoot.querySelectorAll('[data-longitudinal-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.dataset.longitudinalPage;
      if (!['comebackTracks', 'comebackArtists', 'firstTracks', 'firstArtists'].includes(field)) return;
      const direction = Number(button.dataset.dir);
      if (![-1, 1].includes(direction)) return;
      const nextPage = Math.max(1, Number(state.longitudinalPages?.[field] ?? 1) + direction);
      state.longitudinalPages = { ...state.longitudinalPages, [field]: nextPage };
      updateDiscoveryView(`[data-longitudinal-page="${field}"][data-dir="${direction}"]`);
    });
  });
  appRoot.querySelector('[data-longitudinal-page-size]')?.addEventListener('change', (event) => {
    const pageSize = Number(event.target.value);
    if (!LONGITUDINAL_PAGE_SIZES.has(pageSize)) return;
    state.longitudinalPageSize = pageSize;
    state.longitudinalPages = { comebackTracks: 1, comebackArtists: 1, firstTracks: 1, firstArtists: 1 };
    updateDiscoveryView('[data-longitudinal-page-size]');
  });
  appRoot.querySelectorAll('[data-discovery-focus]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.discoveryFocus);
      const heading = target?.querySelector('h2');
      if (!heading) return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start' });
    });
  });
  compareForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const fromA = compareForm.querySelector('[data-compare-field="fromA"]')?.value;
    const toA = compareForm.querySelector('[data-compare-field="toA"]')?.value;
    const fromB = compareForm.querySelector('[data-compare-field="fromB"]')?.value;
    const toB = compareForm.querySelector('[data-compare-field="toB"]')?.value;
    const preset = compareForm.querySelector('[data-compare-field="preset"]')?.value;
    const rangeA = compareDateRange(fromA, toA);
    const rangeB = compareDateRange(fromB, toB);
    const message = compareForm.querySelector('[data-compare-status]');
    if (!rangeA || (preset === 'manual' && !rangeB)) {
      if (message) message.textContent = !rangeA ? 'Revisá las fechas del período A.' : 'Revisá las fechas manuales del período B.';
      return;
    }
    state.comparePreset = preset;
    state.compareGranularity = compareForm.querySelector('[data-compare-field="granularity"]')?.value;
    state.compareFrom = fromA;
    state.compareTo = toA;
    state.compareRefFrom = fromB || null;
    state.compareRefTo = toB || null;
    compareResultKey = null;
    compareStatus = 'idle';
    compareLoadError = null;
    if (message) message.textContent = '';
    pushCompareHash();
    render();
    appRoot.querySelector('#compare-form [type="submit"]')?.focus();
  });

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
      const confirmed = analysisState.getConfirmed();
      const text = receiptTextFromConfirmed({
        confirmed,
        fallbackModel: current,
        fallbackState: state,
        fallbackMetric: activeMetric
      });
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
    const headingRow = document.createElement('div');
    headingRow.className = 'view-heading';
    viewHeaderH1.before(headingRow);
    headingRow.append(viewHeaderH1);

    const favBtn = document.createElement('button');
    favBtn.type = 'button';
    favBtn.className = `btn-fav ${isFav ? 'is-fav' : ''}`;
    favBtn.dataset.action = 'toggle-fav';
    favBtn.dataset.favView = currentViewName;
    favBtn.setAttribute('aria-label', isFav ? 'Quitar de favoritos' : 'Agregar a favoritos');
    favBtn.setAttribute('aria-pressed', String(isFav));
    favBtn.title = isFav ? 'Quitar de favoritos' : 'Agregar a favoritos';
    favBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 3.75h12v17l-6-4-6 4z"/></svg>';
    favBtn.addEventListener('click', () => {
      if (favorites.has(currentViewName)) favorites.delete(currentViewName);
      else favorites.add(currentViewName);
      saveStoredFavorites(favorites);
      render();
    });
    headingRow.append(favBtn);
  }

  document.querySelectorAll('[data-action="reset-preferences"]').forEach((btn) => {
    btn.onclick = () => resetPreferences();
  });
}

function cloneFilterState(filters) {
  return {
    ...filters,
    range: filters.range ? { ...filters.range } : null,
    ...Object.fromEntries(['years', 'months', 'hours', 'dows'].map((key) => [key, filters[key] ? new Set(filters[key]) : null]))
  };
}

function captureExportContext() {
  const exploreState = buildViewContext('explore').exploreState;
  const compareContext = parseHash()[0] === 'compare' ? buildViewContext('compare') : null;
  return {
    filterState: cloneFilterState(state),
    metric: activeMetric,
    exploreState: exploreState ? {
      tab: exploreState.tab,
      query: exploreState.query,
      sortBy: exploreState.sortBy,
      sortDir: exploreState.sortDir,
      page: exploreState.page,
      pageSize: exploreState.pageSize,
      minPlays: exploreState.minPlays,
      minMonths: exploreState.minMonths
    } : null,
    compareRanges: compareContext?.compareRangeA && compareContext?.compareRangeB ? {
      rangeA: compareContext.compareRangeA,
      rangeB: compareContext.compareRangeB
    } : null
  };
}

function summarizeExportFilters(filters, fullModel) {
  const parts = [];
  if (filters.range) parts.push(`${locToISODate(filters.range.from)} a ${locToISODate(filters.range.to)}`);
  if (filters.years?.size) parts.push(`años ${[...filters.years].sort((a, b) => a - b).join(', ')}`);
  if (filters.months?.size) parts.push(`${filters.months.size} meses seleccionados`);
  if (filters.dows?.size) parts.push(`${filters.dows.size} días de semana seleccionados`);
  if (filters.hours?.size) parts.push(`${filters.hours.size} horas seleccionadas`);
  for (const [id, kind, label] of [
    [filters.artistId, 'artists', 'Artista'],
    [filters.trackId, 'tracks', 'Canción'],
    [filters.albumId, 'albums', 'Álbum']
  ]) {
    if (id == null) continue;
    const entity = fullModel[kind].byId.get(id);
    parts.push(`${label}: ${entity ? `${entity.name}${entity.artist ? ` — ${entity.artist}` : ''}` : id}`);
  }
  for (const [key, label] of [['skip', 'Saltada'], ['shuffle', 'Aleatoria'], ['offline', 'Sin conexión']]) {
    if (filters[key] != null) parts.push(`${label}: ${filters[key] === 'unknown' ? 'desconocida' : filters[key] ? 'sí' : 'no'}`);
  }
  return parts.length ? parts.join('; ') : 'sin filtros analíticos';
}

function downloadExport(result) {
  if (!result?.bytes) return;
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

async function exportModel(scope = 'all', context = captureExportContext()) {
  if (!model) return;
  const label = scope === 'selection' ? 'Exportando selección analítica'
    : scope === 'table' ? 'Exportando tabla actual'
      : 'Preparando exportación';
  const job = beginProcessing(label, 'export');
  let result;
  try {
    const payload = {
      scope,
      filterState: scope === 'all' ? undefined : context.filterState,
      metric: context.metric,
      exploreState: scope === 'table' ? context.exploreState : undefined,
      compareRanges: context.compareRanges ?? undefined
    };
    result = await analysisClient.request('export', payload, { onProgress: job.progress });
  }
  finally { job.finish(); }
  if (!result?.bytes) return;
  downloadExport(result);
  if (scope === 'table') announce(`Descargadas ${fmtNum(result.totalMatches)} filas con su metadata.`);
}

const exportDialog = document.getElementById('dialog-export');
const exportForm = document.getElementById('export-form');
let pendingExportContext = null;

function openExportDialog(defaultScope = 'all') {
  if (!model) return false;
  if ([...jobs.values()].some((job) => job.type === 'filter')) {
    announce('Esperá a que termine la actualización de filtros antes de exportar.');
    return true;
  }
  if (!exportDialog || typeof exportDialog.showModal !== 'function') return false;

  const confirmed = analysisState.getConfirmed();
  const confirmedModel = confirmed.model ?? current;
  const context = captureExportContext();
  if (!confirmedModel) return true;
  pendingExportContext = context;

  const allDesc = document.getElementById('export-all-desc');
  if (allDesc) allDesc.textContent = `${fmtNum(model.totals.records)} reproducciones de todo el historial, sin filtros analíticos.`;

  const optSelection = document.getElementById('export-opt-selection');
  const selDesc = document.getElementById('export-selection-desc');
  const hasFilters = isFilterActive(context.filterState);
  if (optSelection && selDesc) {
    optSelection.classList.toggle('is-disabled', !hasFilters);
    optSelection.querySelector('input').disabled = !hasFilters;
    selDesc.textContent = hasFilters
      ? `${fmtNum(confirmedModel.totals.records)} reproducciones; ${summarizeExportFilters(context.filterState, model)}.`
      : 'No hay filtros analíticos activos.';
  }

  const [viewName] = parseHash();
  const optTable = document.getElementById('export-opt-table');
  const tableDesc = document.getElementById('export-table-desc');
  const hasTable = viewName === 'explore' && confirmedModel;
  if (optTable) {
    optTable.hidden = !hasTable;
    if (hasTable) {
      const tableButton = document.querySelector('#explore-card [data-action="export-table"]');
      const totalMatches = Number(tableButton?.dataset.totalMatches);
      const effectiveDir = tableButton?.dataset.sortDirection;
      const tableRadio = optTable.querySelector('input[name="export-scope"]');
      const hasRenderedQuery = Number.isSafeInteger(totalMatches) && totalMatches >= 0
        && (effectiveDir === 'asc' || effectiveDir === 'desc');
      if (tableRadio) tableRadio.disabled = !hasRenderedQuery;
      const { tab, options } = describeCatalogQuery(confirmedModel, {
        metric: context.metric,
        exploreState: context.exploreState
      });
      const tabName = tab === 'artists' ? 'artistas' : tab === 'tracks' ? 'canciones' : 'álbumes';
      const criteria = [];
      if (options.query) criteria.push(`búsqueda “${options.query}”`);
      if (options.minPlays != null) criteria.push(`mínimo ${options.minPlays} reproducciones`);
      if (options.minMonths != null) criteria.push(`mínimo ${options.minMonths} meses activos`);
      if (options.minKnownSkips != null) criteria.push(`mínimo ${options.minKnownSkips} saltos conocidos`);
      const criterion = criteria.length ? criteria.join('; ') : 'sin búsqueda ni umbrales adicionales';
      const metricLabel = context.metric === 'ms' ? 'tiempo escuchado' : 'reproducciones';
      if (tableDesc) {
        tableDesc.textContent = hasRenderedQuery
          ? `${fmtNum(totalMatches)} ${tabName}; selección: ${summarizeExportFilters(context.filterState, model)}; métrica principal: ${metricLabel}; ${criterion}; orden: ${catalogOrderLabel(options.sortBy, effectiveDir)}. Descarga un ZIP con el CSV y su metadata.`
          : 'No se pudo confirmar el conteo de la tabla actual. Volvé a abrir Explorar antes de exportarla.';
      }
    }
  }

  const tableScopeAvailable = hasTable && !exportForm?.querySelector('input[name="export-scope"][value="table"]')?.disabled;
  const selectedScope = tableScopeAvailable || defaultScope !== 'table' ? defaultScope : 'all';
  const radio = exportForm?.querySelector(`input[name="export-scope"][value="${selectedScope}"]`);
  if (radio && !radio.disabled) radio.checked = true;
  else {
    const allRadio = exportForm?.querySelector('input[name="export-scope"][value="all"]');
    if (allRadio) allRadio.checked = true;
  }
  exportDialog.showModal();
  return true;
}

headerActions?.querySelectorAll('[data-action="export"]').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    if (!model) return;
    if (openExportDialog('all')) return;

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
        await exportModel(scope, pendingExportContext ?? captureExportContext());
      } else {
        await exportModel(scope, pendingExportContext ?? captureExportContext());
      }
    } catch (error) {
      if (error.code !== 'E_ABORT') reportProcessingError(error, 'export');
    } finally {
      pendingExportContext = null;
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
    longitudinalRevision++;
    const confirmed = analysisState.cancelUpdate();
    restoreConfirmedContext(confirmed);
    clearTimeout(activeJob.timer);
    jobs.delete(activeJobId);
    processingError = 'Actualización cancelada. Podés reintentarla.';
    processingErrorType = 'filter';
    setFilterBusy([...jobs.values()].some(item => item.type === 'filter'));
    updateProcessing();
    return;
  }
  if (activeJob?.type === 'export') {
    analysisClient.cancelExport();
    clearTimeout(activeJob.timer);
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
  for (const job of jobs.values()) clearTimeout(job.timer);
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
  if (!failed) {
    const [view] = parseHash();
    if (!longitudinalLoadError || (view !== 'habits' && view !== 'discovery')) return;
    longitudinalLoadError = null;
    if (await refreshModel()) render();
    return;
  }
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
let pendingCalendarDate = null;
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
    pendingCalendarDate = null;
  } else if (pendingCalendarDate) {
    appRoot.querySelector(`.calendar-month__table [data-date="${pendingCalendarDate}"]`)?.focus({ preventScroll: true });
    pendingCalendarDate = null;
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
  const compareEntityButton = e.target.closest?.('[data-compare-entity]');
  if (!compareEntityButton || !appRoot.contains(compareEntityButton)) return;
  let selection;
  try {
    selection = normalizeCompareEntities([JSON.parse(compareEntityButton.dataset.compareEntity)])[0];
  } catch {
    selection = null;
  }
  if (!selection) return;
  const selections = normalizeCompareEntities(state.compareEntities);
  const selectedKey = compareEntityKey(selection);
  const existingIndex = selections.findIndex((entity) => compareEntityKey(entity) === selectedKey);
  if (existingIndex < 0 && selections.length >= 3) {
    const status = appRoot.querySelector('[data-compare-entity-status]');
    if (status) status.textContent = 'Podés seleccionar hasta tres entidades.';
    announce('Podés seleccionar hasta tres entidades.');
    return;
  }
  if (existingIndex >= 0) selections.splice(existingIndex, 1);
  else selections.push(selection);
  state.compareEntities = selections;
  pushCompareHash();
  render();
  const focusTarget = [...appRoot.querySelectorAll('[data-compare-entity]')].find((button) => {
    try { return compareEntityKey(JSON.parse(button.dataset.compareEntity)) === selectedKey; } catch { return false; }
  });
  (focusTarget ?? appRoot.querySelector('#compare-selected-title'))?.focus?.({ preventScroll: true });
  announce(existingIndex >= 0 ? `${selection.kind === 'artist' ? selection.name : `${selection.title} — ${selection.artist}`} se quitó de la comparación.` : `${selection.kind === 'artist' ? selection.name : `${selection.title} — ${selection.artist}`} se agregó a la comparación.`);
});

appRoot.addEventListener('click', (e) => {
  const clearBtn = e.target.closest?.('[data-action="clear"]');
  if (clearBtn && appRoot.contains(clearBtn)) {
    state = {
      ...emptyFilterState(),
      comebackThresholdDays: state.comebackThresholdDays ?? 30,
      longitudinalPageSize: state.longitudinalPageSize ?? 25,
      longitudinalPages: { comebackTracks: 1, comebackArtists: 1, firstTracks: 1, firstArtists: 1 }
    };
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
appRoot.addEventListener('click', (e) => {
  const dayEl = e.target.closest?.('[data-day]');
  if (dayEl && appRoot.contains(dayEl)) {
    const day = Number(dayEl.dataset.day);
    if (Number.isFinite(day)) {
      const iso = dayEl.dataset.date || new Date(day * 86400000).toISOString().slice(0, 10);
      const [selectedYear, selectedMonth] = iso.split('-').map(Number);
      state.calMonth = { year: selectedYear, month: selectedMonth };
      if (e.shiftKey && calAnchor != null) {
        const [a, b] = calAnchor <= day ? [calAnchor, day] : [day, calAnchor];
        state.calDate = iso;
        state.calRangeFrom = new Date(a * 86400000).toISOString().slice(0, 10);
        state.calRangeTo = new Date(b * 86400000).toISOString().slice(0, 10);
        state.range = { from: a * 86400, to: b * 86400 + 86399 };
        calAnchor = day;
        applyAndRenderView();
        return;
      }
      calAnchor = day;
      state.calDate = iso;
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
      if (selVal) selVal.textContent = valLabel ? `· ${valLabel}` : '';
      if (btnFilter) btnFilter.disabled = false;
      if (btnStart) btnStart.disabled = false;
      if (btnEnd) btnEnd.disabled = false;
      if (fromInput && !fromInput.value) fromInput.value = iso;
      if (toInput && fromInput?.value && !toInput.value) toInput.value = iso;
      state.calRangeFrom = fromInput?.value || null;
      state.calRangeTo = toInput?.value || null;
      if (detailLink) {
        const params = new URLSearchParams(portableFilterParams(state, model).replace(/^\?/, ''));
        params.set('m', activeMetric);
        const query = calendarQuery(`?${params}`, state.calMonth, state.normalizeYears, {
          date: state.calDate,
          rangeFrom: state.calRangeFrom,
          rangeTo: state.calRangeTo
        });
        detailLink.href = formatSemanticRoute('day', iso, query);
        detailLink.hidden = false;
      }

      appRoot.querySelectorAll('[data-day].is-selected').forEach((cell) => cell.classList.remove('is-selected'));
      dayEl.classList.add('is-selected');
      syncCalendarGridSelection(iso);
      syncHash();
      analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
    }
  }

  const calAction = e.target.closest?.('[data-cal-action]');
  if (calAction && appRoot.contains(calAction)) {
    const act = calAction.dataset.calAction;
    if (act === 'filter-day' && calAnchor != null) {
      state.range = { from: calAnchor * 86400, to: calAnchor * 86400 + 86399 };
      applyAndRenderView('#btn-cal-filter-day');
      return;
    }
    if (act === 'set-start' && calAnchor != null) {
      const fromInput = appRoot.querySelector('#cal-range-from');
      if (fromInput) {
        fromInput.value = new Date(calAnchor * 86400000).toISOString().slice(0, 10);
        state.calRangeFrom = fromInput.value;
        syncHash();
        analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
      }
      return;
    }
    if (act === 'set-end' && calAnchor != null) {
      const toInput = appRoot.querySelector('#cal-range-to');
      if (toInput) {
        toInput.value = new Date(calAnchor * 86400000).toISOString().slice(0, 10);
        state.calRangeTo = toInput.value;
        syncHash();
        analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
      }
      return;
    }
    if (act === 'apply-range') {
      const fromInput = appRoot.querySelector('#cal-range-from');
      const toInput = appRoot.querySelector('#cal-range-to');
      if (fromInput?.value && toInput?.value) {
        state.calRangeFrom = fromInput.value;
        state.calRangeTo = toInput.value;
        const fromDay = Math.floor(Date.parse(`${fromInput.value}T00:00:00Z`) / 86400000);
        const toDay = Math.floor(Date.parse(`${toInput.value}T00:00:00Z`) / 86400000);
        if (Number.isFinite(fromDay) && Number.isFinite(toDay)) {
          state.range = { from: Math.min(fromDay, toDay) * 86400, to: Math.max(fromDay, toDay) * 86400 + 86399 };
          applyAndRenderView('#btn-cal-apply-range');
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
    const query = calendarQuery(`${fParams || '?'}${fParams ? '&' : ''}${serializeMetricParam(activeMetric)}`, state.calMonth, state.normalizeYears, {
      date: state.calDate,
      rangeFrom: state.calRangeFrom,
      rangeTo: state.calRangeTo
    });
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

  const compareSeriesPage = e.target.closest?.('[data-compare-series-page]');
  if (compareSeriesPage && appRoot.contains(compareSeriesPage)) {
    const controls = compareSeriesPage.closest('[data-compare-series-controls]');
    const table = controls?.previousElementSibling?.matches('table') ? controls.previousElementSibling : controls?.parentElement?.querySelector('table');
    const rows = [...(table?.querySelectorAll('[data-compare-series-row]') ?? [])];
    const pageSize = Number(controls?.dataset.pageSize);
    if (!controls || !Number.isInteger(pageSize) || pageSize < 1) return;
    const pageCount = Math.ceil(rows.length / pageSize);
    const page = Math.max(0, Math.min(pageCount - 1, Number(controls.dataset.page) + Number(compareSeriesPage.dataset.compareSeriesPage)));
    const start = page * pageSize;
    rows.forEach((row, index) => { row.hidden = index < start || index >= start + pageSize; });
    controls.dataset.page = String(page);
    controls.querySelector('[aria-live="polite"]').textContent = `Mostrando ${start + 1}–${Math.min(start + pageSize, rows.length)} de ${rows.length}`;
    controls.querySelector('[data-compare-series-page="-1"]').disabled = page === 0;
    controls.querySelector('[data-compare-series-page="1"]').disabled = page >= pageCount - 1;
    return;
  }

  const longitudinalStaticPage = e.target.closest?.('[data-longitudinal-static-page]');
  if (longitudinalStaticPage && appRoot.contains(longitudinalStaticPage)) {
    const controls = longitudinalStaticPage.closest('[data-longitudinal-static-controls]');
    const table = controls?.previousElementSibling?.querySelector('table');
    const rows = [...(table?.querySelectorAll('[data-longitudinal-static-row]') ?? [])];
    const pageSize = Number(controls?.dataset.pageSize);
    if (!controls || !Number.isInteger(pageSize) || pageSize < 1) return;
    const pageCount = Math.ceil(rows.length / pageSize);
    const page = Math.max(0, Math.min(pageCount - 1, Number(controls.dataset.page) + Number(longitudinalStaticPage.dataset.dir)));
    const start = page * pageSize;
    rows.forEach((row, index) => { row.hidden = index < start || index >= start + pageSize; });
    controls.dataset.page = String(page);
    controls.querySelector('[aria-live="polite"]').textContent = `Mostrando ${start + 1}–${Math.min(start + pageSize, rows.length)} de ${rows.length}`;
    controls.querySelector('[data-dir="-1"]').disabled = page === 0;
    controls.querySelector('[data-dir="1"]').disabled = page >= pageCount - 1;
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
  const calendarCell = e.target.closest?.('.calendar-month__table [data-date]');
  if (calendarCell && appRoot.contains(calendarCell)) {
    const targetDate = calendarGridTargetDate(calendarCell.dataset.date, e.key);
    if (targetDate) {
      e.preventDefault();
      if (targetDate === calendarCell.dataset.date) return;
      const target = appRoot.querySelector(`.calendar-month__table [data-date="${targetDate}"]`);
      if (target) {
        target.focus({ preventScroll: true });
        target.click();
        return;
      }
      const [year, month] = targetDate.split('-').map(Number);
      state.calDate = targetDate;
      state.calMonth = { year, month };
      pendingCalendarDate = targetDate;
      const [view, routeYear] = parseHash();
      const filters = portableFilterParams(state, model);
      const query = calendarQuery(`${filters || '?'}${filters ? '&' : ''}${serializeMetricParam(activeMetric)}`, state.calMonth, state.normalizeYears, {
        date: state.calDate,
        rangeFrom: state.calRangeFrom,
        rangeTo: state.calRangeTo
      });
      location.hash = formatSemanticRoute('calendar', view === 'calendar' && routeYear != null ? year : null, query);
      return;
    }
  }
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

appRoot.addEventListener('change', (e) => {
  const input = e.target;
  if (input.id === 'cal-range-from') state.calRangeFrom = input.value || null;
  else if (input.id === 'cal-range-to') state.calRangeTo = input.value || null;
  else return;
  syncHash();
  analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
});

window.addEventListener('resize', () => {
  resizeContractCharts();
  restoreChartSelections();
  syncTallTables(appRoot);
}, { passive: true });
