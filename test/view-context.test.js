import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilterState } from '../src/filters.js';
import { filterParams } from '../app/filter-ui.js';
import { compareDateRange } from '../app/compare-state.js';
import { buildViewContext, discoveryQuery, parseDiscoveryState } from '../app/view-context.js';

function createSnapshot({ view = 'dashboard', query = '', state = emptyFilterState(), overrides = {} } = {}) {
  return {
    route: { view, id: null, query },
    state,
    model: { meta: { firstTs: 1704067200, lastTs: 1704672000 } },
    previousTotals: { records: 3 },
    detail: { id: 9 },
    metric: 'plays',
    rankUI: { tab: 'artists' },
    limits: new Map([['artists', 10]]),
    presentation: {},
    compare: {},
    longitudinal: {},
    now: new Date(2024, 4, 15),
    ...overrides
  };
}

test('view context projects explicit route, presentation and shared references without exposing the model', () => {
  const state = { ...emptyFilterState(), range: { from: 1704067200, to: 1704672000 } };
  const model = { meta: { firstTs: 1704067200, lastTs: 1704672000 } };
  const rankUI = { tab: 'artists' };
  const limits = new Map([['artists', 25]]);
  const context = buildViewContext('explore', createSnapshot({
    view: 'explore', query: 'tab=tracks&q=Echo', state,
    overrides: { model, rankUI, limits, presentation: { density: 'compact', visibleCols: new Set(['name']) } }
  }));

  assert.equal(context.rawQuery, 'tab=tracks&q=Echo');
  assert.equal(context.exploreState.tab, 'tracks');
  assert.equal(context.exploreState.q, 'Echo');
  assert.equal(context.exploreState.density, 'compact');
  assert.equal(context.exploreState.visibleCols.has('name'), true);
  assert.equal(context.metric, 'plays');
  const query = new URLSearchParams(context.query.replace(/^\?/, ''));
  assert.equal(query.get('r'), '1704067200-1704672000');
  assert.equal(query.get('m'), 'plays');
  assert.equal(context.rankUI, rankUI);
  assert.equal(context.limits, limits);
  assert.equal(context.detail, null);
  assert.equal(context.prev, null);
  assert.equal(context.month, 5);
  assert.equal(Object.hasOwn(context, 'model'), false);
});

test('calendar context carries the selected month, date and metric without reading the clock', () => {
  const state = {
    ...emptyFilterState(),
    calMonth: { year: 2024, month: 3 },
    normalizeYears: true,
    calDate: '2024-03-12',
    calRangeFrom: '2024-03-10',
    calRangeTo: '2024-03-12'
  };
  const context = buildViewContext('calendar', createSnapshot({ view: 'calendar', state }));
  const query = new URLSearchParams(context.query.replace(/^\?/, ''));

  assert.equal(query.get('cm'), '2024-03');
  assert.equal(query.get('cn'), '1');
  assert.equal(query.get('cd'), '2024-03-12');
  assert.equal(query.get('cf'), '2024-03-10');
  assert.equal(query.get('ct'), '2024-03-12');
  assert.equal(query.get('m'), 'plays');
  assert.equal(context.calendarMonthOptions.year, 2024);
  assert.equal(context.calendarMonthOptions.month, 3);
  assert.equal(context.calendarMonthOptions.byMs, false);
  assert.equal(context.calendarMonthOptions.selectedDate, '2024-03-12');
  assert.deepEqual(context.calendarMonthOptions.daysMap, new Map());
});

