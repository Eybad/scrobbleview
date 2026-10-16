// app/views.js — render de las 7 vistas desde StatsModel
//
// Funciones puras: (model, ctx) → string HTML. ctx = { tz } (por ahora).
// Navegación entre vistas por hash (#/artist/123, #/track/…, #/album/…).
// Los gráficos son componentes SVG puros de src/charts.js.

import {
  barChart, lineChart, heatmap, heatmapTable, donut, sparkline,
  calendarGrid, listeningClock, stackedBar,
  esc, fmtNum, fmtMs, fmtPct, fmtBytes, makeScale, MONTHS_SHORT, DOW_SHORT, DOW_LONG, PALETTE
} from '../src/charts.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';

function card(title, body, cls = '', titleHtml = false) {
  const h = title ? `<h2>${titleHtml ? title : esc(title)}</h2>` : '';
  return `<section class="card ${cls}">${h}${body}</section>`;
}

function kpis(items) {
  return `<dl class="kpis">${items.map((it) => `
    <div class="kpi"><dt>${esc(it.label)}</dt><dd>${it.value}${it.sub ? `<span class="kpi-sub">${esc(it.sub)}</span>` : ''}</dd></div>`).join('')}</dl>`;
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

// `rows` es HTML YA escapado por el llamador: las celdas reciben markup (enlaces
// de entidad, <span> de color), por eso no se escapan aquí. Todo valor de dato
// debe pasar por esc() o entityLink() ANTES de entrar en `rows`.
// El scroll horizontal vive en .table-scroll (solo la tabla scrollea; el h2 de
// la card queda fijo). Sin tabindex: el scroll sigue al foco de los enlaces.
function table(headers, rows, cls = '', colClasses = []) {
  const th = (h, i) => `<th scope="col"${colClasses[i] ? ` class="${colClasses[i]}"` : ''}>${esc(h)}</th>`;
  const td = (c, i) => `<td${colClasses[i] ? ` class="${colClasses[i]}"` : ''}>${c}</td>`;
  return `<div class="table-scroll"><table class="${cls}"><thead><tr>${headers.map(th).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map(td).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function rankTable(rows, { valueFmt = fmtNum, link = null, valueLabel = 'Reproducciones' }) {
  // Con `sub` (ej. artista de un álbum) el nombre se apila en 2 líneas:
  // título como enlace, sub en gris secundario. El title del enlace lleva
  // el nombre completo "título — sub".
  const cell = (r) => {
    const full = r.sub ? `${r.name} — ${r.sub}` : r.name;
    const inner = r.sub
      ? `<span class="cell-name">${esc(r.name)}</span><span class="cell-sub">${esc(r.sub)}</span>`
      : esc(r.name);
    return link
      ? `<a class="cell-link" href="${link(r)}" title="${esc(full)}">${inner}</a>`
      : `<span class="cell-link" title="${esc(full)}">${inner}</span>`;
  };
  return table(['#', 'Nombre', valueLabel], rows.map((r, i) => [
    String(i + 1),
    cell(r),
    valueFmt(r.value)
  ]), '', ['c', '', 'n']);
}

// El title revela el nombre truncado por ellipsis (en táctil no hay tooltip:
// el enlace navega a la ficha, donde están los detalles).
function entityLink(type, id, name) {
  return `<a class="cell-name" href="#/${type}/${id}" title="${esc(name)}">${esc(name)}</a>`;
}

function sortedMonths(map) {
  return [...map.keys()].sort((a, b) => a - b);
}

function monthlySeries(monthMap, key) {
  // monthMap: Map<monthIndex, Map<entityId, value>> → [{label, y}]
  return sortedMonths(monthMap).map((mi) => ({
    label: monthLabel(mi),
    y: monthMap.get(mi).get(key) ?? 0
  }));
}

function pctOf(part, total) {
  return total > 0 ? fmtPct(part / total) : '—';
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
      .slice(0, 25);
  } else {
    rows = source.map(rowOf).slice(0, topN);
  }

  const tabBtn = (id, label) => `<button type="button" role="tab" aria-selected="${tab === id}" class="${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`;
  const metricBtn = (id, label) => `<button type="button" aria-pressed="${metric === id}" class="${metric === id ? 'active' : ''}" data-metric="${id}">${label}</button>`;

  return `
    <div class="rank-controls">
      <div class="tabs" role="tablist" aria-label="Rankings">
        ${tabBtn('artists', 'Artistas')}${tabBtn('tracks', 'Canciones')}${tabBtn('albums', 'Álbumes')}
      </div>
      <div class="rank-opts">
        <div class="tabs" role="group" aria-label="Métrica">
          ${metricBtn('plays', 'Por reproducciones')}${metricBtn('ms', 'Por tiempo')}
        </div>
        <select data-topn aria-label="Cantidad">
          ${[10, 25, 50].map((n) => `<option value="${n}" ${topN === n ? 'selected' : ''}>Top ${n}</option>`).join('')}
        </select>
        <input type="search" data-search placeholder="Buscar…" aria-label="Buscar en rankings" value="${esc(opts.query ?? '')}">
      </div>
    </div>
    <div role="tabpanel">${rows.length
      ? rankTable(rows, { valueFmt, valueLabel, link: (r) => r.link })
      : '<p class="empty">Sin resultados.</p>'}</div>`;
}

const WARNING_LABELS = {
  EPISODE: 'episodios de podcast',
  NO_TS: 'eventos sin fecha',
  BAD_TS: 'eventos con fecha inválida',
  NO_TRACK: 'eventos sin canción',
  BAD_MS: 'eventos con duración inválida'
};

function warningsNote(model) {
  const w = model.meta.warnings;
  if (!w || w.length === 0) return '';
  const byCode = new Map();
  for (const x of w) byCode.set(x.code, (byCode.get(x.code) || 0) + 1);
  const parts = [...byCode.entries()].map(([code, n]) => `${n} ${WARNING_LABELS[code] ?? code}`);
  return `<p class="warnings-note" role="note">Se ignoraron: ${esc(parts.join(', '))}.</p>`;
}

export function dashboard(model) {
  const t = model.totals;
  const range = model.meta.firstTs != null
    ? `${fmtLocal(model.meta.firstTs)} → ${fmtLocal(model.meta.lastTs)}`
    : '—';
  const filesLabel = model.meta.sources.length === 1 ? 'archivo' : 'archivos';

  const heatCells = [];
  let maxMs = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = model.dayHourMs[d * 24 + h];
      if (v > maxMs) maxMs = v;
      heatCells.push({ x: h, y: d, value: v });
    }
  }
  const heat = heatmap({
    cells: heatCells,
    width: 640, height: 190,
    colorScale: makeScale(maxMs),
    xLabels: [0, 3, 6, 9, 12, 15, 18, 21].map((h) => `${h}`),
    yLabels: DOW_SHORT,
    cellTitle: (c) => `${DOW_LONG[c.y]} ${c.x}:00 — ${fmtMs(c.value)}`,
    ariaLabel: 'Actividad por hora del día y día de la semana (tiempo escuchado)'
  });
  const heatTable = heatmapTable({
    cells: heatCells,
    xLabels: Array.from({ length: 24 }, (_, h) => `${h}`),
    yLabels: DOW_SHORT,
    cellText: (c) => fmtMs(c.value),
    caption: 'Tiempo escuchado por hora y día (ms)'
  });

  const monthly = sortedMonths(model.monthly).map((mi) => ({
    label: monthLabel(mi),
    y: model.monthly.get(mi).ms
  }));
  const evolution = lineChart({ points: monthly, format: fmtMs });

  const dist = donut({
    segments: t.msDist.map((b) => ({ label: b.label, value: b.count })),
    format: fmtNum,
    centerLabel: fmtNum(t.records)
  });

  const rankings = `<div id="rank-card">${rankCardHTML(model, {})}</div>`;

  const skipRate = t.records > 0 ? fmtPct(t.skipped / t.records) : '—';
  const shuffleRate = t.records > 0 ? fmtPct(t.shuffle / t.records) : '—';
  const offlineRate = t.records > 0 ? fmtPct(t.offline / t.records) : '—';

  return `
    <header class="view-header">
      <h1>Tu resumen</h1>
      <p class="view-meta">${esc(range)} · ${fmtNum(model.meta.sources.length)} ${filesLabel} · ${fmtBytes(model.meta.bytesRead)}</p>
      ${warningsNote(model)}
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(t.records) },
      { label: 'Tiempo escuchado', value: fmtMs(t.ms) },
      { label: 'Artistas', value: fmtNum(model.artists.byId.size) },
      { label: 'Canciones', value: fmtNum(model.tracks.byId.size) },
      { label: 'Álbumes', value: fmtNum(model.albums.byId.size) },
      { label: 'Sesiones', value: fmtNum(model.sessionsStats.count) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—', sub: model.streak.start != null ? `${fmtDay(model.streak.start)} → ${fmtDay(model.streak.end)}` : undefined },
      { label: 'Saltadas', value: fmtNum(t.skipped), sub: skipRate }
    ])}
    ${card('Rankings', rankings)}
    <div class="grid-2">
      ${card('Evolución mensual', evolution)}
      ${card('Duración de reproducciones', dist)}
    </div>
    ${card('Cuándo escuchás (día × hora)', `<div class="chart-scroll chart-scroll--heat">${heat}</div>` + heatTable)}
    ${card('Obsesión (plays por día activo)', table(['Canción', 'Intensidad', 'Reproducciones'], model.tables.obsession.slice(0, 10).map((o) => [
      entityLink('track', o.tk, o.name),
      o.intensity.toLocaleString('es-ES', { maximumFractionDigits: 1 }),
      fmtNum(o.plays)
    ]), '', ['', 'n', 'n']))}
    <div class="grid-2">
      ${card('Rachas (misma canción seguida)', table(['Canción', 'Racha'], model.tables.binge.slice(0, 10).map((b) => [
        entityLink('track', b.tk, b.track.name),
        fmtNum(b.run)
      ]), '', ['', 'n']))}
      ${card('Mayor tasa de salto', table(['Nombre', 'Saltadas'], [...model.tables.skipRate.artists.slice(0, 5).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtPct(a.skips / a.plays)
      ]), ...model.tables.skipRate.tracks.slice(0, 5).map((tr) => [
        entityLink('track', tr.tk, tr.name),
        fmtPct(tr.skips / tr.plays)
      ])], '', ['', 'n']))}
    </div>
    <div class="grid-2">
      ${card('Primera canción del día', table(['Canción', 'Días'], model.tables.dayFirst.slice(0, 10).map((d) => [
        entityLink('track', d.tk, d.track.name),
        fmtNum(d.count)
      ]), '', ['', 'n']))}
      ${card('Última canción del día', table(['Canción', 'Días'], model.tables.dayLast.slice(0, 10).map((d) => [
        entityLink('track', d.tk, d.track.name),
        fmtNum(d.count)
      ]), '', ['', 'n']))}
    </div>
    ${kpis([
      { label: 'Con shuffle', value: fmtNum(t.shuffle), sub: shuffleRate },
      { label: 'Sin conexión', value: fmtNum(t.offline), sub: offlineRate },
      { label: 'Reproducciones significativas', value: fmtNum(t.playsSignificant) },
      { label: 'Saltadas por duración', value: fmtNum(t.playsSkipped) }
    ])}`;
}

