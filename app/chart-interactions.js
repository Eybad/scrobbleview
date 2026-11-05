import { fmtNum, fmtMs, lineChart, barChart } from '../src/charts.js';

function chartPoints(card) {
  try {
    const points = JSON.parse(card.dataset.chartPoints ?? '[]');
    return Array.isArray(points) ? points : [];
  } catch {
    return [];
  }
}

function chartIndexAt(svg, chart, event, points) {
  const rect = svg.getBoundingClientRect();
  if (chart.dataset.chartType === 'grid' || chart.dataset.chartType === 'stacked') {
    const matrix = svg.getScreenCTM();
    if (!matrix) return 0;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const position = cursor.matrixTransform(matrix.inverse());
    if (chart.dataset.chartType === 'stacked') {
      const rowHeight = (svg.viewBox.baseVal.height - 4) / points.length;
      return Math.max(0, Math.min(points.length - 1, Math.floor(position.y / rowHeight)));
    }
    const cols = Number(svg.dataset.gridCols);
    const rows = Number(svg.dataset.gridRows);
    const labelWidth = Number(svg.dataset.gridLabelWidth);
    const labelTop = Number(svg.dataset.gridLabelTop ?? 0);
    const cellWidth = Number(svg.dataset.gridCellWidth);
    const cellHeight = Number(svg.dataset.gridCellHeight);
    const gap = Number(svg.dataset.gridGap);
    const x = Math.max(0, Math.min(cols - 1, Math.floor((position.x - labelWidth) / (cellWidth + gap))));
    const y = Math.max(0, Math.min(rows - 1, Math.floor((position.y - labelTop) / (cellHeight + gap))));
    return points.findIndex((point) => point.extra?.x === x && point.extra?.y === y);
  }
  if (rect.width <= 0) return 0;
  const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return Math.round(position * (points.length - 1));
}

