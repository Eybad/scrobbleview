import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createAnalysisClient } from '../app/analysis-client.js';
import { emptyFilterState } from '../src/filters.js';
import { createAnalysisState } from '../app/analysis-state.js';
import { renderView } from '../app/views.js';
import { formatSemanticRoute, parseRoute, resolveRoute } from '../app/routes.js';
import { describeCatalogQuery } from '../app/catalog-query.js';
import { exportExploreTableCSV } from '../src/export.js';
import { crc32 } from '../src/export/zip.js';
import { buildCompareSeries } from '../src/compare.js';
import { chartDataTableHTML, createChartContract } from '../src/chart-contract.js';
import { fmtNum } from '../src/charts.js';

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

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = text.charCodeAt(0) === 0xFEFF ? 1 : 0; index < text.length; index++) {
    const char = text[index];
    if (quoted && char === '"' && text[index + 1] === '"') {
      field += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && char === ',') {
      row.push(field);
      field = '';
    } else if (!quoted && char === '\r' && text[index + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index++;
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function readCsvArchive(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index--) {
    if (view.getUint32(index, true) === 0x06054b50) { eocd = index; break; }
  }
  assert.notEqual(eocd, -1);
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();

  for (let entryIndex = 0; entryIndex < count; entryIndex++) {
    assert.equal(view.getUint32(offset, true), 0x02014b50);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let content = compressed;
    if (method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    assert.equal(method === 0 || method === 8, true);
    assert.equal(content.length, uncompressedSize);
    assert.equal(crc32(content), crc);
    files.set(name, decoder.decode(content));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function metadataMap(csv) {
  return new Map(parseCsv(csv).slice(1).map(([key, value]) => [key, value]));
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
  const compareRanges = {
    rangeA: { from: Date.parse('2024-01-01T00:00:00Z') / 1000, to: Date.parse('2024-01-15T23:59:59Z') / 1000 },
    rangeB: { from: Date.parse('2024-01-16T00:00:00Z') / 1000, to: Date.parse('2024-01-31T23:59:59Z') / 1000 }
  };
  const exported = await client.request('export', { compareRanges });
  assert.match(exported.filename, /\.zip$/);
  assert.equal(new DataView(exported.bytes.buffer).getUint32(0, true), 0x04034b50);
  const archive = await readCsvArchive(exported.bytes);
  const metadata = metadataMap(archive.get('metadata.csv'));
  assert.equal(metadata.get('scope'), 'all');
  assert.equal(metadata.get('schema_version'), '2');
  assert.equal(metadata.get('records_in_scope'), '2');
  assert.equal(metadata.has('observed_range_last_local'), true);
  assert.equal(metadata.has('last_event_local'), false);
  assert.equal(metadata.get('compare.range_a.local_epoch_s'), `${compareRanges.rangeA.from}..${compareRanges.rangeA.to}`);
  assert.equal(metadata.get('compare.range_b.local_epoch_s'), `${compareRanges.rangeB.from}..${compareRanges.rangeB.to}`);
  assert.match(archive.get('artists.csv'), /duration_known/);
  const albumTracks = parseCsv(archive.get('album_tracks.csv'));
  const trackId = String([...model.tracks.byId.keys()][0]);
  assert.deepEqual(new Set(albumTracks.slice(1).map(([albumId]) => albumId)), new Set([...model.albums.byId.keys()].map(String)));
  assert.deepEqual(albumTracks.slice(1).map((row) => row.slice(1, 4)), [[trackId, '1', '180000'], [trackId, '1', '180000']]);
});

test('B21: worker ZIP preserves the confirmed query, selection filters and metadata', async (t) => {
  const client = clientForTest(t);
  const events = [
    { ts: '2024-01-01T00:00:00Z', ms_played: 60000, skipped: null, shuffle: null, offline: null,
      master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'First' },
    { ts: '2024-01-02T00:00:00Z', skipped: null, shuffle: null, offline: null,
      master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'A', master_metadata_album_album_name: 'Second' },
    { ts: '2024-01-03T00:00:00Z', ms_played: 120000, skipped: null, shuffle: null, offline: null,
      master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'B', master_metadata_album_album_name: 'Third' },
    { ts: '2024-01-04T00:00:00Z', ms_played: 30000, skipped: null, shuffle: null, offline: null,
      master_metadata_track_name: '=1+1', master_metadata_album_artist_name: 'C', master_metadata_album_album_name: 'Fourth' }
  ];
  const { model: fullModel } = await client.request('load', { files: [file(events)], timeZone: 'UTC' });
  const filterState = {
    ...emptyFilterState(),
    range: { from: Date.parse('2024-01-01T00:00:00Z') / 1000, to: Date.parse('2024-01-04T23:59:59Z') / 1000 },
    years: new Set([2024]),
    months: new Set([202401]),
    dows: new Set([0, 1, 2, 3]),
    hours: new Set([0]),
    skip: 'unknown',
    shuffle: 'unknown',
    offline: 'unknown'
  };
  const filtered = await client.request('filter', { state: filterState });
  const exploreState = {
    tab: 'tracks', query: 'Echo', sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25,
    minPlays: null, minMonths: null
  };
  const description = describeCatalogQuery(filtered.model, { metric: 'plays', exploreState });
  const visible = (await import('../src/query.js')).queryCatalog(description.pool, description.options);
  const expected = exportExploreTableCSV(description.pool, description.options, description.tab);
  const result = await client.request('export', {
    scope: 'table', filterState, metric: 'plays', exploreState
  });
  const archive = await readCsvArchive(result.bytes);
  const metadata = metadataMap(archive.get('metadata.csv'));

  assert.equal(fullModel.totals.records, 4);
  assert.equal(filtered.model.totals.durationKnown, 3);
  assert.equal(filtered.model.totals.durationUnknown, 1);
  assert.equal(visible.totalMatches, 2);
  assert.equal(visible.rows[1].metricRank, 2);
  assert.equal(result.totalMatches, visible.totalMatches);
  assert.equal(archive.get('tracks.csv'), expected.csv.replace(/^\uFEFF/, ''));
  assert.equal(metadata.get('scope'), 'table');
  assert.equal(metadata.get('metric'), 'plays');
  assert.equal(metadata.get('effective_schema'), 'catalog-table-v1');
  assert.equal(metadata.get('records_in_scope'), '4');
  assert.equal(metadata.get('duration_known_records'), '3');
  assert.equal(metadata.get('duration_unknown_records'), '1');
  assert.equal(metadata.get('skip_known_records'), '0');
  assert.equal(metadata.get('skip_unknown_records'), '4');
  assert.equal(metadata.get('shuffle_known_records'), '0');
  assert.equal(metadata.get('shuffle_unknown_records'), '4');
  assert.equal(metadata.get('offline_known_records'), '0');
  assert.equal(metadata.get('offline_unknown_records'), '4');
  assert.equal(metadata.get('catalog.match_count'), '2');
  assert.equal(metadata.get('catalog.search'), 'Echo');
  assert.equal(metadata.get('catalog.sort_direction'), 'asc');
  assert.equal(metadata.get('catalog.share_denominator'), '4');
  assert.equal(metadata.get('filter.range.from'), String(filterState.range.from));
  assert.equal(metadata.get('filter.range.to'), String(filterState.range.to));
  assert.equal(metadata.get('filter.years'), '2024');
  assert.equal(metadata.get('filter.months'), '202401');
  assert.equal(metadata.get('filter.dows'), '0;1;2;3');
  assert.equal(metadata.get('filter.hours'), '0');
  assert.equal(metadata.get('filter.skip'), 'unknown');
  assert.equal(metadata.get('filter.shuffle'), 'unknown');
  assert.equal(metadata.get('filter.offline'), 'unknown');
  assert.equal(metadata.get('observed_range_local_epoch_s'), `${filterState.range.from}..${Date.parse('2024-01-04T00:00:00Z') / 1000}`);
  assert.equal(metadata.has('last_event_local'), false);
  const exportedRows = parseCsv(archive.get('tracks.csv'));
  assert.equal(exportedRows.length, 3);
  assert.equal(exportedRows[1][0], '1');
  assert.equal(exportedRows[1][4], '1');
  assert.equal(exportedRows[2][0], '2');

  const artistId = [...fullModel.artists.byId.entries()].find(([, artist]) => artist.name === 'A')[0];
  const entitySelection = { ...filterState, artistId };
  const selection = await client.request('export', { scope: 'selection', filterState: entitySelection, metric: 'plays' });
  const selectionArchive = await readCsvArchive(selection.bytes);
  const selectionMetadata = metadataMap(selectionArchive.get('metadata.csv'));
  assert.equal(selectionMetadata.get('scope'), 'selection');
  assert.equal(selectionMetadata.get('metric'), 'plays');
  assert.equal(selectionMetadata.get('filter.artistId'), String(artistId));
  assert.equal(selectionMetadata.get('filter.artistId.name'), 'A');
  assert.equal(selectionMetadata.get('filter.range.from'), String(filterState.range.from));
  assert.equal(selectionMetadata.get('filter.range.to'), String(filterState.range.to));
  assert.equal(selectionMetadata.get('filter.years'), '2024');
  assert.equal(selectionMetadata.get('filter.months'), '202401');
  assert.equal(selectionMetadata.get('filter.dows'), '0;1;2;3');
  assert.equal(selectionMetadata.get('filter.hours'), '0');
  assert.equal(selectionMetadata.get('filter.skip'), 'unknown');
  assert.equal(selectionMetadata.get('filter.shuffle'), 'unknown');
  assert.equal(selectionMetadata.get('filter.offline'), 'unknown');
  assert.equal(selectionMetadata.get('records_in_scope'), '2');

  const completeExport = await client.request('export');
  const completeArchive = await readCsvArchive(completeExport.bytes);
  assert.match(completeArchive.get('tracks.csv'), /,'=1\+1,/);
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
  const positions = [
    '<div class="scope-notice card"',
    '<dl class="kpis kpis--entity">',
    'data-chart-id="track-monthly"',
    '<h2>Álbumes asociados</h2>'
  ].map((marker) => html.indexOf(marker));
  assert.ok(
    positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])),
    `track attribution order: ${JSON.stringify(positions)}`
  );
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

test('B08: worker details and ZIP preserve homonym identity and album attribution', async (t) => {
  const client = clientForTest(t);
  const entries = [
    { ts: '2024-01-01T00:00:00Z', ms_played: 60000, master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'Artist A', master_metadata_album_album_name: 'Album A' },
    { ts: '2024-01-02T00:00:00Z', ms_played: 60000, master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'Artist B', master_metadata_album_album_name: 'Album B' },
    { ts: '2024-01-03T00:00:00Z', ms_played: 60000, master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist C', master_metadata_album_album_name: 'Album One' },
    { ts: '2024-01-04T00:00:00Z', ms_played: 60000, master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist C', master_metadata_album_album_name: 'Album Two' },
    { ts: '2024-01-05T00:00:00Z', ms_played: 60000, master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist C', master_metadata_album_album_name: 'Album Two' }
  ];
  const { model } = await client.request('load', { files: [file(entries)], timeZone: 'UTC' });
  const routeA = resolveRoute(parseRoute(formatSemanticRoute('track', { artist: 'Artist A', name: 'Echo' })), model);
  const routeB = resolveRoute(parseRoute(formatSemanticRoute('track', { artist: 'Artist B', name: 'Echo' })), model);
  const echoLinks = renderView('explore', model, null, {
    metric: 'plays',
    exploreState: { tab: 'tracks', query: 'Echo', sortBy: 'name' }
  }).match(/href="(#\/v1\/track\/[^\"]+)"/g) ?? [];
  const shared = [...model.tracks.byId.values()].find(track => track.name === 'Shared');
  const controller = createAnalysisState(client);
  controller.initialize(model);
  const detail = await controller.update(emptyFilterState(), { view: 'track', id: shared.tk });
  const detailHtml = renderView('track', detail.model, shared.tk, {
    detail: detail.detail,
    detailRequested: true
  });
  const exported = await client.request('export');
  const archive = await readCsvArchive(exported.bytes);
  const tracksCsv = parseCsv(archive.get('tracks.csv'));
  const echoRows = tracksCsv.slice(1).filter(row => row[2] === 'Echo');
  const albumRows = parseCsv(archive.get('album_tracks.csv')).slice(1);
  const sharedAlbumRows = albumRows.filter(row => row[1] === String(shared.tk));

  assert.equal(routeA.notFound, false);
  assert.equal(routeB.notFound, false);
  assert.notEqual(routeA.id, routeB.id);
  assert.equal(echoLinks.length, 2);
  assert.notEqual(echoLinks[0], echoLinks[1]);
  assert.deepEqual(detail.detail.rows.map(row => [row.name, row.plays]).sort(), [
    ['Album One', 1], ['Album Two', 2]
  ]);
  assert.match(detailHtml, /Album One/);
  assert.match(detailHtml, /Album Two/);
  assert.deepEqual(echoRows.map(row => row[3]).sort(), ['Artist A', 'Artist B']);
  assert.deepEqual(sharedAlbumRows.map(row => row.slice(2, 4)).sort(), [['1', '60000'], ['2', '120000']]);
});

test('B18: worker comparison series reconcile partial DST periods and Monday weeks', async (t) => {
  const client = clientForTest(t);
  const events = [
    ['2024-03-10T06:30:00Z', 'Before spring transition'],
    ['2024-03-10T07:30:00Z', 'After spring transition'],
    ['2024-03-11T04:30:00Z', 'Next local day'],
    ['2024-04-01T04:30:00Z', 'April local day']
  ].map(([ts, track]) => ({
    ts,
    ms_played: 60000,
    master_metadata_track_name: track,
    master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album'
  }));
  const rangeA = {
    from: Date.parse('2024-03-10T00:00:00Z') / 1000,
    to: Date.parse('2024-04-01T23:59:59Z') / 1000
  };
  const { model } = await client.request('load', {
    files: [file(events)],
    timeZone: 'America/New_York'
  });
  const result = await client.request('compare', {
    preset: 'manual',
    rangeA,
    rangeB: rangeA,
    state: emptyFilterState()
  });
  const range = {
    from: Date.parse('2024-03-10T00:00:00Z') / 1000,
    to: Date.parse('2024-04-01T23:59:59Z') / 1000
  };
  const daily = buildCompareSeries(result.periodA.daily, range, 'daily');
  const weekly = buildCompareSeries(result.periodA.daily, range, 'weekly');
  const monthly = buildCompareSeries(result.periodA.daily, range, 'monthly');
  const monthTable = chartDataTableHTML(createChartContract({
    id: 'r10-dst-months',
    title: 'Eventos mensuales',
    data: monthly.map(point => ({ label: point.label, value: point.value })),
    format: fmtNum
  }));

  assert.equal(model.totals.records, 4);
  assert.equal(result.periodA.totals.plays, 4);
  assert.equal(daily.reduce((sum, point) => sum + point.value, 0), 4);
  assert.equal(daily.find(point => point.label === '2024-03-10').value, 2);
  assert.equal(daily.find(point => point.label === '2024-03-12').value, 0);
  assert.equal(weekly.reduce((sum, point) => sum + point.value, 0), 4);
  assert.equal(weekly[0].startDow, 6);
  assert.equal(weekly[0].isPartial, true);
  assert.equal(weekly[1].startDow, 0);
  assert.equal(monthly.reduce((sum, point) => sum + point.value, 0), 4);
  assert.deepEqual(monthly.map(point => [point.label, point.value, point.isPartial]), [
    ['03/2024', 3, true], ['04/2024', 1, true]
  ]);
  assert.match(monthTable, /03\/2024/);
  assert.match(monthTable, />3<\/td>/);
  assert.match(monthTable, />1<\/td>/);
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
