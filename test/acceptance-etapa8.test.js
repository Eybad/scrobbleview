import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from './fakes/dataset.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { emptyFilterState } from '../src/filters.js';
import { csvField, toCSV } from '../src/export/csv.js';
import { exportExploreTableCSV, modelToTables } from '../src/export.js';
import { createAnalysisState } from '../app/analysis-state.js';
import { renderView, receiptTextFromConfirmed } from '../app/views.js';

test('A25: export explore table exports all matching rows, not only the current page', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;

  const events = [];
  for (let i = 0; i < 35; i++) {
    const title = i < 20 ? `Rock Anthem ${i}` : `Pop Melody ${i}`;
    events.push({ t: D0 + i * 60, m: 60000, track: title, artist: 'Various Artists' });
  }
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  const trackPool = [...model.tracks.byId.values()];
  const queryOpts = {
    metric: 'plays',
    totalMetric: model.totals.plays,
    query: 'Rock',
    page: 1,
    pageSize: 10
  };

  const exported = exportExploreTableCSV(trackPool, queryOpts, 'tracks');
  assert.equal(exported.totalMatches, 20);

  const lines = exported.csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines.length, 21);
  assert.ok(lines[1].includes('Rock Anthem 0'));
  assert.ok(exported.csv.includes('Rock Anthem 19'));
  assert.ok(!exported.csv.includes('Pop Melody'));
});

test('A26: CSV exporter neutralizes spreadsheet formula prefixes on strings and leaves numbers intact', () => {
  assert.equal(csvField('=1+1'), "'=1+1");
  assert.equal(csvField('+1234'), "'+1234");
  assert.equal(csvField('-cmd'), "'-cmd");
  assert.equal(csvField('@SUM(A1:A10)'), "'@SUM(A1:A10)");
  assert.equal(csvField('\tsecret'), "'\tsecret");
  assert.equal(csvField('\rtest'), '"\'\rtest"');

  assert.equal(csvField(42), '42');
  assert.equal(csvField(-100), '-100');
  assert.equal(csvField(0), '0');
});

test('view markup and aggregate CSV escape injected HTML strings', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;
  const XSS_PAYLOAD = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

  const events = [
    { t: D0, m: 60000, track: XSS_PAYLOAD, artist: XSS_PAYLOAD, album: XSS_PAYLOAD }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  const dashboardHtml = renderView('dashboard', model);
  assert.ok(!dashboardHtml.includes('<script>'));
  assert.ok(!dashboardHtml.includes('<img src=x'));
  assert.ok(dashboardHtml.includes('&lt;script&gt;'));

  const tables = modelToTables(model);
  const tracksTable = tables.find((t) => t.name === 'tracks');
  const csv = toCSV(tracksTable.headers, tracksTable.rows);
  assert.ok(csv.includes('<script>alert(""xss"")</script><img src=x onerror=alert(1)>'));
  assert.ok(csv.includes('"<script>alert'));
});

