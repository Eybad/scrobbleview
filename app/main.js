import { createAnalysisClient } from './analysis-client.js';
import { createAnalysisState } from './analysis-state.js';
import { AbortError } from '../src/parse/errors.js';
import { emptyFilterState, RANGE_PRESETS } from '../src/filters.js';
import { setupInput } from './input.js';
import { renderView, rankCardHTML, receiptTextFromConfirmed, emptyFiltersHTML, footerMetaText, calendarYearGridHTML } from './views.js';
import { createExportUI } from './export-ui.js';
import { esc, fmtNum, fmtMs } from '../src/charts.js';
import { filterBarHTML, isFilterActive, BLOCKS, chipsHTML, isoDateToDay, locToISODate, rangeFromYear, rangeFromMonth, syncRangeShortcuts, normalizeRangeDays, filterStatusMessage, filterParams, portableFilterParams, resolvePortableFilters, advancedFilterCount } from './filter-ui.js';
import { clear as cacheClear, cacheSummary, isAvailable as cacheAvailable, persist as cachePersist } from './storage.js';
import { resolveMetric, parseQueryParams, serializeMetricParam, METRIC_STORAGE_KEY, DEFAULT_METRIC } from './state-metric.js';
import { parseExploreState } from './catalog-query.js';
import { parseRoute, resolveRoute, formatSemanticRoute, mergeExploreParams } from './routes.js';
import { captureHistoryState, restoreHistoryState } from './history-state.js';
import { resetPresentationPreferences } from './presentation-preferences.js';
import { contextBarHTML } from './context-bar.js';
import { parseCalendarState, parseCalendarSelection, calendarQuery } from './calendar-ui.js';
import { parseCompareState, compareQuery, compareDateRange, compareDateAt, compareEntityKey, normalizeCompareEntities } from './compare-state.js';
import { buildViewContext as createViewContext, discoveryQuery, LONGITUDINAL_PAGE_SIZES, LONGITUDINAL_THRESHOLDS, parseDiscoveryState } from './view-context.js';
import { mountExplore } from './explore-controller.js';
import { mountChartInteractions } from './chart-interactions.js';
import { mountCalendar } from './calendar-controller.js';
import { mountNavigation, SECTION_NAMES } from './navigation-ui.js';

const appRoot = document.getElementById('app-root');
const siteHeader = document.querySelector('.site-header');
const headerActions = document.getElementById('header-actions');
const siteFooter = document.querySelector('.site-footer');
const footerMeta = document.getElementById('footer-meta');

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
let model = null;
let current = null;
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
let cacheOffer = null;
let advState = null;
let popReturnState = null;
let exploreController = null;
let chartInteractions = null;
let calendarController = null;
let calendarViewContext = null;
let appFrame = null;

function disposeApplicationFrame() {
  exploreController?.dispose();
  exploreController = null;
  chartInteractions?.dispose();
  chartInteractions = null;
  calendarController?.dispose();
  calendarController = null;
  appFrame?.navigationController.dispose();
  appRoot.replaceChildren();
  appFrame = null;
}

// Keep the toast outside #app-root so it survives view renders.
const toast = document.createElement('div');
toast.id = 'chart-toast';
toast.className = 'toast';
toast.setAttribute('role', 'status');
toast.setAttribute('aria-atomic', 'true');
toast.hidden = true;
document.body.appendChild(toast);
let toastTimer = 0;

// Keep one persistent live region for async updates.
const liveRegion = document.createElement('p');
liveRegion.id = 'live-status';
liveRegion.className = 'visually-hidden';
liveRegion.setAttribute('role', 'status');
liveRegion.setAttribute('aria-atomic', 'true');
document.body.appendChild(liveRegion);

