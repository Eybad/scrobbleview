import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCompareRange,
  computeMetricDelta,
  compareAverages,
  compareEntityRankings,
  formatDeltaNotice,
  buildCompareSeries
} from '../src/compare.js';
import { fmtNum, fmtMs } from '../src/charts.js';

test('calculateCompareRange: equal_previous generates exact preceding interval of equal duration', () => {
  const rangeA = { from: 1704931200, to: 1705795199 };
  const dataRange = { minSec: 1600000000, maxSec: 1800000000 };

  const res = calculateCompareRange('equal_previous', rangeA, dataRange);
  assert.equal(res.rangeB.to, rangeA.from - 1);
  const durA = rangeA.to - rangeA.from + 1;
  const durB = res.rangeB.to - res.rangeB.from + 1;
  assert.equal(durA, durB);
  assert.equal(res.isOutOfRange, false);
});

test('calculateCompareRange: detects when comparison window exceeds loaded dataset range', () => {
  const rangeA = { from: 1704067200, to: 1704153599 };
  const dataRange = { minSec: 1704067200, maxSec: 1705000000 };

  const res = calculateCompareRange('equal_previous', rangeA, dataRange);
  assert.equal(res.isOutOfRange, true);
  assert.ok(res.warning.includes('exceden el intervalo observado'));
});

test('computeMetricDelta: base zero handles new and zero without NaN or Infinity', () => {
  const deltaNew = computeMetricDelta(100, 0, fmtNum);
  assert.equal(deltaNew.diff, 100);
  assert.equal(deltaNew.pctLabel, 'nuevo');
  assert.equal(deltaNew.isFinite, true);

  const deltaZero = computeMetricDelta(0, 0, fmtNum);
  assert.equal(deltaZero.diff, 0);
  assert.equal(deltaZero.pctLabel, '0,0%');

  const deltaNormal = computeMetricDelta(100, 50, fmtNum);
  assert.equal(deltaNormal.diff, 50);
  assert.equal(deltaNormal.pctLabel, '+100,0%');

  const deltaDown = computeMetricDelta(50, 100, fmtNum);
  assert.equal(deltaDown.diff, -50);
  assert.equal(deltaDown.pctLabel, '-50,0%');
});

test('compareAverages: provides both days of range and active days with explicit denominators', () => {
  const range = { from: 1704067200, to: 1704067200 + 10 * 86400 - 1 };
  const avgs = compareAverages({ plays: 50, ms: 100000 }, range, 5);

  assert.equal(avgs.totalDays, 10);
  assert.equal(avgs.activeDays, 5);
  assert.equal(avgs.playsPerRangeDay, 5);
  assert.equal(avgs.playsPerActiveDay, 10);
  assert.ok(avgs.rangeDayLabel.includes('10 días'));
  assert.ok(avgs.activeDayLabel.includes('5 días'));
});

test('compareEntityRankings: computes positions, entries, exits, and percentage point share differences', () => {
  const mapA = new Map([
    ['art1', { name: 'Radiohead', value: 200 }],
    ['art2', { name: 'Portishead', value: 100 }]
  ]);
  const mapB = new Map([
    ['art1', { name: 'Radiohead', value: 150 }],
    ['art3', { name: 'Massive Attack', value: 300 }]
  ]);

  const rows = compareEntityRankings(mapA, mapB, 300, 450);

  const rh = rows.find((r) => r.key === 'art1');
  assert.ok(rh);
  assert.equal(rh.rankA, 1);
  assert.equal(rh.rankB, 2);
  assert.equal(rh.rankDelta, 1);

  const ph = rows.find((r) => r.key === 'art2');
  assert.ok(ph);
  assert.equal(ph.status, 'Entrada');
  assert.equal(ph.rankB, null);

  const ma = rows.find((r) => r.key === 'art3');
  assert.ok(ma);
  assert.equal(ma.status, 'Salida');
  assert.equal(ma.rankA, null);
});

test('buildCompareSeries: daily, weekly, and monthly bucket reconciliation with partial flags', () => {
  const dailyMap = new Map([
    [19725, { plays: 10, ms: 10000 }],
    [19728, { plays: 20, ms: 20000 }],
    [19760, { plays: 30, ms: 30000 }]
  ]);
  const range = { from: 19725 * 86400, to: 19768 * 86400 + 86399 };

  const seriesDaily = buildCompareSeries(dailyMap, range, 'daily');
  const sumDaily = seriesDaily.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumDaily, 60);

  const seriesWeekly = buildCompareSeries(dailyMap, range, 'weekly');
  const sumWeekly = seriesWeekly.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumWeekly, 60);
  assert.equal(seriesWeekly[0].isPartial, true);

  const seriesMonthly = buildCompareSeries(dailyMap, range, 'monthly');
  const sumMonthly = seriesMonthly.reduce((acc, b) => acc + b.value, 0);
  assert.equal(sumMonthly, 60);
  assert.equal(seriesMonthly[0].isPartial, true);
});