test('receiptText: formats custom period vs full year with timezone, metric criterion, and entity names', async () => {
  const UTC = fixedTz('UTC', 0);
  const events = [
    { t: 1685577600, m: 60000, track: 'Song 2023', artist: 'Artist 2023' },
    { t: 1717200000, m: 120000, track: 'Song 2024', artist: 'Artist 2024' }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  const fullYearText = (await import('../app/views.js')).receiptText(model, {
    years: new Set([2024]),
    metric: 'ms'
  });
  assert.ok(fullYearText.includes('Mi resumen Scrobbleview (año 2024)'));
  assert.ok(fullYearText.includes('Artista del año:'));
  assert.ok(fullYearText.includes('Canción del año:'));
  assert.ok(fullYearText.includes('Criterio principal: Tiempo escuchado'));

  const periodText = (await import('../app/views.js')).receiptText(model, {
    range: { from: 19500 * 86400, to: 19800 * 86400 + 86399 },
    metric: 'plays'
  });
  assert.ok(periodText.includes('Mi resumen Scrobbleview (del período)'));
  assert.ok(periodText.includes('Artista del período:'));
  assert.ok(periodText.includes('Canción del período:'));
  assert.ok(periodText.includes('Criterio principal: Reproducciones'));
});

test('receipt text uses the confirmed model, period, and metric while a newer filter is pending', async () => {
  const UTC = fixedTz('UTC', 0);
  const events = [
    { t: Date.parse('2023-06-01T12:00:00Z') / 1000, m: 60000, track: 'Past song', artist: 'Past artist', skipped: true },
    { t: Date.parse('2024-06-01T12:00:00Z') / 1000, m: 120000, track: 'Pending song', artist: 'Pending artist', offline: true }
  ];
  const ds = buildDataset(events);
  const fullModel = aggregate(ds, { tz: UTC });
  const confirmedModel = aggregate(ds, { tz: UTC, indices: Uint32Array.of(0) });
  const confirmedRange = {
    from: Date.parse('2023-01-01T00:00:00Z') / 1000,
    to: Date.parse('2023-12-31T23:59:59Z') / 1000
  };
  const pendingRange = {
    from: Date.parse('2024-01-01T00:00:00Z') / 1000,
    to: Date.parse('2024-12-31T23:59:59Z') / 1000
  };
  let deferFilter = false;
  let pendingResolve;
  const controller = createAnalysisState({
    request() {
      if (deferFilter) return new Promise((resolve) => { pendingResolve = resolve; });
      return Promise.resolve({ model: confirmedModel, prev: null });
    },
    cancelUpdate() {}
  });
  controller.initialize(fullModel);
  await controller.update({ ...emptyFilterState(), range: confirmedRange, skip: true }, {
    view: 'wrapped', context: { hash: '#/v1/wrapped', metric: 'plays' }
  });
  deferFilter = true;
  const pendingUpdate = controller.update({ ...emptyFilterState(), range: pendingRange, offline: true }, {
    view: 'wrapped', context: { hash: '#/v1/wrapped?from=2024', metric: 'ms' }
  });
  const confirmed = controller.getConfirmed();
  const text = receiptTextFromConfirmed({
    confirmed,
    fallbackModel: fullModel,
    fallbackState: { range: pendingRange, years: null },
    fallbackMetric: 'ms'
  });

  assert.match(text, /Mi resumen Scrobbleview \(año 2023\)/);
  assert.match(text, /Criterio principal: Reproducciones/);
  assert.match(text, /Artista del año: Past artist/);
  assert.match(text, /Canción del año: Past song — Past artist/);
  assert.match(text, /Filtros: Saltada: sí/);
  assert.doesNotMatch(text, /2024|Pending artist|Pending song/);
  assert.doesNotMatch(text, /Sin conexión/);
  controller.cancelUpdate();
  pendingResolve({ model: fullModel });
  assert.equal(await pendingUpdate, null);
});

test('calendarIndexView: defers previous year grids until opened and provides calendarYearGridHTML on demand', async () => {
  const UTC = fixedTz('UTC', 0);
  const events = [
    { t: 1685577600, m: 60000, track: 'Song 2023', artist: 'Artist 2023' },
    { t: 1717200000, m: 120000, track: 'Song 2024', artist: 'Artist 2024' }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });
  const { calendarIndexView, calendarYearGridHTML } = await import('../app/views.js');

  const html = calendarIndexView(model);
  assert.ok(html.includes('data-deferred-year="2023"'));

  const gridHtml = calendarYearGridHTML(model, 2023);
  assert.ok(gridHtml.includes('class="chart calendar"'));
});

test('Node view-rendering smoke loop keeps temporary heap growth bounded', async () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;
  const events = [];
  for (let i = 0; i < 500; i++) {
    events.push({
      t: D0 + i * 180,
      m: 60000 + (i % 5) * 10000,
      track: `Track ${i % 25}`,
      artist: `Artist ${i % 10}`,
      album: `Album ${i % 5}`
    });
  }
  const ds = buildDataset(events);

  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;

  for (let cycle = 0; cycle < 20; cycle++) {
    const model = aggregate(ds, { tz: UTC });
    renderView('dashboard', model);
    renderView('habits', model);
    renderView('hours', model);
    renderView('sessions', model);
  }

  if (global.gc) global.gc();
  const memAfter = process.memoryUsage().heapUsed;
  const growthMiB = (memAfter - memBefore) / (1024 * 1024);
  assert.ok(growthMiB < 25, `Heap growth after 20 cycles (${growthMiB.toFixed(2)} MiB) is bounded under 25 MiB`);
});