function announce(text) {
  liveRegion.textContent = text;
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
let activeImportJob = null;
let cancelledFilter = null;
let filterProcessingError = null;
let displayedJobId = null;

function processingTarget(job) {
  if (!job) {
    if (!processingError) return null;
    if (processingErrorType === 'export' && document.getElementById('dialog-export')?.open) return document.getElementById('export-progress');
    return processing;
  }
  if (job.type === 'import') return document.getElementById('import-progress');
  if (job.type === 'export') return document.getElementById('dialog-export')?.open
    ? document.getElementById('export-progress')
    : processing;
  return processing;
}

function updateProcessing() {
  const activeEntries = [...jobs.entries()];
  const importEntry = activeEntries.filter(([, item]) => item.type === 'import').at(-1);
  const exportEntry = activeEntries.filter(([, item]) => item.type === 'export').at(-1);
  const generalEntry = activeEntries.filter(([, item]) => item.type === 'general').at(-1);
  const globalEntry = importEntry ?? exportEntry ?? generalEntry;
  const [jobId, job] = globalEntry ?? [];
  displayedJobId = jobId ?? null;
  const target = processingTarget(job);
  const importProgress = document.getElementById('import-progress');
  const exportProgress = document.getElementById('export-progress');
  const slots = [processing, importProgress, exportProgress].filter(Boolean);
  for (const slot of slots) slot.hidden = slot !== target;
  target?.append(processingStatus, processingProgress, cancelProcessing);
  const globalError = !job && Boolean(processingError);
  if (globalError) {
    processingStatus.setAttribute('role', 'alert');
    processingStatus.removeAttribute('aria-live');
  } else {
    processingStatus.setAttribute('role', 'status');
    processingStatus.setAttribute('aria-live', 'off');
  }
  processingStatus.textContent = job ? `${job.label}… ${Math.round(job.fraction * 100)}%` : processingError ?? '';
  processingProgress.hidden = !job;
  if (job) {
    processingProgress.value = job.fraction;
    processingStatus.style.setProperty('--processing-progress', `${job.fraction * 100}%`);
  } else {
    processingStatus.style.removeProperty('--processing-progress');
  }
  cancelProcessing.hidden = !job;
  cancelProcessing.textContent = 'Cancelar';
  cancelProcessing.setAttribute('aria-label', job?.type === 'import' ? 'Cancelar carga' : 'Cancelar exportación');
  processing.hidden = target !== processing;

  const filterProgress = appFrame?.context.querySelector('#filter-progress');
  const filterJob = activeEntries.filter(([, item]) => item.type === 'filter').at(-1)?.[1] ?? null;
  const filterStatus = filterProgress?.querySelector('#filter-processing-status');
  const filterNativeProgress = filterProgress?.querySelector('#filter-processing-progress');
  const cancelFilter = filterProgress?.querySelector('#cancel-filter-processing');
  const resetFilterProcessing = appFrame?.context.querySelector('#reset-filter-processing');
  const filterError = !filterJob && Boolean(filterProcessingError);
  if (filterProgress) {
    filterProgress.hidden = !filterJob && !filterError;
    filterProgress.classList.toggle('is-error', filterError);
  }
  appFrame?.context.querySelector('.context-period')?.toggleAttribute('hidden', Boolean(filterJob || filterError));
  if (filterStatus) {
    if (filterError) {
      filterStatus.setAttribute('role', 'alert');
      filterStatus.removeAttribute('aria-live');
      filterStatus.textContent = filterProcessingError;
    } else {
      filterStatus.setAttribute('role', 'status');
      filterStatus.setAttribute('aria-live', 'off');
      filterStatus.textContent = filterJob ? `${filterJob.label}… ${Math.round(filterJob.fraction * 100)}%` : '';
      filterStatus.style.setProperty('--processing-progress', `${(filterJob?.fraction ?? 0) * 100}%`);
    }
  } else {
    filterStatus?.removeAttribute('role');
  }
  if (filterNativeProgress) {
    filterNativeProgress.hidden = !filterJob;
    if (filterJob) filterNativeProgress.value = filterJob.fraction;
  }
  if (cancelFilter) cancelFilter.hidden = !filterJob;
  if (filterError) filterProgress?.append(retryProcessing);
  else processing.append(retryProcessing);
  retryProcessing.hidden = !filterError || (!analysisState.getFailed() && !cancelledFilter) || !analysisState.getConfirmed().context;
  if (resetFilterProcessing) resetFilterProcessing.hidden = !filterError;
}

function beginProcessing(label, type = 'general') {
  const id = ++nextJob;
  if (type === 'import') {
    processingError = null;
    processingErrorType = null;
    filterProcessingError = null;
    cancelledFilter = null;
  } else if (type === 'filter') {
    filterProcessingError = null;
    cancelledFilter = null;
  } else {
    processingError = null;
    processingErrorType = null;
  }
  const job = { label, fraction: 0, type };
  jobs.set(id, job);
  if (!(type === 'filter' && activeImportJob)) announce(`${label}.`);
  updateProcessing();
  return {
    setContext(context) {
      job.context = context;
    },
    progress(fraction, nextLabel) {
      const activeJob = jobs.get(id);
      if (!activeJob) return;
      activeJob.fraction = fraction;
      if (nextLabel) activeJob.label = nextLabel;
      updateProcessing();
    },
    finish() {
      jobs.delete(id);
      updateProcessing();
    }
  };
}

function reportProcessingError(error, type = 'general') {
  if (error.code === 'E_ABORT') return;
  if (type === 'filter') {
    filterProcessingError = `${error.message} Reintentá o restablecé los filtros.`;
  } else if (type === 'export') {
    processingErrorType = type;
    processingError = `${error.message} Reintentá la exportación.`;
  } else {
    processingErrorType = type;
    processingError = `${error.message} Podés volver a cargar los archivos.`;
  }
  updateProcessing();
}

async function initializeAnalysis(result) {
  disposeApplicationFrame();
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
    activeImportJob?.progress(0, 'Actualizando estadísticas');
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
  activeImportJob = job;
  try {
    const result = await analysisClient.request('load', input, { onProgress(fraction, label) {
      job.progress(fraction, label); onProgress?.(fraction, label);
    } });
    await initializeAnalysis(result);
    cacheOffer = cacheAvailable() ? 'save' : null;
    return result;
  } finally {
    if (activeImportJob === job) activeImportJob = null;
    job.finish();
  }
}

async function loadCached() {
  const job = beginProcessing('Cargando datos guardados', 'import');
  activeImportJob = job;
  try {
    const result = await analysisClient.request('cached', {}, { onProgress: job.progress });
    if (!result) return null;
    await initializeAnalysis(result);
    cacheOffer = 'loaded';
    return result;
  } finally {
    if (activeImportJob === job) activeImportJob = null;
    job.finish();
  }
}

async function clearCached() {
  if (!await cacheClear()) return false;
  cacheOffer = null;
  updateCacheToast();
  inputApi.showCachedButtons(false);
  return true;
}

function setFilterBusy(busy) {
  appRoot.classList.toggle('app--updating', busy);
  const frame = appFrame;
  if (!frame) return;
  const viewContent = frame.viewRoot.querySelector('[data-view-content]');
  const placeholder = frame.viewRoot.querySelector('[data-view-placeholder]');
  frame.viewRoot.setAttribute('aria-busy', String(busy));
  frame.filters.toggleAttribute('inert', busy);
  frame.context.querySelector('.metric-switch')?.toggleAttribute('inert', busy);
  if (viewContent) {
    viewContent.style.visibility = busy ? 'hidden' : '';
    viewContent.toggleAttribute('inert', busy);
    if (busy) viewContent.setAttribute('aria-hidden', 'true');
    else viewContent.removeAttribute('aria-hidden');
  }
  if (placeholder) placeholder.hidden = !busy;
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
  const job = initializing && activeImportJob
    ? activeImportJob
    : beginProcessing('Actualizando estadísticas', 'filter');
  const ownsJob = job !== activeImportJob;
  const requestedFilter = state;
  const requestedMetric = activeMetric;
  if (ownsJob) job.setContext({ state: requestedFilter, metric: requestedMetric, hash: requestedHash });
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
    cancelledFilter = null;
    return true;
  } catch (error) {
    if (error.code !== 'E_ABORT' && !initializing) {
      restoreConfirmedContext();
      cancelledFilter = { state: requestedFilter, metric: requestedMetric, hash: requestedHash };
      reportProcessingError(error, 'filter');
    }
    if (initializing) throw error;
    return false;
  } finally {
    if (ownsJob) job.finish();
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

// Replace filter state without adding a history entry for every control change.
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

// Restore URL state and its model together before rendering a view.
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

function updateContextBar(root, options) {
  const template = document.createElement('template');
  template.innerHTML = contextBarHTML(options);
  const next = template.content.firstElementChild;
  const current = root.querySelector('.context-bar');
  if (!next) {
    current?.remove();
    return;
  }
  if (!current) {
    root.replaceChildren(next);
    return;
  }

  const currentPeriodSlot = current.querySelector('.context-period-slot');
  const currentPeriod = current.querySelector('.context-period');
  const nextPeriod = next.querySelector('.context-period');
  currentPeriod.textContent = nextPeriod.textContent;
  currentPeriod.title = nextPeriod.title;

  const currentWarning = current.querySelector('.context-coverage-warning');
  const nextWarning = next.querySelector('.context-coverage-warning');
  if (currentWarning && nextWarning) currentWarning.textContent = nextWarning.textContent;
  else if (nextWarning) currentPeriodSlot.after(nextWarning);
  else currentWarning?.remove();

  for (const metric of ['ms', 'plays']) {
    const button = current.querySelector(`[data-metric="${metric}"]`);
    const nextButton = next.querySelector(`[data-metric="${metric}"]`);
    button.className = nextButton.className;
    button.setAttribute('aria-pressed', nextButton.getAttribute('aria-pressed'));
  }
}

function navigationQuery(view) {
  const fParams = portableFilterParams(state, model);
  const mParam = serializeMetricParam(activeMetric);
  const baseQuery = fParams ? `${fParams}&${mParam}` : `?${mParam}`;
  return {
    default: baseQuery,
    ...(view === 'compare' ? { compare: compareQuery(baseQuery, state) } : {}),
    ...(view === 'discovery' ? { discovery: discoveryQuery(baseQuery, state) } : {})
  };
}

function ensureApplicationFrame() {
  if (appFrame) return appFrame;
  const navigation = document.createElement('div');
  navigation.className = 'app-frame-slot';
  navigation.dataset.appSlot = 'navigation';
  const analysisControls = document.createElement('div');
  analysisControls.id = 'analysis-controls';
  analysisControls.className = 'app-analysis-controls';
  analysisControls.dataset.appSlot = 'analysis';
  const context = document.createElement('div');
  context.className = 'app-frame-slot';
  context.dataset.appSlot = 'context';
  updateContextBar(context, { state, model, metric: activeMetric });
  context.querySelector('#cancel-filter-processing')?.addEventListener('click', cancelFilterUpdate);
  const filters = document.createElement('div');
  filters.className = 'app-frame-slot';
  filters.dataset.appSlot = 'filters';
  filters.innerHTML = filterBarHTML(model, state);
  analysisControls.append(context, filters);
  const warning = document.createElement('div');
  warning.className = 'app-frame-slot';
  warning.dataset.appSlot = 'warning';
  const viewRoot = document.createElement('div');
  viewRoot.id = 'view-root';
  appRoot.replaceChildren(navigation, analysisControls, warning, viewRoot);
  const navigationController = mountNavigation(navigation);
  appFrame = { navigation, analysisControls, context, filters, warning, viewRoot, navigationController };
  wireFilters();
  return appFrame;
}

function updateFramePresentation(name, warningHTML = '') {
  const frame = ensureApplicationFrame();
  frame.navigationController.update({ view: name, query: navigationQuery(name), favorites });
  updateContextBar(frame.context, { state, model, metric: activeMetric });
  frame.warning.innerHTML = warningHTML;
  updateFilterDynamics();
}

function renderViewContent(markup, viewName) {
  const frame = ensureApplicationFrame();
  const busy = frame.viewRoot.getAttribute('aria-busy') === 'true';
  const indexSlot = document.createElement('div');
  indexSlot.dataset.viewIndex = '';
  indexSlot.hidden = true;
  const content = document.createElement('div');
  content.dataset.viewContent = '';
  content.innerHTML = markup;
  const placeholder = document.createElement('div');
  placeholder.className = 'view-placeholder';
  placeholder.dataset.viewPlaceholder = '';
  placeholder.setAttribute('aria-hidden', 'true');
  placeholder.hidden = !busy;
  placeholder.innerHTML = '<p class="view-placeholder__message">Los resultados confirmados se conservan durante el cálculo.</p>';
  if (busy) {
    content.style.visibility = 'hidden';
    content.setAttribute('inert', '');
    content.setAttribute('aria-hidden', 'true');
  }
  frame.viewRoot.dataset.view = viewName;
  frame.viewRoot.replaceChildren(indexSlot, content, placeholder);
  chartInteractions?.refresh();
  calendarController?.refresh();
}

// Keep the persistent save prompt separate from transient cache messages.
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

// Toast buttons are re-created on each render, so delegate their events.
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
      cachePersist();
    } else {
      // Remove stale cache after a failed load to avoid showing old data.
      await cacheClear();
      cacheOffer = 'error';
    }
  } else {
    cacheOffer = null;
  }
  updateCacheToast();
});

