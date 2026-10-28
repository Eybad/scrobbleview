import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createAnalysisClient } from '../app/analysis-client.js';
import { parseRoute, resolveRoute, formatSemanticRoute } from '../app/routes.js';
import { captureHistoryState, restoreHistoryState } from '../app/history-state.js';
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

function file(name, events) {
  const blob = new Blob([JSON.stringify(events)]);
  return { name, size: blob.size, lastModified: 1, blob };
}

test('A10: navigation roundtrip preserves row, page scroll, table scroll, query and focus', () => {
  let focusedEl = null;
  let pageScroll = { x: 0, y: 0 };
  const mockTable = { id: 'artists-table', scrollLeft: 180, scrollTop: 60 };

  const mockWindow = {
    scrollX: 0,
    scrollY: 450,
    scrollTo(x, y) { pageScroll = { x, y }; }
  };

  const mockDoc = {
    activeElement: {
      dataset: {},
      getAttribute(k) { return k === 'href' ? '#/v1/artist/Radiohead' : null; }
    },
    querySelectorAll(sel) {
      if (sel === '.table-scroll, .chart-scroll') return [mockTable];
      return [];
    },
    querySelector(sel) {
      if (sel === '#artists-table') return mockTable;
      if (sel === 'a[href="#/v1/artist/Radiohead"]') {
        return {
          focus(opts) {
            assert.equal(opts?.preventScroll, true);
            focusedEl = sel;
          }
        };
      }
      return null;
    }
  };

  const snapshot = captureHistoryState(mockWindow, mockDoc);
  assert.equal(snapshot.scrollY, 450);
  assert.equal(snapshot.focusSelector, 'a[href="#/v1/artist/Radiohead"]');
  assert.equal(snapshot.tableScrolls[0].left, 180);

  // Simulate navigating to artist detail and scrolling to top
  pageScroll = { x: 0, y: 0 };
  mockTable.scrollLeft = 0;
  mockTable.scrollTop = 0;

  // Simulate Back button popstate: restore snapshot
  const success = restoreHistoryState(snapshot, mockWindow, mockDoc);
  assert.equal(success, true);
  assert.equal(pageScroll.y, 450);
  assert.equal(mockTable.scrollLeft, 180);
  assert.equal(focusedEl, 'a[href="#/v1/artist/Radiohead"]');
});

test('A11: Artist A -> Artist B and new tab transports filters and metric in real href', () => {
  const hrefArtistA = formatSemanticRoute('artist', { name: 'Daft Punk' }, 'range=2024-01-01..2024-06-30&m=plays');
  assert.equal(hrefArtistA, '#/v1/artist/Daft%20Punk?range=2024-01-01..2024-06-30&m=plays');

  const hrefArtistB = formatSemanticRoute('artist', { name: 'Radiohead' }, 'range=2024-01-01..2024-06-30&m=plays');
  assert.equal(hrefArtistB, '#/v1/artist/Radiohead?range=2024-01-01..2024-06-30&m=plays');

  const parsed = parseRoute(hrefArtistB);
  assert.equal(parsed.view, 'artist');
  assert.equal(parsed.params.artist, 'Radiohead');
  assert.ok(parsed.query.includes('m=plays'));
  assert.ok(parsed.query.includes('range=2024-01-01..2024-06-30'));
});

