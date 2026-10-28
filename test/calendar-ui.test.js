import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarInspectorHTML,
  calendarMonthViewHTML,
  calendarScaleToggleHTML
} from '../app/calendar-ui.js';
import { makeScale, HEAT } from '../src/charts.js';

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

test('calendarScaleToggleHTML: explains shared scale and normalized scale options', () => {
  const sharedHtml = calendarScaleToggleHTML({ normalizeYears: false, maxValFormatted: '10.000 ms' });
  assert.ok(sharedHtml.includes('Escala compartida'));
  assert.ok(sharedHtml.includes('Normalizar cada año'));
  assert.ok(sharedHtml.includes('10.000 ms'));

  const normHtml = calendarScaleToggleHTML({ normalizeYears: true, maxValFormatted: '10.000 ms' });
  assert.ok(normHtml.includes('Escala normalizada'));
  assert.ok(normHtml.includes('Usar escala compartida'));
});