function buildViewContext(viewName) {
  const [, , , route] = parseHash();
  const rawQuery = route.query ?? '';
  let presentation = {};
  if (viewName === 'explore') {
    const tab = parseExploreState(rawQuery).tab;
    const storedDensity = typeof localStorage !== 'undefined' ? localStorage.getItem('scrobbleview:density') : null;
    const storedColsRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(`scrobbleview:cols:${tab}`) : null;
    let visibleCols = null;
    if (storedColsRaw) {
      try { visibleCols = new Set(JSON.parse(storedColsRaw)); } catch (_) {}
    }
    presentation = { density: storedDensity, visibleCols };
  }
  return createViewContext(viewName, {
    route,
    state,
    model,
    calendarModel: current,
    previousTotals: currentPrev,
    detail: currentDetail,
    metric: activeMetric,
    rankUI,
    limits: tableLimits,
    presentation,
    compare: { key: compareResultKey, result: compareResult, status: compareStatus, error: compareLoadError },
    longitudinal: { key: longitudinalResultKey, result: longitudinalResult, error: longitudinalLoadError },
    now: new Date()
  });
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
  const isEmpty = name !== 'compare' && isFilterActive(state) && current.totals.records === 0;
  const viewCtx = buildViewContext(name);
  calendarViewContext = name === 'calendar' ? viewCtx : null;
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
  ensureApplicationFrame();
  updateFramePresentation(name, filterWarning);
  renderViewContent(viewContent, name);
  updateCacheToast();
  announceFilters();
  siteHeader?.classList.remove('site-header--home');
  headerActions?.removeAttribute('hidden');
  siteFooter?.removeAttribute('hidden');
  if (footerMeta && model) {
    footerMeta.textContent = footerMetaText(model);
    footerMeta.hidden = false;
  }
  wireView();
}

