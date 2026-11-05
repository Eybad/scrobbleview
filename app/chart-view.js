import {
  barChart, lineChart, hbarChart, heatmapTable, heatLegend,
  esc, fmtNum, fmtMs, DOW_SHORT, DOW_LONG
} from '../src/charts.js';
import { createChartContract, renderChartWithContract } from '../src/chart-contract.js';

function clockTable(cells, byMs = false) {
  return heatmapTable({
    cells: cells.map((c) => ({ x: c.hour, y: c.dow, value: c.value })),
    xLabels: Array.from({ length: 24 }, (_, h) => `${h}`),
    yLabels: DOW_SHORT,
    cellText: (c) => (byMs ? fmtMs(c.value) : fmtNum(c.value)),
    caption: byMs ? 'Tiempo escuchado por hora y día' : 'Reproducciones por hora y día'
  });
}

export function scrollChart(svg, label) {
  return svg ? `<div class="chart-scroll chart-scroll--bar" tabindex="0" role="region" aria-label="${esc(label)}">${svg}</div>` : '';
}

export function contractedLineChart({ id, title, points, format, unit, base }) {
  const range = points.length ? `${points[0].label} → ${points[points.length - 1].label}` : '';
  const contract = createChartContract({
    id,
    title,
    unit,
    base,
    range,
    data: points.map((point) => ({ label: point.label, date: point.date, value: point.y })),
    format,
    showShare: false,
    chartType: 'line'
  });
  return renderChartWithContract(contract, scrollChart(lineChart({ points, format }), title));
}

export function contractedBarChart({ id, title, data, format = fmtNum, unit, base, orientation = 'vertical', showValue = true }) {
  const contract = createChartContract({
    id,
    title,
    unit,
    base,
    data,
    format,
    chartType: orientation === 'horizontal' ? 'list' : 'bar',
    showShare: orientation === 'horizontal'
  });
  const chart = orientation === 'horizontal'
    ? hbarChart({ rows: data, format })
    : scrollChart(barChart({ data, format, showValue }), title);
  return renderChartWithContract(contract, chart);
}

export function contractedClockChart({ id, title, cells, format, byMs, base, svg }) {
  const contract = createChartContract({
    id,
    title,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base,
    data: cells.map((cell) => ({
      label: `${DOW_LONG[cell.dow]} ${cell.hour}:00`,
      value: cell.value,
      extra: { x: cell.hour, y: cell.dow }
    })),
    format,
    showShare: false,
    chartType: 'grid',
    fallbackTable: clockTable(cells, byMs)
  });
  const chart = `<div class="chart-scroll chart-scroll--clock" tabindex="0" role="region" aria-label="${esc(title)}">${svg}</div>${heatLegend()}`;
  return renderChartWithContract(contract, chart);
}
