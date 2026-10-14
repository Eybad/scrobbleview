// app/views.js — render de las 7 vistas desde StatsModel
//
// Funciones puras: (model, ctx) → string HTML. ctx = { tz } (por ahora).
// Navegación entre vistas por hash (#/artist/123, #/track/…, #/album/…).
// Los gráficos son componentes SVG puros de src/charts.js.

import {
  barChart, lineChart, heatmap, heatmapTable, donut, sparkline,
  calendarGrid, listeningClock, stackedBar,
  esc, fmtNum, fmtMs, fmtPct, makeScale, MONTHS_SHORT, DOW_SHORT, DOW_LONG, PALETTE
} from '../src/charts.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';

// ---------- helpers ----------

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
function table(headers, rows, cls = '') {
  return `<table class="${cls}"><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function rankTable(rows, { valueFmt = fmtNum, link = null, valueLabel = 'Reproducciones' }) {
  return table(['#', 'Nombre', valueLabel], rows.map((r, i) => [
    String(i + 1),
    link ? `<a href="${link(r)}">${esc(r.name)}</a>` : esc(r.name),
    valueFmt(r.value)
  ]));
}

function entityLink(type, id, name) {
  return `<a href="#/${type}/${id}">${esc(name)}</a>`;
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

function warningsNote(model) {
  const w = model.meta.warnings;
  if (!w || w.length === 0) return '';
  const byCode = new Map();
  for (const x of w) byCode.set(x.code, (byCode.get(x.code) || 0) + 1);
  const parts = [...byCode.entries()].map(([code, n]) => `${n} ${code}`);
  return `<p class="warnings-note" role="note">Se ignoraron: ${esc(parts.join(', '))}.</p>`;
}

// ---------- dashboard ----------

export function dashboard(model) {
  const t = model.totals;
  const range = model.meta.firstTs != null
    ? `${fmtLocal(model.meta.firstTs)} → ${fmtLocal(model.meta.lastTs)}`
    : '—';

  // Heatmap día × hora (ms).
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

  // Evolución mensual.
  const monthly = sortedMonths(model.monthly).map((mi) => ({
    label: monthLabel(mi),
    y: model.monthly.get(mi).ms
  }));
  const evolution = lineChart({ points: monthly, format: fmtMs });

  // Distribución de duración.
  const dist = donut({
    segments: t.msDist.map((b) => ({ label: b.label, value: b.count })),
    format: fmtNum,
    centerLabel: fmtNum(t.records)
  });

  // Rankings (toggle artistas/canciones).
  const artistRows = (list) => list.map((a) => ({ name: a.name, value: a.plays, id: a.id }));
  const trackRows = (list) => list.map((tr) => ({ name: `${tr.name} — ${tr.artist}`, value: tr.plays, id: tr.tk }));
  const rankArtists = rankTable(artistRows(model.artists.top.byPlays.slice(0, 10)), { link: (r) => `#/artist/${r.id}` });
  const rankTracks = rankTable(trackRows(model.tracks.top.byPlays.slice(0, 10)), { link: (r) => `#/track/${r.id}` });
  const rankings = `
    <div class="tabs" role="tablist" aria-label="Rankings">
      <button type="button" role="tab" aria-selected="true" data-tab="artists">Artistas</button>
      <button type="button" role="tab" aria-selected="false" data-tab="tracks">Canciones</button>
    </div>
    <div role="tabpanel" data-panel="artists">${rankArtists}</div>
    <div role="tabpanel" data-panel="tracks" hidden>${rankTracks}</div>`;

  const skipRate = t.records > 0 ? fmtPct(t.skipped / t.records) : '—';
  const shuffleRate = t.records > 0 ? fmtPct(t.shuffle / t.records) : '—';
  const offlineRate = t.records > 0 ? fmtPct(t.offline / t.records) : '—';

  return `
    <header class="view-header">
      <h1>Tu resumen</h1>
      <p class="view-meta">${esc(range)} · zona ${esc(model.meta.tzId)} · ${esc(model.meta.sources.length)} archivo(s) · ${fmtNum(model.meta.bytesRead)} bytes</p>
      ${warningsNote(model)}
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(t.records) },
      { label: 'Tiempo escuchado', value: fmtMs(t.ms) },
      { label: 'Artistas', value: fmtNum(model.artists.byId.size) },
      { label: 'Canciones', value: fmtNum(model.tracks.byId.size) },
      { label: 'Álbumes', value: fmtNum(model.albums.byId.size) },
      { label: 'Sesiones', value: fmtNum(model.sessionsStats.count) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—' },
      { label: 'Saltadas', value: fmtNum(t.skipped), sub: skipRate }
    ])}
    <div class="grid-2">
      ${card('Cuándo escuchás (día × hora)', heat + heatTable)}
      ${card('Evolución mensual', evolution)}
    </div>
    <div class="grid-2">
      ${card('Duración de reproducciones', dist)}
      ${card('Rankings', rankings)}
    </div>
    ${kpis([
      { label: 'Con shuffle', value: fmtNum(t.shuffle), sub: shuffleRate },
      { label: 'Sin conexión', value: fmtNum(t.offline), sub: offlineRate },
      { label: 'Reproducciones significativas', value: fmtNum(t.playsSignificant) },
      { label: 'Saltadas por duración', value: fmtNum(t.playsSkipped) }
    ])}`;
}

