// app/views.js — render de las 7 vistas desde StatsModel
//
// Funciones puras: (model, ctx) → string HTML. ctx = { tz } (por ahora).
// Navegación entre vistas por hash (#/artist/123, #/track/…, #/album/…).
// Los gráficos son componentes SVG puros de src/charts.js.

import {
  barChart, lineChart, heatmap, heatmapTable, hbarChart, sparkline,
  calendarGrid, listeningClock, stackedBar, heatLegend, NO_DATA,
  esc, fmtNum, fmtMs, fmtPct, fmtBytes, makeScale, MONTHS_SHORT, DOW_SHORT, DOW_LONG, PALETTE
} from '../src/charts.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';

const CHEVRON_SVG = '<svg class="chevron" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';

function card(title, body, cls = '', titleHtml = false) {
  const h = title ? `<h2>${titleHtml ? title : esc(title)}</h2>` : '';
  return `<section class="card ${cls}">${h}${body}</section>`;
}

function limitSelect(key, currentLimit, label) {
  return `<select class="table-limit" name="limit-${esc(key)}" autocomplete="off" data-table-limit="${esc(key)}" aria-label="${esc(label)}">${[10, 25, 50, 100].map((n) => `<option value="${n}"${currentLimit === n ? ' selected' : ''}>Top ${n}</option>`).join('')}</select>`;
}

function cardWithLimit(title, key, limit, body, cls = '') {
  const content = limit >= 25
    ? body.replace('class="table-scroll"', 'class="table-scroll table-scroll--tall"')
    : body;
  return `<section class="card ${cls}"><div class="card-head"><h2>${esc(title)}</h2>${limitSelect(key, limit, `Cantidad en ${title}`)}</div>${content}</section>`;
}

function resolveLimit(ctx, key, fallback = 10) {
  const store = ctx?.limits ?? ctx?.tableLimits;
  if (!store) return fallback;
  const val = store instanceof Map ? store.get(key) : store[key];
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

// `value` llega como HTML seguro (formatters numéricos o entityLink()):
// todo string de dato debe ser escapado por el llamador ANTES de entrar
// acá. `label` y `sub` se escapan en esta función.
function kpis(items) {
  return `<dl class="kpis">${items.map((it) => `
    <div class="kpi${it.text ? ' kpi-text' : ''}"><dt>${esc(it.label)}</dt><dd>${it.value}${it.sub ? `<span class="kpi-sub">${esc(it.sub)}</span>` : ''}</dd></div>`).join('')}</dl>`;
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

// Códigos de reason_start/reason_end de Spotify → etiquetas cortas en español
// (los gráficos de razones no deben desbordar). Los códigos sin mapeo quedan
// crudos: preferible a inventar una traducción dudosa.
const REASON_LABELS = new Map([
  ['trackdone', 'Canción completa'],
  ['fwdbtn', 'Botón siguiente'],
  ['backbtn', 'Botón anterior'],
  ['clickrow', 'Clic en pista'],
  ['appload', 'Inicio de app'],
  ['appstart', 'Inicio de app'],
  ['endplay', 'Cierre de sesión'],
  ['logout', 'Cierre de sesión'],
  ['remote', 'Control remoto'],
  ['unexpected-exit', 'Cierre inesperado'],
  ['shuffle', 'Aleatorio']
]);
const reasonLabel = (code) => REASON_LABELS.get(code) ?? code;

// Umbral de los KPIs (minMs/skipThresholdMs vienen de meta y son
// configurables): "+30 s", "+1,5 s" o "+500 ms" según el valor.
function thresholdLabel(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  return Number.isInteger(s) ? `${s} s` : `${s.toFixed(1).replace('.', ',')} s`;
}

// Fallback de tabla para los relojes (hora × día): teclado/lector de pantalla
// no puede leer valores desde el SVG (el heatmap del dashboard ya lo tiene).
function clockTable(cells, byMs = false) {
  return heatmapTable({
    cells: cells.map((c) => ({ x: c.hour, y: c.dow, value: c.value })),
    xLabels: Array.from({ length: 24 }, (_, h) => `${h}`),
    yLabels: DOW_SHORT,
    cellText: (c) => (byMs ? fmtMs(c.value) : fmtNum(c.value)),
    caption: byMs ? 'Tiempo escuchado por hora y día' : 'Reproducciones por hora y día'
  });
}

// Fallback del calendario: 12 meses × 31 días del mes. Los días sin entrada
// quedan como celda vacía (heatmapTable no encuentra el par x-y).
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

// `rows` es HTML YA escapado por el llamador: las celdas reciben markup (enlaces
// de entidad, <span> de color), por eso no se escapan aquí. Todo valor de dato
// debe pasar por esc() o entityLink() ANTES de entrar en `rows`.
// El scroll horizontal vive en .table-scroll (solo la tabla scrollea; el h2 de
// la card queda fijo). Sin tabindex: el scroll sigue al foco de los enlaces.
// `rowAttrs(r, i)` emite atributos por <tr> (ej. la barra proporcional).
// `caption` es para lectores de pantalla (visually-hidden): el h2 de la card
// no viaja con la tabla al scrollear, así que la tabla sin caption queda
// anónima fuera de contexto (WCAG H51/H63).
function table(headers, rows, cls = '', colClasses = [], rowAttrs = null, caption = '', scrollCls = '') {
  const th = (h, i) => `<th scope="col"${colClasses[i] ? ` class="${colClasses[i]}"` : ''}>${esc(h)}</th>`;
  const td = (c, i) => `<td${colClasses[i] ? ` class="${colClasses[i]}"` : ''}>${c}</td>`;
  const cap = caption ? `<caption class="visually-hidden">${esc(caption)}</caption>` : '';
  const wrapCls = scrollCls ? `table-scroll ${scrollCls}` : 'table-scroll';
  return `<div class="${wrapCls}"><table class="${cls}">${cap}<thead><tr>${headers.map(th).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr${rowAttrs ? rowAttrs(r, i) : ''}>${r.map(td).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function rankTable(rows, { valueFmt = fmtNum, subValue = null, link = null, valueLabel = 'Reproducciones', caption = '', spark = null, tall = false }) {
  // Con `sub` (ej. artista de un álbum) el nombre se apila en 2 líneas:
  // título como enlace, sub en gris secundario. El title del enlace lleva
  // el nombre completo "título — sub".
  const cell = (r) => {
    const full = r.sub ? `${r.name} — ${r.sub}` : r.name;
    const inner = r.sub
      ? `<span class="cell-name">${esc(r.name)}</span><span class="cell-sub">${esc(r.sub)}</span>`
      : `<span class="cell-name">${esc(r.name)}</span>`;
    return link
      ? `<a class="cell-link" href="${link(r)}" title="${esc(full)}">${inner}</a>`
      : `<span class="cell-link" title="${esc(full)}">${inner}</span>`;
  };
  // Barra proporcional al máximo visible (rows[0] tras el orden desc): el
  // largo compara de un vistazo sin leer los números.
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

// El title revela el nombre truncado por ellipsis (en táctil no hay tooltip:
// el enlace navega a la ficha, donde están los detalles).
function entityLink(type, id, name) {
  return `<a class="cell-name" href="#/${type}/${id}" title="${esc(name)}">${esc(name)}</a>`;
}

function trackSubLink(tk, name, artist) {
  if (!artist) return entityLink('track', tk, name);
  const full = `${name} — ${artist}`;
  return `<a class="cell-link" href="#/track/${tk}" title="${esc(full)}"><span class="cell-name">${esc(name)}</span><span class="cell-sub">${esc(artist)}</span></a>`;
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

// Los SVG de barra/línea/apiladas escalan su texto con el ancho de la card:
// en móvil (viewBox 640 → ~296px) los labels de 12px rinden ~5.5px. El piso
// de 480px mantiene ≥9px efectivos (mismo patrón que heat/clock/cal). Región
// focable con nombre: el scroll horizontal es inalcanzable por teclado sin él.
function scrollChart(svg, label) {
  return svg ? `<div class="chart-scroll chart-scroll--bar" tabindex="0" role="region" aria-label="${esc(label)}">${svg}</div>` : '';
}

// Rellena los meses huecos entre el primero y el último (índices YYYYMM):
// sin esto, lineChart espaciaba los puntos por posición del dato y la línea
// mentía (dos puntos consecutivos en el eje aunque distaran un año).
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
  // monthMap: Map<monthIndex, Map<entityId, value>> → [{label, y}]
  return fillMonths(sortedMonths(monthMap)).map((mi) => ({
    label: monthLabel(mi),
    y: monthMap.get(mi)?.get(key) ?? 0
  }));
}

// Serie mensual (solo valores) para la sparkline de una fila de ranking.
// Los álbumes no tienen serie propia en el modelo: se suma la de sus
// canciones (mismo camino que la evolución de albumView).
function rowSeries(model, tab, metric, id) {
  if (tab === 'albums') {
    const al = model.albums.byId.get(id);
    if (!al) return [];
    const src = metric === 'ms' ? model.monthlyTrackMs : model.monthlyTrackPlays;
    return fillMonths(sortedMonths(src)).map((mi) => {
      let v = 0;
      for (const tk of al.tracks) v += src.get(mi)?.get(tk) ?? 0;
      return v;
    });
  }
  const map = tab === 'artists'
    ? (metric === 'ms' ? model.monthlyArtistMs : model.monthlyArtistPlays)
    : (metric === 'ms' ? model.monthlyTrackMs : model.monthlyTrackPlays);
  return monthlySeries(map, id).map((p) => p.y);
}

function pctOf(part, total) {
  return total > 0 ? fmtPct(part / total) : '—';
}

// Sub de KPI comparado contra el período anterior de igual largo. Sin datos
// previos no hay división: se anuncia vacío en vez de inventar un %.
function deltaSub(now, before) {
  if (before <= 0) return 'anterior sin datos';
  const pct = Math.round(((now - before) / before) * 100);
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs período anterior`;
}

// Entrada de mayor valor de un Map (first-wins en empates).
function maxEntry(map, getVal) {
  let best = null;
  for (const entry of map.entries()) if (!best || getVal(entry[1]) > getVal(best[1])) best = entry;
  return best;
}

function recordsGridHTML(model) {
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
    meta: esc(`${fmtNum(model.zeroDays.length)} días sin actividad`)
  });
  return `<div class="records-grid">${tiles.map((t) => `<div class="record-item"><span class="record-label">${esc(t.label)}</span><span class="record-value">${t.val}</span><span class="record-sub">${t.meta}</span></div>`).join('')}</div>`;
}

