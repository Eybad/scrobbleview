import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createAnalysisClient } from '../app/analysis-client.js';
import { emptyFilterState } from '../src/filters.js';
import { createAnalysisState } from '../app/analysis-state.js';
import { renderView } from '../app/views.js';
import { parseRoute, resolveRoute } from '../app/routes.js';

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
  return { name: 'synthetic.json', size: blob.size, lastModified: 1, blob };
}

const events = [
  { ts: '2024-01-01T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'T',
    master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'First' },
  { ts: '2024-02-01T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'T',
    master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'Second' }
];

test('real worker preserves filters, historical discovery and deferred album attribution', async (t) => {
  const client = clientForTest(t);
  const progress = [];
  const { model } = await client.request('load', { files: [file(events)], timeZone: 'UTC' }, {
    onProgress: (fraction, label) => progress.push([fraction, label])
  });
  assert.equal(model.totals.records, 2);
  assert.equal(model.cols, undefined);
  assert.equal(model.meta.firstEventLocal, Date.parse('2024-01-01T12:00:00Z') / 1000);
  const { renderView } = await import('../app/views.js');
  for (const view of ['dashboard', 'hours', 'habits', 'sessions', 'discovery', 'yearly', 'calendar', 'wrapped']) {
    assert.doesNotMatch(renderView(view, model), /NaN|undefined/);
  }
  assert.ok(progress.some(([, label]) => label === 'Calculando estadísticas'));
  const albumId = [...model.albums.byId.keys()][0];
  assert.equal(model.albums.byId.get(albumId).trackStats.size, 0);
  const album = await client.request('album', { id: albumId, state: emptyFilterState() });
  assert.equal([...album.trackStats.values()][0].plays, 1);
  assert.equal([...album.trackStats.values()][0].ms, 180000);
  const state = { ...emptyFilterState(), range: { from: Date.parse('2024-02-01') / 1000, to: Date.parse('2024-02-29T23:59:59Z') / 1000 } };
  const filtered = await client.request('filter', { state });
  assert.equal(filtered.model.totals.records, 1);
  assert.equal(filtered.model.monthlyDiscovery.get(202402).new, 0);
  assert.equal(filtered.prev.records, 0);
  const reset = await client.request('filter', { state: emptyFilterState() });
  assert.equal(reset.model, null);
  const exported = await client.request('export');
  assert.match(exported.filename, /\.zip$/);
  assert.equal(new DataView(exported.bytes.buffer).getUint32(0, true), 0x04034b50);
});

test('worker errors are localized and a later request can recover', async (t) => {
  const client = clientForTest(t);
  await assert.rejects(client.request('load', { files: [{ name: 'bad.json', blob: new Blob(['[{]']) }] }),
    (error) => error.code === 'E_PARSE' && Number.isInteger(error.byteOffset) && /bad.json/.test(error.message));
  assert.equal((await client.request('load', { files: [file(events)], timeZone: 'UTC' })).model.totals.records, 2);
});

test('worker client and controller deliver a day detail to the view', async (t) => {
  const client = clientForTest(t);
  const { model } = await client.request('load', { files: [file(events)], timeZone: 'UTC' });
  const controller = createAnalysisState(client);
  controller.initialize(model);
  const result = await controller.update(emptyFilterState(), { view: 'day', id: '2024-01-01' });
  assert.equal(result.detail.total, 1);
  assert.equal(result.detail.rows[0].track, 'T');
  assert.equal(result.model.cols, undefined);
  const html = renderView('day', result.model, '2024-01-01', { detail: result.detail, detailRequested: true });
  assert.match(html, /Mostrando 1–1 de 1/);
  assert.match(html, /First/);
});

test('worker client and controller render actual track album attribution', async (t) => {
  const client = clientForTest(t);
  const { model } = await client.request('load', { files: [file(events)], timeZone: 'UTC' });
  const controller = createAnalysisState(client);
  controller.initialize(model);
  const id = [...model.tracks.byId.keys()][0];
  const result = await controller.update(emptyFilterState(), { view: 'track', id });
  assert.deepEqual(result.detail.rows.map(row => row.plays), [1, 1]);
  const html = renderView('track', result.model, id, { detail: result.detail, detailRequested: true });
  assert.match(html, /First/);
  assert.match(html, /Second/);
  assert.match(html, /Primera aparición histórica/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('album link opens the track with verified album attribution', async (t) => {
  const client = clientForTest(t);
  const { model } = await client.request('load', { files: [file(events)], timeZone: 'UTC' });
  const controller = createAnalysisState(client);
  controller.initialize(model);
  const album = [...model.albums.byId.values()].find(item => item.name === 'First');
  const albumResult = await controller.update(emptyFilterState(), { view: 'album', id: album.id });
  const albumHtml = renderView('album', albumResult.model, album.id, { query: '?m=plays' });
  const href = albumHtml.match(/href="(#\/v1\/track\/[^\"]+)"/)[1].replaceAll('&amp;', '&');
  const parsed = parseRoute(href);
  const resolved = resolveRoute(parsed, model);
  const result = await controller.update(emptyFilterState(), { view: 'track', id: resolved.id, originQuery: parsed.query });
  assert.equal(result.detail.origin.name, 'First');
  assert.equal(result.detail.origin.plays, 1);
  const html = renderView('track', result.model, resolved.id, { detail: result.detail, rawQuery: parsed.query, query: '?m=plays' });
  assert.match(html, /Alcance: En este álbum/);
  assert.match(html, /First/);
});

test('worker cancellation rejects pending work and permits a fresh load', async (t) => {
  const client = clientForTest(t);
  const loading = client.request('load', { files: [file(events)], timeZone: 'UTC' });
  client.cancel();
  await assert.rejects(loading, (error) => error.code === 'E_ABORT');
  assert.equal((await client.request('load', { files: [file(events)], timeZone: 'UTC' })).model.totals.records, 2);
});

test('analysis in the worker leaves the caller event loop available', async (t) => {
  const client = clientForTest(t);
  const many = Array.from({ length: 10000 }, (_, index) => ({ ...events[index % 2],
    ts: new Date(Date.UTC(2024, 0, 1) + index * 1000).toISOString() }));
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 2);
  try {
    const { model } = await client.request('load', { files: [file(many)], timeZone: 'UTC' });
    assert.equal(model.totals.records, 10000);
    assert.ok(ticks > 0, 'caller timers must continue while the worker processes data');
  } finally { clearInterval(timer); }
});
