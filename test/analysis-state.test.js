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
