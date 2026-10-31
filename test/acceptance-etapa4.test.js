import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/aggregate/aggregate.js';
import { createSessionsAcc } from '../src/aggregate/impl/sessions.js';
import { renderView } from '../app/views.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { createChartContract, chartDataTableHTML } from '../src/chart-contract.js';
import { fmtNum } from '../src/charts.js';
import { calendarQuery, parseCalendarState } from '../app/calendar-ui.js';

import { buildDataset } from './fakes/dataset.js';

test('calendar month keeps its year when crossing December and January', () => {
  const ds = buildDataset([
    { t: 1735603200, m: 60000, track: 'December', artist: 'Artist' },
    { t: 1735776000, m: 120000, track: 'January', artist: 'Artist' }
  ]);
  const model = aggregate(ds, { tz: fixedTz('UTC', 0) });
  const january = renderView('calendar', model, null, { calMonth: { year: 2025, month: 1 } });
  const december = renderView('calendar', model, null, { calMonth: { year: 2024, month: 12 } });
  assert.match(january, /Enero 2025/);
  assert.match(december, /Diciembre 2024/);
  assert.match(renderView('calendar', model, 2025, { calMonth: { year: 2025, month: 1 } }), /Enero 2025/);
  assert.match(renderView('calendar', model, 2026, { calMonth: { year: 2026, month: 1 } }), /Enero 2026/);
  const query = calendarQuery('?r=1-2&m=plays', { year: 2025, month: 1 }, true);
  assert.deepEqual(parseCalendarState(query), { calMonth: { year: 2025, month: 1 }, normalizeYears: true });
  assert.equal(new URLSearchParams(query).get('r'), '1-2');
});

test('A15: sessions startHour always completes 24 positions with zero for absent hours', () => {
  const tz = fixedTz('UTC', 0);
  const aggregator = createSessionsAcc({ tz, gapMinutes: 30 });
  const model = aggregator.finalize();

  assert.equal(model.sessionsStats.startHour.size, 24);
  for (let h = 0; h < 24; h++) {
    assert.equal(model.sessionsStats.startHour.get(h), 0);
  }
});

test('A15: sessionsView renders all 24 hour positions and table matches chart data', async () => {
  const ds = buildDataset([
    { t: 1704067200, m: 60000, track: 'Track 1', artist: 'Artist 1', album: 'Album 1' }
  ]);

  const model = aggregate(ds, { tz: fixedTz('UTC', 0) });
  const html = renderView('sessions', model);

  for (let h = 0; h < 24; h++) {
    assert.ok(html.includes(`>${h}<`), `hour ${h} label must be present in chart`);
  }

  const contract = createChartContract({
    id: 'sessions-start-hour',
    title: 'Hora de inicio',
    unit: 'sesiones',
    data: Array.from({ length: 24 }, (_, h) => ({
      label: `${h}:00`,
      value: model.sessionsStats.startHour.get(h) ?? 0
    })),
    format: fmtNum
  });

  const tableHtml = chartDataTableHTML(contract);
  assert.ok(tableHtml.includes('Hora de inicio (sesiones)'));
  assert.ok(tableHtml.includes('0:00'));
  assert.ok(tableHtml.includes('23:00'));
  assert.ok(tableHtml.includes('1'));
  assert.ok(tableHtml.includes('0'));
});

test('A16: calendar provides day inspector, explicit range controls without Shift, and interactive monthly view', async () => {
  const ds = buildDataset([
    { t: 1704067200, m: 60000, track: 'Track 1', artist: 'Artist 1' },
    { t: 1704153600, m: 120000, track: 'Track 2', artist: 'Artist 2' }
  ]);
  const model = aggregate(ds, { tz: fixedTz('UTC', 0) });
  const html = renderView('calendar', model, 2024);

  assert.ok(html.includes('calendar-inspector'));
  assert.ok(html.includes('data-cal-action="filter-day"'));
  assert.ok(html.includes('data-cal-action="set-start"'));
  assert.ok(html.includes('data-cal-action="set-end"'));
  assert.ok(html.includes('data-cal-action="apply-range"'));

  assert.ok(html.includes('calendar-month'));
  assert.ok(html.includes('data-cal-nav="prev-month"'));
  assert.ok(html.includes('data-cal-nav="next-month"'));
  assert.ok(html.includes('cal-month-cell'));
});

test('A17: calendar index defaults to shared scale across years with different maximums, and identifies normalization when opted in', async () => {
  const events = [
    { t: 1685577600, m: 60000, track: 'A', artist: 'Art' }
  ];
  for (let i = 0; i < 10; i++) {
    events.push({ t: 1717200000 + i * 100, m: 60000, track: `B${i}`, artist: 'Art' });
  }
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: fixedTz('UTC', 0) });

  const sharedHtml = renderView('calendar', model, null, { metric: 'plays' });
  assert.ok(sharedHtml.includes('Escala compartida'));
  assert.ok(sharedHtml.includes('Normalizar cada año'));

  const normHtml = renderView('calendar', model, null, { metric: 'plays', normalizeYears: true });
  assert.ok(normHtml.includes('Escala normalizada'));
});
