import {
  barChart, lineChart, heatmap, heatmapTable, sparkline,
  calendarGrid, listeningClock, stackedBar, heatLegend, NO_DATA,
  esc, fmtNum, fmtMs, fmtPct, fmtBytes, makeScale, MONTHS_SHORT, DOW_SHORT, DOW_LONG, PALETTE
} from '../src/charts.js';
import { matchRangeShortcut, rangeChipLabel } from './filter-ui.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';
import { queryCatalog } from '../src/query.js';
import { catalogTableHTML, paginationControlsHTML, densityControlsHTML, columnsPickerHTML } from './catalog-table.js';
import { calendarInspectorHTML, calendarMonthViewHTML, calendarScaleToggleHTML } from './calendar-ui.js';
import { compareView } from './compare-view.js';
import { formatSemanticRoute, formatTrackFromAlbum } from './routes.js';
import { describeCatalogQuery } from './catalog-query.js';
import { createChartContract, renderChartWithContract } from '../src/chart-contract.js';
import { scrollChart, contractedLineChart, contractedBarChart, contractedClockChart } from './chart-view.js';

const CHEVRON_SVG = '<svg class="chevron" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';

function card(title, body, cls = '', titleHtml = false) {
  const h = title ? `<h2>${titleHtml ? title : esc(title)}</h2>` : '';
  return `<section class="card ${cls}">${h}${body}</section>`;
}

function limitSelect(key, currentLimit, label) {
  return `<select class="table-limit" name="limit-${esc(key)}" autocomplete="off" data-table-limit="${esc(key)}" aria-label="${esc(label)}">${[10, 25, 50, 100].map((n) => `<option value="${n}"${currentLimit === n ? ' selected' : ''}>Top ${n}</option>`).join('')}</select>`;
}

function cardWithLimit(title, key, limit, body, cls = '', catalogHref = '') {
  const content = limit >= 25
    ? body.replace('class="table-scroll"', 'class="table-scroll table-scroll--tall"')
    : body;
  const catalog = catalogHref ? `<p><a href="${esc(catalogHref)}">Ver todos en Explorar</a></p>` : '';
  return `<section class="card ${cls}"><div class="card-head"><h2>${esc(title)}</h2>${limitSelect(key, limit, `Cantidad en ${title}`)}</div>${content}${catalog}</section>`;
}

function catalogHref(ctx, tab, sort, thresholdKey, threshold) {
  const params = new URLSearchParams((ctx.query ?? '').replace(/^\?/, ''));
  params.set('tab', tab);
  params.set('sort', sort);
  params.set('dir', sort === 'lowSkipRate' || sort === 'forgotten' ? 'asc' : 'desc');
  if (thresholdKey) params.set(thresholdKey, String(threshold));
  return `#/v1/explore?${params}`;
}

function resolveLimit(ctx, key, fallback = 10) {
  const store = ctx?.limits ?? ctx?.tableLimits;
  if (!store) return fallback;
  const val = store instanceof Map ? store.get(key) : store[key];
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

// Escape user strings before interpolation; `value` is trusted HTML.
function kpis(items, layout = '') {
  return `<dl class="kpis${layout ? ` ${layout}` : ''}">${items.map((it) => {
    if (it.heading) return `<div class="kpi-group-heading" role="presentation"><span>${esc(it.heading)}</span></div>`;
    return `
    <div class="kpi${it.text ? ' kpi-text' : ''}"><dt>${esc(it.label)}</dt><dd>${it.value}${it.sub ? `<span class="kpi-sub">${esc(it.sub)}</span>` : ''}</dd></div>`;
  }).join('')}</dl>`;
}

function fmtLocal(loc) {
  const c = civilFromDays(Math.floor(loc / 86400));
  const sec = ((loc % 86400) + 86400) % 86400;
  const h = Math.floor(sec / 3600);
  const mi = Math.floor((sec % 3600) / 60);
  return `${c.d} ${MONTHS_SHORT[c.m - 1]} ${c.y}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function fmtDay(day) {
  const c = civilFromDays(day);
  return `${c.d} ${MONTHS_SHORT[c.m - 1]} ${c.y}`;
}

function monthLabel(mi) {
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
const reasonLabel = (code) => REASON_LABELS.get(code) ?? code;

function thresholdLabel(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1).replace('.', ',')} s`;
}

function calendarTable(days, year, byMs = true) {
  const byMonthDay = new Map(days.map((d) => {
    const [, m, dd] = d.date.split('-').map(Number);
    return [`${m}-${dd}`, d.value];
  }));
  const cells = [];
  for (let m = 1; m <= 12; m++) {
    for (let dd = 1; dd <= 31; dd++) {
      const v = byMonthDay.get(`${m}-${dd}`);
      if (v != null) cells.push({ x: dd - 1, y: m - 1, value: v });
    }
  }
  return heatmapTable({
    cells,
    xLabels: Array.from({ length: 31 }, (_, i) => `${i + 1}`),
    yLabels: MONTHS_SHORT,
    cellText: (c) => (byMs ? fmtMs(c.value) : fmtNum(c.value)),
    caption: `${byMs ? 'Tiempo escuchado' : 'Reproducciones'} por día en ${year}`
  });
}

// Escape data before adding markup to rows; captions keep tables named on scroll.
function table(headers, rows, cls = '', colClasses = [], rowAttrs = null, caption = '', scrollCls = '', emptyNotice = '') {
  const th = (h, i) => `<th scope="col"${colClasses[i] ? ` class="${colClasses[i]}"` : ''}>${esc(h)}</th>`;
  const td = (c, i) => `<td${colClasses[i] ? ` class="${colClasses[i]}"` : ''}>${c}</td>`;
  const cap = caption ? `<caption class="visually-hidden">${esc(caption)}</caption>` : '';
  const wrapCls = scrollCls ? `table-scroll ${scrollCls}` : 'table-scroll';
  const emptyHTML = rows.length === 0 && emptyNotice ? `<p class="empty">${esc(emptyNotice)}</p>` : '';
  return `<div class="${wrapCls}"><table class="${cls}">${cap}<thead><tr>${headers.map(th).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr${rowAttrs ? rowAttrs(r, i) : ''}>${r.map(td).join('')}</tr>`).join('')}</tbody></table>${emptyHTML}</div>`;
}

function rankTable(rows, { valueFmt = fmtNum, subValue = null, link = null, valueLabel = 'Reproducciones', caption = '', spark = null, tall = false }) {
  const cell = (r) => {
    const full = r.sub ? `${r.name} — ${r.sub}` : r.name;
    const inner = r.sub
      ? `<span class="cell-name">${esc(r.name)}</span> <span class="cell-sub">${esc(r.sub)}</span>`
      : `<span class="cell-name">${esc(r.name)}</span>`;
    return link
      ? `<a class="cell-link" href="${esc(link(r))}" title="${esc(full)}">${inner}</a>`
      : `<span class="cell-link" title="${esc(full)}">${inner}</span>`;
  };
  const max = rows.length > 0 ? rows[0].value : 0;
  const headers = spark ? ['#', 'Nombre', 'Tendencia', valueLabel] : ['#', 'Nombre', valueLabel];
  const colCls = spark ? ['c', '', 'col-trend', 'n col-metric'] : ['c', '', 'n col-metric'];
  return table(headers, rows.map((r, i) => {
    const base = [String(i + 1), cell(r)];
    const formattedVal = valueFmt(r.value);
    const subSpan = subValue ? `<span class="cell-metric-sub">${esc(subValue(r))}</span>` : '';
    if (spark) {
      const pts = spark(r, i);
      const hasPts = pts.some((v) => v > 0);
      base.push(hasPts ? sparkline({ points: pts, width: 80, height: 24 }) : '');
      const mobileSpark = hasPts
        ? `<span class="cell-spark-mobile">${sparkline({ points: pts, width: 68, height: 18 })}</span>`
        : '';
      base.push(`<div class="cell-metric-stack"><span class="cell-metric-val">${formattedVal}</span>${subSpan}${mobileSpark}</div>`);
    } else if (subSpan) {
      base.push(`<div class="cell-metric-stack"><span class="cell-metric-val">${formattedVal}</span>${subSpan}</div>`);
    } else {
      base.push(formattedVal);
    }
    return base;
  }), 'rank-table', colCls, (r, i) => {
    const w = max > 0 ? ((rows[i].value / max) * 100).toFixed(1) : '0';
    return ` style="--bar-w:${w}%"`;
  }, caption, tall ? 'table-scroll--tall' : '');
}

// The link title exposes truncated text when hover tooltips are unavailable.
function entityLinks(model, query = '') {
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

function topEntityInMap(map, ignoreZero = false) {
  let best = null;
  for (const entry of map.entries()) {
    if (ignoreZero && entry[0] === 0) continue;
    if (!best || entry[1] > best[1]) best = entry;
  }
  return best;
}

function paretoShare(list, n, byMs, total) {
  if (total <= 0 || list.length === 0) return '—';
  let sum = 0;
  const cap = Math.min(list.length, n);
  for (let i = 0; i < cap; i++) sum += byMs ? list[i].ms : list[i].plays;
  return fmtPct(sum / total);
}

function sortedMonths(map) {
  return [...map.keys()].sort((a, b) => a - b);
}

function nextMonth(mi) {
  const y = Math.floor(mi / 100);
  const m = mi % 100;
  return m === 12 ? (y + 1) * 100 + 1 : mi + 1;
}

// Preserve elapsed time on the x-axis when months have no activity.
function fillMonths(keys) {
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

function monthlySeries(monthMap, key) {
  if (!monthMap) return [];
  return fillMonths(sortedMonths(monthMap)).map((mi) => ({
    label: monthLabel(mi),
    y: monthMap.get(mi)?.get(key) ?? 0
  }));
}

function albumSeries(model, monthly, metric) {
  if (!model?.monthly || !monthly) return [];
  return fillMonths(sortedMonths(model.monthly)).map((mi) => ({
    label: monthLabel(mi),
    y: monthly.get(mi)?.[metric] ?? 0
  }));
}

// Album series keep their own attribution for tracks shared by releases.
function rowSeries(model, tab, metric, id) {
  if (tab === 'albums') {
    const al = model.albums.byId.get(id);
    if (!al) return [];
    return albumSeries(model, al.monthly, metric).map((point) => point.y);
  }
  const map = tab === 'artists'
    ? (metric === 'ms' ? model.monthlyArtistMs : model.monthlyArtistPlays)
    : (metric === 'ms' ? model.monthlyTrackMs : model.monthlyTrackPlays);
  return monthlySeries(map, id).map((p) => p.y);
}

function pctOf(part, total) {
  return total > 0 ? fmtPct(part / total) : '—';
}

function deltaSub(now, before) {
  if (before <= 0) return 'anterior sin datos';
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs período anterior`;
}

// Resolve ties by keeping the first maximum.
function maxEntry(map, getVal) {
  let best = null;
  for (const entry of map.entries()) if (!best || getVal(entry[1]) > getVal(best[1])) best = entry;
  return best;
}

function recordsGridHTML(model, ctx = {}) {
  const { trackSubLink } = entityLinks(model, ctx.query);
  const tiles = [];
  const day = maxEntry(model.daily, (v) => v.ms);
  if (day) {
    tiles.push({
      label: 'Día más intenso',
      val: esc(fmtMs(day[1].ms)),
      meta: esc(`${fmtDay(day[0])} · ${fmtNum(day[1].plays)} rep.`)
    });
  }
  const month = maxEntry(model.monthly, (v) => v.ms);
  if (month) {
    tiles.push({
      label: 'Mes más intenso',
      val: esc(fmtMs(month[1].ms)),
      meta: esc(`${monthLabel(month[0])} · ${fmtNum(month[1].plays)} rep.`)
    });
  }
  const sess = model.tables.sessions.byDuration[0];
  if (sess) {
    tiles.push({
      label: 'Sesión más larga',
      val: esc(fmtMs(sess.duration * 1000)),
      meta: esc(`${fmtLocal(sess.start)} · ${fmtNum(sess.plays)} rep.`)
    });
  }
  const run = maxEntry(model.maxRun, (v) => v);
  if (run) {
    const tr = model.tracks.byId.get(run[0]);
    tiles.push({
      label: 'Maratón de una canción',
      val: esc(`${fmtNum(run[1])} seguidas`),
      meta: tr ? trackSubLink(run[0], tr.name, tr.artist) : '—'
    });
  }
  tiles.push({
    label: 'Días con escucha',
    val: esc(`${fmtNum(model.daily.size)} días`),
    meta: esc(`${fmtNum(model.zeroDays.length)} días sin registros entre primera y última escucha`)
  });
  return `<div class="records-grid">${tiles.map((t) => `<div class="record-item"><span class="record-label">${esc(t.label)}</span><span class="record-value">${t.val}</span><span class="record-sub">${t.meta}</span></div>`).join('')}</div>`;
}

export function listenerArchetype(model) {
  const t = model.totals;
  if (!t || t.records === 0) return null;
  const skipRate = t.skippedKnown ? t.skipped / t.skippedKnown : 0;
  const c = model.concentration.artists;
  if (!c.knownEntities) return null;
  const repeatRate = model.intraSession.repeatedPlays / t.records;
  let dom = 0;
  model.blocks.forEach((b, i) => { if (b.plays > model.blocks[dom].plays) dom = i; });
  const base = skipRate >= 0.35 ? 'Explorador' : c.hhi >= 0.08 ? 'Devoto' : 'Equilibrado';
  const when = dom === 0 || dom === 3 ? 'nocturno' : dom === 1 ? 'matutino' : 'vespertino';
  return {
    label: `${base} ${when}`,
    detail: `${pctOf(t.skipped, t.skippedKnown)} de saltos · ${fmtPct(c.hhi)} de concentración · ${fmtPct(repeatRate)} de repeticiones`
  };
}