// Keep the filter bar mounted so edits preserve focus and disclosure state.
async function applyAndRenderView(focusSelector = null) {
  unresolvedFilter = false;
  appRoot.querySelector('#filter-resolution-warning')?.remove();
  syncHash();
  if (!await refreshModel()) return;
  const [name, id] = parseHash();
  const isEmpty = name !== 'compare' && isFilterActive(state) && current.totals.records === 0;
  const viewCtx = buildViewContext(name);
  calendarViewContext = name === 'calendar' ? viewCtx : null;
  if (name === 'compare') prepareComparison(viewCtx);
  updateFramePresentation(name);
  renderViewContent(isEmpty ? emptyFiltersHTML() : renderView(name, current, id, viewCtx), name);
  announceFilters();
  syncHash();
  wireView();
  if (focusSelector) (appRoot.querySelector(focusSelector) ?? appRoot.querySelector('#filter-chips'))?.focus({ preventScroll: true });
}

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
  // Keep date shortcuts aligned with the active range.
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
  const advancedToggle = appRoot.querySelector('.filter-advanced-toggle');
  const filterPanel = appRoot.querySelector('#filter-panel');
  if (advancedToggle && filterPanel) {
    const expanded = advState ?? false;
    advancedToggle.setAttribute('aria-expanded', String(expanded));
    filterPanel.hidden = !expanded;
    advancedToggle.addEventListener('click', () => {
      advState = filterPanel.hidden;
      filterPanel.hidden = !advState;
      advancedToggle.setAttribute('aria-expanded', String(advState));
    });
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

  // Collapse an inverted custom range to the edited date.
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

  // Keep unknown flags distinct from known true and false values.
  appRoot.querySelectorAll('[data-toggle3]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const k = sel.dataset.toggle3;
      if (k !== 'skip' && k !== 'shuffle' && k !== 'offline') return;
      state[k] = sel.value === '' ? null : sel.value === 'unknown' ? 'unknown' : sel.value === 'yes';
      applyAndRenderView();
    });
  });
}