export function mountChartInteractions(root, { announce }) {
  const windowObject = root.ownerDocument.defaultView;
  const selections = new Map();

  function resizeCharts() {
    root.querySelectorAll('.chart-card[data-chart-type="line"], .chart-card[data-chart-type="bar"]').forEach((card) => {
      const svg = card.querySelector('svg.chart');
      const chartType = card.dataset.chartType;
      const width = Math.floor(svg?.parentElement?.clientWidth ?? 0);
      const points = chartPoints(card);
      if (!svg || width <= 0 || points.length === 0) return;
      const format = card.dataset.chartUnit === 'tiempo escuchado' ? fmtMs : fmtNum;
      const markup = chartType === 'line'
        ? lineChart({ points: points.map((point) => ({ label: point.label, y: point.value })), format, width })
        : barChart({ data: points.map((point) => ({ label: point.label, value: point.value })), format, width, showValue: svg.querySelector('.chart-value') != null });
      svg.outerHTML = markup;
    });
  }

  function selectPoint(card, index) {
    const points = chartPoints(card);
    if (!points.length) return;
    const selectedIndex = Math.max(0, Math.min(points.length - 1, index));
    const point = points[selectedIndex];
    selections.set(card.dataset.chartId, { index: selectedIndex, key: point.date || point.label });
    const inspector = card.querySelector('.chart-inspector');
    if (!inspector) return;
    inspector.querySelector('.chart-inspector__label').textContent = point.date || point.label;
    inspector.querySelector('.chart-inspector__value').textContent = point.valueText;
    inspector.querySelector('.chart-inspector__pct').textContent = point.shareText ? ` · ${point.shareText}` : '';
    inspector.querySelector('[data-action="close-inspector"]').disabled = false;
    const status = card.querySelector('.chart-nav__status');
    if (status) status.textContent = `${selectedIndex + 1} de ${points.length}: ${point.label}`;
    card.querySelectorAll('[data-chart-step]').forEach((button) => {
      const direction = Number(button.dataset.dir);
      button.disabled = direction < 0 ? selectedIndex === 0 : selectedIndex === points.length - 1;
    });
    card.querySelectorAll('[data-chart-index]').forEach((item) => {
      item.classList.toggle('is-selected', Number(item.dataset.chartIndex) === selectedIndex);
    });
  }

  function restoreSelections() {
    root.querySelectorAll('.chart-card[data-chart-id]').forEach((card) => {
      const selection = selections.get(card.dataset.chartId);
      if (!selection) return;
      const points = chartPoints(card);
      const matchingIndex = points.findIndex((point) => (point.date || point.label) === selection.key);
      if (matchingIndex >= 0) selectPoint(card, matchingIndex);
      else selections.delete(card.dataset.chartId);
    });
  }

  function refresh() {
    resizeCharts();
    restoreSelections();
  }

  function handleClick(event) {
    const chartStep = event.target.closest?.('[data-chart-step]');
    if (chartStep && root.contains(chartStep)) {
      const chart = chartStep.closest('.chart-card');
      const selected = selections.get(chart.dataset.chartId)?.index;
      const direction = Number(chartStep.dataset.dir);
      const start = selected ?? (direction > 0 ? -1 : 1);
      selectPoint(chart, start + direction);
      return;
    }

    const chartPage = event.target.closest?.('[data-chart-page]');
    if (chartPage && root.contains(chartPage)) {
      const chart = chartPage.closest('.chart-card');
      const controls = chartPage.closest('[data-chart-table]');
      const rows = [...chart.querySelectorAll('[data-chart-row]')];
      const pageSize = Number(controls.dataset.pageSize);
      const pageCount = Math.ceil(rows.length / pageSize);
      const page = Math.max(0, Math.min(pageCount - 1, Number(controls.dataset.page) + Number(chartPage.dataset.dir)));
      const start = page * pageSize;
      rows.forEach((row, index) => { row.hidden = index < start || index >= start + pageSize; });
      controls.dataset.page = String(page);
      controls.querySelector('.chart-table-status').textContent = `Mostrando ${start + 1}–${Math.min(start + pageSize, rows.length)} de ${rows.length}`;
      controls.querySelector('[data-dir="-1"]').disabled = page === 0;
      controls.querySelector('[data-dir="1"]').disabled = page >= pageCount - 1;
      return;
    }

    const listPoint = event.target.closest?.('.chart-card[data-chart-type="list"] [data-chart-index]');
    if (listPoint && root.contains(listPoint)) {
      selectPoint(listPoint.closest('.chart-card'), Number(listPoint.dataset.chartIndex));
      return;
    }

    const chartWrap = event.target.closest?.('.chart-card .chart-interactive-wrap');
    const svg = event.target.closest?.('svg.chart');
    if (chartWrap && svg && root.contains(chartWrap)) {
      const chart = chartWrap.closest('.chart-card');
      const points = chartPoints(chart);
      if (points.length) {
        const selectedIndex = chartIndexAt(svg, chart, event, points);
        if (selectedIndex >= 0) selectPoint(chart, selectedIndex);
      }
      return;
    }

    const closeInspector = event.target.closest?.('[data-action="close-inspector"]');
    if (!closeInspector || !root.contains(closeInspector)) return;
    const card = closeInspector.closest('.chart-card');
    const inspector = card?.querySelector('.chart-inspector');
    if (!inspector) return;
    inspector.querySelector('.chart-inspector__label').textContent = 'Elegí un punto';
    inspector.querySelector('.chart-inspector__value').textContent = '';
    inspector.querySelector('.chart-inspector__pct').textContent = '';
    closeInspector.disabled = true;
    selections.delete(card.dataset.chartId);
    card.querySelectorAll('[data-chart-index]').forEach((item) => item.classList.remove('is-selected'));
    const points = chartPoints(card);
    const status = card.querySelector('.chart-nav__status');
    if (status) status.textContent = `${points.length} puntos`;
    card.querySelector('[data-chart-step][data-dir="-1"]')?.setAttribute('disabled', '');
    card.querySelector('[data-chart-step][data-dir="1"]')?.removeAttribute('disabled');
    announce('Inspector cerrado.');
    card.querySelector('[data-chart-step][data-dir="1"]')?.focus({ preventScroll: true });
  }

  function handleKeydown(event) {
    const nav = event.target.closest?.('.chart-nav');
    if (!nav || !root.contains(nav) || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const card = nav.closest('.chart-card');
    const points = chartPoints(card);
    if (!points.length) return;
    const selected = selections.get(card.dataset.chartId)?.index;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (selected ?? (event.key === 'ArrowRight' ? -1 : points.length)) + (event.key === 'ArrowRight' ? 1 : -1)));
    event.preventDefault();
    selectPoint(card, next);
    const activeStep = event.target.closest('[data-chart-step]');
    if (activeStep?.disabled) card.querySelector(`[data-dir="${-Number(activeStep.dataset.dir)}"]`)?.focus();
  }

  root.addEventListener('click', handleClick);
  root.addEventListener('keydown', handleKeydown);
  windowObject.addEventListener('resize', refresh, { passive: true });

  return {
    refresh,
    dispose() {
      root.removeEventListener('click', handleClick);
      root.removeEventListener('keydown', handleKeydown);
      windowObject.removeEventListener('resize', refresh);
      selections.clear();
    }
  };
}
