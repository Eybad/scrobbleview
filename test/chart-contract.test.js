import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChartContract,
  renderChartWithContract,
  chartDataTableHTML
} from '../src/chart-contract.js';
import { fmtNum, fmtMs, lineChart } from '../src/charts.js';

test('createChartContract: validates and normalizes contract fields', () => {
  const contract = createChartContract({
    id: 'test-chart',
    title: 'Actividad por hora',
    unit: 'reproducciones',
    base: 'Total del período',
    range: '2024-01-01 a 2024-12-31',
    data: [
      { label: '00', value: 10, date: '2024-01-01' },
      { label: '01', value: 0, date: '2024-01-02' },
      { label: '02', value: 25, date: '2024-01-03' }
    ],
    format: fmtNum
  });

  assert.equal(contract.id, 'test-chart');
  assert.equal(contract.title, 'Actividad por hora');
  assert.equal(contract.unit, 'reproducciones');
  assert.equal(contract.base, 'Total del período');
  assert.equal(contract.range, '2024-01-01 a 2024-12-31');
  assert.equal(contract.points.length, 3);
  assert.equal(contract.total, 35);
  assert.equal(contract.max, 25);
  assert.equal(contract.isEmpty, false);
});

test('createChartContract: empty series handled gracefully with emptyState', () => {
  const emptyContract = createChartContract({
    id: 'empty-chart',
    title: 'Sin datos',
    data: []
  });

  assert.equal(emptyContract.isEmpty, true);
  assert.ok(emptyContract.emptyNotice.includes('Sin datos'));
});

test('chartDataTableHTML: generates exact matching table preserving zeros and dates', () => {
  const contract = createChartContract({
    id: 'monthly-test',
    title: 'Evolución mensual',
    unit: 'ms',
    data: [
      { label: 'ene 2024', value: 0 },
      { label: 'feb 2024', value: 120000 },
      { label: 'mar 2024', value: 3600000 }
    ],
    format: fmtMs
  });

  const tableHtml = chartDataTableHTML(contract);
  assert.ok(tableHtml.includes('class="table-fallback"'));
  assert.ok(tableHtml.includes('Evolución mensual'));
  assert.ok(tableHtml.includes('ene 2024'));
  assert.ok(tableHtml.includes('0 ms'));
  assert.ok(tableHtml.includes('2 min 0 s'));
  assert.ok(tableHtml.includes('1 h 0 min'));
  assert.ok(tableHtml.includes('scope="col"'));
});

test('renderChartWithContract: generates chart markup with inspector, controls and table fallback', () => {
  const contract = createChartContract({
    id: 'hours-start',
    title: 'Hora de inicio',
    unit: 'sesiones',
    data: Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, value: h === 12 ? 5 : 0 })),
    format: fmtNum
  });

  const dummySvg = '<svg class="chart"></svg>';
  const html = renderChartWithContract(contract, dummySvg);

  assert.ok(html.includes('class="chart-card"'));
  assert.ok(html.includes('data-chart-id="hours-start"'));
  assert.ok(html.includes('class="chart-inspector"'));
  assert.ok(html.includes('class="chart-nav"'));
  assert.ok(html.includes('class="btn-step btn-step--prev"'));
  assert.ok(html.includes('class="btn-step btn-step--next"'));
  assert.ok(html.includes('class="table-fallback"'));
  assert.ok(html.includes('Hora de inicio'));
});

test('B22: long chart contracts preserve zero, unknown values and every selectable point', () => {
  const data = Array.from({ length: 60 }, (_, index) => ({
    label: `month-${index + 1}`,
    value: index === 30 ? null : index === 0 ? 0 : index
  }));
  const contract = createChartContract({
    id: 'long-monthly-series',
    title: 'Serie mensual',
    unit: 'eventos',
    data,
    pageSize: 25,
    format: fmtNum
  });
  const table = chartDataTableHTML(contract);
  const svg = lineChart({ points: data.map(point => ({ label: point.label, y: point.value })) });

  assert.equal(contract.points.length, 60);
  assert.equal(contract.points[0].value, 0);
  assert.equal(contract.points[30].value, null);
  assert.equal((table.match(/data-chart-row=/g) ?? []).length, 60);
  assert.match(table, />0<\/td>/);
  assert.match(table, /Sin base/);
  assert.equal((svg.match(/data-chart-index=/g) ?? []).length, 60);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});