export function artistView(model, ar) {
  const a = model.artists.byId.get(ar);
  if (!a) return `<p class="empty">Artista no encontrado.</p>`;
  const totalMs = model.totals.ms;
  const topTracks = [...model.tracks.byId.entries()]
    .filter(([tk]) => tk % 4294967296 === ar)
    .map(([tk, tr]) => ({ tk, tr }))
    .sort((x, y) => y.tr.plays - x.tr.plays || y.tr.ms - x.tr.ms)
    .slice(0, 10);
  const transitions = model.transitions.top
    .filter((x) => x.from === ar || x.to === ar)
    .slice(0, 10);

  const evolution = lineChart({
    points: monthlySeries(model.monthlyArtistMs, ar),
    format: fmtMs
  });

  const albumRows = [...a.albums]
    .map((ak) => model.albums.byId.get(ak))
    .filter(Boolean)
    .sort((x, y) => y.plays - x.plays || y.ms - x.ms)
    .map((al) => ({ name: al.name, value: al.plays, id: al.id }));

  const clockCells = [];
  let maxPlays = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = a.clock[d * 24 + h];
      if (v > maxPlays) maxPlays = v;
      clockCells.push({ hour: h, dow: d, value: v });
    }
  }

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
      { label: 'Saltadas', value: fmtNum(a.skips), sub: pctOf(a.skips, a.plays) },
      { label: 'Días activos', value: fmtNum(a.days.size) },
      { label: 'Primera escucha', value: fmtLocal(a.firstTs) },
      { label: 'Última escucha', value: fmtLocal(a.lastTs) }
    ])}
    <div class="grid-2">
      ${card('Evolución mensual', evolution)}
      ${card('Tus canciones de este artista', rankTable(topTracks.map(({ tr }) => ({ name: tr.name, value: tr.plays, id: tr.tk })), { link: (r) => `#/track/${r.id}` }))}
    </div>
    <div class="grid-2">
      ${card('Tu semana con este artista', `<div class="chart-scroll chart-scroll--clock">${listeningClock({
        cells: clockCells,
        colorScale: makeScale(maxPlays),
        cellTitle: (x) => `${DOW_LONG[x.dow]} ${x.hour}:00 — ${fmtNum(x.value)} reproducciones`
      })}</div>`)}
      ${card('Álbumes de este artista', albumRows.length
        ? rankTable(albumRows, { link: (r) => `#/album/${r.id}` })
        : '<p class="empty">Sin álbumes registrados.</p>')}
    </div>
    ${card('Transiciones', transitions.length
      ? table(['De', 'A', 'Veces'], transitions.map((x) => [
          x.from === ar ? `<strong>${esc(x.fromName)}</strong>` : entityLink('artist', x.from, x.fromName),
          x.to === ar ? `<strong>${esc(x.toName)}</strong>` : entityLink('artist', x.to, x.toName),
          fmtNum(x.count)
        ]), '', ['', '', 'n'])
      : '<p class="empty">Sin transiciones destacadas.</p>')}`;
}

export function trackView(model, tk) {
  const tr = model.tracks.byId.get(tk);
  if (!tr) return `<p class="empty">Canción no encontrada.</p>`;
  const totalMs = model.totals.ms;
  const ar = tk % 4294967296;
  const al = tr.ak > 0 ? model.albums.byId.get(tr.ak) : null;
  const run = model.maxRun.get(tk) ?? 0;
  const evolution = lineChart({
    points: monthlySeries(model.monthlyTrackMs, tk),
    format: fmtMs
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
      { label: 'Saltadas', value: fmtNum(tr.skips), sub: pctOf(tr.skips, tr.plays) },
      { label: 'Racha máxima (seguidas)', value: fmtNum(run) },
      { label: 'Días activos', value: fmtNum(tr.days.size) },
      { label: 'Primera escucha', value: fmtLocal(tr.firstTs) },
      { label: 'Última escucha', value: fmtLocal(tr.lastTs) }
    ])}
    ${card('Evolución mensual', evolution)}`;
}