// ---------- fichas ----------

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

  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
      <h1>${esc(a.name)}</h1>
      <p class="view-meta">${fmtNum(a.plays)} reproducciones · ${fmtMs(a.ms)} · ${pctOf(a.ms, totalMs)} del total</p>
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
    ${card('Transiciones', transitions.length
      ? table(['De', 'A', 'Veces'], transitions.map((x) => [
          x.from === ar ? `<strong>${esc(x.fromName)}</strong>` : entityLink('artist', x.from, x.fromName),
          x.to === ar ? `<strong>${esc(x.toName)}</strong>` : entityLink('artist', x.to, x.toName),
          fmtNum(x.count)
        ]))
      : '<p class="empty">Sin transiciones destacadas.</p>')}`;
}

export function trackView(model, tk) {
  const tr = model.tracks.byId.get(tk);
  if (!tr) return `<p class="empty">Canción no encontrada.</p>`;
  const totalMs = model.totals.ms;
  const ar = tk % 4294967296;
  const evolution = lineChart({
    points: monthlySeries(model.monthlyTrackMs, tk),
    format: fmtMs
  });

  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
      <h1>${esc(tr.name)}</h1>
      <p class="view-meta">${entityLink('artist', ar, tr.artist)} · ${fmtNum(tr.plays)} reproducciones · ${fmtMs(tr.ms)} · ${pctOf(tr.ms, totalMs)} del total</p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(tr.plays) },
      { label: 'Tiempo', value: fmtMs(tr.ms) },
      { label: 'Saltadas', value: fmtNum(tr.skips), sub: pctOf(tr.skips, tr.plays) },
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
  return `
    <header class="view-header">
      <p><a href="#/dashboard">← Volver al resumen</a></p>
      <h1>${esc(al.name)}</h1>
      <p class="view-meta">${entityLink('artist', ar, al.artist)}</p>
    </header>
    ${kpis([
      { label: 'Reproducciones', value: fmtNum(al.plays) },
      { label: 'Tiempo', value: fmtMs(al.ms) },
      { label: 'Del total', value: pctOf(al.ms, totalMs) }
    ])}`;
}

// ---------- sesiones ----------

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
      ${card('Sesiones más largas', table(['Inicio', 'Duración', 'Reproducciones', 'Tiempo'], sessRows(topDur)))}
      ${card('Sesiones con más reproducciones', table(['Inicio', 'Duración', 'Reproducciones', 'Tiempo'], sessRows(topPlays)))}
    </div>
    <div class="grid-2">
      ${card('Sesiones por franja', barChart({ data: blocks, showValue: true }))}
      ${card('Hora de inicio', barChart({ data: startHour.map(([h, n]) => ({ label: `${h}`, value: n })), showValue: false }))}
    </div>
    ${card('Razones de inicio', barChart({ data: [...model.starts.entries()].map(([k, v]) => ({ label: k, value: v })), showValue: true }))}
    ${card('Razones de fin', barChart({ data: [...model.ends.entries()].map(([k, v]) => ({ label: k, value: v })), showValue: true }))}`;
}

// ---------- descubrimiento ----------

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
      ${card('Meses con más descubrimientos', table(['Mes', 'Nuevas', 'Reproducciones'], abs.map(([mi, d]) => [monthLabel(mi), fmtNum(d.new), fmtNum(d.plays)])))}
      ${card('Meses con mayor proporción de nuevas', table(['Mes', 'Nuevas', 'Reproducciones', 'Proporción'], rel.map(([mi, d]) => [monthLabel(mi), fmtNum(d.new), fmtNum(d.plays), fmtPct(d.new / d.plays)])))}
    </div>`;
}

// ---------- comparación anual ----------

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
      values: model.blocks.map((b) => b.plays),
      total: model.yearly.get(y).plays
    }))
  });

  return `
    <header class="view-header">
      <h1>Comparación anual</h1>
    </header>
    ${card('Año a año', table(['Año', 'Reproducciones', 'Tiempo', 'Artistas', 'Canciones', 'Saltadas', 'Racha'], rows))}
    ${card('Franjas por año', stacked)}`;
}

// ---------- calendario ----------

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
    ${card('Actividad diaria', calendarGrid({
      days,
      year,
      colorScale: makeScale(maxMs),
      cellTitle: (d) => `${d.date}: ${d.value > 0 ? fmtMs(d.value) : 'sin actividad'}`
    }))}`;
}