export function rankCardHTML(model, opts = {}) {
  const tab = opts.tab ?? 'artists';
  const metric = opts.metric ?? 'plays';
  const topN = opts.topN ?? 10;
  const query = (opts.query ?? '').trim().toLowerCase();
  const byMs = metric === 'ms';
  const valueFmt = byMs ? fmtMs : fmtNum;
  const valueLabel = byMs ? 'Tiempo' : 'Reproducciones';

  const source = tab === 'artists' ? model.artists.top[byMs ? 'byMs' : 'byPlays']
    : tab === 'tracks' ? model.tracks.top[byMs ? 'byMs' : 'byPlays']
    : model.albums.top[byMs ? 'byMs' : 'byPlays'];

  const rowOf = tab === 'artists'
    ? (a) => ({ name: a.name, value: byMs ? a.ms : a.plays, id: a.id, link: formatSemanticRoute('artist', a, opts.contextQuery) })
    : tab === 'tracks'
      ? (tr) => ({ name: tr.name, value: byMs ? tr.ms : tr.plays, id: tr.tk, hay: `${tr.name} ${tr.artist}`.toLowerCase(), link: formatSemanticRoute('track', tr, opts.contextQuery) })
      : (al) => ({ name: al.name, sub: al.artist, value: byMs ? al.ms : al.plays, id: al.id, hay: `${al.name} ${al.artist}`.toLowerCase(), link: formatSemanticRoute('album', al, opts.contextQuery) });

  let rows;
  if (query) {
    // Search spans the full catalog, not just the displayed ranking.
    const pool = tab === 'artists' ? [...model.artists.byId.values()]
      : tab === 'tracks' ? [...model.tracks.byId.values()]
      : [...model.albums.byId.values()];
    rows = pool.map(rowOf)
      .filter((r) => (r.hay ?? r.name.toLowerCase()).includes(query))
      .sort((a, b) => b.value - a.value)
      .slice(0, topN);
  } else {
    rows = source.map(rowOf).slice(0, topN);
  }

  // Automatic tab activation follows focus, with one tab stop per tablist.
  const tabBtn = (id, label) => `<button type="button" role="tab" id="rank-tab-${id}" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" class="${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
  const metricBtn = (id, label) => `<button type="button" aria-pressed="${metric === id}" class="${metric === id ? 'active' : ''}" data-metric="${id}">${label}</button>`;
  const tabName = tab === 'artists' ? 'artistas' : tab === 'tracks' ? 'canciones' : 'álbumes';
  const rankCaption = query
    ? `Resultados de búsqueda en ${tabName}`
    : `Ranking de ${tabName} por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`;
  const exploreParams = new URLSearchParams((opts.contextQuery ?? '').replace(/^\?/, ''));
  exploreParams.set('tab', tab);
  exploreParams.set('m', metric);

  return `
    <div class="rank-controls">
      <div class="tabs" role="tablist" aria-label="Rankings">
        ${tabBtn('artists', 'Artistas')}${tabBtn('tracks', 'Canciones')}${tabBtn('albums', 'Álbumes')}
      </div>
      <div class="rank-opts">
        <div class="tabs" role="group" aria-label="Métrica">
          ${metricBtn('plays', 'Por reproducciones')}${metricBtn('ms', 'Por tiempo')}
        </div>
        <select name="rank-topn" autocomplete="off" data-topn aria-label="Cantidad">
          ${[10, 25, 50, 100].map((n) => `<option value="${n}" ${topN === n ? 'selected' : ''}>Top ${n}</option>`).join('')}
        </select>
        <input type="search" name="rank-search" autocomplete="off" spellcheck="false" data-search placeholder="Buscar…" aria-label="Buscar en rankings" value="${esc(opts.query ?? '')}">
      </div>
    </div>
    <div role="tabpanel" id="rank-panel" tabindex="0" aria-labelledby="rank-tab-${tab}">${rows.length
      ? rankTable(rows, {
        valueFmt,
        valueLabel,
        link: (r) => r.link,
        caption: rankCaption,
        spark: (r) => rowSeries(model, tab, metric, r.id),
        tall: topN >= 25
      }) + `<div class="explore-header-links"><a class="table-hint-link" href="#/v1/explore?${esc(exploreParams.toString())}">Ver catálogo completo de ${tabName} en Explorar →</a></div>`
      : '<p class="empty">Sin resultados.</p>'}</div>`;
}

const WARNING_LABELS = {
  EPISODE: ['episodio de podcast', 'episodios de podcast'],
  NO_TS: ['evento sin fecha', 'eventos sin fecha'],
  BAD_TS: ['evento con fecha inválida', 'eventos con fecha inválida'],
  NO_TRACK: ['evento sin canción', 'eventos sin canción'],
  BAD_MS: ['evento con duración inválida', 'eventos con duración inválida']
};

export function footerMetaText(model) {
  const sourcesCount = model.meta.sources.length;
  const filesLabel = sourcesCount === 1 ? 'archivo' : 'archivos';
  const parts = [`${fmtNum(sourcesCount)} ${filesLabel}`, fmtBytes(model.meta.bytesRead)];
  const warnings = model.meta.warnings ?? [];
  const ignored = warnings.filter((warning) => warning.code !== 'OVERLAPPING_SOURCES' && warning.code !== 'BAD_MS');
  const invalidDurations = warnings.filter((warning) => warning.code === 'BAD_MS').length;
  if (invalidDurations) parts.push(`${fmtNum(invalidDurations)} duraciones inválidas tratadas como desconocidas`);
  if (ignored.length) {
    const byCode = new Map();
    for (const warning of ignored) byCode.set(warning.code, (byCode.get(warning.code) || 0) + 1);
    const items = [...byCode].map(([code, count]) => {
      const labels = WARNING_LABELS[code];
      return `${fmtNum(count)} ${labels ? labels[count === 1 ? 0 : 1] : code}`;
    });
    parts.push(`${items.join(', ')} ${ignored.length === 1 ? 'ignorado' : 'ignorados'}`);
  }
  if (warnings.some((warning) => warning.code === 'OVERLAPPING_SOURCES')) {
    parts.push('Aviso: hay archivos con períodos solapados; se concatenan sin eliminar posibles duplicados.');
  }
  return parts.join(' · ');
}

// Distinguish empty data from results hidden by active filters.
export function emptyFiltersHTML() {
  return `<section class="card"><h2>Sin resultados</h2>
    <p class="empty">Ningún resultado coincide con los filtros activos.</p>
    <p><button type="button" class="btn btn-secondary" data-action="clear">Quitar filtros</button></p>
  </section>`;
}

export function dashboard(model, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const t = model.totals;
  const prev = ctx.prev ?? null;
  const byMs = (ctx.metric ?? 'ms') === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const range = model.meta.firstTs != null
    ? `${fmtLocal(model.meta.firstTs)} → ${fmtLocal(model.meta.lastTs)}`
    : '—';

  const heatCells = [];
  let maxVal = 0;
  const heatSrc = byMs ? model.dayHourMs : model.dayHour;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = heatSrc[d * 24 + h];
      if (v > maxVal) maxVal = v;
      heatCells.push({ x: h, y: d, value: v });
    }
  }
  const heat = heatmap({
    cells: heatCells,
    width: 640, height: 190,
    colorScale: makeScale(maxVal),
    xLabels: [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `${h}`),
    yLabels: DOW_SHORT,
    cellTitle: (c) => `${DOW_LONG[c.y]} ${c.x}:00 — ${valFmt(c.value)}`,
    ariaLabel: `Actividad por hora del día y día de la semana (${byMs ? 'tiempo escuchado' : 'reproducciones'})`
  });
  const heatTable = heatmapTable({
    cells: heatCells,
    xLabels: Array.from({ length: 24 }, (_, h) => `${h}`),
    yLabels: DOW_SHORT,
    cellText: (c) => valFmt(c.value),
    caption: byMs ? 'Tiempo escuchado por hora y día' : 'Reproducciones por hora y día'
  });
  const heatChart = renderChartWithContract(createChartContract({
    id: 'dashboard-day-hour',
    title: 'Cuándo escuchás (día y hora)',
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'eventos con duración conocida' : 'eventos registrados',
    data: heatCells.map((cell) => ({
      label: `${DOW_LONG[cell.y]} ${cell.x}:00`,
      value: cell.value,
      extra: { x: cell.x, y: cell.y }
    })),
    format: valFmt,
    showShare: false,
    chartType: 'grid',
    fallbackTable: heatTable
  }), `<div class="chart-scroll chart-scroll--heat" tabindex="0" role="region" aria-label="Actividad por hora y día de la semana">${heat}</div>${heatLegend()}`);

  const monthly = fillMonths(sortedMonths(model.monthly)).map((mi) => ({
    label: monthLabel(mi),
    y: model.monthly.get(mi)?.[byMs ? 'ms' : 'plays'] ?? 0
  }));
  const evolution = contractedLineChart({
    id: 'dashboard-monthly', title: 'Evolución mensual', points: monthly, format: valFmt,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida' : 'eventos registrados'
  });

  const dist = contractedBarChart({
    id: 'dashboard-duration-distribution', title: 'Duración de reproducciones',
    data: t.msDist.map((b) => ({ label: b.label, value: b.count })),
    format: fmtNum, unit: 'reproducciones', base: 'reproducciones con duración conocida', orientation: 'horizontal'
  });

  const rankings = `<div id="rank-card">${rankCardHTML(model, { ...ctx.rankUI, contextQuery: ctx.query })}</div>`;

  const skipRate = t.skippedKnown > 0
    ? `${fmtPct(t.skipped / t.skippedKnown)} (${fmtNum(t.skippedKnown)} conocidas · ${fmtNum(t.records - t.skippedKnown)} desconocidas)`
    : '—';
  const shuffleRate = t.shuffleKnown > 0
    ? `${fmtPct(t.shuffle / t.shuffleKnown)} (${fmtNum(t.shuffleKnown)} conocidas · ${fmtNum(t.records - t.shuffleKnown)} desconocidas)`
    : '—';
  const offlineRate = t.offlineKnown > 0
    ? `${fmtPct(t.offline / t.offlineKnown)} (${fmtNum(t.offlineKnown)} conocidas · ${fmtNum(t.records - t.offlineKnown)} desconocidas)`
    : '—';
  const avgDuration = t.avgMs;

  const obsLimit = resolveLimit(ctx, 'dash-obsession', 10);
  const bingeLimit = resolveLimit(ctx, 'dash-binge', 10);
  const skipArtLimit = resolveLimit(ctx, 'dash-skip-art', 10);
  const skipTrkLimit = resolveLimit(ctx, 'dash-skip-trk', 10);
  const lowSkipArtLimit = resolveLimit(ctx, 'dash-lowskip-art', 10);
  const lowSkipTrkLimit = resolveLimit(ctx, 'dash-lowskip-trk', 10);
  const firstLimit = resolveLimit(ctx, 'dash-first', 10);
  const lastLimit = resolveLimit(ctx, 'dash-last', 10);

  const qualityPanel = `
    <details class="card quality-panel">
      <summary class="quality-summary"><strong>Panel de calidad y cobertura de datos</strong></summary>
      <div class="quality-body">
        <p class="view-meta">Fuentes: ${esc((model.meta.sources || []).join(', ') || 'Sin archivo especificado')} (${fmtNum(model.meta.records)} registros). Zona horaria: ${esc(model.meta.tzId)}.</p>
        <p class="view-meta">Rango observado: ${esc(range)}. La ausencia de registros entre fechas no garantiza cobertura continua de escucha.</p>
        <p class="view-meta">Duración desconocida: ${fmtNum(t.durationUnknown)} registros excluidos de medias, umbrales y distribución. Banderas desconocidas: saltadas ${fmtNum(t.records - t.skippedKnown)}, aleatorio ${fmtNum(t.records - t.shuffleKnown)}, sin conexión ${fmtNum(t.records - t.offlineKnown)}. Las tasas usan únicamente valores con banderas conocidas. Mínimo de 20 eventos conocidos para calificar en rankings de saltos.</p>
        <p class="view-meta">Atribución temporal: Toda actividad horaria o diaria se asigna al timestamp de finalización del evento; no representa una reconstrucción minuto a minuto de reproducciones que cruzan horas o días.</p>
        ${model.meta.warnings && model.meta.warnings.length > 0 ? `<p class="view-meta">Advertencias: ${esc(model.meta.warnings.map((w) => w.message || w.code).join('; '))}</p>` : ''}
      </div>
    </details>`;

  return `
    <header class="view-header view-header--compact">
      <h1>Resumen</h1>
      <p class="view-meta view-range">${esc(range)}</p>
    </header>
    ${kpis([
      { heading: 'Actividad' },
      { label: 'Reproducciones', value: fmtNum(t.records), sub: prev ? deltaSub(t.records, prev.records) : undefined },
      { label: 'Tiempo escuchado', value: fmtMs(t.ms), sub: prev ? deltaSub(t.ms, prev.ms) : undefined },
      { label: 'Artistas', value: fmtNum(model.artists.byId.size) },
      { label: 'Canciones', value: fmtNum(model.tracks.byId.size) },
      { label: 'Álbumes', value: fmtNum(model.albums.byId.size) },
      { label: 'Sesiones', value: fmtNum(model.sessionsStats.count) },
      { heading: 'Continuidad' },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—', sub: model.streak.start != null ? `${fmtDay(model.streak.start)} → ${fmtDay(model.streak.end)}` : undefined },
      { label: 'Duración promedio', value: avgDuration == null ? '—' : fmtMs(avgDuration), sub: `mediana ${t.medianMs == null ? '—' : fmtMs(t.medianMs)}` },
      { label: 'Reproducciones significativas', value: fmtNum(t.playsSignificant), sub: `≥${thresholdLabel(model.meta.minMs)}` },
      { label: 'Reproducciones cortas', value: fmtNum(t.playsSkipped), sub: `<${thresholdLabel(model.meta.skipThresholdMs)}` },
      { heading: 'Comportamiento' },
      { label: 'Final con código trackdone', value: fmtNum(t.completed), sub: `${fmtNum(t.interrupted)} otros finales · ${fmtNum(t.endReasonUnknown)} desconocidos` },
      { label: 'Saltadas', value: fmtNum(t.skipped), sub: skipRate },
      { label: 'En aleatorio', value: fmtNum(t.shuffle), sub: shuffleRate },
      { label: 'Sin conexión', value: fmtNum(t.offline), sub: offlineRate }
    ])}
    ${qualityPanel}
    ${card('Récords', recordsGridHTML(model, ctx))}
    ${card('Rankings', rankings)}
    <div class="grid-2">
      ${evolution}
      ${dist}
    </div>
    ${heatChart}
    <div class="grid-2">
      ${cardWithLimit('Obsesión (reproducciones por día activo)', 'dash-obsession', obsLimit, table(['#', 'Canción', 'Intensidad', 'Días', 'Reproducciones', 'Tiempo'], model.tables.obsession.slice(0, obsLimit).map((o, i) => [
        String(i + 1),
        trackSubLink(o.tk, o.name, o.artist),
        o.intensity.toLocaleString('es-ES', { maximumFractionDigits: 1 }),
        fmtNum(o.days.size),
        fmtNum(o.plays),
        fmtMs(o.ms)
      ]), '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Canciones más escuchadas por día activo'), '', catalogHref(ctx, 'tracks', 'intensity', 'minPlays', 15))}
      ${cardWithLimit('Rachas (misma canción seguida)', 'dash-binge', bingeLimit, table(['#', 'Canción', 'Racha', 'Reproducciones'], model.tables.binge.slice(0, bingeLimit).map((b, i) => [
        String(i + 1),
        trackSubLink(b.tk, b.track.name, b.track.artist),
        fmtNum(b.run),
        fmtNum(b.track.plays)
      ]), '', ['c', '', 'n', 'n'], null, 'Canciones repetidas en racha'))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Mayor tasa de salto — Artistas', 'dash-skip-art', skipArtLimit, table(['#', 'Artista', 'Saltadas / Conocidas', 'Total', 'Desconocidas', 'Tasa'], model.tables.skipRate.artists.slice(0, skipArtLimit).map((a, i) => [
        String(i + 1),
        entityLink('artist', a.id, a.name),
        `${fmtNum(a.skips)} / ${fmtNum(a.skipKnown)}`,
        fmtNum(a.plays),
        fmtNum(a.plays - a.skipKnown),
        fmtPct(a.skips / a.skipKnown)
      ]), '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Artistas con mayor tasa de salto (mínimo 20 banderas conocidas)', '', 'Sin artistas con al menos 20 reproducciones conocidas (mínimo de muestra elegible).'), '', catalogHref(ctx, 'artists', 'skipRate', 'minPlays', 20))}
      ${cardWithLimit('Mayor tasa de salto — Canciones', 'dash-skip-trk', skipTrkLimit, table(['#', 'Canción', 'Saltadas / Conocidas', 'Total', 'Desconocidas', 'Tasa'], model.tables.skipRate.tracks.slice(0, skipTrkLimit).map((tr, i) => [
        String(i + 1),
        trackSubLink(tr.tk, tr.name, tr.artist),
        `${fmtNum(tr.skips)} / ${fmtNum(tr.skipKnown)}`,
        fmtNum(tr.plays),
        fmtNum(tr.plays - tr.skipKnown),
        fmtPct(tr.skips / tr.skipKnown)
      ]), '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Canciones con mayor tasa de salto (mínimo 20 banderas conocidas)', '', 'Sin canciones con al menos 20 reproducciones conocidas (mínimo de muestra elegible).'), '', catalogHref(ctx, 'tracks', 'skipRate', 'minPlays', 20))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Menor tasa de salto — Artistas', 'dash-lowskip-art', lowSkipArtLimit, table(['#', 'Artista', 'Saltadas / Conocidas', 'Total', 'Desconocidas', 'Tasa'], (model.tables.lowSkipRate?.artists ?? []).slice(0, lowSkipArtLimit).map((a, i) => [
        String(i + 1),
        entityLink('artist', a.id, a.name),
        `${fmtNum(a.skips)} / ${fmtNum(a.skipKnown)}`,
        fmtNum(a.plays),
        fmtNum(a.plays - a.skipKnown),
        fmtPct(a.skips / a.skipKnown)
      ]), '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Artistas con menor tasa de salto (mínimo 20 banderas conocidas)', '', 'Sin artistas con al menos 20 reproducciones conocidas (mínimo de muestra elegible).'), '', catalogHref(ctx, 'artists', 'lowSkipRate', 'minPlays', 20))}
      ${cardWithLimit('Menor tasa de salto — Canciones', 'dash-lowskip-trk', lowSkipTrkLimit, table(['#', 'Canción', 'Saltadas / Conocidas', 'Total', 'Desconocidas', 'Tasa'], (model.tables.lowSkipRate?.tracks ?? []).slice(0, lowSkipTrkLimit).map((tr, i) => [
        String(i + 1),
        trackSubLink(tr.tk, tr.name, tr.artist),
        `${fmtNum(tr.skips)} / ${fmtNum(tr.skipKnown)}`,
        fmtNum(tr.plays),
        fmtNum(tr.plays - tr.skipKnown),
        fmtPct(tr.skips / tr.skipKnown)
      ]), '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Canciones con menor tasa de salto (mínimo 20 banderas conocidas)', '', 'Sin canciones con al menos 20 reproducciones conocidas (mínimo de muestra elegible).'), '', catalogHref(ctx, 'tracks', 'lowSkipRate', 'minPlays', 20))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Primera canción del día', 'dash-first', firstLimit, table(['#', 'Canción', 'Días'], model.tables.dayFirst.slice(0, firstLimit).map((d, i) => [
        String(i + 1),
        trackSubLink(d.tk, d.track.name, d.track.artist),
        fmtNum(d.count)
      ]), '', ['c', '', 'n'], null, 'Canción con la que arranca cada día'))}
      ${cardWithLimit('Última canción del día', 'dash-last', lastLimit, table(['#', 'Canción', 'Días'], model.tables.dayLast.slice(0, lastLimit).map((d, i) => [
        String(i + 1),
        trackSubLink(d.tk, d.track.name, d.track.artist),
        fmtNum(d.count)
      ]), '', ['c', '', 'n'], null, 'Canción con la que cierra cada día'))}
    </div>`;
}

export function artistView(model, ar, ctx = {}) {
  const { entityLink } = entityLinks(model, ctx.query);
  const a = model.artists.byId.get(ar);
  if (!a) return `<p class="empty">Artista no encontrado.</p>`;
  const byMs = ctx?.metric === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const valLabel = byMs ? 'Tiempo' : 'Reproducciones';
  const totalMs = model.totals.ms;
  const tracksLimit = resolveLimit(ctx, 'artist-tracks', 10);
  const albumsLimit = resolveLimit(ctx, 'artist-albums', 10);
  const transLimit = resolveLimit(ctx, 'artist-trans', 10);

  const topTracks = [...model.tracks.byId.entries()]
    .filter(([tk]) => tk % 4294967296 === ar)
    .map(([tk, tr]) => ({ tk, tr }))
    .sort((x, y) => (byMs ? y.tr.ms - x.tr.ms || y.tr.plays - x.tr.plays : y.tr.plays - x.tr.plays || y.tr.ms - x.tr.ms))
    .slice(0, tracksLimit);
  const transitions = model.transitions.top
    .filter((x) => x.from === ar || x.to === ar)
    .slice(0, transLimit);

  const evolution = contractedLineChart({
    id: 'artist-monthly', title: 'Evolución mensual',
    points: monthlySeries(byMs ? model.monthlyArtistMs : model.monthlyArtistPlays, ar),
    format: valFmt,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida de este artista' : 'reproducciones de este artista'
  });

  const albumRows = [...a.albums]
    .map((ak) => model.albums.byId.get(ak))
    .filter(Boolean)
    .sort((x, y) => (byMs ? y.ms - x.ms || y.plays - x.plays : y.plays - x.plays || y.ms - x.ms))
    .slice(0, albumsLimit)
    .map((al) => ({ name: al.name, value: byMs ? al.ms : al.plays, plays: al.plays, ms: al.ms, id: al.id }));

  const clockSrc = byMs && a.clockMs ? a.clockMs : a.clock;
  const clockCells = [];
  let maxVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = clockSrc[d * 24 + h];
      if (v > maxVal) maxVal = v;
      clockCells.push({ hour: h, dow: d, value: v });
    }
  }
  const clockChart = contractedClockChart({
    id: 'artist-week-clock',
    title: 'Tu semana con este artista',
    cells: clockCells,
    format: valFmt,
    byMs,
    base: byMs ? 'duración conocida de este artista' : 'reproducciones de este artista',
    svg: listeningClock({
      cells: clockCells,
      colorScale: makeScale(maxVal),
      cellTitle: (cell) => `${DOW_LONG[cell.dow]} ${cell.hour}:00 — ${byMs ? fmtMs(cell.value) : `${fmtNum(cell.value)} reproducciones`}`
    })
  });

  const firstTr = a.firstTrackTk ? model.tracks.byId.get(a.firstTrackTk) : null;

  return `
    <header class="view-header">
      <p><a href="#/dashboard${ctx.query ? (ctx.query.startsWith('?') ? ctx.query : '?' + ctx.query) : ''}">← Volver al resumen</a></p>
      <h1>${esc(a.name)}</h1>
      <p class="view-meta">${fmtNum(a.plays)} reproducciones · ${fmtMs(a.ms)} · ${pctOf(a.ms, totalMs)} del total</p>
      <p><button type="button" class="btn btn-secondary" data-filter-entity="artist:${ar}">Filtrar todo por este artista</button></p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(a.plays) },
      { label: 'Tiempo', value: fmtMs(a.ms) },
      { label: 'Canciones', value: fmtNum(a.tracks ? a.tracks.size : topTracks.length) },
      { label: 'Álbumes', value: fmtNum(a.albums.size) },
      { label: 'Saltadas', value: fmtNum(a.skips), sub: pctOf(a.skips, a.skipKnown) },
      { label: 'Días activos', value: fmtNum(a.days.size) },
      { label: 'Meses activos', value: fmtNum(a.months.size), sub: `${fmtNum(a.years.size)} años` },
      { label: 'Primera canción', value: firstTr ? entityLink('track', a.firstTrackTk, firstTr.name) : '—', text: true },
      { label: 'Primera escucha', value: fmtLocal(a.firstTs) },
      { label: 'Última escucha', value: fmtLocal(a.lastTs) }
    ], 'kpis--entity')}
    <div class="grid-2">
      ${evolution}
      ${cardWithLimit('Tus canciones de este artista', 'artist-tracks', tracksLimit, rankTable(topTracks.map(({ tr }) => ({ name: tr.name, value: byMs ? tr.ms : tr.plays, plays: tr.plays, ms: tr.ms, id: tr.tk })), {
        valueFmt: valFmt,
        subValue: (r) => (byMs ? `${fmtNum(r.plays)} rep.` : fmtMs(r.ms)),
        valueLabel: valLabel,
        link: (r) => formatSemanticRoute('track', model.tracks.byId.get(r.id), ctx.query),
        caption: `Canciones del artista por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`,
        spark: (r) => rowSeries(model, 'tracks', byMs ? 'ms' : 'plays', r.id)
      }))}
    </div>
    <div class="grid-2">
      ${clockChart}
      ${cardWithLimit('Álbumes de este artista', 'artist-albums', albumsLimit, albumRows.length
        ? rankTable(albumRows, {
          valueFmt: valFmt,
          subValue: (r) => (byMs ? `${fmtNum(r.plays)} rep.` : fmtMs(r.ms)),
          valueLabel: valLabel,
          link: (r) => formatSemanticRoute('album', model.albums.byId.get(r.id), ctx.query),
          caption: `Álbumes del artista por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`,
          spark: (r) => rowSeries(model, 'albums', byMs ? 'ms' : 'plays', r.id)
        })
        : '<p class="empty">Sin álbumes registrados.</p>')}
    </div>
    ${cardWithLimit('Transiciones', 'artist-trans', transLimit, transitions.length
      ? table(['#', 'De', 'A', 'Veces'], transitions.map((x, i) => [
          String(i + 1),
          x.from === ar ? `<strong>${esc(x.fromName)}</strong>` : entityLink('artist', x.from, x.fromName),
          x.to === ar ? `<strong>${esc(x.toName)}</strong>` : entityLink('artist', x.to, x.toName),
          fmtNum(x.count)
        ]), '', ['c', '', '', 'n'], null, 'Transiciones hacia y desde este artista')
      : '<p class="empty">Sin transiciones destacadas.</p>')}`;
}

export function trackView(model, tk, ctx = {}) {
  const { entityLink } = entityLinks(model, ctx.query);
  const tr = model.tracks.byId.get(tk);
  if (!tr) return `<p class="empty">Canción no encontrada.</p>`;
  const byMs = (ctx?.metric ?? 'ms') === 'ms';
  const totalMs = model.totals.ms;
  const ar = tk % 4294967296;

  const originStats = ctx.detail?.origin ?? null;
  const originAlbum = originStats ? model.albums.byId.get(originStats.id) : null;
  const originRequested = new URLSearchParams(ctx.rawQuery ?? '').has('originAlbum');

  const albumList = ctx.detail ? ctx.detail.rows.map(item => ({ ak: item.id, name: item.name, plays: item.plays, ms: item.ms })) : [...tr.albums]
    .map((ak) => {
      const al = model.albums.byId.get(ak);
      const st = al?.trackStats?.get(tk);
      return {
        ak,
        name: al ? al.name : '(Álbum desconocido)',
        plays: st ? st.plays : null,
        ms: st ? st.ms : null
      };
    })
    .sort((a, b) => b.plays - a.plays || b.ms - a.ms);

  const albumLinks = albumList
    .map((a) => a.ak ? entityLink('album', a.ak, a.name) : esc(a.name))
    .join(' · ');

  const run = model.maxRun?.get ? (model.maxRun.get(tk) ?? 0) : 0;
  const evolution = contractedLineChart({
    id: 'track-monthly', title: 'Evolución mensual',
    points: monthlySeries(byMs ? model.monthlyTrackMs : model.monthlyTrackPlays, tk),
    format: byMs ? fmtMs : fmtNum,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida de esta canción' : 'reproducciones de esta canción'
  });

  const scopeNotice = originAlbum && originStats
    ? `<div class="scope-notice card" style="margin-bottom:1rem;padding:0.75rem 1rem;border-left:4px solid var(--accent, #1db954);">
        <p style="margin:0 0 0.25rem 0;">
          <strong>Alcance: En este álbum</strong> (<strong>${esc(originAlbum.name)}</strong>: ${fmtNum(originStats.plays)} rep., ${fmtMs(originStats.ms)})
        </p>
        <p style="margin:0;font-size:0.9rem;color:var(--text-sub, #b3b3b3);">
          Totales como <strong>Canción agrupada</strong>: ${fmtNum(tr.plays)} reproducciones · ${fmtMs(tr.ms)}.
          <a href="${esc(formatSemanticRoute('track', tr, ctx.query))}">Ver ficha global de la canción agrupada</a>
        </p>
       </div>`
    : (originRequested
      ? '<p class="empty">El álbum de origen no está disponible en la selección actual.</p>'
      : (ctx.detail?.total ?? albumList.length) > 1
      ? `<div class="scope-notice card" style="margin-bottom:1rem;padding:0.75rem 1rem;">
          <p style="margin:0;font-size:0.9rem;color:var(--text-sub, #b3b3b3);">
            <strong>Canción agrupada:</strong> consolida ${fmtNum(tr.plays)} reproducciones a través de ${fmtNum(ctx.detail?.total ?? albumList.length)} atribuciones de álbum.
          </p>
         </div>`
      : '');

  const albumsCard = albumList.length > 0
    ? card('Álbumes asociados', table(
        ['Álbum', 'Reproducciones', 'Tiempo', 'Cuota de la canción'],
        albumList.map((a) => [
          a.ak ? entityLink('album', a.ak, a.name) : esc(a.name),
          a.plays == null ? '—' : fmtNum(a.plays),
          a.ms == null ? '—' : fmtMs(a.ms),
          a.plays == null ? '—' : pctOf(a.plays, tr.plays)
        ]),
        '', ['cell-name', 'n', 'n', 'n'], null, 'Atribución por álbum'
      ) + (ctx.detail && ctx.detail.total > ctx.detail.pageSize ? `<nav class="pagination" aria-label="Paginación de álbumes"><div class="pagination-actions">
        <button type="button" class="btn btn-sm btn-page" data-detail-page="${ctx.detail.page - 1}"${ctx.detail.page <= 1 ? ' disabled' : ''}>Anterior</button>
        <span class="pagination-current">Página ${fmtNum(ctx.detail.page)} de ${fmtNum(Math.ceil(ctx.detail.total / ctx.detail.pageSize))}</span>
        <button type="button" class="btn btn-sm btn-page" data-detail-page="${ctx.detail.page + 1}"${ctx.detail.page * ctx.detail.pageSize >= ctx.detail.total ? ' disabled' : ''}>Siguiente</button>
        <label class="pagination-size-label">Por página <select class="pagination-select" data-detail-size>${[25, 50, 100].map(size => `<option value="${size}"${size === ctx.detail.pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select></label>
      </div></nav>` : ''))
    : '';

  return `
    <header class="view-header">
      <p><a href="#/dashboard${ctx.query ? (ctx.query.startsWith('?') ? ctx.query : '?' + ctx.query) : ''}">← Volver al resumen</a></p>
      <h1>${esc(tr.name)}</h1>
      <p class="view-meta">${entityLink('artist', ar, tr.artist)}${albumLinks ? ` · ${albumLinks}` : ''} · ${fmtNum(tr.plays)} reproducciones · ${fmtMs(tr.ms)} · ${pctOf(tr.ms, totalMs)} del total</p>
      <p><button type="button" class="btn btn-secondary" data-filter-entity="track:${tk}">Filtrar todo por esta canción</button></p>
    </header>
    ${scopeNotice}
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(originStats ? originStats.plays : tr.plays), sub: originStats ? `de ${fmtNum(tr.plays)} en canción agrupada` : '' },
      { label: 'Tiempo', value: fmtMs(originStats ? originStats.ms : tr.ms), sub: originStats ? `de ${fmtMs(tr.ms)} en canción agrupada` : '' },
      { label: 'Duración media', value: tr.durationKnown ? fmtMs(tr.ms / tr.durationKnown) : '—', sub: `${fmtNum(tr.plays - tr.durationKnown)} duraciones desconocidas` },
      { label: 'Saltadas', value: fmtNum(tr.skips), sub: pctOf(tr.skips, tr.skipKnown) },
      { label: 'Racha máxima (seguidas)', value: fmtNum(run) },
      { label: 'Días activos', value: fmtNum(tr.days.size) },
      { label: 'Meses activos', value: fmtNum(tr.months ? tr.months.size : 0) },
      { label: 'Primera escucha', value: fmtLocal(tr.firstTs) },
      ...(ctx.detail ? [{ label: 'Primera aparición histórica', value: fmtLocal(ctx.detail.firstLocal) }] : []),
      { label: 'Última escucha', value: fmtLocal(tr.lastTs) }
    ], 'kpis--entity')}
    <div class="grid-2">
      ${evolution}
      ${albumsCard}
    </div>`;
}

