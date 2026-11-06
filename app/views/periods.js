import {
  calendarGrid, esc, fmtMs, fmtNum, heatLegend, heatmapTable, makeScale,
  MONTHS_SHORT, stackedBar
} from '../../src/charts.js';
import { civilFromDays } from '../../src/aggregate/impl/derive.js';
import {
  buildCalendarMonthOptions, calendarInspectorHTML, calendarMonthViewHTML,
  calendarScaleToggleHTML
} from '../calendar-ui.js';
import { createChartContract, renderChartWithContract } from '../../src/chart-contract.js';
import { formatSemanticRoute } from '../routes.js';
import { scrollChart } from '../chart-view.js';
import { card, entityLinks, table, topEntityInMap } from './shared.js';

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