export function calendarIndexView(model) {
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  return `
    <header class="view-header">
      <h1>Calendario</h1>
      <p class="view-meta">${fmtNum(model.zeroDays.length)} días sin escuchar en total</p>
    </header>
    ${years.map((y) => {
      const days = [...model.daily.entries()]
        .filter(([d]) => civilFromDays(d).y === y)
        .map(([d, v]) => {
          const c = civilFromDays(d);
          const iso = `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
          return { date: iso, value: v.ms };
        });
      const maxMs = Math.max(...days.map((d) => d.value), 1);
      return card(`<a href="#/calendar/${esc(String(y))}">${esc(String(y))}</a>`, calendarGrid({
        days, year: y,
        colorScale: makeScale(maxMs),
        cellTitle: (d) => `${d.date}: ${d.value > 0 ? fmtMs(d.value) : 'sin actividad'}`
      }), '', true);
    }).join('')}`;
}

// ---------- wrapped ----------

export function wrappedView(model) {
  const t = model.totals;
  const topArtist = model.artists.top.byMs[0];
  const topTrack = model.tracks.top.byMs[0];
  const c = model.concentration.artists;

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
      <h1>Tu año en resumen</h1>
      <p class="view-meta">${esc(model.meta.tzId)} · generado ${new Date(model.meta.generatedAt * 1000).toLocaleString('es-ES')}</p>
    </header>
    ${kpis([
      { label: 'Artista del año', value: topArtist ? entityLink('artist', topArtist.id, topArtist.name) : '—' },
      { label: 'Canción del año', value: topTrack ? entityLink('track', topTrack.id, topTrack.name) : '—' },
      { label: 'Tiempo total', value: fmtMs(t.ms) },
      { label: 'Racha más larga', value: model.streak.len > 0 ? `${model.streak.len} días` : '—' },
      { label: 'Concentración (HHI)', value: c.hhi.toFixed(3) },
      { label: 'Artistas efectivos', value: c.effective.toFixed(1) }
    ])}
    <div class="grid-2">
      ${topArtist ? card(`Sprint de ${topArtist.name}`, sprintChart) : ''}
      ${card('Tu semana típica', listeningClock({
        cells: clockCells,
        colorScale: makeScale(maxPlays),
        cellTitle: (x) => `${DOW_LONG[x.dow]} ${x.hour}:00 — ${fmtNum(x.value)} reproducciones`
      }))}
    </div>
    ${card('Recibo', `<ul class="receipt">
      <li>${fmtNum(t.records)} reproducciones en total</li>
      <li>${fmtNum(model.artists.byId.size)} artistas distintos</li>
      <li>${fmtNum(model.tracks.byId.size)} canciones distintas</li>
      <li>${fmtNum(model.sessionsStats.count)} sesiones de escucha</li>
      <li>${fmtNum(t.skipped)} saltadas (${pctOf(t.skipped, t.records)})</li>
      <li>${fmtNum(t.shuffle)} con shuffle (${pctOf(t.shuffle, t.records)})</li>
      <li>${fmtNum(t.offline)} sin conexión (${pctOf(t.offline, t.records)})</li>
      <li>${fmtNum(model.intraSession.repeatedPlays)} reproducciones repetidas dentro de una sesión</li>
      <li>${fmtNum(model.transitions.auto)} veces que seguiste con el mismo artista</li>
    </ul>`)}`;
}

// ---------- registro de vistas ----------

export const VIEWS = {
  dashboard: (model) => dashboard(model),
  artist: (model, id) => artistView(model, Number(id)),
  track: (model, id) => trackView(model, Number(id)),
  album: (model, id) => albumView(model, Number(id)),
  sessions: (model) => sessionsView(model),
  discovery: (model) => discoveryView(model),
  yearly: (model) => yearlyView(model),
  calendar: (model, id) => (id ? calendarView(model, Number(id)) : calendarIndexView(model)),
  wrapped: (model) => wrappedView(model)
};

export function renderView(name, model, id) {
  if (!Object.hasOwn(VIEWS, name)) return `<p class="empty">Vista desconocida: ${esc(name)}</p>`;
  return VIEWS[name](model, id);
}