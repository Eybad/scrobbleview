import { calculateCompareRange } from '../src/compare.js';
import { filterParams, portableFilterParams } from './filter-ui.js';
import { parseExploreState } from './catalog-query.js';
import { buildCalendarMonthOptions, calendarQuery, defaultCalendarDate } from './calendar-ui.js';
import { compareDateAt, compareDateRange } from './compare-state.js';
import { serializeMetricParam } from './state-metric.js';

export const LONGITUDINAL_THRESHOLDS = new Set([30, 90, 180]);
export const LONGITUDINAL_PAGE_SIZES = new Set([25, 50, 100]);

export function parseDiscoveryState(query) {
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

export function discoveryQuery(query, state) {
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

export function buildViewContext(viewName, snapshot) {
  const {
    route, state, model, previousTotals, detail, metric, rankUI, limits,
    presentation, compare, longitudinal, now
  } = snapshot;
  const rawQuery = route.query ?? '';
  const filterQuery = portableFilterParams(state, model);
  const metricParam = serializeMetricParam(metric);
  const queryString = filterQuery ? `${filterQuery}&${metricParam}` : `?${metricParam}`;
  const exploreState = viewName === 'explore' ? parseExploreState(rawQuery, presentation) : null;
  const contextQuery = viewName === 'calendar' || viewName === 'day'
    ? `?${calendarQuery(queryString, state.calMonth, state.normalizeYears, {
      date: state.calDate,
      rangeFrom: state.calRangeFrom,
      rangeTo: state.calRangeTo
    })}`
    : queryString;
  const query = viewName === 'discovery' ? `?${discoveryQuery(contextQuery, state)}` : contextQuery;
  const compareView = viewName === 'compare';
  const observedRange = compareView && model.meta.firstTs != null ? {
    from: Math.floor(model.meta.firstTs / 86400) * 86400,
    to: Math.floor(model.meta.lastTs / 86400) * 86400 + 86399
  } : null;
  const defaultCompareRange = state.range ?? observedRange;
  const compareFrom = compareView ? state.compareFrom ?? compareDateAt(defaultCompareRange, 'from') : null;
  const compareTo = compareView ? state.compareTo ?? compareDateAt(defaultCompareRange, 'to') : null;
  const compareRangeA = compareView ? compareDateRange(compareFrom, compareTo) : null;
  const compareRefRange = compareView ? compareDateRange(state.compareRefFrom, state.compareRefTo) : null;
  const compareDataRange = compareView && model.meta.firstTs != null
    ? { minSec: model.meta.firstTs, maxSec: model.meta.lastTs }
    : null;
  let compareRangeB = compareRefRange;
  let compareWarning = '';
  let compareError = '';
  if (compareView && compareRangeA && state.comparePreset !== 'manual') {
    try {
      const calculated = calculateCompareRange(state.comparePreset, compareRangeA, compareDataRange);
      compareRangeB = calculated.rangeB;
      compareWarning = calculated.warning;
    } catch (error) {
      compareError = error.message;
    }
  } else if (compareView && compareRangeA && state.comparePreset === 'manual' && compareRefRange) {
    try {
      const calculated = calculateCompareRange('manual', compareRangeA, compareDataRange, compareRefRange);
      compareWarning = calculated.warning;
    } catch (error) {
      compareError = error.message;
    }
  }
  if (compareView && !compareRangeA) compareError ||= 'Elegí fechas válidas para el período A.';
  if (compareView && state.comparePreset === 'manual' && !compareRefRange) compareError ||= 'Elegí fechas válidas para el período B.';

  const compareFilterState = compareView ? { ...state, range: null, years: null, months: null, dows: null, hours: null } : null;
  const currentCompareKey = compareRangeA && compareRangeB
    ? JSON.stringify([filterParams(compareFilterState), state.comparePreset, compareRangeA, compareRangeB])
    : null;
  const isCurrentCompare = currentCompareKey != null && compare?.key === currentCompareKey;
  const longitudinalView = viewName === 'habits' || viewName === 'discovery';
  const longitudinalKey = longitudinalView
    ? JSON.stringify([filterParams(state), state.comebackThresholdDays ?? 30, state.longitudinalPages, state.longitudinalPageSize])
    : null;
  const isCurrentLongitudinal = longitudinalKey != null && longitudinal?.key === longitudinalKey;
  const detailRequested = viewName === 'day' || viewName === 'session' || viewName === 'track';
  let calendarMonthOptions = null;
  if (viewName === 'calendar') {
    const calendarModel = snapshot.calendarModel ?? model;
    const routeYear = route.id == null ? null : Number(route.id);
    const yearlyRoute = Number.isInteger(routeYear) && routeYear >= 100 && routeYear <= 9999;
    const latestYear = [...(calendarModel?.yearly?.keys?.() ?? [])].sort((a, b) => b - a)[0];
    const year = yearlyRoute ? routeYear : state.calMonth?.year ?? latestYear ?? now.getFullYear();
    const month = state.calMonth?.year === year ? state.calMonth.month : state.calMonth?.month ?? now.getMonth() + 1;
    const selectedDate = state.calDate ?? defaultCalendarDate({ model: calendarModel, year, month, yearly: yearlyRoute });
    calendarMonthOptions = buildCalendarMonthOptions({
      model: calendarModel,
      year,
      month,
      metric,
      selectedDate,
      normalizeYears: yearlyRoute || Boolean(state.normalizeYears)
    });
  }

  return {
    years: state.years,
    range: state.range,
    prev: viewName === 'dashboard' ? previousTotals : null,
    limits,
    metric,
    rankUI,
    query,
    exploreState,
    detail: detailRequested ? detail : null,
    rawQuery,
    detailRequested,
    normalizeYears: state.normalizeYears ?? false,
    calMonth: state.calMonth,
    calDate: state.calDate,
    calendarMonthOptions,
    month: state.calMonth?.month ?? now.getMonth() + 1,
    comparePreset: compareView ? state.comparePreset : undefined,
    compareGranularity: compareView ? state.compareGranularity : undefined,
    compareEntities: compareView ? state.compareEntities : undefined,
    compareEntityMode: compareView ? state.compareEntityMode : undefined,
    comebackThresholdDays: longitudinalView ? state.comebackThresholdDays ?? 30 : undefined,
    longitudinalPages: longitudinalView ? state.longitudinalPages : undefined,
    longitudinalPageSize: longitudinalView ? state.longitudinalPageSize : undefined,
    longitudinal: isCurrentLongitudinal ? longitudinal.result : null,
    longitudinalError: longitudinalView ? longitudinal.error : null,
    compareFrom,
    compareTo,
    compareRefFrom: compareView ? state.compareRefFrom : undefined,
    compareRefTo: compareView ? state.compareRefTo : undefined,
    compareRangeA,
    compareRangeB,
    compareDataRange,
    compareWarning,
    compareError,
    compareResult: isCurrentCompare ? compare.result : null,
    compareStatus: compareView ? (isCurrentCompare ? compare.status : 'idle') : undefined,
    compareLoadError: isCurrentCompare ? compare.error : null
  };
}