export function albumView(model, ak, ctx = {}) {
  const { entityLink } = entityLinks(model, ctx.query);
  const al = model.albums.byId.get(ak);
  if (!al) return `<p class="empty">Álbum no encontrado.</p>`;
  const byMs = ctx?.metric === 'ms';
  const evoByMs = (ctx?.metric ?? 'ms') === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const valLabel = byMs ? 'Tiempo' : 'Reproducciones';
  const totalMs = model.totals.ms;
  // Composite album keys store the artist id in the high 32 bits.
  const ar = Math.floor(ak / 4294967296);
  const tracksLimit = resolveLimit(ctx, 'album-tracks', 25);
  const songRows = [...al.trackStats.values()]
    .sort((x, y) => (byMs ? y.ms - x.ms || y.plays - x.plays : y.plays - x.plays || y.ms - x.ms))
    .slice(0, tracksLimit)
    .map((tr) => ({ name: model.tracks.byId.get(tr.tk).name, value: byMs ? tr.ms : tr.plays, plays: tr.plays, ms: tr.ms, id: tr.tk }));
  const evolution = contractedLineChart({
    id: 'album-monthly', title: 'Evolución mensual',
    points: albumSeries(model, al.monthly, evoByMs ? 'ms' : 'plays'),
    format: evoByMs ? fmtMs : fmtNum,
    unit: evoByMs ? 'tiempo escuchado' : 'reproducciones',
    base: evoByMs ? 'duración conocida de este álbum' : 'reproducciones de este álbum'
  });
  return `
    <header class="view-header">
      <p><a href="#/dashboard${ctx.query ? (ctx.query.startsWith('?') ? ctx.query : '?' + ctx.query) : ''}">← Volver al resumen</a></p>
      <h1>${esc(al.name)}</h1>
      <p class="view-meta">${entityLink('artist', ar, al.artist)} · ${fmtNum(al.plays)} reproducciones · ${fmtMs(al.ms)} · ${pctOf(al.ms, totalMs)} del total</p>
      <p><button type="button" class="btn btn-secondary" data-filter-entity="album:${ak}">Filtrar todo por este álbum</button></p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(al.plays) },
      { label: 'Tiempo', value: fmtMs(al.ms) },
      { label: 'Del total', value: pctOf(al.ms, totalMs) },
      { label: 'Canciones', value: fmtNum(al.tracks.size) },
      { label: 'Días activos', value: fmtNum(al.days.size) },
      { label: 'Primera escucha', value: fmtLocal(al.firstTs) },
      { label: 'Última escucha', value: fmtLocal(al.lastTs) }
    ])}
    <div class="grid-2">
      ${evolution}
      ${cardWithLimit('Canciones del álbum', 'album-tracks', tracksLimit, songRows.length
        ? rankTable(songRows, {
          valueFmt: valFmt,
          subValue: (r) => (byMs ? `${fmtNum(r.plays)} rep.` : fmtMs(r.ms)),
          valueLabel: valLabel,
          link: (r) => formatTrackFromAlbum(model.tracks.byId.get(r.id), al, ctx.query ?? ''),
          caption: `Canciones del álbum por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`,
          spark: (r) => albumSeries(model, al.trackStats.get(r.id).monthly, byMs ? 'ms' : 'plays').map((point) => point.y)
        })
        : '<p class="empty">Sin canciones registradas.</p>')}
    </div>`;
}

