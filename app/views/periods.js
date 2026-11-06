import {
  calendarGrid, DOW_LONG, esc, fmtMs, fmtNum, fmtPct, heatLegend, heatmapTable,
  listeningClock, makeScale, MONTHS_SHORT, stackedBar
} from '../../src/charts.js';
import { civilFromDays } from '../../src/aggregate/impl/derive.js';
import {
  buildCalendarMonthOptions, calendarInspectorHTML, calendarMonthViewHTML,
  calendarScaleToggleHTML
} from '../calendar-ui.js';
import { createChartContract, renderChartWithContract } from '../../src/chart-contract.js';
import { formatSemanticRoute } from '../routes.js';
import { contractedClockChart, contractedLineChart, scrollChart } from '../chart-view.js';
import { matchRangeShortcut, rangeChipLabel } from '../filter-ui.js';
import { card, entityLinks, fmtLocal, kpis, monthLabel, monthlySeries, pctOf, table, topEntityInMap } from './shared.js';

const CHEVRON_SVG = '<svg class="chevron" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';

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
  const maxVal = Math.max(...days.map((day) => day.value), 1);
  const zeroInYear = model.zeroDays.filter((d) => civilFromDays(d).y === year).length;
  const totalDays = days.length;
  const dataRange = model.meta.firstTs != null
    ? { from: Math.floor(model.meta.firstTs / 86400), to: Math.floor(model.meta.lastTs / 86400) }
    : null;

  const currentMonth = ctx.calMonth?.year === year ? ctx.calMonth.month : (ctx?.month ? Number(ctx.month) : 1);
  const monthOptions = ctx.calendarMonthOptions ?? buildCalendarMonthOptions({
    model,
    year,
    month: currentMonth,
    metric: ctx.metric,
    selectedDate: ctx.calDate,
    normalizeYears: true
  });

  return `
    <header class="view-header">
      <p><a href="${esc(formatSemanticRoute('calendar', null, ctx.query))}">← Todos los años</a></p>
      <h1>Calendario ${esc(String(year))}</h1>
      <p class="view-meta">${fmtNum(totalDays)} días con actividad · ${fmtNum(zeroInYear)} días sin registros dentro del período observado · tocá un día para filtrar <span class="hint-shift">(shift+click = rango)</span></p>
    </header>
    ${calendarInspectorHTML({ year, byMs })}
    ${calendarMonthViewHTML(monthOptions)}
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

  const [last, ...prev] = years;
  const latestYear = ctx.calMonth?.year ?? last ?? (years.length ? years[0] : new Date().getFullYear());
  const currentMonth = ctx.calMonth?.month ?? (ctx?.month ? Number(ctx.month) : (new Date().getMonth() + 1));
  const monthOptions = ctx.calendarMonthOptions ?? buildCalendarMonthOptions({
    model,
    year: latestYear,
    month: currentMonth,
    metric: ctx.metric,
    selectedDate: ctx.calDate,
    normalizeYears
  });

  return `
    <header class="view-header">
      <h1>Calendario</h1>
      <p class="view-meta">${fmtNum(model.zeroDays.length)} días sin registros entre primera y última escucha · tocá un día para filtrar <span class="hint-shift">(shift+click = rango)</span></p>
    </header>
    ${calendarScaleToggleHTML({ normalizeYears, maxValFormatted: valFmt(sharedMax) })}
    ${calendarInspectorHTML({ year: latestYear, byMs })}
    ${calendarMonthViewHTML(monthOptions)}
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
  return `${CHEVRON_SVG}<span>${esc(String(y))}</span>${meta ? `<span class="calendar-year-meta">${meta}</span>` : ''}`;
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
