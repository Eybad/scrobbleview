import {
  DOW_LONG, DOW_SHORT, esc, fmtMs, fmtNum, fmtPct,
  heatLegend, heatmap, heatmapTable, makeScale
} from '../../src/charts.js';
import { createChartContract, renderChartWithContract } from '../../src/chart-contract.js';
import { formatSemanticRoute } from '../routes.js';

export function card(title, body, cls = '', titleHtml = false, headingTag = 'h2') {
  const heading = title ? `<${headingTag}>${titleHtml ? title : esc(title)}</${headingTag}>` : '';
  return `<section class="card ${cls}">${heading}${body}</section>`;
}

export function kpis(items, layout = '') {
  return `<dl class="kpis${layout ? ` ${layout}` : ''}">${items.map((item) => {
    if (item.heading) return `<div class="kpi-group-heading" role="presentation"><span>${esc(item.heading)}</span></div>`;
    return `
    <div class="kpi${item.text ? ' kpi-text' : ''}${item.className ? ` ${esc(item.className)}` : ''}"><dt>${esc(item.label)}</dt><dd>${item.value}${item.sub ? `<span class="kpi-sub">${esc(item.sub)}</span>` : ''}</dd></div>`;
  }).join('')}</dl>`;
}

export function table(headers, rows, cls = '', colClasses = [], rowAttrs = null, caption = '', scrollCls = '', emptyNotice = '') {
  const th = (header, index) => `<th scope="col"${colClasses[index] ? ` class="${colClasses[index]}"` : ''}>${esc(header)}</th>`;
  const td = (cell, index) => `<td${colClasses[index] ? ` class="${colClasses[index]}"` : ''}>${cell}</td>`;
  const cap = caption ? `<caption class="visually-hidden">${esc(caption)}</caption>` : '';
  const wrapCls = scrollCls ? `table-scroll ${scrollCls}` : 'table-scroll';
  const emptyHTML = rows.length === 0 && emptyNotice ? `<p class="empty">${esc(emptyNotice)}</p>` : '';
  return `<div class="${wrapCls}"><table class="${cls}">${cap}<thead><tr>${headers.map(th).join('')}</tr></thead>
    <tbody>${rows.map((row, index) => `<tr${rowAttrs ? rowAttrs(row, index) : ''}>${row.map(td).join('')}</tr>`).join('')}</tbody></table>${emptyHTML}</div>`;
}

export function entityLinks(model, query = '') {
  function entity(type, id) {
    const group = type === 'artist' ? model.artists : type === 'track' ? model.tracks : model.albums;
    return group.byId.get(id);
  }
  function entityLink(type, id, name) {
    const item = entity(type, id);
    if (!item) return esc(name);
    const href = formatSemanticRoute(type, item, query);
    return `<a class="cell-name" href="${esc(href)}" title="${esc(name)}">${esc(name)}</a>`;
  }
  function trackSubLink(tk, name, artist) {
    const item = entity('track', tk);
    if (!item) return esc(name);
    const full = artist ? `${name} — ${artist}` : name;
    const href = formatSemanticRoute('track', item, query);
    return `<a class="cell-link" href="${esc(href)}" title="${esc(full)}"><span class="cell-name">${esc(name)}</span>${artist ? ` <span class="cell-sub">${esc(artist)}</span>` : ''}</a>`;
  }
  return { entityLink, trackSubLink };
}

export function topEntityInMap(map, ignoreZero = false) {
  let best = null;
  for (const entry of map.entries()) {
    if (ignoreZero && entry[0] === 0) continue;
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best;
}

export function pctOf(part, total) {
  return total > 0 ? fmtPct(part / total) : '—';
}

export function dayHourHeatChart(model, { id, title, metric }) {
  const byMs = metric === 'ms';
  const format = byMs ? fmtMs : fmtNum;
  const source = byMs ? model.dayHourMs : model.dayHour;
  const cells = [];
  let maxValue = 0;
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const value = source[day * 24 + hour];
      if (value > maxValue) maxValue = value;
      cells.push({ x: hour, y: day, value });
    }
  }

  const heat = heatmap({
    cells,
    width: 640,
    height: 190,
    colorScale: makeScale(maxValue),
    xLabels: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => `${hour}`),
    yLabels: DOW_SHORT,
    cellTitle: (cell) => `${DOW_LONG[cell.y]} ${cell.x}:00 — ${format(cell.value)}`,
    ariaLabel: `Actividad por hora del día y día de la semana (${byMs ? 'tiempo escuchado' : 'reproducciones'})`
  });
  const fallbackTable = heatmapTable({
    cells,
    xLabels: Array.from({ length: 24 }, (_, hour) => `${hour}`),
    yLabels: DOW_SHORT,
    cellText: (cell) => format(cell.value),
    caption: byMs ? 'Tiempo escuchado por hora y día' : 'Reproducciones por hora y día'
  });
  const contract = createChartContract({
    id,
    title,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'eventos con duración conocida' : 'eventos registrados',
    data: cells.map((cell) => ({
      label: `${DOW_LONG[cell.y]} ${cell.x}:00`,
      value: cell.value,
      extra: { x: cell.x, y: cell.y }
    })),
    format,
    showShare: false,
    chartType: 'grid',
    fallbackTable
  });
  const chart = `<div class="chart-scroll chart-scroll--heat" tabindex="0" role="region" aria-label="Actividad por hora y día de la semana">${heat}</div>${heatLegend()}`;
  return renderChartWithContract(contract, chart);
}