export function sessionsView(model, ctx = {}) {
  const s = model.sessionsStats;
  const durLimit = resolveLimit(ctx, 'sessions-dur', 10);
  const playsLimit = resolveLimit(ctx, 'sessions-plays', 10);
  const topDur = model.tables.sessions.byDuration.slice(0, durLimit);
  const topPlays = model.tables.sessions.byPlays.slice(0, playsLimit);
  const blocks = [0, 1, 2, 3].map((i) => ({
    label: ['Madrugada', 'Mañana', 'Tarde', 'Noche'][i],
    value: s.byBlock.get(i) ?? 0
  }));
  const startHour = Array.from({ length: 24 }, (_, h) => [h, s.startHour.get(h) ?? 0]);
  const monthPoints = fillMonths(sortedMonths(s.byMonth)).map((mi) => ({
    label: monthLabel(mi),
    y: s.byMonth.get(mi) ?? 0
  }));
  const dowData = DOW_SHORT.map((label, d) => ({
    label,
    value: s.byWeekday.get(d) ?? 0
  }));

  const sessRows = (list) => list.map((x, i) => [
    String(i + 1),
    `<a href="#/session/${x.id ?? i}" class="cell-link">${fmtLocal(x.start)}</a>`,
    fmtMs(x.duration * 1000),
    fmtNum(x.plays),
    fmtMs(x.ms)
  ]);

  return `
    <header class="view-header">
      <h1>Sesiones de escucha</h1>
      <p class="view-meta">Una pausa de más de ${fmtNum(s.gapMinutes)} min inicia otra sesión. Duración estimada desde el final de cada reproducción y su tiempo escuchado; puede incluir pausas y solapamientos.</p>
    </header>
    ${kpis([
      { label: 'Sesiones', value: fmtNum(s.count) },
      { label: 'Duración estimada promedio', value: fmtMs(s.avgDuration * 1000) },
      { label: 'Duración estimada mediana', value: fmtMs(s.medianDuration * 1000) },
      { label: 'Reproducciones promedio', value: s.avgPlays.toFixed(1) },
      { label: 'Reproducciones mediana', value: s.medianPlays.toFixed(1) },
      { label: 'Sesiones con repeticiones', value: fmtNum(model.intraSession.sessionsWithRepeats), sub: pctOf(model.intraSession.sessionsWithRepeats, s.count) },
      { label: 'Reproducciones repetidas', value: fmtNum(model.intraSession.repeatedPlays) }
    ])}
    <div class="grid-2">
      ${cardWithLimit('Sesiones más largas', 'sessions-dur', durLimit, table(['#', 'Inicio estimado', 'Duración estimada', 'Reproducciones', 'Tiempo escuchado'], sessRows(topDur), '', ['c', '', 'n', 'n', 'n'], null, 'Sesiones más largas'))}
      ${cardWithLimit('Sesiones con más reproducciones', 'sessions-plays', playsLimit, table(['#', 'Inicio estimado', 'Duración estimada', 'Reproducciones', 'Tiempo escuchado'], sessRows(topPlays), '', ['c', '', 'n', 'n', 'n'], null, 'Sesiones con más reproducciones'))}
    </div>
    <div class="grid-2">
      ${contractedBarChart({ id: 'sessions-by-block', title: 'Sesiones por franja', data: blocks, unit: 'sesiones', base: 'sesiones registradas' })}
      ${contractedBarChart({ id: 'sessions-by-start-hour', title: 'Hora de inicio', data: startHour.map(([h, n]) => ({ label: `${h}`, value: n })), unit: 'sesiones', base: 'sesiones registradas', showValue: false })}
    </div>
    <div class="grid-2">
      ${contractedLineChart({ id: 'sessions-monthly', title: 'Sesiones por mes', points: monthPoints, format: fmtNum, unit: 'sesiones', base: 'sesiones registradas' })}
      ${contractedBarChart({ id: 'sessions-by-weekday', title: 'Sesiones por día de la semana', data: dowData, unit: 'sesiones', base: 'sesiones registradas' })}
    </div>
    <div class="grid-2">
      ${contractedBarChart({ id: 'sessions-by-start-reason', title: 'Razones de inicio', data: [...model.starts.entries()].map(([k, v]) => ({ label: reasonLabel(k), value: v })), unit: 'sesiones', base: 'sesiones con razón de inicio registrada', orientation: 'horizontal' })}
      ${contractedBarChart({ id: 'sessions-by-end-reason', title: 'Razones de fin', data: [...model.ends.entries()].map(([k, v]) => ({ label: reasonLabel(k), value: v })), unit: 'sesiones', base: 'sesiones con razón de fin registrada', orientation: 'horizontal' })}
    </div>`;
}

