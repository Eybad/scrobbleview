import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createAnalysisClient } from '../app/analysis-client.js';
import { createAnalysisState } from '../app/analysis-state.js';
import { emptyFilterState } from '../src/filters.js';

function clientForTest(t) {
  const client = createAnalysisClient({ createWorker() {
    const worker = new Worker(new URL('../app/analysis-worker.js', import.meta.url));
    return {
      postMessage: (message) => worker.postMessage(message),
      terminate: () => worker.terminate(),
      addEventListener(type, listener) {
        if (type === 'message') worker.on(type, (data) => listener({ data }));
        else worker.on(type, listener);
      }
    };
  } });
  t.after(() => client.cancel());
  return client;
}

function file(events) {
  const blob = new Blob([JSON.stringify(events)]);
  return { name: 'coalescence.json', size: blob.size, lastModified: 1, blob };
}

const events = [
  { ts: '2024-01-01T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'T1',
    master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'Al' },
  { ts: '2024-02-01T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'T2',
    master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'Al' },
  { ts: '2024-03-01T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'T3',
    master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'Al' }
];

test('A13: burst of 5 filter requests dispatches at most 2 requests to the worker', async (t) => {
  const client = clientForTest(t);
  const { model } = await client.request('load', { files: [file(events)], timeZone: 'UTC' });
  assert.equal(model.totals.records, 3);

  const initialDispatched = client.dispatchedFilterCount;
  assert.equal(initialDispatched, 0);

  // Rapid burst of 5 filter requests while worker is processing
  const f1 = client.request('filter', { state: { ...emptyFilterState(), skip: true } });
  const f2 = client.request('filter', { state: { ...emptyFilterState(), offline: true } });
  const f3 = client.request('filter', { state: { ...emptyFilterState(), shuffle: true } });
  const f4 = client.request('filter', { state: { ...emptyFilterState(), skip: false } });
  const f5 = client.request('filter', { state: { ...emptyFilterState(), range: { from: Date.parse('2024-03-01') / 1000, to: Date.parse('2024-03-31') / 1000 } } });

  const [r1, r2, r3, r4, r5] = await Promise.all([f1, f2, f3, f4, f5]);

  // Intermediate superseded requests resolved to null or final
  assert.equal(r2, null);
  assert.equal(r3, null);
  assert.equal(r4, null);

  // The last request must have produced the correct filtered model (March event only: 1 record)
  assert.ok(r5 && r5.model);
  assert.equal(r5.model.totals.records, 1);

  // Total dispatched filter requests to the worker is at most 2 (1 in-flight + 1 latest pending)
  assert.ok(client.dispatchedFilterCount <= 2, `expected <= 2 dispatched filter requests, got ${client.dispatchedFilterCount}`);
});

test('A14: logical cancellation of filter update does not terminate worker or discard dataset', async (t) => {
  const client = clientForTest(t);
  const { model } = await client.request('load', { files: [file(events)], timeZone: 'UTC' });
  assert.equal(model.totals.records, 3);

  const filterPromise = client.request('filter', { state: { ...emptyFilterState(), skip: true } });
  client.cancelUpdate();

  // Cancelled in-flight update is rejected with AbortError
  await assert.rejects(filterPromise, (error) => error.code === 'E_ABORT');

  // Worker is NOT terminated: subsequent filter requests execute normally on loaded dataset
  const recovered = await client.request('filter', { state: { ...emptyFilterState(), range: { from: Date.parse('2024-01-01') / 1000, to: Date.parse('2024-01-31') / 1000 } } });
  assert.ok(recovered && recovered.model);
  assert.equal(recovered.model.totals.records, 1);
});

test('A14: logical cancellation of export does not terminate worker', async (t) => {
  const client = clientForTest(t);
  await client.request('load', { files: [file(events)], timeZone: 'UTC' });

  const exportPromise = client.request('export', {});
  client.cancelExport();

  await assert.rejects(exportPromise, (error) => error.code === 'E_ABORT');

  // Subsequent request works without re-loading
  const filter = await client.request('filter', { state: emptyFilterState() });
  assert.equal(filter.model, null);
});

test('analysisState preserves confirmed model and supports cancelUpdate', async () => {
  let pendingResolve = null;
  const mockClient = {
    request(type, payload) {
      return new Promise((resolve) => { pendingResolve = resolve; });
    },
    cancelUpdate() {}
  };

  const state = createAnalysisState(mockClient);
  const initial = { totals: { records: 10 }, albums: { byId: new Map() } };
  state.initialize(initial);

  assert.equal(state.getConfirmed().model.totals.records, 10);

  const updating = state.update({ ...emptyFilterState(), skip: true });
  assert.equal(state.getConfirmed().model.totals.records, 10);

  state.cancelUpdate();
  if (pendingResolve) pendingResolve({ model: { totals: { records: 5 } } });
  assert.equal(await updating, null);

  // Confirmed model is still the initial one
  assert.equal(state.getConfirmed().model.totals.records, 10);
});
