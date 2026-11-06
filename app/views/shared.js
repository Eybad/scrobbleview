import {
  DOW_LONG, DOW_SHORT, MONTHS_SHORT, esc, fmtMs, fmtNum, fmtPct,
  heatLegend, heatmap, heatmapTable, makeScale
} from '../../src/charts.js';
import { createChartContract, renderChartWithContract } from '../../src/chart-contract.js';
import { civilFromDays } from '../../src/aggregate/impl/derive.js';
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


function limitSelect(key, currentLimit, label) {
  return `<select class="table-limit" name="limit-${esc(key)}" autocomplete="off" data-table-limit="${esc(key)}" aria-label="${esc(label)}">${[10, 25, 50, 100].map((n) => `<option value="${n}"${currentLimit === n ? ' selected' : ''}>Top ${n}</option>`).join('')}</select>`;
}

export function cardWithLimit(title, key, limit, body, cls = '', catalogHref = '', headingTag = 'h2') {
  const content = limit >= 25
    ? body.replace('class="table-scroll"', 'class="table-scroll table-scroll--tall"')
    : body;
  const catalog = catalogHref ? `<p><a href="${esc(catalogHref)}">Ver todos en Explorar</a></p>` : '';
  return `<section class="card ${cls}"><div class="card-head"><${headingTag}>${esc(title)}</${headingTag}>${limitSelect(key, limit, `Cantidad en ${title}`)}</div>${content}${catalog}</section>`;
}

export function catalogHref(ctx, tab, sort, thresholdKey, threshold) {
  const params = new URLSearchParams((ctx.query ?? '').replace(/^\?/, ''));
  params.set('tab', tab);
  params.set('sort', sort);
  params.set('dir', sort === 'lowSkipRate' || sort === 'forgotten' ? 'asc' : 'desc');
  if (thresholdKey) params.set(thresholdKey, String(threshold));
  return `#/v1/explore?${params}`;
}

export function resolveLimit(ctx, key, fallback = 10) {
  const store = ctx?.limits ?? ctx?.tableLimits;
  if (!store) return fallback;
  const val = store instanceof Map ? store.get(key) : store[key];
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

export function fmtLocal(loc) {
  const c = civilFromDays(Math.floor(loc / 86400));
  const sec = ((loc % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600);
  const mi = Math.floor((sec % 3600) / 60);
  return `${c.d} ${MONTHS_SHORT[c.m - 1]} ${c.y}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

export function fmtDay(day) {
  const c = civilFromDays(day);
  return `${c.d} ${MONTHS_SHORT[c.m - 1]} ${c.y}`;
}

export function monthLabel(mi) {
  const y = Math.floor(mi / 100);
  const m = mi % 100;
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

// Keep unknown Spotify reason codes verbatim instead of guessing translations.
const REASON_LABELS = new Map([
  ['trackdone', 'Fin de pista (trackdone)'],
  ['fwdbtn', 'Botón siguiente (fwdbtn)'],
  ['backbtn', 'Botón anterior (backbtn)'],
  ['clickrow', 'Clic en lista (clickrow)'],
  ['appload', 'Carga de app (appload)'],
  ['appstart', 'Inicio de reproducción (appstart)'],
  ['endplay', 'Fin de reproducción (endplay)'],
  ['logout', 'Cierre de sesión (logout)'],
  ['remote', 'Control remoto (remote)'],
  ['unexpected-exit', 'Cierre inesperado (unexpected-exit)'],
  ['shuffle', 'Modo aleatorio (shuffle)'],
  ['trackerror', 'Error de pista (trackerror)']
]);
export const reasonLabel = (code) => REASON_LABELS.get(code) ?? code;

export function sortedMonths(map) {
  return [...map.keys()].sort((a, b) => a - b);
}

function nextMonth(mi) {
  const y = Math.floor(mi / 100);
  const m = mi % 100;
  return m === 12 ? (y + 1) * 100 + 1 : mi + 1;
}

export function monthlySeries(monthMap, key) {
  if (!monthMap) return [];
  return fillMonths(sortedMonths(monthMap)).map((mi) => ({
    label: monthLabel(mi),
    y: monthMap.get(mi)?.get(key) ?? 0
  }));
}

// Preserve elapsed time on the x-axis when months have no activity.
export function fillMonths(keys) {
  if (keys.length === 0) return [];
  const out = [];
  let mi = keys[0];
  for (const k of keys) {
    while (mi < k) {
      out.push(mi);
      mi = nextMonth(mi);
    }
    out.push(k);
    mi = nextMonth(k);
  }
  return out;
}