function eventDetailView(model, id, ctx, type) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const detail = ctx.detail;
  const isSession = type === 'session';
  const title = isSession ? `Sesión #${Number(id) + 1}` : `Día: ${id}`;
  const previous = isSession ? 'sessions' : 'calendar';
  const summary = detail.summary;
  const rows = detail.rows.map(row => [
    fmtLocal(row.local), trackSubLink(row.trackId, row.track, row.artist), esc(row.album),
    row.durationKnown ? fmtMs(row.ms) : '—'
  ]);
  const topRows = (items, kind) => items.map(item => [
    kind === 'track' ? trackSubLink(item.id, item.name, model.tracks.byId.get(item.id)?.artist ?? '(Desconocido)')
      : kind === 'artist' && item.id ? entityLink('artist', item.id, item.name)
        : kind === 'album' && item.id ? entityLink('album', item.id, item.name) : esc(item.name),
    fmtNum(item.plays), fmtMs(item.ms)
  ]);
  const pages = Math.max(1, Math.ceil(detail.total / detail.pageSize));
  return `
    <header class="view-header">
      <p><a href="#/${previous}${esc(ctx.query ?? '')}">← Volver</a></p>
      <h1>${esc(title)}</h1>
      <p class="view-meta">${fmtNum(detail.total)} reproducciones · ${fmtMs(detail.ms)} tiempo escuchado</p>
      ${isSession ? `<p class="view-meta">Inicio estimado: ${fmtLocal(summary.start)} · Fin: ${fmtLocal(summary.end)} · Amplitud estimada: ${fmtMs(summary.duration * 1000)}. Los solapamientos y las pausas internas no pueden reconstruirse.</p>` : ''}
      ${!isSession && typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id) ? `<p><button type="button" class="btn btn-secondary" data-filter-range="${esc(id)}:${esc(id)}">Filtrar solo este día</button></p>` : ''}
    </header>
    ${kpis([
      { label: 'Canciones distintas', value: fmtNum(detail.distinctTracks) },
      { label: 'Artistas distintos', value: fmtNum(detail.distinctArtists) },
      { label: isSession ? 'Reproducciones repetidas' : 'Sesiones relacionadas', value: fmtNum(isSession ? detail.repeatedPlays : detail.sessionCount) }
    ])}
    <div class="grid-2">
      ${card('Canciones principales', table(['Canción', 'Reproducciones', 'Tiempo'], topRows(detail.tracks, 'track'), '', ['', 'n', 'n'], null, 'Canciones principales'))}
      ${card('Artistas principales', table(['Artista', 'Reproducciones', 'Tiempo'], topRows(detail.artists, 'artist'), '', ['', 'n', 'n'], null, 'Artistas principales'))}
      ${card('Álbumes principales', table(['Álbum', 'Reproducciones', 'Tiempo'], topRows(detail.albums, 'album'), '', ['', 'n', 'n'], null, 'Álbumes principales'))}
      ${!isSession && detail.sessions.length ? card('Sesiones relacionadas', table(['Inicio estimado', 'Reproducciones', 'Tiempo'], detail.sessions.map(session => [`<a href="#/session/${session.id}${esc(ctx.query ?? '')}">${fmtLocal(session.start)}</a>`, fmtNum(session.plays), fmtMs(session.ms)]), '', ['', 'n', 'n'], null, 'Sesiones relacionadas')) : ''}
    </div>
    ${card('Reproducciones', `${table(['Final local', 'Canción', 'Álbum', 'Tiempo'], rows, '', ['', '', '', 'n'], null, 'Reproducciones por orden UTC')}
      <nav class="pagination" aria-label="Paginación de reproducciones">
        <div class="pagination-info" aria-live="polite">Mostrando ${fmtNum(detail.startRow)}–${fmtNum(detail.endRow)} de ${fmtNum(detail.total)}</div>
        <div class="pagination-actions">
          <button type="button" class="btn btn-sm btn-page" data-detail-page="${detail.page - 1}"${detail.page <= 1 ? ' disabled' : ''}>Anterior</button>
          <span class="pagination-current">Página ${fmtNum(detail.page)} de ${fmtNum(pages)}</span>
          <button type="button" class="btn btn-sm btn-page" data-detail-page="${detail.page + 1}"${detail.page >= pages ? ' disabled' : ''}>Siguiente</button>
          <label class="pagination-size-label">Por página <select class="pagination-select" data-detail-size>${[25, 50, 100].map(size => `<option value="${size}"${size === detail.pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select></label>
        </div>
      </nav>`)}
  `;
}

export function sessionView(model, id, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  if (ctx.detail) return eventDetailView(model, id, ctx, 'session');
  if (ctx.detailRequested) return '<p class="empty">Sesión no encontrada en la selección actual.</p>';
  const idx = Number(id);
  const s = model.sessions?.[idx];
  if (!s) return `<p class="empty">Sesión no encontrada.</p>`;

  const pauseMs = Math.max(0, s.duration * 1000 - s.ms);

  const topSongs = s.tracks ? [...s.tracks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tk, count], i) => {
      const tr = model.tracks.byId.get(tk);
      return [
        String(i + 1),
        tr ? trackSubLink(tk, tr.name, tr.artist) : 'Desconocido',
        fmtNum(count)
      ];
    }) : [];

  const topArtists = s.artists ? [...s.artists.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ar, count], i) => {
      const a = model.artists.byId.get(ar);
      return [
        String(i + 1),
        a ? entityLink('artist', ar, a.name) : 'Desconocido',
        fmtNum(count)
      ];
    }) : [];

  return `
    <header class="view-header">
      <p><a href="#/sessions${ctx.query ? (ctx.query.startsWith('?') ? ctx.query : '?' + ctx.query) : ''}">← Volver a sesiones</a></p>
      <h1>Sesión #${idx + 1}</h1>
      <p class="view-meta">Inicio estimado: ${fmtLocal(s.start)} · Fin: ${fmtLocal(s.end)} · ${fmtNum(s.plays)} reproducciones · ${fmtMs(s.ms)} tiempo escuchado</p>
      <p class="view-meta">La duración de sesión es una estimación a partir del final de cada reproducción y su tiempo escuchado; puede contener pausas y solapamientos. No afirma escucha simultánea, canción completada ni atención efectiva.</p>
    </header>
    ${kpis([
      { label: 'Duración estimada', value: fmtMs(s.duration * 1000) },
      { label: 'Tiempo escuchado', value: fmtMs(s.ms) },
      { label: 'Pausa estimada', value: fmtMs(pauseMs) },
      { label: 'Reproducciones', value: fmtNum(s.plays) },
      { label: 'Artistas distintos', value: s.artists ? fmtNum(s.artists.size) : '—' },
      { label: 'Canciones distintas', value: s.tracks ? fmtNum(s.tracks.size) : '—' }
    ])}
    <div class="grid-2">
      ${s.tracks && topSongs.length ? card('Canciones de la sesión', table(['#', 'Canción', 'Reproducciones'], topSongs, '', ['c', '', 'n'], null, 'Canciones de la sesión')) : ''}
      ${s.artists && topArtists.length ? card('Artistas de la sesión', table(['#', 'Artista', 'Reproducciones'], topArtists, '', ['c', '', 'n'], null, 'Artistas de la sesión')) : ''}
    </div>`;
}

export function dayView(model, id, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  if (ctx.detail) return eventDetailView(model, id, ctx, 'day');
  if (ctx.detailRequested) return '<p class="empty">No se pudo consultar el día.</p>';
  let dayNum = null;
  let isoDate = null;
  if (typeof id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(id)) {
    isoDate = id;
    const parts = id.split('-').map(Number);
    dayNum = Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2]) / 86400000);
  } else {
    dayNum = Number(id);
    if (Number.isFinite(dayNum)) {
      const c = civilFromDays(dayNum);
      isoDate = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
    }
  }

  if (dayNum == null || !Number.isFinite(dayNum)) {
    return `<p class="empty">Día no válido.</p>`;
  }

  let plays = 0;
  let ms = 0;
  const dayTracks = new Map();
  const dayArtists = new Map();

  const d = model.daily?.get ? model.daily.get(dayNum) : null;
  if (d) {
    plays = d.plays;
    ms = d.ms;
    if (d.tracks) {
      for (const [tk, c] of d.tracks) dayTracks.set(tk, c);
    }
    if (d.artists) {
      for (const [ar, c] of d.artists) dayArtists.set(ar, c);
    }
  } else if (model.cols) {
    const { cols } = model;
    const n = cols.day.length;
    for (let i = 0; i < n; i++) {
      if (cols.day[i] === dayNum) {
        plays++;
        ms += cols.ms[i];
      }
    }
  }

  const daySessions = (model.sessions || []).filter((s) => {
    const startDay = Math.floor(s.start / 86400);
    const endDay = Math.floor(s.end / 86400);
    return dayNum >= startDay && dayNum <= endDay;
  });

  const sessRows = daySessions.map((s, i) => [
    String(i + 1),
    `<a href="#/session/${s.id ?? 0}" class="cell-link">${fmtLocal(s.start)}</a>`,
    fmtMs(s.duration * 1000),
    fmtNum(s.plays),
    fmtMs(s.ms)
  ]);

  const topSongRows = [...dayTracks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tk, count], i) => {
      const tr = model.tracks.byId.get(tk);
      return [
        String(i + 1),
        tr ? trackSubLink(tk, tr.name, tr.artist) : 'Desconocido',
        fmtNum(count)
      ];
    });

  const topArtistRows = [...dayArtists.entries()]
    .filter(([ar]) => ar > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ar, count], i) => {
      const a = model.artists.byId.get(ar);
      return [
        String(i + 1),
        a ? entityLink('artist', ar, a.name) : 'Desconocido',
        fmtNum(count)
      ];
    });

  return `
    <header class="view-header">
      <p><a href="#/calendar${ctx.query ? (ctx.query.startsWith('?') ? ctx.query : '?' + ctx.query) : ''}">← Volver al calendario</a></p>
      <h1>Día: ${esc(isoDate)}</h1>
      <p class="view-meta">${fmtNum(plays)} reproducciones · ${fmtMs(ms)} tiempo escuchado</p>
      <p><button type="button" class="btn btn-secondary" data-filter-range="${isoDate}:${isoDate}">Filtrar solo este día</button></p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(plays) },
      { label: 'Tiempo escuchado', value: fmtMs(ms) },
      { label: 'Sesiones en el día', value: fmtNum(daySessions.length) },
      { label: 'Canciones distintas', value: dayTracks.size ? fmtNum(dayTracks.size) : '—' },
      { label: 'Artistas distintos', value: dayArtists.size ? fmtNum(dayArtists.size) : '—' }
    ])}
    <div class="grid-2">
      ${card('Sesiones del día', table(['#', 'Inicio estimado', 'Duración estimada', 'Reproducciones', 'Tiempo'], sessRows, '', ['c', '', 'n', 'n', 'n'], null, 'Sesiones del día'))}
      ${topSongRows.length ? card('Canciones del día', table(['#', 'Canción', 'Reproducciones'], topSongRows, '', ['c', '', 'n'], null, 'Canciones del día')) : ''}
      ${topArtistRows.length ? card('Artistas del día', table(['#', 'Artista', 'Reproducciones'], topArtistRows, '', ['c', '', 'n'], null, 'Artistas del día')) : ''}
    </div>`;
}

function localPage(rows, page, pageSize) {
  const count = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.max(1, Math.min(count, page));
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), total: rows.length, page: current, pageSize, pageCount: count, start: rows.length ? start + 1 : 0, end: Math.min(rows.length, start + pageSize) };
}

function longitudinalPagination(key, page, label) {
  if (!page || page.pageCount <= 1) return '';
  return `<nav class="pagination" aria-label="Paginación: ${esc(label)}">
    <div class="pagination-info" aria-live="polite">Mostrando ${fmtNum(page.start)}–${fmtNum(page.end)} de ${fmtNum(page.total)}</div>
    <div class="pagination-actions">
      <button type="button" class="btn btn-secondary" data-longitudinal-page="${key}" data-dir="-1"${page.page <= 1 ? ' disabled' : ''} aria-label="Página anterior de ${esc(label)}">← Anterior</button>
      <span class="pagination-current">Página ${fmtNum(page.page)} de ${fmtNum(page.pageCount)}</span>
      <button type="button" class="btn btn-secondary" data-longitudinal-page="${key}" data-dir="1"${page.page >= page.pageCount ? ' disabled' : ''} aria-label="Página siguiente de ${esc(label)}">Siguiente →</button>
    </div>
  </nav>`;
}

function shareOrBase(value) {
  return Number.isFinite(value) ? fmtPct(value) : 'sin base';
}

function formatEffectiveCount(value) {
  return Number.isFinite(value) ? value.toLocaleString('es-ES', { maximumFractionDigits: 1 }) : 'sin base';
}

function monthlyConcentrationRows(monthly) {
  const kinds = [['artists', 'Artistas'], ['tracks', 'Canciones'], ['albums', 'Álbumes']];
  const months = fillMonths(sortedMonths(monthly));
  return months.flatMap((month) => kinds.map(([kind, label]) => {
    const data = monthly.get(month)?.concentration?.[kind];
    const hasBase = data?.knownMs > 0;
    return [
      monthLabel(month), label,
      data ? fmtNum(data.knownEntities) : '—',
      data ? fmtNum(data.unknownEntities) : '—',
      hasBase ? fmtMs(data.knownMs) : 'sin base',
      formatEffectiveCount(data?.effective),
      shareOrBase(data?.hhi), shareOrBase(data?.gini), shareOrBase(data?.entropy),
      shareOrBase(data?.top1Share), shareOrBase(data?.top5Share), shareOrBase(data?.top10Share)
    ];
  }));
}

function monthlyBehaviorRows(monthly) {
  const months = fillMonths(sortedMonths(monthly));
  return months.map((month) => {
    const data = monthly.get(month);
    const metric = (name, knownName, unknownName, rateName) => {
      const count = data?.[name] ?? 0;
      const known = data?.[knownName] ?? 0;
      return [fmtNum(count), fmtNum(known), fmtNum(data?.[unknownName] ?? 0), known > 0 ? fmtPct(data[rateName]) : 'sin base'];
    };
    return [monthLabel(month), ...metric('skips', 'skipKnown', 'skipUnknown', 'skipRate'),
      ...metric('shuffle', 'shuffleKnown', 'shuffleUnknown', 'shuffleRate'),
      ...metric('offline', 'offlineKnown', 'offlineUnknown', 'offlineRate')];
  });
}

function staticPagedTable(key, headers, rows, colClasses, caption) {
  const pageSize = 25;
  const isPaged = rows.length > pageSize;
  const tableHtml = table(headers, rows, 'monthly-longitudinal-table', colClasses, (_, index) =>
    ` data-longitudinal-static-row="${key}" data-longitudinal-index="${index}"${isPaged && index >= pageSize ? ' hidden' : ''}`,
  caption);
  if (!isPaged) return tableHtml;
  return `${tableHtml}<div class="compare-series-controls" data-longitudinal-static-controls="${key}" data-page="0" data-page-size="${pageSize}" data-row-count="${rows.length}">
    <button type="button" class="btn btn-secondary" data-longitudinal-static-page="${key}" data-dir="-1" disabled>Anterior</button>
    <span aria-live="polite">Mostrando 1–${pageSize} de ${fmtNum(rows.length)}</span>
    <button type="button" class="btn btn-secondary" data-longitudinal-static-page="${key}" data-dir="1">Siguiente</button>
  </div>`;
}

export function discoveryView(model, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const longitudinal = ctx.longitudinal;
  const monthly = longitudinal?.monthly ?? new Map();
  const disc = [...model.monthlyDiscovery.entries()].sort((a, b) => a[0] - b[0]);
  const line = contractedLineChart({
    id: 'discovery-monthly', title: 'Canciones nuevas por mes',
    points: fillMonths(sortedMonths(model.monthlyDiscovery)).map((mi) => ({
      label: monthLabel(mi),
      y: model.monthlyDiscovery.get(mi)?.new ?? 0
    })),
    format: fmtNum,
    unit: 'primeras apariciones',
    base: 'canciones cuya primera aparición histórica ocurrió en el mes'
  });
  const absLimit = resolveLimit(ctx, 'disc-abs', 10);
  const relLimit = resolveLimit(ctx, 'disc-rel', 10);
  const constLimit = resolveLimit(ctx, 'disc-constancy', 10);
  const longLimit = resolveLimit(ctx, 'disc-longevity', 10);
  const abs = model.tables.discovery.absolute.slice(0, absLimit);
  const rel = model.tables.discovery.relative.slice(0, relLimit);
  const totalNewTracks = disc.reduce((acc, [, d]) => acc + d.new, 0);
  const totalRepTracks = disc.reduce((acc, [, d]) => acc + d.rep, 0);
  const avgNewPerMonth = disc.length > 0 ? (totalNewTracks / disc.length).toFixed(1) : '0';

  const r30 = model.retention?.r30;
  const r90 = model.retention?.r90;

  const pageSize = ctx.longitudinalPageSize ?? 25;
  const pageState = ctx.longitudinalPages ?? {};
  const comebackTracksPage = longitudinal?.comebacks?.tracks ?? localPage(model.tables?.comebacks ?? [], pageState.comebackTracks ?? 1, pageSize);
  const comebackArtistsPage = longitudinal?.comebacks?.artists ?? localPage(model.tables?.comebackArtists ?? [], pageState.comebackArtists ?? 1, pageSize);
  const comebackTracks = comebackTracksPage.rows;
  const comebackArtists = comebackArtistsPage.rows;
  const comebacksRows = comebackTracks.map((x, i) => [
    fmtNum(comebackTracksPage.start + i),
    trackSubLink(x.id, x.name, x.artist),
    `${fmtNum(x.gapDays)} días`,
    fmtLocal(x.lastSeenLocal ?? x.lastSeenUtc),
    fmtLocal(x.returnLocal ?? x.returnUtc)
  ]);
  const comebackArtistRows = comebackArtists.map((x, i) => [
    fmtNum(comebackArtistsPage.start + i),
    entityLink('artist', x.id, x.name),
    `${fmtNum(x.gapDays)} días`,
    fmtLocal(x.lastSeenLocal ?? x.lastSeenUtc),
    fmtLocal(x.returnLocal ?? x.returnUtc)
  ]);

  const firstTracksPage = longitudinal?.firstAppearances?.tracks ?? localPage(model.tables?.firstAppearances?.tracks ?? [], pageState.firstTracks ?? 1, pageSize);
  const firstArtistsPage = longitudinal?.firstAppearances?.artists ?? localPage(model.tables?.firstAppearances?.artists ?? [], pageState.firstArtists ?? 1, pageSize);
  const newTracksList = firstTracksPage.rows;
  const newArtistsList = firstArtistsPage.rows;
  const newTracksRows = newTracksList.map((tr, i) => [
    fmtNum(firstTracksPage.start + i),
    trackSubLink(tr.id ?? tr.tk, tr.name, tr.artist),
    fmtLocal(tr.firstTs),
    fmtNum(tr.subsequentPlays),
    fmtMs(tr.ms),
    fmtNum(tr.daysCount)
  ]);
  const newArtistsRows = newArtistsList.map((artist, i) => [
    fmtNum(firstArtistsPage.start + i),
    entityLink('artist', artist.id, artist.name),
    fmtLocal(artist.firstTs),
    fmtNum(artist.subsequentPlays),
    fmtMs(artist.ms),
    fmtNum(artist.daysCount)
  ]);

  const monthlyRows = monthlyConcentrationRows(monthly);
  const thresholdDays = [30, 90, 180].includes(ctx.comebackThresholdDays) ? ctx.comebackThresholdDays : 30;
  const thresholdSelector = `<label class="field"><span>Umbral de regreso</span><select data-comeback-threshold>${[30, 90, 180].map((days) => `<option value="${days}"${thresholdDays === days ? ' selected' : ''}>${days} días o más</option>`).join('')}</select></label>`;
  const pageSizeSelector = `<label class="field"><span>Filas por página</span><select data-longitudinal-page-size>${[25, 50, 100].map((size) => `<option value="${size}"${pageSize === size ? ' selected' : ''}>${size}</option>`).join('')}</select></label>`;
  const newTracksTotal = longitudinal?.firstAppearances?.tracks.total ?? model.tables?.firstAppearances?.tracks.length ?? 0;
  const newArtistsTotal = longitudinal?.firstAppearances?.artists.total ?? model.tables?.firstAppearances?.artists.length ?? 0;
  const comebackTrackTable = comebacksRows.length
    ? table(['#', 'Canción', 'Pausa observada', 'Última escucha anterior', 'Regreso'], comebacksRows, '', ['n', '', 'n', '', ''], null, `Regresos de canciones tras pausas de ${thresholdDays} días o más`)
    : '<p class="empty">No se encontraron regresos de canciones para este umbral y filtro.</p>';
  const comebackArtistTable = comebackArtistRows.length
    ? table(['#', 'Artista', 'Pausa observada', 'Última escucha anterior', 'Regreso'], comebackArtistRows, '', ['n', '', 'n', '', ''], null, `Regresos de artistas tras pausas de ${thresholdDays} días o más`)
    : '<p class="empty">No se encontraron regresos de artistas para este umbral y filtro.</p>';
  const firstTracksTable = newTracksRows.length
    ? table(['#', 'Canción', 'Primera aparición histórica', 'Escuchas posteriores', 'Tiempo escuchado', 'Días activos'], newTracksRows, '', ['n', '', '', 'n', 'n', 'n'], null, 'Primeras apariciones históricas de canciones; métricas posteriores sobre todo el historial cargado')
    : '<p class="empty">No hay primeras apariciones de canciones en esta selección.</p>';
  const firstArtistsTable = newArtistsRows.length
    ? table(['#', 'Artista', 'Primera aparición histórica', 'Escuchas posteriores', 'Tiempo escuchado', 'Días activos'], newArtistsRows, '', ['n', '', '', 'n', 'n', 'n'], null, 'Primeras apariciones históricas de artistas; métricas posteriores sobre todo el historial cargado')
    : '<p class="empty">No hay primeras apariciones de artistas en esta selección.</p>';
  const monthlyConcentrationTable = monthlyRows.length
    ? staticPagedTable('monthly-concentration', ['Mes', 'Entidad', 'Con tiempo conocido', 'Excluidas', 'Tiempo conocido', 'Efectivos exp(H)', 'HHI', 'Gini', 'Entropía normalizada', 'Top 1', 'Top 5', 'Top 10'], monthlyRows, ['', '', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'], 'Concentración y diversidad mensuales; todas las cuotas se calculan sobre tiempo reproducido conocido')
    : '<p class="empty">No hay meses para resumir.</p>';

  return `
    <header class="view-header">
      <h1>Descubrimiento</h1>
      <p class="view-meta">Primeras apariciones en todo el historial cargado; no indica cuándo conociste una canción.</p>
    </header>
    <div class="longitudinal-controls card-subtle">${thresholdSelector}${pageSizeSelector}</div>
    ${ctx.longitudinalError ? `<p class="status error" role="alert">${esc(ctx.longitudinalError)}</p>` : ''}
    ${kpis([
      { label: 'Primeras apariciones de canciones', value: `${fmtNum(newTracksTotal)} <button type="button" class="btn btn-secondary" data-discovery-focus="discovery-first-tracks" aria-controls="discovery-first-tracks">Ver lista</button>` },
      { label: 'Primeras apariciones de artistas', value: `${fmtNum(newArtistsTotal)} <button type="button" class="btn btn-secondary" data-discovery-focus="discovery-first-artists" aria-controls="discovery-first-artists">Ver lista</button>` },
      { label: 'Escuchas de catálogo', value: fmtNum(totalRepTracks), sub: `${pctOf(totalRepTracks, model.totals.records)} de las reproducciones` },
      { label: 'Promedio por mes activo', value: `${avgNewPerMonth} nuevas` },
      { label: 'Artistas únicos', value: fmtNum(model.artists.byId.size) },
      {
        label: 'Retorno a 30 días',
        value: r30?.rate != null ? fmtPct(r30.rate) : '—',
        sub: r30 ? `${fmtNum(r30.returned)} regresaron de ${fmtNum(r30.eligible)} elegibles; ${fmtNum(r30.insufficient)} con seguimiento insuficiente` : ''
      },
      {
        label: 'Retorno a 90 días',
        value: r90?.rate != null ? fmtPct(r90.rate) : '—',
        sub: r90 ? `${fmtNum(r90.returned)} regresaron de ${fmtNum(r90.eligible)} elegibles; ${fmtNum(r90.insufficient)} con seguimiento insuficiente` : ''
      }
    ])}
    ${line}
    <div class="grid-2">
      ${cardWithLimit('Meses con más descubrimientos', 'disc-abs', absLimit, table(['#', 'Mes', 'Nuevas', 'Repetidas', 'Reproducciones'], abs.map(([mi, d], i) => [String(i + 1), monthLabel(mi), fmtNum(d.new), fmtNum(d.rep), fmtNum(d.plays)]), '', ['c', '', 'n', 'n', 'n'], null, 'Meses con más descubrimientos'))}
      ${cardWithLimit('Meses con mayor proporción de nuevas', 'disc-rel', relLimit, table(['#', 'Mes', 'Nuevas', 'Repetidas', 'Reproducciones', 'Proporción'], rel.map(([mi, d], i) => [String(i + 1), monthLabel(mi), fmtNum(d.new), fmtNum(d.rep), fmtNum(d.plays), fmtPct(d.new / d.plays)]), '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Meses con mayor proporción de canciones nuevas'))}
    </div>
    ${card('Concentración y diversidad por mes', `<p class="view-meta">Base fija: tiempo reproducido con duración conocida, independiente de la métrica principal. “Excluidas” son entidades sin ninguna duración conocida en ese mes; un mes sin base muestra “sin base”.</p>${monthlyConcentrationTable}`)}
    <div class="grid-2">
      <section class="card"><h2>Regresos de canciones tras pausas de ${thresholdDays} días o más</h2>${comebackTrackTable}${longitudinalPagination('comebackTracks', comebackTracksPage, 'regresos de canciones')}</section>
      <section class="card"><h2>Regresos de artistas tras pausas de ${thresholdDays} días o más</h2>${comebackArtistTable}${longitudinalPagination('comebackArtists', comebackArtistsPage, 'regresos de artistas')}</section>
    </div>
    <div class="grid-2">
      <section class="card" id="discovery-first-tracks" aria-labelledby="discovery-first-tracks-title"><h2 id="discovery-first-tracks-title" tabindex="-1">Primeras apariciones históricas de canciones</h2><p class="view-meta">Las reproducciones, el tiempo y los días activos posteriores se calculan sobre todo el historial cargado.</p>${firstTracksTable}${longitudinalPagination('firstTracks', firstTracksPage, 'primeras apariciones de canciones')}</section>
      <section class="card" id="discovery-first-artists" aria-labelledby="discovery-first-artists-title"><h2 id="discovery-first-artists-title" tabindex="-1">Primeras apariciones históricas de artistas</h2><p class="view-meta">Las reproducciones, el tiempo y los días activos posteriores se calculan sobre todo el historial cargado.</p>${firstArtistsTable}${longitudinalPagination('firstArtists', firstArtistsPage, 'primeras apariciones de artistas')}</section>
    </div>
    <div class="grid-2">
      ${cardWithLimit('Constancia (artistas con ≥6 meses activos)', 'disc-constancy', constLimit, table(['#', 'Artista', 'Meses activos', 'Etapa activa', 'Período observado'], model.tables.constancy.slice(0, constLimit).map((a, i) => [
        String(i + 1),
        entityLink('artist', a.id, a.name),
        fmtNum(a.months.size),
        `${fmtPct(a.coverage)} (${fmtNum(a.months.size)}/${fmtNum(a.activeMonthsSpan)})`,
        `${fmtPct(a.periodCoverage)} (${fmtNum(a.months.size)}/${fmtNum(a.observedMonths)})`
      ]), '', ['c', '', 'n', 'n', 'n'], null, 'Continuidad durante etapa activa y cobertura del período total (mín. 6 meses activos)'), '', catalogHref(ctx, 'artists', 'constancy', 'minMonths', 6))}
      ${cardWithLimit('Longevidad (años activos)', 'disc-longevity', longLimit, table(['#', 'Artista', 'Años', 'Meses', 'Días'], model.tables.longevity.slice(0, longLimit).map((a, i) => [
        String(i + 1),
        entityLink('artist', a.id, a.name),
        fmtNum(a.years.size),
        fmtNum(a.months.size),
        fmtNum(a.days.size)
      ]), '', ['c', '', 'n', 'n', 'n'], null, 'Artistas con más años activos'), '', catalogHref(ctx, 'artists', 'longevity'))}
    </div>
    <p class="view-meta">El retorno acumulado toma como cohorte las canciones cuya primera aparición histórica coincide con la selección y busca reproducciones posteriores en todo el historial. La elegibilidad temporal requiere seguimiento de 30 o 90 días; los insuficientes quedan fuera del denominador. Eso no demuestra que los archivos estén completos ni permite concluir desinterés personal. Los regresos usan eventos consecutivos de la cronología histórica completa aunque el filtro oculte los intermedios.</p>`;
}

export function yearlyView(model, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const byMs = ctx?.metric === 'ms';
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  const rows = years.map((y) => {
    const d = model.yearly.get(y);
    const st = model.yearlyStreaks.get(y);
    const topArEntry = topEntityInMap(byMs ? d.artistsMs : d.artistsC, true);
    const topAr = topArEntry ? model.artists.byId.get(topArEntry[0]) : null;
    const topTkEntry = topEntityInMap(byMs ? d.tracksMs : d.tracksC, false);
    const topTr = topTkEntry ? model.tracks.byId.get(topTkEntry[0]) : null;
    return [
      `<a href="${esc(formatSemanticRoute('calendar', y, ctx.query))}">${esc(String(y))}</a>`,
      fmtNum(d.plays),
      fmtMs(d.ms),
      fmtNum(d.artistsC.size) + (d.unknownArtistPlays > 0 ? ` <span class="cell-sub">(${fmtNum(d.unknownArtistPlays)} sin artista)</span>` : ''),
      fmtNum(d.tracksC.size),
      fmtNum(d.albumsC.size),
      fmtNum(d.newArtists),
      fmtNum(d.newTracks),
      topAr ? entityLink('artist', topAr.id, topAr.name) : '—',
      topTr ? trackSubLink(topTkEntry[0], topTr.name, topTr.artist) : '—',
      fmtNum(d.skips),
      st ? `${st.len} días` : '—'
    ];
  });
  const stackedSeries = years.map((y) => {
      const d = model.yearly.get(y);
      return {
        label: String(y),
        values: byMs ? d.blocksMs : d.blocks,
        total: byMs ? d.ms : d.plays
      };
    });
  const segmentLabels = ['Madrugada', 'Mañana', 'Tarde', 'Noche'];
  const stacked = stackedBar({
    series: stackedSeries,
    segmentLabels,
    format: byMs ? fmtMs : fmtNum
  });
  const stackedChart = renderChartWithContract(createChartContract({
    id: 'yearly-time-blocks',
    title: 'Franjas por año',
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida por año' : 'eventos registrados por año',
    data: stackedSeries.map((row) => ({ label: row.label, value: row.total, values: row.values })),
    format: byMs ? fmtMs : fmtNum,
    showShare: false,
    chartType: 'stacked',
    seriesLabels: segmentLabels
  }), scrollChart(stacked, 'Franjas por año'));

  return `
    <header class="view-header">
      <h1>Comparación anual</h1>
    </header>
    ${card('Año a año', table(['Año', 'Reproducciones', 'Tiempo', 'Artistas', 'Canciones', 'Álbumes', 'Nuevos art.', 'Nuevas canc.', 'Artista #1', 'Canción #1', 'Saltadas', 'Racha'], rows, '', ['', 'n', 'n', 'n', 'n', 'n', 'n', 'n', '', '', 'n', 'n'], null, 'Comparación año a año'))}
    ${stackedChart}`;
}

export function calendarView(model, year, ctx = {}) {
  if (!Number.isInteger(year) || year < 100 || year > 9999) return '<p class="empty">Año no válido.</p>';
  const byMs = ctx?.metric ? ctx.metric === 'ms' : true;
  const valFmt = byMs ? fmtMs : fmtNum;
  const days = [...model.daily.entries()]
    .filter(([d]) => civilFromDays(d).y === year)
    .map(([d, v]) => {
      const c = civilFromDays(d);
      const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      return { date: iso, value: byMs ? v.ms : v.plays };
    });
  const maxVal = Math.max(...days.map((d) => d.value), 1);
  const zeroInYear = model.zeroDays.filter((d) => civilFromDays(d).y === year).length;
  const totalDays = days.length;
  const dataRange = model.meta.firstTs != null
    ? { from: Math.floor(model.meta.firstTs / 86400), to: Math.floor(model.meta.lastTs / 86400) }
    : null;

  const daysMap = new Map(days.map((d) => [d.date, d]));
  const currentMonth = ctx.calMonth?.year === year ? ctx.calMonth.month : (ctx?.month ? Number(ctx.month) : 1);

  return `
    <header class="view-header">
      <p><a href="${esc(formatSemanticRoute('calendar', null, ctx.query))}">← Todos los años</a></p>
      <h1>Calendario ${esc(String(year))}</h1>
      <p class="view-meta">${fmtNum(totalDays)} días con actividad · ${fmtNum(zeroInYear)} días sin registros dentro del período observado · tocá un día para filtrar <span class="hint-shift">(shift+click = rango)</span></p>
    </header>
    ${calendarInspectorHTML({ year, byMs })}
    ${calendarMonthViewHTML({ year, month: currentMonth, daysMap, colorScale: makeScale(maxVal), byMs, dataRange, selectedDate: ctx.calDate })}
    ${card('Actividad diaria', `<div class="chart-scroll chart-scroll--cal" tabindex="0" role="region" aria-label="Calendario de ${esc(String(year))}">${calendarGrid({
      days,
      year,
      colorScale: makeScale(maxVal),
      cellTitle: (d) => `${d.date}: ${d.value > 0 ? valFmt(d.value) : 'sin registros'}`,
      dataRange,
      interactive: true
    })}</div>` + heatLegend({ max: maxVal, unit: byMs ? 'tiempo' : 'reproducciones', format: valFmt }) + calendarTable(days, year, byMs))}