let searchTimer = 0;

function syncTallTables(root) {
  root.querySelectorAll('.table-scroll--tall').forEach((wrap) => {
    if (wrap.closest('#explore-card')) return;
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
  // Restore horizontal tab position after rendering the new table.
  const tabsX = [...card.querySelectorAll('.tabs')].map((t) => t.scrollLeft);
  card.innerHTML = rankCardHTML(current, { ...rankUI, contextQuery: buildViewContext('dashboard').query });
  card.querySelectorAll('.tabs').forEach((t, i) => { t.scrollLeft = tabsX[i] ?? 0; });
  wireRankCard();
  syncTallTables(card);
  // Restore keyboard focus after re-rendering the activated control.
  if (focusSel) card.querySelector(focusSel)?.focus({ preventScroll: true });
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
      const newBtn = document.getElementById('rank-card')?.querySelector(`[data-metric="${activeMetric}"]`);
      if (newBtn) newBtn.focus({ preventScroll: true });
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
  // Automatic tab activation follows focus; restore focus after re-rendering.
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
      // Announce the result count after changing catalog tabs.
      const q = v.trim();
      if (q) {
        const n = card.querySelectorAll('tbody tr').length;
        announce(n > 0 ? `${n} ${n === 1 ? 'resultado' : 'resultados'} de “${q}”` : 'Sin resultados.');
      }
    }, 200);
  });
}