export function albumView(model, ak) {
  const al = model.albums.byId.get(ak);
  if (!al) return `<p class="empty">Álbum no encontrado.</p>`;
  const totalMs = model.totals.ms;
  const ar = ak % 4294967296;
  const songRows = [...al.tracks]
    .map((tk) => model.tracks.byId.get(tk))
    .filter(Boolean)
    .sort((x, y) => y.plays - x.plays || y.ms - x.ms)
    .map((tr) => ({ name: tr.name, value: tr.plays, id: tr.tk }));
  const evolution = lineChart({
    points: sortedMonths(model.monthly).map((mi) => {
      let ms = 0;
      for (const tk of al.tracks) ms += model.monthlyTrackMs.get(mi)?.get(tk) ?? 0;
      return { label: monthLabel(mi), y: ms };
    }),
    format: fmtMs
  });
  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
      <h1>${esc(al.name)}</h1>
      <p class="view-meta">${entityLink('artist', ar, al.artist)}</p>
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
      ${card('Evolución mensual', evolution)}
      ${card('Canciones del álbum', songRows.length
        ? rankTable(songRows, { link: (r) => `#/track/${r.id}` })
        : '<p class="empty">Sin canciones registradas.</p>')}
    </div>`;
}

export function sessionsView(model) {
  const s = model.sessionsStats;
  const topDur = model.tables.sessions.byDuration;
  const topPlays = model.tables.sessions.byPlays;
  const blocks = model.blocks.map((b, i) => ({
    label: ['Madrugada', 'Mañana', 'Tarde', 'Noche'][i],
    value: b.plays
  }));
  const startHour = [...s.startHour.entries()].sort((a, b) => a[0] - b[0]);

  const sessRows = (list) => list.map((x) => [
    fmtLocal(x.start),
    fmtMs(x.duration * 1000),
    fmtNum(x.plays),
    fmtMs(x.ms)
  ]);

  return `
    <header class="view-header">
      <h1>Sesiones de escucha</h1>
      <p class="view-meta">Gap de 30 min entre sesiones</p>
    </header>
    ${kpis([
      { label: 'Sesiones', value: fmtNum(s.count) },
      { label: 'Duración promedio', value: fmtMs(s.avgDuration * 1000) },
      { label: 'Duración mediana', value: fmtMs(s.medianDuration * 1000) },
      { label: 'Reproducciones promedio', value: s.avgPlays.toFixed(1) },
      { label: 'Sesiones con repeticiones', value: fmtNum(model.intraSession.sessionsWithRepeats) },
      { label: 'Reproducciones repetidas', value: fmtNum(model.intraSession.repeatedPlays) }
    ])}
    <div class="grid-2">
      ${card('Sesiones más largas', table(['Inicio', 'Duración', 'Reproducciones', 'Tiempo'], sessRows(topDur), '', ['', 'n', 'n', 'n']))}
      ${card('Sesiones con más reproducciones', table(['Inicio', 'Duración', 'Reproducciones', 'Tiempo'], sessRows(topPlays), '', ['', 'n', 'n', 'n']))}
    </div>
    <div class="grid-2">
      ${card('Sesiones por franja', barChart({ data: blocks, showValue: true }))}
      ${card('Hora de inicio', barChart({ data: startHour.map(([h, n]) => ({ label: `${h}`, value: n })), showValue: false }))}
    </div>
    ${card('Razones de inicio', barChart({ data: [...model.starts.entries()].map(([k, v]) => ({ label: k, value: v })), showValue: true }))}
    ${card('Razones de fin', barChart({ data: [...model.ends.entries()].map(([k, v]) => ({ label: k, value: v })), showValue: true }))}`;
}

export function discoveryView(model) {
  const disc = [...model.monthlyDiscovery.entries()].sort((a, b) => a[0] - b[0]);
  const line = lineChart({
    points: disc.map(([mi, d]) => ({ label: monthLabel(mi), y: d.new })),
    format: fmtNum
  });
  const abs = model.tables.discovery.absolute;
  const rel = model.tables.discovery.relative;

  return `
    <header class="view-header">
      <h1>Descubrimiento</h1>
      <p class="view-meta">Canciones nuevas por mes</p>
    </header>
    ${card('Canciones nuevas por mes', line)}
    <div class="grid-2">
      ${card('Meses con más descubrimientos', table(['Mes', 'Nuevas', 'Reproducciones'], abs.map(([mi, d]) => [monthLabel(mi), fmtNum(d.new), fmtNum(d.plays)]), '', ['', 'n', 'n']))}
      ${card('Meses con mayor proporción de nuevas', table(['Mes', 'Nuevas', 'Reproducciones', 'Proporción'], rel.map(([mi, d]) => [monthLabel(mi), fmtNum(d.new), fmtNum(d.plays), fmtPct(d.new / d.plays)]), '', ['', 'n', 'n', 'n']))}
    </div>
    <div class="grid-2">
      ${card('Constancia (artistas de todos los meses)', table(['Artista', 'Meses', 'Cobertura'], model.tables.constancy.slice(0, 10).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtNum(a.months.size),
        fmtPct(a.coverage)
      ]), '', ['', 'n', 'n']))}
      ${card('Longevidad (años activos)', table(['Artista', 'Años', 'Meses', 'Días'], model.tables.longevity.slice(0, 10).map((a) => [
        entityLink('artist', a.id, a.name),
        fmtNum(a.years.size),
        fmtNum(a.months.size),
        fmtNum(a.days.size)
      ]), '', ['', 'n', 'n', 'n']))}
    </div>`;
}

export function yearlyView(model) {
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  const rows = years.map((y) => {
    const d = model.yearly.get(y);
    const st = model.yearlyStreaks.get(y);
    return [
      `<a href="#/calendar/${esc(String(y))}">${esc(String(y))}</a>`,
      fmtNum(d.plays),
      fmtMs(d.ms),
      fmtNum(d.artistsC.size),
      fmtNum(d.tracksC.size),
      fmtNum(d.skips),
      st ? `${st.len} días` : '—'
    ];
  });
  const stacked = stackedBar({
    series: years.map((y) => ({
      label: String(y),
      values: model.yearly.get(y).blocks,
      total: model.yearly.get(y).plays
    })),
    segmentLabels: ['Madrugada', 'Mañana', 'Tarde', 'Noche']
  });

  return `
    <header class="view-header">
      <h1>Comparación anual</h1>
    </header>
    ${card('Año a año', table(['Año', 'Reproducciones', 'Tiempo', 'Artistas', 'Canciones', 'Saltadas', 'Racha'], rows, '', ['', 'n', 'n', 'n', 'n', 'n', 'n']))}
    ${card('Franjas por año', stacked)}`;
}

export function calendarView(model, year) {
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  if (!years.includes(year)) {
    return `<p class="empty">Sin datos para ${esc(String(year))}.</p>`;
  }
  const days = [...model.daily.entries()]
    .filter(([d]) => civilFromDays(d).y === year)
    .map(([d, v]) => {
      const c = civilFromDays(d);
      const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
      return { date: iso, value: v.ms };
    });
  const maxMs = Math.max(...days.map((d) => d.value), 1);
  const zeroInYear = model.zeroDays.filter((d) => civilFromDays(d).y === year).length;
  const totalDays = days.length;

  return `
    <header class="view-header">
      <p><a href="#/calendar">← Todos los años</a></p>
      <h1>Calendario ${esc(String(year))}</h1>
      <p class="view-meta">${fmtNum(totalDays)} días con actividad · ${fmtNum(zeroInYear)} días sin escuchar</p>
    </header>
    ${card('Actividad diaria', `<div class="chart-scroll chart-scroll--cal">${calendarGrid({
      days,
      year,
      colorScale: makeScale(maxMs),
      cellTitle: (d) => `${d.date}: ${d.value > 0 ? fmtMs(d.value) : 'sin actividad'}`
    })}</div>`)}