`;
}

export function calendarYearGridHTML(model, y, ctx = {}) {
  const byMs = ctx?.metric ? ctx.metric === 'ms' : true;
  const valFmt = byMs ? fmtMs : fmtNum;
  const normalizeYears = Boolean(ctx?.normalizeYears);
  const allDailyValues = [...model.daily.values()].map((v) => (byMs ? v.ms : v.plays));
  const sharedMax = allDailyValues.length ? Math.max(...allDailyValues, 1) : 1;

  const dataRange = model.meta.firstTs != null
    ? { from: Math.floor(model.meta.firstTs / 86400), to: Math.floor(model.meta.lastTs / 86400) }
    : null;

  const days = [...model.daily.entries()]
    .filter(([d]) => civilFromDays(d).y === y)
    .map(([d, v]) => {
      const c = civilFromDays(d);
      const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      return { date: iso, value: byMs ? v.ms : v.plays };
    });
  const yearMax = Math.max(...days.map((d) => d.value), 1);
  const effectiveScale = normalizeYears ? makeScale(yearMax) : makeScale(sharedMax);
  const legendMax = normalizeYears ? yearMax : sharedMax;

  return calendarGrid({
    days, year: y,
    colorScale: effectiveScale,
    cellTitle: (d) => `${d.date}: ${d.value > 0 ? valFmt(d.value) : 'sin registros'}`,
    dataRange,
    interactive: true
  }) + heatLegend({ max: legendMax, unit: byMs ? 'tiempo' : 'reproducciones', format: valFmt }) + calendarTable(days, y, byMs);
}

export function calendarIndexView(model, ctx = {}) {
  const byMs = ctx?.metric ? ctx.metric === 'ms' : true;
  const valFmt = byMs ? fmtMs : fmtNum;
  const years = [...model.yearly.keys()].sort((a, b) => b - a);
  const normalizeYears = Boolean(ctx?.normalizeYears);
  const allDailyValues = [...model.daily.values()].map((v) => (byMs ? v.ms : v.plays));
  const sharedMax = allDailyValues.length ? Math.max(...allDailyValues, 1) : 1;

  const dataRange = model.meta.firstTs != null
    ? { from: Math.floor(model.meta.firstTs / 86400), to: Math.floor(model.meta.lastTs / 86400) }
    : null;

  const [last, ...prev] = years;
  const latestYear = ctx.calMonth?.year ?? last ?? (years.length ? years[0] : new Date().getFullYear());
  const latestDaysMap = new Map([...model.daily.entries()]
    .filter(([d]) => civilFromDays(d).y === latestYear)
    .map(([d, v]) => {
      const c = civilFromDays(d);
      const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      return [iso, { date: iso, value: byMs ? v.ms : v.plays, ms: v.ms, plays: v.plays }];
    }));
  const currentMonth = ctx.calMonth?.month ?? (ctx?.month ? Number(ctx.month) : (new Date().getMonth() + 1));

  return `
    <header class="view-header">
      <h1>Calendario</h1>
      <p class="view-meta">${fmtNum(model.zeroDays.length)} días sin registros entre primera y última escucha · tocá un día para filtrar <span class="hint-shift">(shift+click = rango)</span></p>
    </header>
    ${calendarScaleToggleHTML({ normalizeYears, maxValFormatted: valFmt(sharedMax) })}
    ${calendarInspectorHTML({ year: latestYear, byMs })}
    ${calendarMonthViewHTML({ year: latestYear, month: currentMonth, daysMap: latestDaysMap, colorScale: normalizeYears ? makeScale(Math.max(...[...latestDaysMap.values()].map((d) => d.value), 1)) : makeScale(sharedMax), byMs, dataRange, selectedDate: ctx.calDate })}
    ${last != null ? card(`<a href="${esc(formatSemanticRoute('calendar', last, ctx.query))}">${esc(String(last))}</a>`, `<div class="chart-scroll chart-scroll--cal" tabindex="0" role="region" aria-label="Calendario de ${esc(String(last))}">${calendarYearGridHTML(model, last, ctx)}</div>`, '', true) : ''}
    ${prev.map((y) => {
      const yd = model.yearly.get(y);
      const isRendered = Boolean(ctx?.renderAllYears);
      return `
      <details class="card calendar-year">
        <summary>${calendarYearSummaryHTML(y, yd)}</summary>
        <p class="calendar-year-link"><a href="${esc(formatSemanticRoute('calendar', y, ctx.query))}">Ver solo ${esc(String(y))} →</a></p>
        <div class="chart-scroll chart-scroll--cal" data-deferred-year="${y}" tabindex="0" role="region" aria-label="Calendario de ${esc(String(y))}">${isRendered ? calendarYearGridHTML(model, y, ctx) : ''}</div>
      </details>`;
    }).join('')}`;
}

function calendarYearSummaryHTML(y, yd) {
  const meta = yd ? `${fmtNum(yd.plays)} reproducciones · ${fmtMs(yd.ms)}` : '';
  return `${CHEVRON_SVG}<span>${esc(String(y))}</span>${meta ? `<span class="calendar-year-meta">${esc(meta)}</span>` : ''}`;
}

export function hoursView(model, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const byMs = ctx?.metric === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const valLabel = byMs ? 'Tiempo' : 'Reproducciones';
  const totalVal = byMs ? model.totals.ms : model.totals.records;

  let peakHour = 0;
  let valleyHour = 0;
  for (let h = 1; h < 24; h++) {
    const cur = byMs ? model.hour[h].ms : model.hour[h].plays;
    const best = byMs ? model.hour[peakHour].ms : model.hour[peakHour].plays;
    const worst = byMs ? model.hour[valleyHour].ms : model.hour[valleyHour].plays;
    if (cur > best) peakHour = h;
    if (cur < worst) valleyHour = h;
  }

  let peakDow = 0;
  for (let d = 1; d < 7; d++) {
    const cur = byMs ? model.weekday[d].ms : model.weekday[d].plays;
    const best = byMs ? model.weekday[peakDow].ms : model.weekday[peakDow].plays;
    if (cur > best) peakDow = d;
  }

  const blockNames = ['Madrugada (0–5h)', 'Mañana (6–11h)', 'Tarde (12–17h)', 'Noche (18–23h)'];
  let peakBlock = 0;
  for (let b = 1; b < 4; b++) {
    const cur = byMs ? model.blocks[b].ms : model.blocks[b].plays;
    const best = byMs ? model.blocks[peakBlock].ms : model.blocks[peakBlock].plays;
    if (cur > best) peakBlock = b;
  }

  const weekendVal = (byMs ? model.weekday[5].ms + model.weekday[6].ms : model.weekday[5].plays + model.weekday[6].plays);
  const weekdayVal = totalVal - weekendVal;

  const hourChart = contractedBarChart({
    id: 'hours-by-hour', title: `Actividad por hora del día (${valLabel.toLowerCase()})`,
    data: model.hour.map((h, i) => ({
      label: String(i).padStart(2, '0'),
      value: byMs ? h.ms : h.plays
    })),
    format: valFmt,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida' : 'eventos registrados',
    showValue: false
  });

  const dowChart = contractedBarChart({
    id: 'hours-by-weekday', title: `Actividad por día de la semana (${valLabel.toLowerCase()})`,
    data: DOW_LONG.map((label, d) => ({
      label,
      value: byMs ? model.weekday[d].ms : model.weekday[d].plays
    })),
    format: valFmt,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida' : 'eventos registrados',
    orientation: 'horizontal'
  });

  const blockRows = model.blocks.map((b, i) => {
    const topArEntry = topEntityInMap(b.artists, true);
    const topAr = topArEntry ? model.artists.byId.get(topArEntry[0]) : null;
    const topTkEntry = topEntityInMap(b.tracks, false);
    const topTr = topTkEntry ? model.tracks.byId.get(topTkEntry[0]) : null;
    const bVal = byMs ? b.ms : b.plays;
    return [
      esc(blockNames[i]),
      fmtNum(b.plays),
      fmtMs(b.ms),
      pctOf(bVal, totalVal),
      topAr ? entityLink('artist', topAr.id, topAr.name) : '—',
      topTr ? trackSubLink(topTkEntry[0], topTr.name, topTr.artist) : '—'
    ];
  });

  const hourTrackRows = Array.from({ length: 24 }, (_, h) => {
    const label = `${String(h).padStart(2, '0')}:00`;
    const hStat = model.hour[h];
    const map = byMs ? model.hourTracksMs[h] : model.hourTracks[h];
    const topEntry = topEntityInMap(map, false);
    const topTk = topEntry ? topEntry[0] : null;
    const topTr = topTk != null ? model.tracks.byId.get(topTk) : null;
    const topPlays = topTk != null ? (model.hourTracks[h].get(topTk) ?? 0) : 0;
    const topMs = topTk != null ? (model.hourTracksMs[h].get(topTk) ?? 0) : 0;
    return [
      esc(label),
      `<div class="cell-metric-stack"><span class="cell-metric-val">${fmtNum(hStat.plays)} rep.</span><span class="cell-metric-sub">${fmtMs(hStat.ms)}</span></div>`,
      topTr ? trackSubLink(topTk, topTr.name, `${topTr.artist} · ${fmtNum(topPlays)} rep. (${fmtMs(topMs)})`) : '—'
    ];
  });

  return `
    <header class="view-header">
      <h1>Horarios y ritmo diario</h1>
      <p class="view-meta">Distribución atribuida al momento de finalización registrado de cada evento (no a una reconstrucción minuto a minuto de escuchas que cruzan horas o días).</p>
    </header>
    ${kpis([
      { label: 'Hora pico', value: `${String(peakHour).padStart(2, '0')}:00`, sub: `${fmtNum(model.hour[peakHour].plays)} rep. · ${fmtMs(model.hour[peakHour].ms)}` },
      { label: 'Hora valle', value: `${String(valleyHour).padStart(2, '0')}:00`, sub: `${fmtNum(model.hour[valleyHour].plays)} rep. · ${fmtMs(model.hour[valleyHour].ms)}` },
      { label: 'Día más activo', value: esc(DOW_LONG[peakDow]), sub: `${fmtNum(model.weekday[peakDow].plays)} rep. · ${fmtMs(model.weekday[peakDow].ms)}`, text: true },
      { label: 'Franja dominante', value: esc(blockNames[peakBlock].split(' ')[0]), sub: `${pctOf(byMs ? model.blocks[peakBlock].ms : model.blocks[peakBlock].plays, totalVal)} · ${fmtMs(model.blocks[peakBlock].ms)}`, text: true },
      { label: 'Fin de semana', value: pctOf(weekendVal, totalVal), sub: `${fmtNum(model.weekday[5].plays + model.weekday[6].plays)} rep. · ${fmtMs(model.weekday[5].ms + model.weekday[6].ms)}` },
      { label: 'Lunes a viernes', value: pctOf(weekdayVal, totalVal), sub: `${fmtNum(model.totals.records - (model.weekday[5].plays + model.weekday[6].plays))} rep. · ${fmtMs(model.totals.ms - (model.weekday[5].ms + model.weekday[6].ms))}` }
    ])}
    <div class="grid-2">
      ${hourChart}
      ${dowChart}
    </div>
    ${card('Las 4 franjas del día', table(['Franja', 'Reproducciones', 'Tiempo', '%', 'Artista #1', 'Canción #1'], blockRows, '', ['', 'n', 'n', 'n', '', ''], null, 'Comparación de las 4 franjas del día'))}
    ${card('Detalle por hora (00:00–23:00)', table(['Hora', 'Total de la hora', 'Canción #1'], hourTrackRows, '', ['c', 'n', ''], null, 'Actividad total y canción más escuchada en cada una de las 24 horas del día'))}`;
}

export function habitsView(model, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const byMs = ctx?.metric === 'ms';
  const t = model.totals;
  const totalVal = byMs ? t.ms : t.records;
  const topKey = byMs ? 'byMs' : 'byPlays';
  const cArt = model.concentration.artists;
  const cTrk = model.concentration.tracks;
  const cAlb = model.concentration.albums;
  const longitudinalMonthly = ctx.longitudinal?.monthly ?? new Map();
  const monthlyRateRows = monthlyBehaviorRows(longitudinalMonthly);

  const concRows = [['Artistas', cArt], ['Canciones', cTrk], ['Álbumes', cAlb]].map(([label, concentration]) => [
    label, fmtNum(concentration.knownEntities), fmtNum(concentration.unknownEntities),
    concentration.knownEntities ? fmtNum(Math.round(concentration.effective)) : '—',
    ...['hhi', 'gini', 'entropy'].map((field) => concentration.knownEntities ? fmtPct(concentration[field]) : '—')
  ]);

  const paretoRows = [
    ['Artistas', paretoShare(model.artists.top[topKey], 1, byMs, totalVal), paretoShare(model.artists.top[topKey], 5, byMs, totalVal), paretoShare(model.artists.top[topKey], 10, byMs, totalVal), paretoShare(model.artists.top[topKey], 50, byMs, totalVal)],
    ['Canciones', paretoShare(model.tracks.top[topKey], 1, byMs, totalVal), paretoShare(model.tracks.top[topKey], 5, byMs, totalVal), paretoShare(model.tracks.top[topKey], 10, byMs, totalVal), paretoShare(model.tracks.top[topKey], 50, byMs, totalVal)],
    ['Álbumes', paretoShare(model.albums.top[topKey], 1, byMs, totalVal), paretoShare(model.albums.top[topKey], 5, byMs, totalVal), paretoShare(model.albums.top[topKey], 10, byMs, totalVal), paretoShare(model.albums.top[topKey], 50, byMs, totalVal)]
  ];

  const months = fillMonths(sortedMonths(model.monthlyBehavior));
  const skipsLine = contractedLineChart({
    id: 'habits-skips-monthly', title: 'Saltos por mes',
    points: months.map((mi) => {
      const data = model.monthlyBehavior.get(mi);
      return { label: monthLabel(mi), y: data?.skipKnown > 0 ? data.skips : null };
    }),
    format: fmtNum,
    unit: 'reproducciones saltadas',
    base: 'eventos con bandera de salto conocida'
  });
  const shuffleLine = contractedLineChart({
    id: 'habits-shuffle-monthly', title: 'Aleatorio por mes',
    points: months.map((mi) => {
      const data = model.monthlyBehavior.get(mi);
      return { label: monthLabel(mi), y: data?.shuffleKnown > 0 ? data.shuffle : null };
    }),
    format: fmtNum,
    unit: 'reproducciones en aleatorio',
    base: 'eventos con bandera de aleatorio conocida'
  });
  const offlineLine = contractedLineChart({
    id: 'habits-offline-monthly', title: 'Sin conexión por mes',
    points: months.map((mi) => {
      const data = model.monthlyBehavior.get(mi);
      return { label: monthLabel(mi), y: data?.offlineKnown > 0 ? data.offline : null };
    }),
    format: fmtNum,
    unit: 'reproducciones sin conexión',
    base: 'eventos con bandera de sin conexión conocida'
  });

  const transLimit = resolveLimit(ctx, 'habits-transitions', 10);
  const pairsLimit = resolveLimit(ctx, 'habits-pairs', 10);
  const oneHitLimit = resolveLimit(ctx, 'habits-onehit', 10);
  const deepLimit = resolveLimit(ctx, 'habits-deep', 10);
  const forgArtLimit = resolveLimit(ctx, 'habits-forg-art', 10);
  const forgTrkLimit = resolveLimit(ctx, 'habits-forg-trk', 10);

  const transRows = model.transitions.top.slice(0, transLimit).map((x, i) => [
    String(i + 1),
    x.from > 0 ? entityLink('artist', x.from, x.fromName) : esc(x.fromName),
    x.to > 0 ? entityLink('artist', x.to, x.toName) : esc(x.toName),
    fmtNum(x.count),
    x.repeat ? 'repeat' : 'cambio'
  ]);

  const pairRows = model.pairs.slice(0, pairsLimit).map((p, i) => [
    String(i + 1),
    esc(reasonLabel(p.start)),
    esc(reasonLabel(p.end)),
    fmtNum(p.count),
    pctOf(p.count, t.records)
  ]);

  const oneHitRows = (model.tables.oneHitWonders ?? []).slice(0, oneHitLimit).map((x, i) => {
    const topTk = x.topTrack?.tk ?? x.topTrackTk;
    const topName = x.topTrack?.name ?? x.topTrackName ?? '';
    const topPlays = x.topTrack?.plays ?? x.topTrackPlays ?? 0;
    return [
      String(i + 1),
      entityLink('artist', x.id, x.name),
      topTk ? trackSubLink(topTk, topName, x.name) : esc(topName),
      fmtPct(x.share),
      `${fmtNum(topPlays)} / ${fmtNum(x.plays)}`
    ];
  });

  const deepRows = (model.tables.deepCatalog ?? []).slice(0, deepLimit).map((x, i) => [
    String(i + 1),
    entityLink('artist', x.id, x.name),
    fmtNum(x.trackCount ?? x.tracks?.size ?? 0),
    fmtNum(x.albumCount ?? x.albums?.size ?? 0),
    fmtNum(x.plays),
    fmtMs(x.ms)
  ]);

  const forgArtRows = (model.tables.forgotten?.artists ?? []).slice(0, forgArtLimit).map((a, i) => [
    String(i + 1),
    entityLink('artist', a.id, a.name),
    fmtNum(a.plays),
    fmtMs(a.ms),
    a.daysSinceEnd != null && a.daysSinceNow != null
      ? `${esc(fmtLocal(a.lastTs))} <span class="cell-sub">(${fmtNum(a.daysSinceEnd)}d del fin · ${fmtNum(a.daysSinceNow)}d de hoy)</span>`
      : esc(fmtLocal(a.lastTs))
  ]);

  const forgTrkRows = (model.tables.forgotten?.tracks ?? []).slice(0, forgTrkLimit).map((tr, i) => [
    String(i + 1),
    trackSubLink(tr.tk, tr.name, tr.artist),
    fmtNum(tr.plays),
    fmtMs(tr.ms),
    tr.daysSinceEnd != null && tr.daysSinceNow != null
      ? `${esc(fmtLocal(tr.lastTs))} <span class="cell-sub">(${fmtNum(tr.daysSinceEnd)}d del fin · ${fmtNum(tr.daysSinceNow)}d de hoy)</span>`
      : esc(fmtLocal(tr.lastTs))
  ]);

  return `
    <header class="view-header">
      <h1>Hábitos, concentración y transiciones</h1>
      <p class="view-meta">Diversidad matemática del catálogo, comportamiento mensual, cadenas de Markov y curiosidades</p>
    </header>
    ${kpis([
      { label: 'Tasa de salto', value: pctOf(t.skipped, t.skippedKnown), sub: `${fmtNum(t.skipped)} saltadas` },
      { label: 'Tasa de aleatorio', value: pctOf(t.shuffle, t.shuffleKnown), sub: `${fmtNum(t.shuffle)} en aleatorio` },
      { label: 'Sin conexión', value: pctOf(t.offline, t.offlineKnown), sub: `${fmtNum(t.offline)} sin conexión` },
      { label: 'Sesiones con repeticiones', value: fmtNum(model.intraSession.sessionsWithRepeats), sub: `${fmtNum(model.intraSession.repeatedPlays)} repeticiones` },
      { label: 'Mismo artista seguido', value: fmtNum(model.transitions.auto), sub: 'auto-transiciones' },
      { label: 'Artistas efectivos', value: cArt.knownEntities ? `~${fmtNum(Math.max(1, Math.round(cArt.effective)))}` : '—', sub: cArt.knownEntities ? `HHI ${fmtPct(cArt.hhi)}` : 'Sin duraciones conocidas' }
    ])}
    <div class="grid-2">
      ${card('Índices de concentración y diversidad', table(['Entidad', 'Con duración conocida', 'Excluidos', 'Efectivos exp(H)', 'HHI', 'Gini', 'Entropía norm.'], concRows, '', ['', 'n', 'n', 'n', 'n', 'n', 'n'], null, 'Índices matemáticos de concentración y diversidad'))}
      ${card(`Curva de Pareto (% acumulado por ${byMs ? 'tiempo' : 'reproducciones'})`, table(['Entidad', 'Top 1', 'Top 5', 'Top 10', 'Top 50'], paretoRows, '', ['', 'n', 'n', 'n', 'n'], null, 'Porcentaje acumulado del catálogo por los primeros N elementos'))}
    </div>
    <div class="grid-2">
      ${skipsLine}
      ${shuffleLine}
      ${offlineLine}
    </div>
    ${card('Tasas mensuales con base conocida', monthlyRateRows.length
      ? staticPagedTable('monthly-behavior', ['Mes', 'Saltos', 'Salto conocido', 'Salto desconocido', 'Tasa de salto', 'Aleatorio', 'Aleatorio conocido', 'Aleatorio desconocido', 'Tasa aleatoria', 'Sin conexión', 'Bandera conocida', 'Bandera desconocida', 'Tasa sin conexión'], monthlyRateRows, ['', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n'], 'Conteos y tasas mensuales con denominadores de banderas conocidas')
      : '<p class="empty">No hay meses con actividad en esta selección.</p>')}
    <div class="grid-2">
      ${cardWithLimit('Transiciones entre artistas', 'habits-transitions', transLimit, transRows.length
        ? table(['#', 'De', 'A', 'Veces', 'Tipo'], transRows, '', ['c', '', '', 'n', ''], null, 'Transiciones consecutivas entre artistas')
        : '<p class="empty">Sin transiciones destacadas (mínimo 5 repeticiones).</p>')}
      ${cardWithLimit('Pares de inicio → fin de pista', 'habits-pairs', pairsLimit, pairRows.length
        ? table(['#', 'Inicio', 'Fin', 'Veces', '%'], pairRows, '', ['c', '', '', 'n', 'n'], null, 'Combinaciones de razón de inicio y razón de fin')
        : '<p class="empty">Sin pares registrados.</p>')}
    </div>
    <div class="grid-2">
      ${cardWithLimit('One-hit wonders (≥80% en 1 canción)', 'habits-onehit', oneHitLimit, oneHitRows.length
        ? table(['#', 'Artista', 'Canción dominante', 'Concentración', 'Reproducciones'], oneHitRows, '', ['c', '', '', 'n', 'n'], null, 'Artistas cuyas reproducciones se concentran en una sola canción')
        : '<p class="empty">Sin artistas con ≥80% en una sola canción (mínimo 20 reproducciones).</p>', '', catalogHref(ctx, 'artists', 'dominance', 'minPlays', 20))}
      ${cardWithLimit('Catálogo profundo (más canciones distintas)', 'habits-deep', deepLimit, deepRows.length
        ? table(['#', 'Artista', 'Canciones', 'Álbumes', 'Reproducciones', 'Tiempo'], deepRows, '', ['c', '', 'n', 'n', 'n', 'n'], null, 'Artistas con más canciones distintas escuchadas')
        : '<p class="empty">Sin datos.</p>', '', catalogHref(ctx, 'artists', 'deepCatalog'))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Artistas olvidados', 'habits-forg-art', forgArtLimit, forgArtRows.length
        ? table(['#', 'Artista', 'Reproducciones', 'Tiempo', 'Última escucha'], forgArtRows, '', ['c', '', 'n', 'n', ''], null, 'Artistas con al menos 15 reproducciones cuya última escucha fue hace más tiempo')
        : '<p class="empty">Sin artistas con ≥15 reproducciones.</p>', '', catalogHref(ctx, 'artists', 'forgotten', 'minPlays', 15))}
      ${cardWithLimit('Canciones olvidadas', 'habits-forg-trk', forgTrkLimit, forgTrkRows.length
        ? table(['#', 'Canción', 'Reproducciones', 'Tiempo', 'Última escucha'], forgTrkRows, '', ['c', '', 'n', 'n', ''], null, 'Canciones con al menos 15 reproducciones cuya última escucha fue hace más tiempo')
        : '<p class="empty">Sin canciones con ≥15 reproducciones.</p>', '', catalogHref(ctx, 'tracks', 'forgotten', 'minPlays', 15))}
    </div>`;
}

export function wrappedView(model, id, ctx) {
  const { entityLink } = entityLinks(model, ctx?.query);
  const t = model.totals;
  const byMs = ctx?.metric === 'ms';
  const evoByMs = (ctx?.metric ?? 'ms') === 'ms';
  const topArtist = model.artists.top[evoByMs ? 'byMs' : 'byPlays'][0];
  const topTrack = model.tracks.top[evoByMs ? 'byMs' : 'byPlays'][0];
  const c = model.concentration.artists;
  const archetype = listenerArchetype(model);
  const onlyYear = ctx?.range ? matchRangeShortcut(ctx.range).year
    : ctx?.years?.size === 1 ? [...ctx.years][0] : null;
  const period = ctx?.range ? rangeChipLabel(ctx.range) : `${fmtLocal(model.meta.firstTs)} → ${fmtLocal(model.meta.lastTs)}`;
  const title = onlyYear != null ? `Tu ${onlyYear} en resumen` : 'Tu período en resumen';

  const sprint = topArtist
    ? monthlySeries(evoByMs ? model.monthlyArtistMs : model.monthlyArtistPlays, topArtist.id)
    : [];
  const sprintChart = topArtist
    ? contractedLineChart({
      id: 'wrapped-artist-monthly', title: `Evolución de ${topArtist.name}`, points: sprint,
      format: evoByMs ? fmtMs : fmtNum,
      unit: evoByMs ? 'tiempo escuchado' : 'reproducciones',
      base: evoByMs ? 'duración conocida del artista' : 'reproducciones del artista'
    })
    : '';

  // Show effective artists prominently; raw HHI values are hard to interpret.
  const eff = c.knownEntities ? Math.max(1, Math.round(c.effective)) : 0;
  const effNoun = eff === 1 ? 'artista base' : 'artistas base';
  const hhiPct = c.knownEntities ? `${(c.hhi * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` : '—';

  const clockSrc = byMs ? model.dayHourMs : model.dayHour;
  const clockCells = [];
  let maxVal = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = clockSrc[d * 24 + h];
      if (v > maxVal) maxVal = v;
      clockCells.push({ hour: h, dow: d, value: v });
    }
  }
  const clockChart = contractedClockChart({
    id: 'wrapped-week-clock',
    title: 'Tu semana típica',
    cells: clockCells,
    format: byMs ? fmtMs : fmtNum,
    byMs,
    base: byMs ? 'duración conocida del período' : 'reproducciones del período',
    svg: listeningClock({
      cells: clockCells,
      colorScale: makeScale(maxVal),
      cellTitle: (cell) => `${DOW_LONG[cell.dow]} ${cell.hour}:00 — ${byMs ? fmtMs(cell.value) : `${fmtNum(cell.value)} reproducciones`}`
    })
  });

  const unknownFlagsNote = (t.records - t.skippedKnown > 0)
    ? ` Nota: ${fmtNum(t.records - t.skippedKnown)} eventos tienen bandera de salto desconocida.`
    : '';
  const heroHTML = archetype
    ? `<section class="card hero-archetype">
        <p class="hero-eyebrow">Perfil de escucha</p>
        <h2 class="hero-title">${esc(archetype.label)}</h2>
        <p class="hero-detail">${esc(archetype.detail)}</p>
        <details class="archetype-rules">
          <summary>Patrón heurístico: reglas descriptivas</summary>
          <p class="view-meta">Clasificación descriptiva basada en umbrales estadísticos de tus datos locales: Explorador (saltos conocidos ≥ 35%), Devoto (concentración HHI ≥ 8%), o Equilibrado; combinado con la franja horaria más frecuente. No constituye diagnóstico psicológico ni de personalidad.${unknownFlagsNote}</p>
        </details>
      </section>`
    : '';

  return `
    <header class="view-header">
      <h1>${esc(title)}</h1>
      <p class="view-meta">${esc(period)} · generado ${new Date(model.meta.generatedAt * 1000).toLocaleString('es-ES')}</p>
    </header>
    ${heroHTML}
    ${kpis([
      { label: onlyYear != null ? 'Artista del año' : 'Artista del período', value: topArtist ? entityLink('artist', topArtist.id, topArtist.name) : '—', text: true },
      { label: onlyYear != null ? 'Canción del año' : 'Canción del período', value: topTrack ? entityLink('track', topTrack.tk, topTrack.name) : '—', text: true },
      { label: 'Tiempo total', value: fmtMs(t.ms) },
      { label: 'Reproducciones', value: fmtNum(t.records) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—' },
      { label: 'Artistas efectivos', value: eff ? `~${eff} ${effNoun}` : '—', sub: eff ? `Equivale a repartir tu tiempo en partes iguales entre ${eff} ${eff === 1 ? 'artista' : 'artistas'}` : 'Sin duraciones conocidas', text: true },
      { label: 'Concentración (HHI)', value: hhiPct }
    ])}
    <div class="grid-2">
      ${sprintChart}
      ${clockChart}
    </div>
    <div class="grid-2">
      ${card('Así empezó', `<ul class="receipt">
        <li><span>Primera escucha</span><span>${esc(fmtLocal(model.meta.firstEventLocal ?? model.cols?.loc[0] ?? null))}</span></li>
        ${topArtist ? `<li><span>Primera vez con ${esc(topArtist.name)}</span><span>${esc(fmtLocal(topArtist.firstTs))}</span></li>` : ''}
        ${topTrack ? `<li><span>Primera vez con ${esc(topTrack.name)}</span><span>${esc(fmtLocal(topTrack.firstTs))}</span></li>` : ''}
      </ul>`)}
      ${card('Resumen', `<ul class="receipt">
        <li><span>Reproducciones</span><span>${fmtNum(t.records)}</span></li>
        <li><span>Tiempo escuchado</span><span>${fmtMs(t.ms)}</span></li>
        <li><span>Artistas distintos</span><span>${fmtNum(model.artists.byId.size)}</span></li>
        <li><span>Canciones distintas</span><span>${fmtNum(model.tracks.byId.size)}</span></li>
        <li><span>Álbumes distintos</span><span>${fmtNum(model.albums.byId.size)}</span></li>
        <li><span>Sesiones de escucha</span><span>${fmtNum(model.sessionsStats.count)}</span></li>
        <li><span>Saltadas</span><span>${fmtNum(t.skipped)} (${pctOf(t.skipped, t.skippedKnown)})</span></li>
        <li><span>En aleatorio</span><span>${fmtNum(t.shuffle)} (${pctOf(t.shuffle, t.shuffleKnown)})</span></li>
        <li><span>Sin conexión</span><span>${fmtNum(t.offline)} (${pctOf(t.offline, t.offlineKnown)})</span></li>
        <li><span>Repetidas dentro de sesión</span><span>${fmtNum(model.intraSession.repeatedPlays)}</span></li>
        <li><span>Mismo artista seguido</span><span>${fmtNum(model.transitions.auto)}</span></li>
      </ul>
      <div class="receipt-actions"><button type="button" class="btn btn-secondary" data-action="copy-receipt">Copiar resumen en texto</button></div>
      <pre id="receipt-text" class="receipt-plain" hidden></pre>`)}
    </div>`;
}

export function receiptText(model, ctx = {}) {
  const t = model.totals;
  const evoByMs = (ctx?.metric ?? 'ms') === 'ms';
  const topArtist = model.artists.top[evoByMs ? 'byMs' : 'byPlays']?.[0];
  const topTrack = model.tracks.top[evoByMs ? 'byMs' : 'byPlays']?.[0];
  const onlyYear = ctx?.range ? matchRangeShortcut(ctx.range)?.year
    : ctx?.years?.size === 1 ? [...ctx.years][0] : null;
  const isFullYear = onlyYear != null;
  const periodLabel = ctx?.range ? rangeChipLabel(ctx.range)
    : ctx?.years?.size ? [...ctx.years].sort((a, b) => a - b).join(', ')
      : (model.meta.firstTs != null ? `${fmtLocal(model.meta.firstTs)} → ${fmtLocal(model.meta.lastTs)}` : '—');
  const tzLabel = model.meta.tzId || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC');
  const metricLabel = evoByMs ? 'Tiempo escuchado' : 'Reproducciones';
  const filters = ctx?.filters ?? {};
  const filterParts = [];
  if (filters.months?.size) filterParts.push(`meses: ${[...filters.months].sort((a, b) => a - b).map(monthLabel).join(', ')}`);
  if (filters.dows?.size) {
    const weekdays = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
    filterParts.push(`días: ${[...filters.dows].sort((a, b) => a - b).map((day) => weekdays[day]).join(', ')}`);
  }
  if (filters.hours?.size) filterParts.push(`horas: ${[...filters.hours].sort((a, b) => a - b).map((hour) => String(hour).padStart(2, '0')).join(', ')}`);
  for (const [id, kind, label] of [
    [filters.artistId, 'artists', 'Artista'],
    [filters.trackId, 'tracks', 'Canción'],
    [filters.albumId, 'albums', 'Álbum']
  ]) {
    if (id == null) continue;
    const entity = model[kind].byId.get(id);
    filterParts.push(`${label}: ${entity ? `${entity.name}${entity.artist ? ` — ${entity.artist}` : ''}` : id}`);
  }
  for (const [key, label] of [['skip', 'Saltada'], ['shuffle', 'Aleatoria'], ['offline', 'Sin conexión']]) {
    if (filters[key] != null) filterParts.push(`${label}: ${filters[key] === 'unknown' ? 'desconocida' : filters[key] ? 'sí' : 'no'}`);
  }

  const lines = [
    isFullYear ? `Mi resumen Scrobbleview (año ${onlyYear})` : 'Mi resumen Scrobbleview (del período)',
    `Período: ${periodLabel}`,
    `Zona horaria: ${tzLabel}`,
    `Criterio principal: ${metricLabel}`,
    ...(filterParts.length ? [`Filtros: ${filterParts.join('; ')}`] : []),
    `Reproducciones: ${t.records}`,
    `Tiempo escuchado: ${fmtMs(t.ms)}`,
    `Artistas distintos: ${model.artists.byId.size}`,
    `Canciones distintas: ${model.tracks.byId.size}`,
    `Sesiones: ${model.sessionsStats.count}`,
    `${isFullYear ? 'Artista del año' : 'Artista del período'}: ${topArtist ? topArtist.name : '—'}`,
    `${isFullYear ? 'Canción del año' : 'Canción del período'}: ${topTrack ? `${topTrack.name} — ${topTrack.artist}` : '—'}`,
    `Saltadas: ${t.skipped}`,
    `Racha más larga: ${model.streak.len} días`
  ];
  return lines.join('\n');
}

export function receiptTextFromConfirmed({ confirmed, fallbackModel, fallbackState = {}, fallbackMetric = 'ms' }) {
  const model = confirmed?.model ?? fallbackModel;
  if (!model) return '';
  const state = confirmed?.context?.state ?? fallbackState;
  return receiptText(model, {
    range: state.range,
    years: state.years,
    filters: state,
    metric: confirmed?.context?.metric ?? fallbackMetric
  });
}

export function exploreView(model, ctx = {}) {
  const exp = ctx.exploreState || {};
  const { tab, pool, options } = describeCatalogQuery(model, ctx);
  const { metric, query, sortBy, sortDir, minPlays, minMonths, minKnownSkips } = options;
  const density = exp.density || 'comfortable';
  const visibleCols = exp.visibleCols || null;
  const queryResult = queryCatalog(pool, options);

  const tabBtn = (id, label) => `<button type="button" role="tab" id="explore-tab-${id}" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" class="${tab === id ? 'active' : ''}" data-explore-tab="${id}">${label}</button>`;
  const tabName = tab === 'artists' ? 'artistas' : tab === 'tracks' ? 'canciones' : 'álbumes';

  let thresholdControl = '';
  if (sortBy === 'skipRate' || sortBy === 'lowSkipRate') {
    thresholdControl = `
      <label class="explore-threshold-label">
        <span>Mín. eventos conocidos:</span>
        <input type="number" min="1" max="10000" data-min-plays value="${minKnownSkips}" class="pagination-select" aria-label="Mínimo de eventos con bandera conocida">
      </label>`;
  } else if (sortBy === 'intensity' || sortBy === 'dominance' || sortBy === 'forgotten') {
    thresholdControl = `
      <label class="explore-threshold-label">
        <span>Mín. reproducciones:</span>
        <input type="number" min="1" max="10000" data-min-plays value="${minPlays}" class="pagination-select" aria-label="Mínimo de reproducciones">
      </label>`;
  } else if (sortBy === 'constancy') {
    thresholdControl = `
      <label class="explore-threshold-label">
        <span>Mín. meses activos:</span>
        <input type="number" min="1" max="120" data-min-months value="${minMonths ?? 6}" class="pagination-select" aria-label="Mínimo de meses activos">
      </label>`;
  }

  const toolbar = `
    <div class="explore-toolbar">
      <div class="explore-toolbar-left">
        <div class="tabs" role="tablist" aria-label="Explorar catálogo">
          ${tabBtn('artists', 'Artistas')}${tabBtn('tracks', 'Canciones')}${tabBtn('albums', 'Álbumes')}
        </div>
      </div>
      <div class="explore-toolbar-right">
        ${thresholdControl}
        ${densityControlsHTML(density)}
        ${columnsPickerHTML(tab, visibleCols)}
        <button type="button" class="btn btn-secondary btn-sm" data-action="export-table" data-total-matches="${queryResult.totalMatches}" data-sort-direction="${queryResult.effectiveDir}" title="Preparar ZIP con las ${queryResult.totalMatches} coincidencias y su metadata">Exportar tabla (${queryResult.totalMatches})</button>
      </div>
    </div>
    <div class="explore-search-wrap">
      <input type="search" class="explore-search" data-explore-search placeholder="Buscar en ${tabName}…" value="${esc(query)}" aria-label="Buscar en catálogo">
    </div>`;

  const routeParams = new URLSearchParams((ctx.query ?? '').replace(/^\?/, ''));
  const routeState = [
    ['tab', tab],
    ['q', query],
    ['sort', sortBy],
    ['dir', queryResult.effectiveDir || sortDir],
    ['page', queryResult.page],
    ['pageSize', queryResult.pageSize],
    ['minPlays', minPlays],
    ['minMonths', minMonths],
    ['minKnownSkips', minKnownSkips]
  ];
  for (const [key, value] of routeState) {
    if (value == null || value === '') routeParams.delete(key);
    else routeParams.set(key, String(value));
  }
  const entityQuery = routeParams.toString() ? `?${routeParams}` : '';

  const tableHtml = catalogTableHTML(queryResult, {
    tab,
    metric,
    sortBy,
    sortDir: queryResult.effectiveDir || sortDir,
    query,
    visibleCols,
    density,
    queryParamStr: entityQuery,
    spark: (item) => rowSeries(model, tab, metric, item.id ?? item.tk)
  });

  const paginationHtml = paginationControlsHTML(queryResult);

  return `
    <div class="view-header">
      <h1>Explorar catálogo completo</h1>
      <p class="view-meta">Consulta, filtrado y ordenamiento de todo tu historial sin límites prefijados.</p>
    </div>
    <div class="card explore-card" id="explore-card">
      ${toolbar}
      <div role="tabpanel" id="explore-panel" tabindex="0" aria-labelledby="explore-tab-${tab}">
        ${tableHtml}
        ${paginationHtml}
      </div>
    </div>`;
}

export const VIEWS = {
  dashboard: (model, id, ctx) => dashboard(model, ctx),
  explore: (model, id, ctx) => exploreView(model, ctx),
  compare: (model, id, ctx) => compareView(model, id, ctx),
  artist: (model, id, ctx) => artistView(model, Number(id), ctx),
  track: (model, id, ctx) => trackView(model, Number(id), ctx),
  album: (model, id, ctx) => albumView(model, Number(id), ctx),
  session: (model, id, ctx) => sessionView(model, Number(id), ctx),
  day: (model, id, ctx) => dayView(model, id, ctx),
  hours: (model, id, ctx) => hoursView(model, ctx),
  habits: (model, id, ctx) => habitsView(model, ctx),
  sessions: (model, id, ctx) => sessionsView(model, ctx),
  discovery: (model, id, ctx) => discoveryView(model, ctx),
  yearly: (model, id, ctx) => yearlyView(model, ctx),
  calendar: (model, id, ctx) => (id ? calendarView(model, Number(id), ctx) : calendarIndexView(model, ctx)),
  wrapped: (model, id, ctx) => wrappedView(model, id, ctx)
};

export function renderView(name, model, id, ctx) {
  if (!Object.hasOwn(VIEWS, name)) return `<p class="empty">Vista desconocida: ${esc(name)}</p>`;
  return VIEWS[name](model, id, ctx);
}
