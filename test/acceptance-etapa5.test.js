import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from './fakes/dataset.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { renderView } from '../app/views.js';
import {
  calculateCompareRange,
  computeMetricDelta,
  compareEntityRankings,
  buildCompareSeries
} from '../src/compare.js';

test('A18: comparison handles zero base without Infinity/NaN and flags partial/out of range windows', () => {
  // 1. Zero base delta
  const deltaFromZero = computeMetricDelta(500, 0);
  assert.equal(deltaFromZero.diff, 500);
  assert.equal(deltaFromZero.pctLabel, 'nuevo');
  assert.equal(Number.isFinite(deltaFromZero.diff), true);
  assert.ok(!deltaFromZero.pctLabel.includes('Infinity'));
  assert.ok(!deltaFromZero.pctLabel.includes('NaN'));

  // 2. Both zero
  const deltaBothZero = computeMetricDelta(0, 0);
  assert.equal(deltaBothZero.diff, 0);
  assert.equal(deltaBothZero.pctLabel, '0,0%');
  assert.ok(!deltaBothZero.pctLabel.includes('NaN'));

  // 3. Out of range window detection
  const rangeA = { from: 1704067200, to: 1704153599 }; // 2024-01-01
  const dataRange = { minSec: 1704067200, maxSec: 1735689600 };
  const comp = calculateCompareRange('equal_previous', rangeA, dataRange);
  assert.equal(comp.isOutOfRange, true);
  assert.ok(comp.warning.length > 0);
});

test('A19: day, week and month series reconcile sums exactly without event loss across periods', () => {
  // 3 events over 40 days
  const dailyMap = new Map([
    [19725, { plays: 15, ms: 90000 }],
    [19730, { plays: 25, ms: 150000 }],
    [19750, { plays: 10, ms: 60000 }]
  ]);
  const range = { from: 19725 * 86400, to: 19760 * 86400 + 86399 };
  const totalPlays = 15 + 25 + 10;
  const totalMs = 90000 + 150000 + 60000;

  // Daily
  const seriesDaily = buildCompareSeries(dailyMap, range, 'daily', false);
  const sumDailyPlays = seriesDaily.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumDailyPlays, totalPlays);

  const seriesDailyMs = buildCompareSeries(dailyMap, range, 'daily', true);
  const sumDailyMs = seriesDailyMs.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumDailyMs, totalMs);

  // Weekly
  const seriesWeekly = buildCompareSeries(dailyMap, range, 'weekly', false);
  const sumWeeklyPlays = seriesWeekly.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumWeeklyPlays, totalPlays);

  // Monthly
  const seriesMonthly = buildCompareSeries(dailyMap, range, 'monthly', true);
  const sumMonthlyMs = seriesMonthly.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumMonthlyMs, totalMs);
});

test('A18 / A19: compare view renders period comparisons, deltas, and entity transitions', async () => {
  const events = [
    { t: 1704067200, m: 60000, track: 'Song A', artist: 'Artist 1', album: 'Album 1' },
    { t: 1704153600, m: 120000, track: 'Song B', artist: 'Artist 2', album: 'Album 2' }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: fixedTz('UTC', 0) });

  const html = renderView('compare', model, null, { metric: 'ms' });

  assert.ok(html.includes('Comparación'));
  assert.ok(html.includes('Período A'));
  assert.ok(html.includes('Período B'));
  assert.ok(html.includes('compare-presets'));
  assert.ok(html.includes('equal_previous'));
  assert.ok(html.includes('same_period_last_year'));
  assert.ok(html.includes('table-fallback'));
});
