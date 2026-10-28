import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElementSelector, captureHistoryState, restoreHistoryState } from '../app/history-state.js';
import { formatPeriodLabel, contextBarHTML } from '../app/context-bar.js';
import { emptyFilterState } from '../src/filters.js';

test('buildElementSelector: identifies selectors by id, dataset, href, or name', () => {
  const elId = { id: 'search-input', dataset: {}, getAttribute: (k) => k === 'id' ? 'search-input' : null };
  assert.equal(buildElementSelector(elId), '#search-input');

  const elMetric = { dataset: { metric: 'ms' }, getAttribute: () => null };
  assert.equal(buildElementSelector(elMetric), '[data-metric="ms"]');

  const elLink = { dataset: {}, getAttribute: (k) => k === 'href' ? '#/v1/artist/Radiohead' : null };
  assert.equal(buildElementSelector(elLink), 'a[href="#/v1/artist/Radiohead"]');
});

test('A10: captureHistoryState and restoreHistoryState preserve scroll and focus', () => {
  let focusedSelector = null;
  let scrollCoords = { x: 0, y: 0 };
  const mockTable = { scrollLeft: 120, scrollTop: 45 };

  const mockWindow = {
    scrollX: 50,
    scrollY: 320,
    scrollTo(x, y) { scrollCoords = { x, y }; }
  };

  const mockDoc = {
    activeElement: { dataset: { metric: 'plays' }, getAttribute: () => null },
    querySelectorAll(selector) {
      if (selector === '.table-scroll, .chart-scroll') return [mockTable];
      return [];
    },
    querySelector(sel) {
      if (sel === '[data-metric="plays"]') {
        return {
          focus(opts) {
            assert.equal(opts?.preventScroll, true);
            focusedSelector = sel;
          }
        };
      }
      return null;
    }
  };

  const captured = captureHistoryState(mockWindow, mockDoc);
  assert.equal(captured.scrollX, 50);
  assert.equal(captured.scrollY, 320);
  assert.equal(captured.focusSelector, '[data-metric="plays"]');
  assert.equal(captured.tableScrolls[0].left, 120);

  // Clear mock state
  scrollCoords = { x: 0, y: 0 };
  mockTable.scrollLeft = 0;
  mockTable.scrollTop = 0;

  // Restore
  const restored = restoreHistoryState(captured, mockWindow, mockDoc);
  assert.equal(restored, true);
  assert.equal(scrollCoords.x, 50);
  assert.equal(scrollCoords.y, 320);
  assert.equal(mockTable.scrollLeft, 120);
  assert.equal(focusedSelector, '[data-metric="plays"]');
});

test('contextBarHTML: formats active period, filter pill, and metric switch', () => {
  const model = { meta: { firstTs: 1704067200, lastTs: 1706745600 }, yearly: new Map([[2024, {}]]) };

  // All history
  const htmlAll = contextBarHTML({ state: emptyFilterState(), model, metric: 'ms' });
  assert.ok(htmlAll.includes('Todo el historial'));
  assert.ok(htmlAll.includes('data-metric="ms"'));
  assert.ok(htmlAll.includes('aria-pressed="true"'));

  // Range
  const stateRange = { ...emptyFilterState(), range: { from: 1704067200, to: 1706745600 } };
  const htmlRange = contextBarHTML({ state: stateRange, model, metric: 'plays' });
  assert.ok(htmlRange.includes('2024-01-01 – 2024-02-01'));
  assert.ok(htmlRange.includes('data-metric="plays"'));
  assert.ok(htmlRange.includes('aria-label="Filtros activos: 1 filtro aplicado"'));
});