test('A12: same files in different load orders resolve the same semantic entities', async (t) => {
  const client1 = clientForTest(t);
  const client2 = clientForTest(t);

  const evA = { ts: '2024-01-01T12:00:00Z', ms_played: 60000, master_metadata_album_artist_name: 'Band A', master_metadata_track_name: 'Song A', master_metadata_album_album_name: 'Album A' };
  const evB = { ts: '2024-02-01T12:00:00Z', ms_played: 60000, master_metadata_album_artist_name: 'Band B', master_metadata_track_name: 'Song B', master_metadata_album_album_name: 'Album B' };

  // Load order 1: File A then File B
  const res1 = await client1.request('load', { files: [file('a.json', [evA]), file('b.json', [evB])], timeZone: 'UTC' });
  // Load order 2: File B then File A
  const res2 = await client2.request('load', { files: [file('b.json', [evB]), file('a.json', [evA])], timeZone: 'UTC' });

  const routeBandA = parseRoute('#/v1/artist/Band%20A');
  const routeBandB = parseRoute('#/v1/artist/Band%20B');

  const resolvedA1 = resolveRoute(routeBandA, res1.model);
  const resolvedA2 = resolveRoute(routeBandA, res2.model);
  assert.equal(resolvedA1.entity.name, 'Band A');
  assert.equal(resolvedA2.entity.name, 'Band A');

  const resolvedB1 = resolveRoute(routeBandB, res1.model);
  const resolvedB2 = resolveRoute(routeBandB, res2.model);
  assert.equal(resolvedB1.entity.name, 'Band B');
  assert.equal(resolvedB2.entity.name, 'Band B');

  // Verify internal IDs were inverted due to file order, proving semantic resolution's invariance
  assert.notEqual(resolvedA1.id, resolvedA2.id);
  assert.equal(resolvedA1.id, resolvedB2.id);
});

test('A13: burst of five filter requests while worker is busy maintains at most one in-flight and one pending', async (t) => {
  const client = clientForTest(t);
  const events = [
    { ts: '2024-01-10T12:00:00Z', ms_played: 120000, master_metadata_album_artist_name: 'Artist', master_metadata_track_name: 'Track 1', master_metadata_album_album_name: 'Album' },
    { ts: '2024-02-10T12:00:00Z', ms_played: 120000, master_metadata_album_artist_name: 'Artist', master_metadata_track_name: 'Track 2', master_metadata_album_album_name: 'Album' }
  ];
  await client.request('load', { files: [file('hist.json', events)], timeZone: 'UTC' });

  assert.equal(client.dispatchedFilterCount, 0);

  const req1 = client.request('filter', { state: { ...emptyFilterState(), skip: true } });
  const req2 = client.request('filter', { state: { ...emptyFilterState(), shuffle: true } });
  const req3 = client.request('filter', { state: { ...emptyFilterState(), offline: true } });
  const req4 = client.request('filter', { state: { ...emptyFilterState(), skip: false } });
  const req5 = client.request('filter', { state: { ...emptyFilterState(), range: { from: Date.parse('2024-02-01') / 1000, to: Date.parse('2024-02-28') / 1000 } } });

  const [, , , , res5] = await Promise.all([req1, req2, req3, req4, req5]);

  assert.ok(client.dispatchedFilterCount <= 2, `dispatched ${client.dispatchedFilterCount} requests, expected <= 2`);
  assert.ok(res5 && res5.model);
  assert.equal(res5.model.totals.records, 1);
});

test('A14: cancellation of filter or export leaves dataset and analysis confirmed intact', async (t) => {
  const client = clientForTest(t);
  const events = [
    { ts: '2024-01-10T12:00:00Z', ms_played: 120000, master_metadata_album_artist_name: 'Artist', master_metadata_track_name: 'Track', master_metadata_album_album_name: 'Album' }
  ];
  const { model } = await client.request('load', { files: [file('hist.json', events)], timeZone: 'UTC' });
  assert.equal(model.totals.records, 1);

  // Logical filter cancellation
  const filterPromise = client.request('filter', { state: { ...emptyFilterState(), skip: true } });
  client.cancelUpdate();
  await assert.rejects(filterPromise, (err) => err.code === 'E_ABORT');

  // Logical export cancellation
  const exportPromise = client.request('export', {});
  client.cancelExport();
  await assert.rejects(exportPromise, (err) => err.code === 'E_ABORT');

  // Verify dataset is still loaded in worker
  const activeCheck = await client.request('filter', { state: emptyFilterState() });
  assert.equal(activeCheck.model, null); // reset to full model without error
});