`;
}

export function calendarIndexView(model) {
  const years = [...model.yearly.keys()].sort((a, b) => b - a);
  const yearGrid = (y) => {
    const days = [...model.daily.entries()]
      .filter(([d]) => civilFromDays(d).y === y)
      .map(([d, v]) => {
        const c = civilFromDays(d);
        const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
        return { date: iso, value: v.ms };
      });
    const maxMs = Math.max(...days.map((d) => d.value), 1);
    return calendarGrid({
      days, year: y,
      colorScale: makeScale(maxMs),
      cellTitle: (d) => `${d.date}: ${d.value > 0 ? fmtMs(d.value) : 'sin actividad'}`
    });
  };
  const [last, ...prev] = years;
  return `
    <header class="view-header">
      <h1>Calendario</h1>
      <p class="view-meta">${fmtNum(model.zeroDays.length)} días sin escuchar en total</p>
    </header>
    ${last != null ? card(`<a href="#/calendar/${esc(String(last))}">${esc(String(last))}</a>`, `<div class="chart-scroll chart-scroll--cal">${yearGrid(last)}</div>`, '', true) : ''}
    ${prev.map((y) => `
      <details class="card calendar-year">
        <summary><a href="#/calendar/${esc(String(y))}">${esc(String(y))}</a></summary>
        <div class="chart-scroll chart-scroll--cal">${yearGrid(y)}</div>
      </details>`).join('')}`;
}

export function wrappedView(model, id, ctx) {
  const t = model.totals;
  const topArtist = model.artists.top.byMs[0];
  const topTrack = model.tracks.top.byMs[0];
  const c = model.concentration.artists;
  const onlyYear = ctx?.years && ctx.years.size === 1 ? [...ctx.years][0] : null;
  const title = onlyYear != null ? `Tu ${onlyYear} en resumen` : 'Tu año en resumen';

  // Sprint del artista top: ms por mes.
  const sprint = topArtist
    ? monthlySeries(model.monthlyArtistMs, topArtist.id)
    : [];
  const sprintChart = topArtist
    ? lineChart({ points: sprint, format: fmtMs })
    : '';

  const clockCells = [];
  let maxPlays = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const v = model.dayHour[d * 24 + h];
      if (v > maxPlays) maxPlays = v;
      clockCells.push({ hour: h, dow: d, value: v });
    }
  }

  return `
    <header class="view-header">
      <h1>${esc(title)}</h1>
      <p class="view-meta">generado ${new Date(model.meta.generatedAt * 1000).toLocaleString('es-ES')}</p>
    </header>
    ${kpis([
      { label: 'Artista del año', value: topArtist ? entityLink('artist', topArtist.id, topArtist.name) : '—' },
      { label: 'Canción del año', value: topTrack ? entityLink('track', topTrack.tk, topTrack.name) : '—' },
      { label: 'Tiempo total', value: fmtMs(t.ms) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—' },
      { label: 'Concentración (HHI)', value: c.hhi.toFixed(3) },
      { label: 'Artistas efectivos', value: c.effective.toFixed(1) }
    ])}
    <div class="grid-2">
      ${topArtist ? card(`Sprint de ${topArtist.name}`, sprintChart) : ''}
      ${card('Tu semana típica', `<div class="chart-scroll chart-scroll--clock">${listeningClock({
        cells: clockCells,
        colorScale: makeScale(maxPlays),
        cellTitle: (x) => `${DOW_LONG[x.dow]} ${x.hour}:00 — ${fmtNum(x.value)} reproducciones`
      })}</div>`)}
    </div>
    ${card('Recibo', `<ul class="receipt">
      <li><span>Reproducciones</span><span>${fmtNum(t.records)}</span></li>
      <li><span>Artistas distintos</span><span>${fmtNum(model.artists.byId.size)}</span></li>
      <li><span>Canciones distintas</span><span>${fmtNum(model.tracks.byId.size)}</span></li>
      <li><span>Sesiones de escucha</span><span>${fmtNum(model.sessionsStats.count)}</span></li>
      <li><span>Saltadas</span><span>${fmtNum(t.skipped)} (${pctOf(t.skipped, t.records)})</span></li>
      <li><span>Con shuffle</span><span>${fmtNum(t.shuffle)} (${pctOf(t.shuffle, t.records)})</span></li>
      <li><span>Sin conexión</span><span>${fmtNum(t.offline)} (${pctOf(t.offline, t.records)})</span></li>
      <li><span>Repetidas dentro de sesión</span><span>${fmtNum(model.intraSession.repeatedPlays)}</span></li>
      <li><span>Mismo artista seguido</span><span>${fmtNum(model.transitions.auto)}</span></li>
    </ul>`)}
    ${card('Compartir', `
      <p><button type="button" class="btn btn-secondary" data-action="copy-receipt">Copiar recibo en texto</button></p>
      <pre id="receipt-text" class="receipt-plain" hidden></pre>`)}`;
}

// Recibo en texto plano (para portapapeles / copia manual). Sin HTML: se
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
  dashboard: (model) => dashboard(model),
  artist: (model, id) => artistView(model, Number(id)),
  track: (model, id) => trackView(model, Number(id)),
  album: (model, id) => albumView(model, Number(id)),
  sessions: (model) => sessionsView(model),
  discovery: (model) => discoveryView(model),
  yearly: (model) => yearlyView(model),
  calendar: (model, id) => (id ? calendarView(model, Number(id)) : calendarIndexView(model)),
  wrapped: (model, id, ctx) => wrappedView(model, id, ctx)
};

export function renderView(name, model, id, ctx) {
  if (!Object.hasOwn(VIEWS, name)) return `<p class="empty">Vista desconocida: ${esc(name)}</p>`;
  return VIEWS[name](model, id, ctx);
}