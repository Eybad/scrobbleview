import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCalendarMonthOptions,
  calendarInspectorHTML,
  calendarMonthDaysHTML,
  calendarMonthViewHTML,
  calendarScaleToggleHTML
} from '../app/calendar-ui.js';
import { makeScale, NO_DATA } from '../src/charts.js';

test('buildCalendarMonthOptions: prepara el mes y conserva la escala compartida o anual', () => {
  const january = Math.floor(Date.UTC(2024, 0, 12) / 86400000);
  const february = Math.floor(Date.UTC(2024, 1, 8) / 86400000);
  const previousYear = Math.floor(Date.UTC(2023, 5, 4) / 86400000);
  const model = {
    daily: new Map([
      [january, { ms: 100, plays: 10 }],
      [february, { ms: 300, plays: 30 }],
      [previousYear, { ms: 900, plays: 90 }]
    ]),
    meta: { firstTs: previousYear * 86400, lastTs: february * 86400 }
  };
  const shared = buildCalendarMonthOptions({
    model, year: 2024, month: 1, metric: 'plays', selectedDate: '2024-01-12'
  });
  const normalized = buildCalendarMonthOptions({
    model, year: 2024, month: 1, metric: 'plays', selectedDate: null, normalizeYears: true
  });

  assert.equal(shared.year, 2024);
  assert.equal(shared.month, 1);
  assert.equal(shared.byMs, false);
  assert.equal(shared.selectedDate, '2024-01-12');
  assert.deepEqual(shared.daysMap.get('2024-01-12'), {
    date: '2024-01-12', value: 10, ms: 100, plays: 10
  });
  assert.equal(shared.daysMap.has('2023-06-04'), false);
  assert.deepEqual(shared.dataRange, { from: previousYear, to: february });
  assert.equal(shared.colorScale(10), makeScale(90)(10));
  assert.equal(normalized.colorScale(10), makeScale(30)(10));
  assert.notEqual(shared.colorScale(10), normalized.colorScale(10));
});

test('calendarInspectorHTML: renders inspector with explicit filter and range actions', () => {
  const html = calendarInspectorHTML({ year: 2024, byMs: true });
  assert.ok(html.includes('calendar-inspector'));
  assert.ok(html.includes('data-cal-action="filter-day"'));
  assert.ok(html.includes('data-cal-action="set-start"'));
  assert.ok(html.includes('data-cal-action="set-end"'));
  assert.ok(html.includes('data-cal-action="apply-range"'));
  assert.ok(html.includes('id="cal-range-from"'));
  assert.ok(html.includes('id="cal-range-to"'));
});

test('calendarMonthViewHTML: renders month navigation and comfortable cell touch targets', () => {
  const daysMap = new Map([
    ['2024-05-15', { value: 50, plays: 50, ms: 150000 }]
  ]);
  const scale = makeScale(100);

  const html = calendarMonthViewHTML({
    year: 2024,
    month: 5,
    daysMap,
    colorScale: scale,
    byMs: false
  });

  assert.ok(html.includes('calendar-month'));
  assert.ok(html.includes('Mayo 2024'));
  assert.ok(html.includes('data-cal-nav="prev-month"'));
  assert.ok(html.includes('data-cal-nav="next-month"'));
  assert.ok(html.includes('class="cal-month-cell"'));
  assert.ok(html.includes('data-day='));
  assert.ok(html.includes('2024-05-15'));
});

test('calendarMonthDaysHTML: renders one roving-focus tree for grid or narrow list', () => {
  const options = {
    year: 2024,
    month: 2,
    daysMap: new Map([['2024-02-10', { value: 5, ms: 500, plays: 5 }]]),
    colorScale: makeScale(5),
    dataRange: null,
    selectedDate: '2024-02-10'
  };
  const grid = calendarMonthDaysHTML(options);
  const list = calendarMonthDaysHTML({ ...options, layout: 'list' });

  assert.match(grid, /<table class="calendar-month__table" role="grid"/);
  assert.equal((grid.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(list, /Vista en lista para este ancho/);
  assert.match(list, /<ul class="calendar-month__list"/);
  assert.match(list, /calendar-month__list-weekday/);
  assert.match(list, /aria-pressed="true"/);
  assert.equal((list.match(/tabindex="0"/g) ?? []).length, 1);
  assert.equal((list.match(/data-day="/g) ?? []).length, 29);

  const fullListView = calendarMonthViewHTML({ ...options, layout: 'list' });
  assert.equal((fullListView.match(/data-day="/g) ?? []).length, 29);
  assert.match(fullListView, /class="calendar-month__grid-wrap" data-layout="list"/);
});

test('calendarMonthViewHTML: distingue el período sin datos con patrón', () => {
  const html = calendarMonthViewHTML({
    year: 2024,
    month: 5,
    daysMap: new Map(),
    colorScale: makeScale(100),
    dataRange: {
      from: Math.floor(Date.UTC(2024, 4, 15) / 86400000),
      to: Math.floor(Date.UTC(2024, 4, 15) / 86400000)
    }
  });

  assert.match(html, /class="cal-month-cell cal-month-cell--no-data"[^>]*data-date="2024-05-01"[^>]*style="background-color: #101822"[^>]*aria-label="2024-05-01: sin datos"/);
  assert.ok(html.includes(`background-color: ${NO_DATA}`));
});

test('calendarScaleToggleHTML: explains shared scale and normalized scale options', () => {
  const sharedHtml = calendarScaleToggleHTML({ normalizeYears: false, maxValFormatted: '10.000 ms' });
  assert.ok(sharedHtml.includes('Escala compartida'));
  assert.ok(sharedHtml.includes('Normalizar cada año'));
  assert.ok(sharedHtml.includes('10.000 ms'));

  const normHtml = calendarScaleToggleHTML({ normalizeYears: true, maxValFormatted: '10.000 ms' });
  assert.ok(normHtml.includes('Escala normalizada'));
  assert.ok(normHtml.includes('Usar escala compartida'));
});
