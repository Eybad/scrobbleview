import test from 'node:test';
import assert from 'node:assert/strict';
import { fmtMs } from '../src/charts.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { buildDataset } from './fakes/dataset.js';

const UTC = fixedTz('utc', 0);
const D0 = 1704067200; // 2024-01-01T00:00:00Z

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
    { t: D0 + 86400, m: 180000, track: 'Track 2' } // Sin artista (desconocido)
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
  // Enero a Junio para Artista 1 (6 meses, 1 evento por mes)
  for (let month = 0; month < 6; month++) {
    const date = new Date(Date.UTC(2024, month, 15, 12, 0, 0));
    events.push({
      t: Math.floor(date.getTime() / 1000),
      m: 180000,
      track: `Track M${month}`,
      artist: 'Artista Continuo'
    });
  }
  // Diciembre 2024 para Artista 2 (ancla el fin del período observado a Dic 2024 -> 12 meses observados)
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
  assert.equal(a1.coverage, 1); // 100% de continuidad activa
  assert.equal(a1.observedMonths, 12);
  assert.equal(a1.periodCoverage, 0.5); // 50% de cobertura del período observado
});

test('A01 / A02: cascada CSS responsive de .kpis y .records-grid colocada tras sus bases', async () => {
  const fs = await import('node:fs/promises');
  const css = await fs.readFile(new URL('../css/style.css', import.meta.url), 'utf-8');

  const baseKpiIdx = css.indexOf('.kpis {');
  const baseRecordsIdx = css.indexOf('.records-grid {');
  const basePresetsIdx = css.indexOf('.filter-presets {');

  const media640Idx = css.indexOf('@media (max-width: 640px)');
  assert.ok(media640Idx >= 0, 'media query 640px presente');

  // Verificar que el override de .kpis y .records-grid en móvil está DESPUÉS de la definición base
  const mobileKpiMatches = [...css.matchAll(/\.kpis\s*\{\s*grid-template-columns:\s*repeat\(2/g)];
  assert.ok(mobileKpiMatches.length > 0, 'override móvil de 2 columnas presente');
  for (const m of mobileKpiMatches) {
    assert.ok(m.index > baseKpiIdx, 'override móvil de .kpis debe ubicarse posterior a su base');
  }

  const mobileRecordsMatches = [...css.matchAll(/\.records-grid\s*\{\s*grid-template-columns:\s*repeat\(2/g)];
  assert.ok(mobileRecordsMatches.length > 0, 'override móvil de records-grid presente');
  for (const m of mobileRecordsMatches) {
    assert.ok(m.index > baseRecordsIdx, 'override móvil de .records-grid debe ubicarse posterior a su base');
  }

  const mobilePresetsMatches = [...css.matchAll(/\.filter-presets\s*\{\s*width:\s*100%/g)];
  assert.ok(mobilePresetsMatches.length > 0, 'override móvil de filter-presets presente');
  for (const m of mobilePresetsMatches) {
    assert.ok(m.index > basePresetsIdx, 'override móvil de .filter-presets debe ubicarse posterior a su base');
  }
});