// Arquetipo de oyente: etiqueta derivada de skip rate, concentración (HHI),
// repeticiones en sesión y franja dominante. Umbrales acotados a mano:
// skip ≥ 35% = explora y descarta; HHI ≥ 0.08 ≈ artista top con ~28% del tiempo.
export function listenerArchetype(model) {
  const t = model.totals;
  if (!t || t.records === 0) return null;
  const skipRate = t.skipped / t.records;
  const c = model.concentration.artists;
  const repeatRate = model.intraSession.repeatedPlays / t.records;
  let dom = 0;
  model.blocks.forEach((b, i) => { if (b.plays > model.blocks[dom].plays) dom = i; });
  const base = skipRate >= 0.35 ? 'Explorador' : c.hhi >= 0.08 ? 'Devoto' : 'Equilibrado';
  const when = dom === 0 || dom === 3 ? 'nocturno' : dom === 1 ? 'matutino' : 'vespertino';
  return {
    label: `${base} ${when}`,
    detail: `${fmtPct(skipRate)} de saltos · ${fmtPct(c.hhi)} de concentración · ${fmtPct(repeatRate)} de repeticiones`
  };
}

// Tarjeta de rankings con controles (pestaña, métrica, top N, buscador).
// Pura: main.js la re-renderiza solo dentro de #rank-card ante cambios de
// estos controles, sin tocar el resto de la vista (no se pierde el foco).
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
    ? (a) => ({ name: a.name, value: byMs ? a.ms : a.plays, id: a.id, link: `#/artist/${a.id}` })
    : tab === 'tracks'
      ? (tr) => ({ name: tr.name, value: byMs ? tr.ms : tr.plays, id: tr.tk, hay: `${tr.name} ${tr.artist}`.toLowerCase(), link: `#/track/${tr.tk}` })
      : (al) => ({ name: al.name, sub: al.artist, value: byMs ? al.ms : al.plays, id: al.id, hay: `${al.name} ${al.artist}`.toLowerCase(), link: `#/album/${al.id}` });

  let rows;
  if (query) {
    // Con búsqueda se recorre el catálogo completo (no solo el top 50).
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

  // Patrón APG de tabs: roving tabindex (solo el activo entra en el orden de
  // tabulación) + panel etiquetado por el tab activo. Las flechas las cablea
  // main.js (activación automática: la selección sigue al foco).
  const tabBtn = (id, label) => `<button type="button" role="tab" id="rank-tab-${id}" aria-selected="${tab === id}" tabindex="${tab === id ? 0 : -1}" class="${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
  const metricBtn = (id, label) => `<button type="button" aria-pressed="${metric === id}" class="${metric === id ? 'active' : ''}" data-metric="${id}">${label}</button>`;
  const tabName = tab === 'artists' ? 'artistas' : tab === 'tracks' ? 'canciones' : 'álbumes';
  const rankCaption = query
    ? `Resultados de búsqueda en ${tabName}`
    : `Ranking de ${tabName} por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`;

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
      })
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
  const w = model.meta.warnings;
  if (w && w.length > 0) {
    const byCode = new Map();
    for (const x of w) byCode.set(x.code, (byCode.get(x.code) || 0) + 1);
    const warnItems = [...byCode.entries()].map(([code, n]) => {
      const labels = WARNING_LABELS[code];
      const label = labels ? (n === 1 ? labels[0] : labels[1]) : code;
      return `${fmtNum(n)} ${label}`;
    });
    const ignoredWord = w.length === 1 ? 'ignorado' : 'ignorados';
    parts.push(`${warnItems.join(', ')} ${ignoredWord}`);
  }
  return parts.join(' · ');
}

// Estado vacío POR FILTROS (distinto del vacío de datos): la vista no tiene
// nada que mostrar hasta aflojar el filtro. El botón lo maneja la delegación
// de data-action="clear" en main.js (los chips usan el mismo camino).
export function emptyFiltersHTML() {
  return `<section class="card"><h2>Sin resultados</h2>
    <p class="empty">Ningún resultado coincide con los filtros activos.</p>
    <p><button type="button" class="btn btn-secondary" data-action="clear">Quitar filtros</button></p>
  </section>`;
}

export function dashboard(model, ctx = {}) {
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

  const monthly = fillMonths(sortedMonths(model.monthly)).map((mi) => ({
    label: monthLabel(mi),
    y: model.monthly.get(mi)?.[byMs ? 'ms' : 'plays'] ?? 0
  }));
  const evolution = lineChart({ points: monthly, format: valFmt });

  const dist = hbarChart({
    rows: t.msDist.map((b) => ({ label: b.label, value: b.count })),
    format: fmtNum
  });

  const rankings = `<div id="rank-card">${rankCardHTML(model, ctx.rankUI)}</div>`;

  const skipRate = t.records > 0 ? fmtPct(t.skipped / t.records) : '—';
  const shuffleRate = t.records > 0 ? fmtPct(t.shuffle / t.records) : '—';
  const offlineRate = t.records > 0 ? fmtPct(t.offline / t.records) : '—';
  const avgDuration = t.records > 0 ? t.ms / t.records : 0;

  const obsLimit = resolveLimit(ctx, 'dash-obsession', 10);
  const bingeLimit = resolveLimit(ctx, 'dash-binge', 10);
  const skipArtLimit = resolveLimit(ctx, 'dash-skip-art', 10);
  const skipTrkLimit = resolveLimit(ctx, 'dash-skip-trk', 10);
  const lowSkipArtLimit = resolveLimit(ctx, 'dash-lowskip-art', 10);
  const lowSkipTrkLimit = resolveLimit(ctx, 'dash-lowskip-trk', 10);
  const firstLimit = resolveLimit(ctx, 'dash-first', 10);
  const lastLimit = resolveLimit(ctx, 'dash-last', 10);

  return `
    <header class="view-header view-header--compact">
      <h1 class="visually-hidden">Resumen</h1>
      <p class="view-meta view-range">${esc(range)}</p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(t.records), sub: prev ? deltaSub(t.records, prev.records) : undefined },
      { label: 'Tiempo escuchado', value: fmtMs(t.ms), sub: prev ? deltaSub(t.ms, prev.ms) : undefined },
      { label: 'Artistas', value: fmtNum(model.artists.byId.size) },
      { label: 'Canciones', value: fmtNum(model.tracks.byId.size) },
      { label: 'Álbumes', value: fmtNum(model.albums.byId.size) },
      { label: 'Sesiones', value: fmtNum(model.sessionsStats.count) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—', sub: model.streak.start != null ? `${fmtDay(model.streak.start)} → ${fmtDay(model.streak.end)}` : undefined },
      { label: 'Duración promedio', value: fmtMs(avgDuration), sub: `mediana ${fmtMs(t.medianMs)}` },
      { label: 'Completas', value: fmtNum(t.completed), sub: `${fmtNum(t.interrupted)} sin terminar` },
      { label: 'Saltadas', value: fmtNum(t.skipped), sub: skipRate },
      { label: 'En aleatorio', value: fmtNum(t.shuffle), sub: shuffleRate },
      { label: 'Sin conexión', value: fmtNum(t.offline), sub: offlineRate },
      { label: 'Escuchas válidas', value: fmtNum(t.playsSignificant), sub: `+${thresholdLabel(model.meta.minMs)}` },
      { label: 'Descartadas', value: fmtNum(t.playsSkipped), sub: `<${thresholdLabel(model.meta.skipThresholdMs)}` }
    ])}
    ${card('Récords', recordsGridHTML(model))}
    ${card('Rankings', rankings)}
    <div class="grid-2">
      ${card('Evolución mensual', scrollChart(evolution, 'Evolución mensual'))}
      ${card('Duración de reproducciones', dist)}
    </div>
    ${card('Cuándo escuchás (día × hora)', `<div class="chart-scroll chart-scroll--heat" tabindex="0" role="region" aria-label="Actividad por hora y día de la semana">${heat}</div>` + heatLegend() + heatTable)}
    <div class="grid-2">
      ${cardWithLimit('Obsesión (reproducciones por día activo)', 'dash-obsession', obsLimit, table(['Canción', 'Intensidad', 'Días', 'Reproducciones', 'Tiempo'], model.tables.obsession.slice(0, obsLimit).map((o) => [
        trackSubLink(o.tk, o.name, o.artist),
        o.intensity.toLocaleString('es-ES', { maximumFractionDigits: 1 }),
        fmtNum(o.days.size),
        fmtNum(o.plays),
        fmtMs(o.ms)
      ]), '', ['', 'n', 'n', 'n', 'n'], null, 'Canciones más escuchadas por día activo'))}
      ${cardWithLimit('Rachas (misma canción seguida)', 'dash-binge', bingeLimit, table(['Canción', 'Racha', 'Reproducciones'], model.tables.binge.slice(0, bingeLimit).map((b) => [
        trackSubLink(b.tk, b.track.name, b.track.artist),
        fmtNum(b.run),
        fmtNum(b.track.plays)
      ]), '', ['', 'n', 'n'], null, 'Canciones repetidas en racha'))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Mayor tasa de salto — Artistas', 'dash-skip-art', skipArtLimit, table(['Artista', 'Saltadas', 'Reproducciones', 'Tasa'], model.tables.skipRate.artists.slice(0, skipArtLimit).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtNum(a.skips),
        fmtNum(a.plays),
        fmtPct(a.skips / a.plays)
      ]), '', ['', 'n', 'n', 'n'], null, 'Artistas con mayor tasa de salto'))}
      ${cardWithLimit('Mayor tasa de salto — Canciones', 'dash-skip-trk', skipTrkLimit, table(['Canción', 'Saltadas', 'Reproducciones', 'Tasa'], model.tables.skipRate.tracks.slice(0, skipTrkLimit).map((tr) => [
        trackSubLink(tr.tk, tr.name, tr.artist),
        fmtNum(tr.skips),
        fmtNum(tr.plays),
        fmtPct(tr.skips / tr.plays)
      ]), '', ['', 'n', 'n', 'n'], null, 'Canciones con mayor tasa de salto'))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Menor tasa de salto — Artistas', 'dash-lowskip-art', lowSkipArtLimit, table(['Artista', 'Saltadas', 'Reproducciones', 'Tasa'], (model.tables.lowSkipRate?.artists ?? []).slice(0, lowSkipArtLimit).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtNum(a.skips),
        fmtNum(a.plays),
        fmtPct(a.skips / a.plays)
      ]), '', ['', 'n', 'n', 'n'], null, 'Artistas con menor tasa de salto'))}
      ${cardWithLimit('Menor tasa de salto — Canciones', 'dash-lowskip-trk', lowSkipTrkLimit, table(['Canción', 'Saltadas', 'Reproducciones', 'Tasa'], (model.tables.lowSkipRate?.tracks ?? []).slice(0, lowSkipTrkLimit).map((tr) => [
        trackSubLink(tr.tk, tr.name, tr.artist),
        fmtNum(tr.skips),
        fmtNum(tr.plays),
        fmtPct(tr.skips / tr.plays)
      ]), '', ['', 'n', 'n', 'n'], null, 'Canciones con menor tasa de salto'))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Primera canción del día', 'dash-first', firstLimit, table(['Canción', 'Días'], model.tables.dayFirst.slice(0, firstLimit).map((d) => [
        trackSubLink(d.tk, d.track.name, d.track.artist),
        fmtNum(d.count)
      ]), '', ['', 'n'], null, 'Canción con la que arranca cada día'))}
      ${cardWithLimit('Última canción del día', 'dash-last', lastLimit, table(['Canción', 'Días'], model.tables.dayLast.slice(0, lastLimit).map((d) => [
        trackSubLink(d.tk, d.track.name, d.track.artist),
        fmtNum(d.count)
      ]), '', ['', 'n'], null, 'Canción con la que cierra cada día'))}
    </div>`;
}

export function artistView(model, ar, ctx = {}) {
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

  const evolution = lineChart({
    points: monthlySeries(byMs ? model.monthlyArtistMs : model.monthlyArtistPlays, ar),
    format: valFmt
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

  const firstTr = a.firstTrackTk ? model.tracks.byId.get(a.firstTrackTk) : null;

  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
      <h1>${esc(a.name)}</h1>
      <p class="view-meta">${fmtNum(a.plays)} reproducciones · ${fmtMs(a.ms)} · ${pctOf(a.ms, totalMs)} del total</p>
      <p><button type="button" class="btn btn-secondary" data-filter-entity="artist:${ar}">Filtrar todo por este artista</button></p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(a.plays) },
      { label: 'Tiempo', value: fmtMs(a.ms) },
      { label: 'Canciones', value: fmtNum(a.tracks ? a.tracks.size : topTracks.length) },
      { label: 'Álbumes', value: fmtNum(a.albums.size) },
      { label: 'Saltadas', value: fmtNum(a.skips), sub: pctOf(a.skips, a.plays) },
      { label: 'Días activos', value: fmtNum(a.days.size) },
      { label: 'Meses activos', value: fmtNum(a.months.size), sub: `${fmtNum(a.years.size)} años` },
      { label: 'Primera canción', value: firstTr ? entityLink('track', a.firstTrackTk, firstTr.name) : '—', text: true },
      { label: 'Primera escucha', value: fmtLocal(a.firstTs) },
      { label: 'Última escucha', value: fmtLocal(a.lastTs) }
    ])}
    <div class="grid-2">
      ${card('Evolución mensual', scrollChart(evolution, 'Evolución mensual'))}
      ${cardWithLimit('Tus canciones de este artista', 'artist-tracks', tracksLimit, rankTable(topTracks.map(({ tr }) => ({ name: tr.name, value: byMs ? tr.ms : tr.plays, plays: tr.plays, ms: tr.ms, id: tr.tk })), {
        valueFmt: valFmt,
        subValue: (r) => (byMs ? `${fmtNum(r.plays)} rep.` : fmtMs(r.ms)),
        valueLabel: valLabel,
        link: (r) => `#/track/${r.id}`,
        caption: `Canciones del artista por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`,
        spark: (r) => rowSeries(model, 'tracks', byMs ? 'ms' : 'plays', r.id)
      }))}
    </div>
    <div class="grid-2">
      ${card('Tu semana con este artista', `<div class="chart-scroll chart-scroll--clock" tabindex="0" role="region" aria-label="Reloj de escucha del artista">${listeningClock({
        cells: clockCells,
        colorScale: makeScale(maxVal),
        cellTitle: (x) => `${DOW_LONG[x.dow]} ${x.hour}:00 — ${byMs ? fmtMs(x.value) : `${fmtNum(x.value)} reproducciones`}`
      })}</div>` + heatLegend() + clockTable(clockCells, byMs))}
      ${cardWithLimit('Álbumes de este artista', 'artist-albums', albumsLimit, albumRows.length
        ? rankTable(albumRows, {
          valueFmt: valFmt,
          subValue: (r) => (byMs ? `${fmtNum(r.plays)} rep.` : fmtMs(r.ms)),
          valueLabel: valLabel,
          link: (r) => `#/album/${r.id}`,
          caption: `Álbumes del artista por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`,
          spark: (r) => rowSeries(model, 'albums', byMs ? 'ms' : 'plays', r.id)
        })
        : '<p class="empty">Sin álbumes registrados.</p>')}
    </div>
    ${cardWithLimit('Transiciones', 'artist-trans', transLimit, transitions.length
      ? table(['De', 'A', 'Veces'], transitions.map((x) => [
          x.from === ar ? `<strong>${esc(x.fromName)}</strong>` : entityLink('artist', x.from, x.fromName),
          x.to === ar ? `<strong>${esc(x.toName)}</strong>` : entityLink('artist', x.to, x.toName),
          fmtNum(x.count)
        ]), '', ['', '', 'n'], null, 'Transiciones hacia y desde este artista')
      : '<p class="empty">Sin transiciones destacadas.</p>')}`;
}

export function trackView(model, tk, ctx = {}) {
  const tr = model.tracks.byId.get(tk);
  if (!tr) return `<p class="empty">Canción no encontrada.</p>`;
  const byMs = (ctx?.metric ?? 'ms') === 'ms';
  const totalMs = model.totals.ms;
  const ar = tk % 4294967296;
  const al = tr.ak > 0 ? model.albums.byId.get(tr.ak) : null;
  const run = model.maxRun.get(tk) ?? 0;
  const evolution = lineChart({
    points: monthlySeries(byMs ? model.monthlyTrackMs : model.monthlyTrackPlays, tk),
    format: byMs ? fmtMs : fmtNum
  });

  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
      <h1>${esc(tr.name)}</h1>
      <p class="view-meta">${entityLink('artist', ar, tr.artist)}${al ? ` · ${entityLink('album', al.id, al.name)}` : ''} · ${fmtNum(tr.plays)} reproducciones · ${fmtMs(tr.ms)} · ${pctOf(tr.ms, totalMs)} del total</p>
      <p><button type="button" class="btn btn-secondary" data-filter-entity="track:${tk}">Filtrar todo por esta canción</button></p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(tr.plays) },
      { label: 'Tiempo', value: fmtMs(tr.ms) },
      { label: 'Duración media', value: fmtMs(tr.plays > 0 ? tr.ms / tr.plays : 0) },
      { label: 'Saltadas', value: fmtNum(tr.skips), sub: pctOf(tr.skips, tr.plays) },
      { label: 'Racha máxima (seguidas)', value: fmtNum(run) },
      { label: 'Días activos', value: fmtNum(tr.days.size) },
      { label: 'Meses activos', value: fmtNum(tr.months ? tr.months.size : 0) },
      { label: 'Primera escucha', value: fmtLocal(tr.firstTs) },
      { label: 'Última escucha', value: fmtLocal(tr.lastTs) }
    ])}
    ${card('Evolución mensual', scrollChart(evolution, 'Evolución mensual'))}`;
}