function wireView(exploreReturnState = null) {
  wireRankCard();
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
  exploreController?.refresh(exploreReturnState);
}

const exportUI = createExportUI({
  document,
  client: analysisClient,
  beginProcessing,
  announce,
  refreshProcessing: updateProcessing,
  reportError: (error) => reportProcessingError(error, 'export'),
  getContext() {
    if (!model) return { model: null };
    const exploreState = buildViewContext('explore').exploreState;
    const [viewName] = parseHash();
    const compareContext = viewName === 'compare' ? buildViewContext('compare') : null;
    return {
      model,
      confirmedModel: analysisState.getConfirmed().model ?? current,
      filterState: state,
      metric: activeMetric,
      exploreState,
      viewName,
      filterBusy: [...jobs.values()].some((job) => job.type === 'filter'),
      compareRanges: compareContext?.compareRangeA && compareContext?.compareRangeB ? {
        rangeA: compareContext.compareRangeA,
        rangeB: compareContext.compareRangeB
      } : null
    };
  }
});

function mountExploreController() {
  exploreController?.dispose();
  exploreController = mountExplore(appFrame.viewRoot, {
    readSnapshot() {
      const [, , , route] = parseHash();
      const confirmed = analysisState.getConfirmed();
      if (!confirmed?.model) return null;
      return { route, context: buildViewContext('explore'), model: confirmed.model };
    },
    commitQuery(nextQuery, returnState) {
      const query = nextQuery ? `?${nextQuery}` : '';
      const hash = formatSemanticRoute('explore', null, query);
      history.replaceState(history.state, '', hash);
      analysisState.updatePresentation({ hash: location.hash, metric: activeMetric });
      const [view, id] = parseHash();
      const viewRoot = appFrame?.viewRoot;
      if (view !== 'explore' || !viewRoot || !current) return;
      const viewContext = buildViewContext('explore');
      updateFramePresentation('explore', '');
      renderViewContent(renderView('explore', current, id, viewContext), 'explore');
      wireView(returnState);
    },
    savePreference(key, value) {
      if (typeof localStorage === 'undefined') return;
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    },
    exportTable() {
      exportUI.start({ scope: 'table' });
    }
  });
}

