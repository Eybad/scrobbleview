import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from './fakes/dataset.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { csvField, toCSV } from '../src/export/csv.js';
import { exportExploreTableCSV, modelToTables } from '../src/export.js';
import { renderView } from '../app/views.js';

test('A25: export explore table exports all matching rows, not only the current page', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;

  // 35 distinct tracks: 20 match search 'Rock', 15 do not
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
    pageSize: 10 // Paginated view only displays 10 rows
  };

  const exported = exportExploreTableCSV(trackPool, queryOpts, 'tracks');
  assert.equal(exported.totalMatches, 20);

  const lines = exported.csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(lines.length, 21); // Header + 20 matched rows (NOT 10)
  assert.ok(lines[1].includes('Rock Anthem 0'));
  assert.ok(exported.csv.includes('Rock Anthem 19'));
  assert.ok(!exported.csv.includes('Pop Melody'));
});

test('A26: CSV exporter neutralizes spreadsheet formula prefixes on strings and leaves numbers intact', () => {
  // Formula prefixes: =, +, -, @, \t, \r
  assert.equal(csvField('=1+1'), "'=1+1");
  assert.equal(csvField('+1234'), "'+1234");
  assert.equal(csvField('-cmd'), "'-cmd");
  assert.equal(csvField('@SUM(A1:A10)'), "'@SUM(A1:A10)");
  assert.equal(csvField('\tsecret'), "'\tsecret");
  assert.equal(csvField('\rtest'), '"\'\rtest"');

  // Numbers are not strings, never formulas
  assert.equal(csvField(42), '42');
  assert.equal(csvField(-100), '-100');
  assert.equal(csvField(0), '0');
});

test('A27: HTML injection strings are safely escaped across all views and CSV export', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;
  const XSS_PAYLOAD = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

  const events = [
    { t: D0, m: 60000, track: XSS_PAYLOAD, artist: XSS_PAYLOAD, album: XSS_PAYLOAD }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  // Check views render without unescaped script or img tag
  const dashboardHtml = renderView('dashboard', model);
  assert.ok(!dashboardHtml.includes('<script>'));
  assert.ok(!dashboardHtml.includes('<img src=x'));
  assert.ok(dashboardHtml.includes('&lt;script&gt;'));

  // Check CSV tables contain safely quoted content per RFC 4180
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

  // 1. Full year context
  const fullYearText = (await import('../app/views.js')).receiptText(model, {
    years: new Set([2024]),
    metric: 'ms'
  });
  assert.ok(fullYearText.includes('Mi resumen Scrobbleview (año 2024)'));
  assert.ok(fullYearText.includes('Artista del año:'));
  assert.ok(fullYearText.includes('Canción del año:'));
  assert.ok(fullYearText.includes('Criterio principal: Tiempo escuchado'));

  // 2. Custom period context
  const periodText = (await import('../app/views.js')).receiptText(model, {
    range: { start: 19500, end: 19800 },
    metric: 'plays'
  });
  assert.ok(periodText.includes('Mi resumen Scrobbleview (del período)'));
  assert.ok(periodText.includes('Artista del período:'));
  assert.ok(periodText.includes('Canción del período:'));
  assert.ok(periodText.includes('Criterio principal: Reproducciones'));
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

  // Standalone on-demand generation works
  const gridHtml = calendarYearGridHTML(model, 2023);
  assert.ok(gridHtml.includes('class="chart calendar"'));
});

test('A28: twenty consecutive aggregation and view render cycles execute with bounded heap', async () => {
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