export function albumView(model, ak, ctx = {}) {
  const al = model.albums.byId.get(ak);
  if (!al) return `<p class="empty">Álbum no encontrado.</p>`;
  const byMs = ctx?.metric === 'ms';
  const evoByMs = (ctx?.metric ?? 'ms') === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const valLabel = byMs ? 'Tiempo' : 'Reproducciones';
  const totalMs = model.totals.ms;
  // ak = ar*2^32 + al: la parte alta es el artista (el residuo es el id del álbum).
  const ar = Math.floor(ak / 4294967296);
  const tracksLimit = resolveLimit(ctx, 'album-tracks', 25);
  const songRows = [...al.tracks]
    .map((tk) => model.tracks.byId.get(tk))
    .filter(Boolean)
    .sort((x, y) => (byMs ? y.ms - x.ms || y.plays - x.plays : y.plays - x.plays || y.ms - x.ms))
    .slice(0, tracksLimit)
    .map((tr) => ({ name: tr.name, value: byMs ? tr.ms : tr.plays, plays: tr.plays, ms: tr.ms, id: tr.tk }));
  const monthTrackMap = evoByMs ? model.monthlyTrackMs : model.monthlyTrackPlays;
  const evolution = lineChart({
    points: fillMonths(sortedMonths(model.monthly)).map((mi) => {
      let sum = 0;
      for (const tk of al.tracks) sum += monthTrackMap.get(mi)?.get(tk) ?? 0;
      return { label: monthLabel(mi), y: sum };
    }),
    format: evoByMs ? fmtMs : fmtNum
  });
  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
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
      ${card('Evolución mensual', scrollChart(evolution, 'Evolución mensual'))}
      ${cardWithLimit('Canciones del álbum', 'album-tracks', tracksLimit, songRows.length
        ? rankTable(songRows, {
          valueFmt: valFmt,
          subValue: (r) => (byMs ? `${fmtNum(r.plays)} rep.` : fmtMs(r.ms)),
          valueLabel: valLabel,
          link: (r) => `#/track/${r.id}`,
          caption: `Canciones del álbum por ${byMs ? 'tiempo escuchado' : 'reproducciones'}`,
          spark: (r) => rowSeries(model, 'tracks', byMs ? 'ms' : 'plays', r.id)
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
  const startHour = [...s.startHour.entries()].sort((a, b) => a[0] - b[0]);
  const monthPoints = fillMonths(sortedMonths(s.byMonth)).map((mi) => ({
    label: monthLabel(mi),
    y: s.byMonth.get(mi) ?? 0
  }));
  const dowData = DOW_SHORT.map((label, d) => ({
    label,
    value: s.byWeekday.get(d) ?? 0
  }));

  const sessRows = (list) => list.map((x) => [
    fmtLocal(x.start),
    fmtMs(x.duration * 1000),
    fmtNum(x.plays),
    fmtMs(x.ms)
  ]);

  return `
    <header class="view-header">
      <h1>Sesiones de escucha</h1>
      <p class="view-meta">Pausa de 30 min entre sesiones</p>
    </header>
    ${kpis([
      { label: 'Sesiones', value: fmtNum(s.count) },
      { label: 'Duración promedio', value: fmtMs(s.avgDuration * 1000) },
      { label: 'Duración mediana', value: fmtMs(s.medianDuration * 1000) },
      { label: 'Reproducciones promedio', value: s.avgPlays.toFixed(1) },
      { label: 'Reproducciones mediana', value: s.medianPlays.toFixed(1) },
      { label: 'Sesiones con repeticiones', value: fmtNum(model.intraSession.sessionsWithRepeats), sub: pctOf(model.intraSession.sessionsWithRepeats, s.count) },
      { label: 'Reproducciones repetidas', value: fmtNum(model.intraSession.repeatedPlays) }
    ])}
    <div class="grid-2">
      ${cardWithLimit('Sesiones más largas', 'sessions-dur', durLimit, table(['Inicio', 'Duración', 'Reproducciones', 'Tiempo'], sessRows(topDur), '', ['', 'n', 'n', 'n'], null, 'Sesiones más largas'))}
      ${cardWithLimit('Sesiones con más reproducciones', 'sessions-plays', playsLimit, table(['Inicio', 'Duración', 'Reproducciones', 'Tiempo'], sessRows(topPlays), '', ['', 'n', 'n', 'n'], null, 'Sesiones con más reproducciones'))}
    </div>
    <div class="grid-2">
      ${card('Sesiones por franja', scrollChart(barChart({ data: blocks, showValue: true }), 'Sesiones por franja'))}
      ${card('Hora de inicio', scrollChart(barChart({ data: startHour.map(([h, n]) => ({ label: `${h}`, value: n })), showValue: false }), 'Hora de inicio'))}
    </div>
    <div class="grid-2">
      ${card('Sesiones por mes', scrollChart(lineChart({ points: monthPoints, format: fmtNum }), 'Sesiones por mes'))}
      ${card('Sesiones por día de la semana', scrollChart(barChart({ data: dowData, showValue: true }), 'Sesiones por día de la semana'))}
    </div>
    <div class="grid-2">
      ${card('Razones de inicio', hbarChart({ rows: [...model.starts.entries()].map(([k, v]) => ({ label: reasonLabel(k), value: v })), format: fmtNum }))}
      ${card('Razones de fin', hbarChart({ rows: [...model.ends.entries()].map(([k, v]) => ({ label: reasonLabel(k), value: v })), format: fmtNum }))}
    </div>`;
}

export function discoveryView(model, ctx = {}) {
  const disc = [...model.monthlyDiscovery.entries()].sort((a, b) => a[0] - b[0]);
  const line = lineChart({
    points: disc.map(([mi, d]) => ({ label: monthLabel(mi), y: d.new })),
    format: fmtNum
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

  return `
    <header class="view-header">
      <h1>Descubrimiento</h1>
      <p class="view-meta">Canciones nuevas por mes</p>
    </header>
    ${kpis([
      { label: 'Canciones descubiertas', value: fmtNum(totalNewTracks), sub: pctOf(totalNewTracks, model.totals.records) },
      { label: 'Repetidas del catálogo', value: fmtNum(totalRepTracks), sub: pctOf(totalRepTracks, model.totals.records) },
      { label: 'Promedio mensual', value: `${avgNewPerMonth} nuevas` },
      { label: 'Artistas únicos', value: fmtNum(model.artists.byId.size) }
    ])}
    ${card('Canciones nuevas por mes', scrollChart(line, 'Canciones nuevas por mes'))}
    <div class="grid-2">
      ${cardWithLimit('Meses con más descubrimientos', 'disc-abs', absLimit, table(['Mes', 'Nuevas', 'Repetidas', 'Reproducciones'], abs.map(([mi, d]) => [monthLabel(mi), fmtNum(d.new), fmtNum(d.rep), fmtNum(d.plays)]), '', ['', 'n', 'n', 'n'], null, 'Meses con más descubrimientos'))}
      ${cardWithLimit('Meses con mayor proporción de nuevas', 'disc-rel', relLimit, table(['Mes', 'Nuevas', 'Repetidas', 'Reproducciones', 'Proporción'], rel.map(([mi, d]) => [monthLabel(mi), fmtNum(d.new), fmtNum(d.rep), fmtNum(d.plays), fmtPct(d.new / d.plays)]), '', ['', 'n', 'n', 'n', 'n'], null, 'Meses con mayor proporción de canciones nuevas'))}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Constancia (artistas de todos los meses)', 'disc-constancy', constLimit, table(['Artista', 'Meses', 'Cobertura'], model.tables.constancy.slice(0, constLimit).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtNum(a.months.size),
        fmtPct(a.coverage)
      ]), '', ['', 'n', 'n'], null, 'Artistas presentes en todos los meses del rango'))}
      ${cardWithLimit('Longevidad (años activos)', 'disc-longevity', longLimit, table(['Artista', 'Años', 'Meses', 'Días'], model.tables.longevity.slice(0, longLimit).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtNum(a.years.size),
        fmtNum(a.months.size),
        fmtNum(a.days.size)
      ]), '', ['', 'n', 'n', 'n'], null, 'Artistas con más años activos'))}
    </div>`;
}

export function yearlyView(model, ctx = {}) {
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
      `<a href="#/calendar/${esc(String(y))}">${esc(String(y))}</a>`,
      fmtNum(d.plays),
      fmtMs(d.ms),
      fmtNum(d.artistsC.size),
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
  const stacked = stackedBar({
    series: years.map((y) => {
      const d = model.yearly.get(y);
      return {
        label: String(y),
        values: byMs ? d.blocksMs : d.blocks,
        total: byMs ? d.ms : d.plays
      };
    }),
    segmentLabels: ['Madrugada', 'Mañana', 'Tarde', 'Noche'],
    format: byMs ? fmtMs : fmtNum
  });

  return `
    <header class="view-header">
      <h1>Comparación anual</h1>
    </header>
    ${card('Año a año', table(['Año', 'Reproducciones', 'Tiempo', 'Artistas', 'Canciones', 'Álbumes', 'Nuevos art.', 'Nuevas canc.', 'Artista #1', 'Canción #1', 'Saltadas', 'Racha'], rows, '', ['', 'n', 'n', 'n', 'n', 'n', 'n', 'n', '', '', 'n', 'n'], null, 'Comparación año a año'))}
    ${card('Franjas por año', scrollChart(stacked, 'Franjas por año'))}`;
}

export function calendarView(model, year, ctx = {}) {
  const byMs = ctx?.metric ? ctx.metric === 'ms' : true;
  const valFmt = byMs ? fmtMs : fmtNum;
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  if (!years.includes(year)) {
    return `<p class="empty">Sin datos para ${esc(String(year))}.</p>`;
  }
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

  return `
    <header class="view-header">
      <p><a href="#/calendar">← Todos los años</a></p>
      <h1>Calendario ${esc(String(year))}</h1>
      <p class="view-meta">${fmtNum(totalDays)} días con actividad · ${fmtNum(zeroInYear)} días sin escuchar · tocá un día para filtrar <span class="hint-shift">(shift+click = rango)</span></p>
    </header>
    ${card('Actividad diaria', `<div class="chart-scroll chart-scroll--cal" tabindex="0" role="region" aria-label="Calendario de ${esc(String(year))}">${calendarGrid({
      days,
      year,
      colorScale: makeScale(maxVal),
      cellTitle: (d) => `${d.date}: ${d.value > 0 ? valFmt(d.value) : 'sin actividad'}`,
      dataRange,
      interactive: true
    })}</div>` + heatLegend() + calendarTable(days, year, byMs))}
`;
}

export function calendarIndexView(model, ctx = {}) {
  const byMs = ctx?.metric ? ctx.metric === 'ms' : true;
  const valFmt = byMs ? fmtMs : fmtNum;
  const years = [...model.yearly.keys()].sort((a, b) => b - a);
  const dataRange = model.meta.firstTs != null
    ? { from: Math.floor(model.meta.firstTs / 86400), to: Math.floor(model.meta.lastTs / 86400) }
    : null;
  const yearGrid = (y) => {
    const days = [...model.daily.entries()]
      .filter(([d]) => civilFromDays(d).y === y)
      .map(([d, v]) => {
        const c = civilFromDays(d);
        const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
        return { date: iso, value: byMs ? v.ms : v.plays };
      });
    const maxVal = Math.max(...days.map((d) => d.value), 1);
    return calendarGrid({
      days, year: y,
      colorScale: makeScale(maxVal),
      cellTitle: (d) => `${d.date}: ${d.value > 0 ? valFmt(d.value) : 'sin actividad'}`,
      dataRange,
      interactive: true
    }) + heatLegend() + calendarTable(days, y, byMs);
  };
  const [last, ...prev] = years;
  return `
    <header class="view-header">
      <h1>Calendario</h1>
      <p class="view-meta">${fmtNum(model.zeroDays.length)} días sin escuchar en total · tocá un día para filtrar <span class="hint-shift">(shift+click = rango)</span></p>
    </header>
    ${last != null ? card(`<a href="#/calendar/${esc(String(last))}">${esc(String(last))}</a>`, `<div class="chart-scroll chart-scroll--cal" tabindex="0" role="region" aria-label="Calendario de ${esc(String(last))}">${yearGrid(last)}</div>`, '', true) : ''}
    ${prev.map((y) => {
      const yd = model.yearly.get(y);
      return `
      <details class="card calendar-year">
        <summary>${calendarYearSummaryHTML(y, yd)}</summary>
        <p class="calendar-year-link"><a href="#/calendar/${esc(String(y))}">Ver solo ${esc(String(y))} →</a></p>
        <div class="chart-scroll chart-scroll--cal" tabindex="0" role="region" aria-label="Calendario de ${esc(String(y))}">${yearGrid(y)}</div>
      </details>`;
    }).join('')}`;
}

function calendarYearSummaryHTML(y, yd) {
  const meta = yd ? `${fmtNum(yd.plays)} reproducciones · ${fmtMs(yd.ms)}` : '';
  return `${CHEVRON_SVG}<span>${esc(String(y))}</span>${meta ? `<span class="calendar-year-meta">${esc(meta)}</span>` : ''}`;
}

export function hoursView(model, ctx = {}) {
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

  const hourChart = barChart({
    data: model.hour.map((h, i) => ({
      label: String(i).padStart(2, '0'),
      value: byMs ? h.ms : h.plays
    })),
    format: valFmt,
    showValue: false
  });

  const dowChart = hbarChart({
    rows: DOW_LONG.map((label, d) => ({
      label,
      value: byMs ? model.weekday[d].ms : model.weekday[d].plays
    })),
    format: valFmt
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
    const topTr = topEntry ? model.tracks.byId.get(topEntry[0]) : null;
    return [
      esc(label),
      fmtNum(hStat.plays),
      fmtMs(hStat.ms),
      topTr ? trackSubLink(topEntry[0], topTr.name, topTr.artist) : '—',
      topEntry ? valFmt(topEntry[1]) : '—'
    ];
  });

  return `
    <header class="view-header">
      <h1>Horarios y ritmo diario</h1>
      <p class="view-meta">Distribución por hora (00–23h), día de la semana y franja horaria</p>
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
      ${card(`Actividad por hora del día (${valLabel.toLowerCase()})`, scrollChart(hourChart, 'Actividad por hora del día'))}
      ${card(`Actividad por día de la semana (${valLabel.toLowerCase()})`, dowChart)}
    </div>
    ${card('Las 4 franjas del día', table(['Franja', 'Reproducciones', 'Tiempo', '%', 'Artista #1', 'Canción #1'], blockRows, '', ['', 'n', 'n', 'n', '', ''], null, 'Comparación de las 4 franjas del día'))}
    ${card('Canción #1 de cada hora (00:00–23:00)', table(['Hora', 'Reproducciones', 'Tiempo', 'Canción #1', `${valLabel} en esa hora`], hourTrackRows, '', ['c', 'n', 'n', '', 'n'], null, 'Canción más escuchada en cada una de las 24 horas del día'))}`;
}

export function habitsView(model, ctx = {}) {
  const byMs = ctx?.metric === 'ms';
  const t = model.totals;
  const totalVal = byMs ? t.ms : t.records;
  const topKey = byMs ? 'byMs' : 'byPlays';
  const cArt = model.concentration.artists;
  const cTrk = model.concentration.tracks;
  const cAlb = model.concentration.albums;

  const concRows = [
    ['Artistas', fmtNum(model.artists.byId.size), fmtNum(Math.round(cArt.effective)), fmtPct(cArt.hhi), fmtPct(cArt.gini), fmtPct(cArt.entropy)],
    ['Canciones', fmtNum(model.tracks.byId.size), fmtNum(Math.round(cTrk.effective)), fmtPct(cTrk.hhi), fmtPct(cTrk.gini), fmtPct(cTrk.entropy)],
    ['Álbumes', fmtNum(model.albums.byId.size), fmtNum(Math.round(cAlb.effective)), fmtPct(cAlb.hhi), fmtPct(cAlb.gini), fmtPct(cAlb.entropy)]
  ];

  const paretoRows = [
    ['Artistas', paretoShare(model.artists.top[topKey], 1, byMs, totalVal), paretoShare(model.artists.top[topKey], 5, byMs, totalVal), paretoShare(model.artists.top[topKey], 10, byMs, totalVal), paretoShare(model.artists.top[topKey], 50, byMs, totalVal)],
    ['Canciones', paretoShare(model.tracks.top[topKey], 1, byMs, totalVal), paretoShare(model.tracks.top[topKey], 5, byMs, totalVal), paretoShare(model.tracks.top[topKey], 10, byMs, totalVal), paretoShare(model.tracks.top[topKey], 50, byMs, totalVal)],
    ['Álbumes', paretoShare(model.albums.top[topKey], 1, byMs, totalVal), paretoShare(model.albums.top[topKey], 5, byMs, totalVal), paretoShare(model.albums.top[topKey], 10, byMs, totalVal), paretoShare(model.albums.top[topKey], 50, byMs, totalVal)]
  ];

  const months = fillMonths(sortedMonths(model.monthlyBehavior));
  const skipsLine = lineChart({
    points: months.map((mi) => ({ label: monthLabel(mi), y: model.monthlyBehavior.get(mi)?.skips ?? 0 })),
    format: fmtNum
  });
  const shuffleLine = lineChart({
    points: months.map((mi) => ({ label: monthLabel(mi), y: model.monthlyBehavior.get(mi)?.shuffle ?? 0 })),
    format: fmtNum
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

  const oneHitRows = (model.tables.oneHitWonders ?? []).slice(0, oneHitLimit).map((x) => {
    const topTk = x.topTrack?.tk ?? x.topTrackTk;
    const topName = x.topTrack?.name ?? x.topTrackName ?? '';
    const topPlays = x.topTrack?.plays ?? x.topTrackPlays ?? 0;
    return [
      entityLink('artist', x.id, x.name),
      topTk ? trackSubLink(topTk, topName, x.name) : esc(topName),
      fmtPct(x.share),
      `${fmtNum(topPlays)} / ${fmtNum(x.plays)}`
    ];
  });

  const deepRows = (model.tables.deepCatalog ?? []).slice(0, deepLimit).map((x) => [
    entityLink('artist', x.id, x.name),
    fmtNum(x.trackCount ?? x.tracks?.size ?? 0),
    fmtNum(x.albumCount ?? x.albums?.size ?? 0),
    fmtNum(x.plays),
    fmtMs(x.ms)
  ]);

  const forgArtRows = (model.tables.forgotten?.artists ?? []).slice(0, forgArtLimit).map((a) => [
    entityLink('artist', a.id, a.name),
    fmtNum(a.plays),
    fmtMs(a.ms),
    esc(fmtLocal(a.lastTs))
  ]);

  const forgTrkRows = (model.tables.forgotten?.tracks ?? []).slice(0, forgTrkLimit).map((tr) => [
    trackSubLink(tr.tk, tr.name, tr.artist),
    fmtNum(tr.plays),
    fmtMs(tr.ms),
    esc(fmtLocal(tr.lastTs))
  ]);

  return `
    <header class="view-header">
      <h1>Hábitos, concentración y transiciones</h1>
      <p class="view-meta">Diversidad matemática del catálogo, comportamiento mensual, cadenas de Markov y curiosidades</p>
    </header>
    ${kpis([
      { label: 'Tasa de salto', value: pctOf(t.skipped, t.records), sub: `${fmtNum(t.skipped)} saltadas` },
      { label: 'Tasa de aleatorio', value: pctOf(t.shuffle, t.records), sub: `${fmtNum(t.shuffle)} en aleatorio` },
      { label: 'Sin conexión', value: pctOf(t.offline, t.records), sub: `${fmtNum(t.offline)} sin conexión` },
      { label: 'Sesiones con repeticiones', value: fmtNum(model.intraSession.sessionsWithRepeats), sub: `${fmtNum(model.intraSession.repeatedPlays)} repeticiones` },
      { label: 'Mismo artista seguido', value: fmtNum(model.transitions.auto), sub: 'auto-transiciones' },
      { label: 'Artistas efectivos', value: `~${fmtNum(Math.max(1, Math.round(cArt.effective)))}`, sub: `HHI ${fmtPct(cArt.hhi)}` }
    ])}
    <div class="grid-2">
      ${card('Índices de concentración y diversidad', table(['Entidad', 'Únicos', 'Efectivos exp(H)', 'HHI', 'Gini', 'Entropía norm.'], concRows, '', ['', 'n', 'n', 'n', 'n', 'n'], null, 'Índices matemáticos de concentración y diversidad'))}
      ${card(`Curva de Pareto (% acumulado por ${byMs ? 'tiempo' : 'reproducciones'})`, table(['Entidad', 'Top 1', 'Top 5', 'Top 10', 'Top 50'], paretoRows, '', ['', 'n', 'n', 'n', 'n'], null, 'Porcentaje acumulado del catálogo por los primeros N elementos'))}
    </div>
    <div class="grid-2">
      ${card('Saltos por mes', scrollChart(skipsLine, 'Saltos por mes'))}
      ${card('Aleatorio por mes', scrollChart(shuffleLine, 'Aleatorio por mes'))}
    </div>
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
        ? table(['Artista', 'Canción dominante', 'Concentración', 'Reproducciones'], oneHitRows, '', ['', '', 'n', 'n'], null, 'Artistas cuyas reproducciones se concentran en una sola canción')
        : '<p class="empty">Sin artistas con ≥80% en una sola canción (mínimo 5 reproducciones).</p>')}
      ${cardWithLimit('Catálogo profundo (más canciones distintas)', 'habits-deep', deepLimit, deepRows.length
        ? table(['Artista', 'Canciones', 'Álbumes', 'Reproducciones', 'Tiempo'], deepRows, '', ['', 'n', 'n', 'n', 'n'], null, 'Artistas con más canciones distintas escuchadas')
        : '<p class="empty">Sin datos.</p>')}
    </div>
    <div class="grid-2">
      ${cardWithLimit('Artistas olvidados', 'habits-forg-art', forgArtLimit, forgArtRows.length
        ? table(['Artista', 'Reproducciones', 'Tiempo', 'Última escucha'], forgArtRows, '', ['', 'n', 'n', ''], null, 'Artistas con al menos 10 reproducciones cuya última escucha fue hace más tiempo')
        : '<p class="empty">Sin artistas con ≥10 reproducciones.</p>')}
      ${cardWithLimit('Canciones olvidadas', 'habits-forg-trk', forgTrkLimit, forgTrkRows.length
        ? table(['Canción', 'Reproducciones', 'Tiempo', 'Última escucha'], forgTrkRows, '', ['', 'n', 'n', ''], null, 'Canciones con al menos 10 reproducciones cuya última escucha fue hace más tiempo')
        : '<p class="empty">Sin canciones con ≥10 reproducciones.</p>')}
    </div>`;
}

export function wrappedView(model, id, ctx) {
  const t = model.totals;
  const byMs = ctx?.metric === 'ms';
  const evoByMs = (ctx?.metric ?? 'ms') === 'ms';
  const topArtist = model.artists.top[evoByMs ? 'byMs' : 'byPlays'][0];
  const topTrack = model.tracks.top[evoByMs ? 'byMs' : 'byPlays'][0];
  const c = model.concentration.artists;
  const archetype = listenerArchetype(model);
  const onlyYear = ctx?.years && ctx.years.size === 1 ? [...ctx.years][0] : null;
  const title = onlyYear != null ? `Tu ${onlyYear} en resumen` : 'Tu año en resumen';

  // Evolución del artista top: ms por mes.
  const sprint = topArtist
    ? monthlySeries(evoByMs ? model.monthlyArtistMs : model.monthlyArtistPlays, topArtist.id)
    : [];
  const sprintChart = topArtist
    ? lineChart({ points: sprint, format: evoByMs ? fmtMs : fmtNum })
    : '';

  // Concentración legible: los efectivos redondeados como valor principal y
  // el HHI en porcentaje como dato secundario (el crudo 0.083 no dice nada).
  const eff = Math.max(1, Math.round(c.effective));
  const effNoun = eff === 1 ? 'artista base' : 'artistas base';
  const hhiPct = `${(c.hhi * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`;

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

  const heroHTML = archetype
    ? `<section class="card hero-archetype"><p class="hero-eyebrow">Perfil de escucha</p><h2 class="hero-title">${esc(archetype.label)}</h2><p class="hero-detail">${esc(archetype.detail)}</p></section>`
    : '';

  return `
    <header class="view-header">
      <h1>${esc(title)}</h1>
      <p class="view-meta">generado ${new Date(model.meta.generatedAt * 1000).toLocaleString('es-ES')}</p>
    </header>
    ${heroHTML}
    ${kpis([
      { label: 'Artista del año', value: topArtist ? entityLink('artist', topArtist.id, topArtist.name) : '—', text: true },
      { label: 'Canción del año', value: topTrack ? entityLink('track', topTrack.tk, topTrack.name) : '—', text: true },
      { label: 'Tiempo total', value: fmtMs(t.ms) },
      { label: 'Reproducciones', value: fmtNum(t.records) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—' },
      { label: 'Artistas efectivos', value: `~${eff} ${effNoun}`, sub: `Equivale a repartir tu tiempo en partes iguales entre ${eff} ${eff === 1 ? 'artista' : 'artistas'}`, text: true },
      { label: 'Concentración (HHI)', value: hhiPct }
    ])}
    <div class="grid-2">
      ${topArtist ? card(`Evolución de ${topArtist.name}`, scrollChart(sprintChart, `Evolución de ${topArtist.name}`)) : ''}
      ${card('Tu semana típica', `<div class="chart-scroll chart-scroll--clock" tabindex="0" role="region" aria-label="Tu semana típica">${listeningClock({
        cells: clockCells,
        colorScale: makeScale(maxVal),
        cellTitle: (x) => `${DOW_LONG[x.dow]} ${x.hour}:00 — ${byMs ? fmtMs(x.value) : `${fmtNum(x.value)} reproducciones`}`
      })}</div>` + heatLegend() + clockTable(clockCells, byMs))}
    </div>
    <div class="grid-2">
      ${card('Así empezó', `<ul class="receipt">
        <li><span>Primera escucha</span><span>${esc(fmtLocal(model.meta.firstTs))}</span></li>
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
        <li><span>Saltadas</span><span>${fmtNum(t.skipped)} (${pctOf(t.skipped, t.records)})</span></li>
        <li><span>En aleatorio</span><span>${fmtNum(t.shuffle)} (${pctOf(t.shuffle, t.records)})</span></li>
        <li><span>Sin conexión</span><span>${fmtNum(t.offline)} (${pctOf(t.offline, t.records)})</span></li>
        <li><span>Repetidas dentro de sesión</span><span>${fmtNum(model.intraSession.repeatedPlays)}</span></li>
        <li><span>Mismo artista seguido</span><span>${fmtNum(model.transitions.auto)}</span></li>
      </ul>
      <div class="receipt-actions"><button type="button" class="btn btn-secondary" data-action="copy-receipt">Copiar resumen en texto</button></div>
      <pre id="receipt-text" class="receipt-plain" hidden></pre>`)}
    </div>`;
}

// Resumen en texto plano (para portapapeles / copia manual). Sin HTML: se
// asigna con textContent, así que no necesita escaping.
export function receiptText(model) {
  const t = model.totals;
  const topArtist = model.artists.top.byMs[0];
  const topTrack = model.tracks.top.byMs[0];
  const lines = [
    'Mi resumen Scrobbleview',
    `Reproducciones: ${t.records}`,
    `Tiempo escuchado: ${fmtMs(t.ms)}`,
    `Artistas distintos: ${model.artists.byId.size}`,
    `Canciones distintas: ${model.tracks.byId.size}`,
    `Sesiones: ${model.sessionsStats.count}`,
    `Artista del año: ${topArtist ? topArtist.name : '—'}`,
    `Canción del año: ${topTrack ? `${topTrack.name} — ${topTrack.artist}` : '—'}`,
    `Saltadas: ${t.skipped}`,
    `Racha más larga: ${model.streak.len} días`
  ];
  return lines.join('\n');
}

export const VIEWS = {
  dashboard: (model, id, ctx) => dashboard(model, ctx),
  artist: (model, id, ctx) => artistView(model, Number(id), ctx),
  track: (model, id, ctx) => trackView(model, Number(id), ctx),
  album: (model, id, ctx) => albumView(model, Number(id), ctx),
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