function dispatchCalendarAction(action) {
  if (action.type === 'select-day') {
    const [year, month] = action.date.split('-').map(Number);
    const previousDate = state.calDate;
    state.calMonth = { year, month };
    state.calDate = action.date;
    if (action.shiftKey && previousDate) {
      const anchor = Math.floor(Date.parse(`${previousDate}T00:00:00Z`) / 86400000);
      const [from, to] = anchor <= action.day ? [anchor, action.day] : [action.day, anchor];
      state.calRangeFrom = new Date(from * 86400000).toISOString().slice(0, 10);
      state.calRangeTo = new Date(to * 86400000).toISOString().slice(0, 10);
      state.range = { from: from * 86400, to: to * 86400 + 86399 };
      applyAndRenderView();
      return;
    }
    state.calRangeFrom = action.rangeFrom || action.date;
    state.calRangeTo = action.rangeTo || action.date;
    syncHash();
    analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
    return;
  }

  if (action.type === 'filter-day') {
    const day = Math.floor(Date.parse(`${action.date}T00:00:00Z`) / 86400000);
    state.range = { from: day * 86400, to: day * 86400 + 86399 };
    applyAndRenderView('#btn-cal-filter-day');
    return;
  }

  if (action.type === 'set-range-bound' || action.type === 'change-range') {
    state[action.field] = action.type === 'set-range-bound' ? action.date : action.value || null;
    syncHash();
    analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
    return;
  }

  if (action.type === 'apply-range' && action.from && action.to) {
    state.calRangeFrom = action.from;
    state.calRangeTo = action.to;
    const fromDay = Math.floor(Date.parse(`${action.from}T00:00:00Z`) / 86400000);
    const toDay = Math.floor(Date.parse(`${action.to}T00:00:00Z`) / 86400000);
    if (!Number.isFinite(fromDay) || !Number.isFinite(toDay)) return;
    state.range = { from: Math.min(fromDay, toDay) * 86400, to: Math.max(fromDay, toDay) * 86400 + 86399 };
    applyAndRenderView('#btn-cal-apply-range');
    return;
  }

  if (action.type === 'navigate-month') {
    state.calMonth = { year: action.year, month: action.month };
    const [view, year] = parseHash();
    const filters = portableFilterParams(state, model);
    const query = calendarQuery(`${filters || '?'}${filters ? '&' : ''}${serializeMetricParam(activeMetric)}`, state.calMonth, state.normalizeYears, {
      date: state.calDate,
      rangeFrom: state.calRangeFrom,
      rangeTo: state.calRangeTo
    });
    pendingCalendarFocus = action.navigation;
    location.hash = formatSemanticRoute('calendar', view === 'calendar' && year != null ? state.calMonth.year : null, query);
    return;
  }

  if (action.type === 'navigate-date') {
    const [year, month] = action.date.split('-').map(Number);
    state.calDate = action.date;
    state.calMonth = { year, month };
    pendingCalendarDate = action.date;
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

  if (action.type === 'toggle-scale') {
    state.normalizeYears = action.normalizeYears;
    syncHash();
    analysisState.updatePresentation({ hash: location.hash, metric: activeMetric, state });
    render();
    appRoot.querySelector('[data-action="toggle-cal-scale"]')?.focus({ preventScroll: true });
  }
}

function mountCalendarController() {
  calendarController?.dispose();
  calendarController = mountCalendar(appFrame.viewRoot, {
    readState() {
      const [, , , route] = parseHash();
      return { route, state, context: calendarViewContext, model: current };
    },
    dispatch: dispatchCalendarAction
  });
}

headerActions?.querySelectorAll('[data-action="export"]').forEach((button) => {
  button.addEventListener('click', (event) => exportUI.start({ trigger: event.currentTarget }));
});

headerActions?.querySelectorAll('[data-action="reset"]').forEach((btn) => {
  btn.addEventListener('click', () => location.reload());
});

const inputApi = setupInput({
  analyze,
  onReady() {
    // An existing hash takes precedence over the default dashboard route.
    if (!location.hash) location.hash = '#/dashboard';
    ensureApplicationFrame();
    mountExploreController();
    chartInteractions = mountChartInteractions(appFrame.viewRoot, { announce });
    mountCalendarController();
    render();
  },
  onError() {
  },
  onLoadCached: loadCached,
  onClearCached: clearCached
});

function cancelFilterUpdate() {
  const [activeJobId, activeJob] = [...jobs.entries()].filter(([, job]) => job.type === 'filter').at(-1) ?? [];
  if (!activeJob || initializing) return;
  longitudinalRevision++;
  const confirmed = analysisState.cancelUpdate();
  cancelledFilter = activeJob.context ?? null;
  restoreConfirmedContext(confirmed);
  jobs.delete(activeJobId);
  filterProcessingError = 'Actualización cancelada. Podés reintentarla.';
  setFilterBusy([...jobs.values()].some(item => item.type === 'filter'));
  updateProcessing();
}

cancelProcessing.addEventListener('click', () => {
  const activeJobId = displayedJobId;
  const activeJob = jobs.get(activeJobId);
  if (!activeJob) return;
  if (activeJob?.type === 'export') {
    analysisClient.cancelExport();
    jobs.delete(activeJobId);
    processingError = null;
    processingErrorType = null;
    announce('Exportación cancelada.');
    updateProcessing();
    return;
  }
  if (activeJob?.type !== 'import') return;
  activeImportJob = null;
  analysisState.clear();
  analysisClient.cancel();
  model = null; current = null; currentPrev = null; currentDetail = null; detailContext = null; cacheOffer = null;
  disposeApplicationFrame();
  jobs.clear(); processingError = null; processingErrorType = null; filterProcessingError = null; cancelledFilter = null;
  appRoot.classList.remove('app--updating');
  updateProcessing(); updateCacheToast();
  headerActions?.setAttribute('hidden', '');
  siteFooter?.setAttribute('hidden', '');
  siteHeader?.classList.add('site-header--home');
  inputApi.reset('Procesamiento cancelado. Volvé a seleccionar los archivos para continuar.');
});

retryProcessing.addEventListener('click', async () => {
  const failed = analysisState.getFailed();
  const cancelled = cancelledFilter;
  const retry = failed ?? cancelled;
  if (!retry) {
    const [view] = parseHash();
    if (!longitudinalLoadError || (view !== 'habits' && view !== 'discovery')) return;
    longitudinalLoadError = null;
    if (await refreshModel()) render();
    return;
  }
  cancelledFilter = null;
  state = retry.state;
  activeMetric = retry.metric;
  rankUI.metric = activeMetric;
  if (failed) {
    detailPage = failed.page;
    detailPageSize = failed.pageSize;
    detailContext = (failed.view === 'day' || failed.view === 'session' || failed.view === 'track')
      ? JSON.stringify([failed.view, failed.id, filterParams(state)]) : null;
  }
  history.replaceState(history.state, '', retry.hash);
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
    appRoot.querySelector(`.calendar-month__grid-wrap [data-date="${pendingCalendarDate}"]`)?.focus({ preventScroll: true });
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

// Delegate chip events because the row is re-rendered after each filter change.
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
    if (newBtn) newBtn.focus({ preventScroll: true });
    return;
  }
});

// Preserve filters, metric, and return position across internal navigation.
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

// SVG titles are unavailable on touch, so handle chart feedback without hover.
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

appRoot.addEventListener('click', (e) => {
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

});

window.addEventListener('resize', () => {
  syncTallTables(appRoot);
}, { passive: true });
