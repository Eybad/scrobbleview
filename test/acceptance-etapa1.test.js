import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtMs } from '../src/charts.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { buildDataset } from './fakes/dataset.js';

const UTC = fixedTz('utc', 0);
const D0 = 1704067200;

test('A03: redondeo coherente de duraciones en fmtMs sin 60s', () => {
  assert.equal(fmtMs(500), '500 ms');
  assert.equal(fmtMs(12500), '12,5 s');
  assert.equal(fmtMs(59999), '1 min 0 s');
  assert.equal(fmtMs(119999), '2 min 0 s');
  assert.equal(fmtMs(3599999), '1 h 0 min');
});

test('A04: tasas de salto conservan base conocida y desconocidos separados', () => {
  const events = [];
  for (let i = 0; i < 100; i++) {
    const isKnown = i < 20;
    const isSkipped = isKnown && i < 10;
    const flagVal = (isKnown ? 0 : 32) | (isSkipped ? 2 : 0);
    events.push({
      t: D0 + i * 100,
      m: 180000,
      track: `Track ${i}`,
      artist: 'Artist A',
      flags: flagVal
    });
  }
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });
  assert.equal(model.totals.records, 100);
  assert.equal(model.totals.skipped, 10);
  assert.equal(model.totals.skippedKnown, 20);
  assert.equal(model.totals.records - model.totals.skippedKnown, 80);
  assert.equal(model.totals.skipped / model.totals.skippedKnown, 0.5);
});

test('A05: una reproducción sin artista coincide en artistas identificados entre Resumen y Años', () => {
  const events = [
    { t: D0, m: 180000, track: 'Track 1', artist: 'Artist A' },
    { t: D0 + 86400, m: 180000, track: 'Track 2' }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  assert.equal(model.artists.byId.size, 1);
  const year2024 = model.yearly.get(2024);
  assert.ok(year2024, 'año 2024 presente');
  assert.equal(year2024.artistsC.size, 1);
  assert.equal(year2024.unknownArtistPlays, 1);
});

test('A06: constancia separa continuidad activa (100%) de cobertura del período (50%)', () => {
  const events = [];
  for (let month = 0; month < 6; month++) {
    const date = new Date(Date.UTC(2024, month, 15, 12, 0, 0));
    events.push({
      t: Math.floor(date.getTime() / 1000),
      m: 180000,
      track: `Track M${month}`,
      artist: 'Artista Continuo'
    });
  }
  const decDate = new Date(Date.UTC(2024, 11, 15, 12, 0, 0));
  events.push({
    t: Math.floor(decDate.getTime() / 1000),
    m: 180000,
    track: 'Track Dec',
    artist: 'Artista Cierre'
  });

  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  assert.ok(model.tables.constancy.length > 0, 'artista 1 califica con 6 meses');
  const a1 = model.tables.constancy.find((x) => x.name === 'Artista Continuo');
  assert.ok(a1, 'artista 1 encontrado en constancia');
  assert.equal(a1.months.size, 6);
  assert.equal(a1.activeMonthsSpan, 6);
  assert.equal(a1.coverage, 1);
  assert.equal(a1.observedMonths, 12);
  assert.equal(a1.periodCoverage, 0.5);
});

test('CSS loads seven local stylesheets in ownership order', async () => {
  const fs = await import('node:fs/promises');
  const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf-8');
  const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"\s*\/?\s*>/g)]
    .map(([, path]) => path);

  assert.deepEqual(links, [
    'css/tokens.css',
    'css/base.css',
    'css/layout.css',
    'css/components.css',
    'css/navigation.css',
    'css/data.css',
    'css/style.css'
  ]);
});