test('discovery state parser validates its values and serializer preserves surrounding query state', () => {
  assert.deepEqual(parseDiscoveryState('?cb=90&lps=100&ctp=2&cap=0&ftp=4&fap=1'), {
    comebackThresholdDays: 90,
    longitudinalPageSize: 100,
    longitudinalPages: { comebackTracks: 2, comebackArtists: 1, firstTracks: 4, firstArtists: 1 }
  });
  assert.deepEqual(parseDiscoveryState('?cb=31&lps=10&ctp=-2'), {
    comebackThresholdDays: 30,
    longitudinalPageSize: 25,
    longitudinalPages: { comebackTracks: 1, comebackArtists: 1, firstTracks: 1, firstArtists: 1 }
  });
  const query = new URLSearchParams(discoveryQuery('?m=plays&future=kept', {
    comebackThresholdDays: 90,
    longitudinalPageSize: 50,
    longitudinalPages: { comebackTracks: 3, comebackArtists: 1, firstTracks: 1, firstArtists: 1 }
  }));
  assert.equal(query.get('future'), 'kept');
  assert.equal(query.get('cb'), '90');
  assert.equal(query.get('lps'), '50');
  assert.equal(query.get('ctp'), '3');
  assert.equal(query.has('cap'), false);
});

test('view context includes only longitudinal results matching the explicit filter key', () => {
  const state = {
    ...emptyFilterState(),
    comebackThresholdDays: 90,
    longitudinalPages: { comebackTracks: 2, comebackArtists: 1, firstTracks: 1, firstArtists: 1 },
    longitudinalPageSize: 50
  };
  const key = JSON.stringify([filterParams(state), 90, state.longitudinalPages, 50]);
  const result = { total: 14 };
  const snapshot = createSnapshot({
    view: 'discovery', state,
    overrides: { longitudinal: { key, result, error: null } }
  });
  const context = buildViewContext('discovery', snapshot);
  const query = new URLSearchParams(context.query.replace(/^\?/, ''));

  assert.equal(context.longitudinal, result);
  assert.equal(query.get('cb'), '90');
  assert.equal(query.get('ctp'), '2');
  assert.equal(query.get('m'), 'plays');
  assert.equal(context.longitudinalPages, state.longitudinalPages);
  assert.equal(context.prev, null);
  assert.equal(Object.hasOwn(context, 'model'), false);

  const stale = buildViewContext('discovery', {
    ...snapshot,
    longitudinal: { key: 'stale', result, error: 'old error' }
  });
  assert.equal(stale.longitudinal, null);
  assert.equal(stale.longitudinalError, 'old error');
});

test('view context includes only a comparison result for the current date and filter key', () => {
  const state = {
    ...emptyFilterState(),
    comparePreset: 'manual',
    compareGranularity: 'daily',
    compareFrom: '2024-01-05',
    compareTo: '2024-01-07',
    compareRefFrom: '2024-01-01',
    compareRefTo: '2024-01-03',
    compareEntities: [],
    compareEntityMode: 'absolute'
  };
  const rangeA = compareDateRange(state.compareFrom, state.compareTo);
  const rangeB = compareDateRange(state.compareRefFrom, state.compareRefTo);
  const model = { meta: { firstTs: 1704067200, lastTs: 1704672000 } };
  const filterState = { ...state, range: null, years: null, months: null, dows: null, hours: null };
  const key = JSON.stringify([filterParams(filterState), state.comparePreset, rangeA, rangeB]);
  const result = { records: 12 };
  const snapshot = createSnapshot({
    view: 'compare', state,
    overrides: { model, compare: { key, result, status: 'ready', error: null } }
  });
  const context = buildViewContext('compare', snapshot);

  assert.deepEqual(context.compareRangeA, rangeA);
  assert.deepEqual(context.compareRangeB, rangeB);
  assert.equal(context.compareResult, result);
  assert.equal(context.compareStatus, 'ready');
  assert.equal(context.compareError, '');

  const stale = buildViewContext('compare', {
    ...snapshot,
    compare: { key: 'stale', result, status: 'ready', error: 'old error' }
  });
  assert.equal(stale.compareResult, null);
  assert.equal(stale.compareStatus, 'idle');
  assert.equal(stale.compareLoadError, null);
  assert.equal(Object.hasOwn(stale, 'model'), false);
});
