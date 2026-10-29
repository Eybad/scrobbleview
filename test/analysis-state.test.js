import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisState } from '../app/analysis-state.js';
import { emptyFilterState } from '../src/filters.js';

function result(records) { return { totals: { records }, albums: { byId: new Map() } }; }

test('only the latest filter response can update the visible model', async () => {
  const pending = [];
  const state = createAnalysisState({ request: () => new Promise((resolve) => pending.push(resolve)) });
  state.initialize(result(3));
  const older = state.update({ ...emptyFilterState(), skip: true });
  const latest = state.update({ ...emptyFilterState(), offline: true });
  pending[1]({ model: result(2), prev: null });
  assert.equal((await latest).model.totals.records, 2);
  pending[0]({ model: result(1), prev: null });
  assert.equal(await older, null);
});

test('table controls reuse statistics and clearing invalidates pending work', async () => {
  let resolve, requests = 0;
  const state = createAnalysisState({ request() { requests++; return new Promise((done) => { resolve = done; }); } });
  state.initialize(result(3));
  const first = state.update(emptyFilterState());
  resolve({ model: null, prev: null });
  await first;
  assert.equal((await state.update(emptyFilterState())).model.totals.records, 3);
  assert.equal(requests, 1);
  const pending = state.update({ ...emptyFilterState(), skip: false });
  state.clear();
  resolve({ model: result(1), prev: null });
  assert.equal(await pending, null);
});

test('album details are fetched on demand and released when leaving the album', async () => {
  const album = { trackStats: new Map() };
  const model = { ...result(3), albums: { byId: new Map([[1, album]]) } };
  const requests = [];
  const state = createAnalysisState({ async request(type) {
    requests.push(type);
    return type === 'filter' ? { model: null, prev: null } : { trackStats: new Map([[1, { plays: 1 }]]) };
  } });
  state.initialize(model);
  await state.update(emptyFilterState(), { view: 'album', id: '1' });
  assert.equal(album.trackStats.get(1).plays, 1);
  await state.update(emptyFilterState(), { view: 'dashboard' });
  assert.equal(album.trackStats.size, 0);
  assert.deepEqual(requests, ['filter', 'album']);
});

test('event details discard stale responses and are released on navigation', async () => {
  const pending = [];
  const state = createAnalysisState({ request(type) {
    if (type === 'filter') return Promise.resolve({ model: null, prev: null });
    return new Promise(resolve => pending.push(resolve));
  } });
  state.initialize(result(3));
  const first = state.update(emptyFilterState(), { view: 'day', id: '2024-01-01' });
  await Promise.resolve();
  const second = state.update(emptyFilterState(), { view: 'day', id: '2024-01-02' });
  await Promise.resolve();
  pending[1]({ rows: ['new'] });
  assert.deepEqual((await second).detail.rows, ['new']);
  pending[0]({ rows: ['old'] });
  assert.equal(await first, null);
  assert.equal((await state.update(emptyFilterState(), { view: 'dashboard' })).detail, null);
});

test('failed updates preserve the confirmed context and retain the failed request', async () => {
  let fail = false;
  const state = createAnalysisState({ async request() {
    if (fail) throw new Error('synthetic failure');
    return { model: null, prev: null };
  } });
  state.initialize(result(3));
  await state.update(emptyFilterState(), { context: { hash: '#/dashboard?m=ms', metric: 'ms' } });
  fail = true;
  const requested = { ...emptyFilterState(), dows: new Set([1]) };
  await assert.rejects(state.update(requested, { context: { hash: '#/dashboard?d=1&m=plays', metric: 'plays' } }));
  requested.dows.add(2);
  assert.equal(state.getConfirmed().context.hash, '#/dashboard?m=ms');
  assert.equal(state.getFailed().hash, '#/dashboard?d=1&m=plays');
  assert.deepEqual([...state.getFailed().state.dows], [1]);
});

test('failed filter leaves the confirmed album detail intact', async () => {
  const album = { trackStats: new Map() };
  const model = { ...result(3), albums: { byId: new Map([[1, album]]) } };
  let fail = false;
  const state = createAnalysisState({ async request(type) {
    if (type === 'album') return { trackStats: new Map([[7, { plays: 2 }]]) };
    if (fail) throw new Error('synthetic failure');
    return { model: null, prev: null };
  } });
  state.initialize(model);
  await state.update(emptyFilterState(), { view: 'album', id: 1 });
  fail = true;
  await assert.rejects(state.update({ ...emptyFilterState(), shuffle: true }, { view: 'dashboard' }));
  assert.equal(album.trackStats.get(7).plays, 2);
});

test('cancelling an update retains its requested context for retry', async () => {
  let resolve;
  let requests = 0;
  const state = createAnalysisState({
    request() {
      requests++;
      if (requests === 1) return Promise.resolve({ model: null, prev: null });
      return new Promise(done => { resolve = done; });
    },
    cancelUpdate() {}
  });
  state.initialize(result(3));
  await state.update(emptyFilterState(), { context: { hash: '#/dashboard', metric: 'ms' } });
  const pending = state.update({ ...emptyFilterState(), skip: true }, { context: { hash: '#/dashboard?s=yes', metric: 'ms' } });
  const confirmed = state.cancelUpdate();
  assert.equal(confirmed.context.hash, '#/dashboard');
  assert.equal(state.getFailed().state.skip, true);
  resolve({ model: result(1), prev: null });
  assert.equal(await pending, null);
  assert.equal(state.getConfirmed().model.totals.records, 3);
});
