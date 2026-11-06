import { DOW_LONG, esc, fmtMs, fmtNum, fmtPct } from '../../src/charts.js';
import { contractedBarChart, contractedLineChart } from '../chart-view.js';
import { card, cardWithLimit, catalogHref, dayHourHeatChart, entityLinks, fillMonths, fmtLocal, kpis, monthLabel, pctOf, reasonLabel, resolveLimit, sortedMonths, table, topEntityInMap } from './shared.js';

export function hoursView(model, ctx = {}) {
  const { entityLink, trackSubLink } = entityLinks(model, ctx.query);
  const byMs = ctx?.metric === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const valLabel = byMs ? 'Tiempo' : 'Reproducciones';
  const totalVal = byMs ? model.totals.ms : model.totals.records;

  let peakHour = 0;
  let valleyHour = 0;
  for (let hour = 1; hour < 24; hour++) {
    const current = byMs ? model.hour[hour].ms : model.hour[hour].plays;
    const peak = byMs ? model.hour[peakHour].ms : model.hour[peakHour].plays;
    const valley = byMs ? model.hour[valleyHour].ms : model.hour[valleyHour].plays;
    if (current > peak) peakHour = hour;
    if (current < valley) valleyHour = hour;
  }

  let peakDow = 0;
  for (let day = 1; day < 7; day++) {
    const current = byMs ? model.weekday[day].ms : model.weekday[day].plays;
    const peak = byMs ? model.weekday[peakDow].ms : model.weekday[peakDow].plays;
    if (current > peak) peakDow = day;
  }

  const blockNames = ['Madrugada (0–5h)', 'Mañana (6–11h)', 'Tarde (12–17h)', 'Noche (18–23h)'];
  let peakBlock = 0;
  for (let block = 1; block < 4; block++) {
    const current = byMs ? model.blocks[block].ms : model.blocks[block].plays;
    const peak = byMs ? model.blocks[peakBlock].ms : model.blocks[peakBlock].plays;
    if (current > peak) peakBlock = block;
  }

  const weekendVal = byMs
    ? model.weekday[5].ms + model.weekday[6].ms
    : model.weekday[5].plays + model.weekday[6].plays;
  const weekdayVal = totalVal - weekendVal;

  const hourChart = contractedBarChart({
    id: 'hours-by-hour', title: `Actividad por hora del día (${valLabel.toLowerCase()})`,
    data: model.hour.map((hour, index) => ({
      label: String(index).padStart(2, '0'),
      value: byMs ? hour.ms : hour.plays
    })),
    format: valFmt,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida' : 'eventos registrados',
    showValue: false
  });

  const dowChart = contractedBarChart({
    id: 'hours-by-weekday', title: `Actividad por día de la semana (${valLabel.toLowerCase()})`,
    data: DOW_LONG.map((label, day) => ({
      label,
      value: byMs ? model.weekday[day].ms : model.weekday[day].plays
    })),
    format: valFmt,
    unit: byMs ? 'tiempo escuchado' : 'reproducciones',
    base: byMs ? 'duración conocida' : 'eventos registrados',
    orientation: 'horizontal'
  });

  const dayHourChart = dayHourHeatChart(model, {
    id: 'hours-day-hour',
    title: 'Actividad por día y hora',
    metric: byMs ? 'ms' : 'plays'
  });

  const blockRows = model.blocks.map((block, index) => {
    const topArtistEntry = topEntityInMap(block.artists, true);
    const topArtist = topArtistEntry ? model.artists.byId.get(topArtistEntry[0]) : null;
    const topTrackEntry = topEntityInMap(block.tracks, false);
    const topTrack = topTrackEntry ? model.tracks.byId.get(topTrackEntry[0]) : null;
    const blockValue = byMs ? block.ms : block.plays;
    return [
      esc(blockNames[index]),
      fmtNum(block.plays),
      fmtMs(block.ms),
      pctOf(blockValue, totalVal),
      topArtist ? entityLink('artist', topArtist.id, topArtist.name) : '—',
      topTrack ? trackSubLink(topTrackEntry[0], topTrack.name, topTrack.artist) : '—'
    ];
  });

  const hourTrackRows = Array.from({ length: 24 }, (_, hour) => {
    const label = `${String(hour).padStart(2, '0')}:00`;
    const hourStats = model.hour[hour];
    const tracks = byMs ? model.hourTracksMs[hour] : model.hourTracks[hour];
    const topEntry = topEntityInMap(tracks, false);
    const topTrackId = topEntry ? topEntry[0] : null;
    const topTrack = topTrackId != null ? model.tracks.byId.get(topTrackId) : null;
    const topPlays = topTrackId != null ? (model.hourTracks[hour].get(topTrackId) ?? 0) : 0;
    const topMs = topTrackId != null ? (model.hourTracksMs[hour].get(topTrackId) ?? 0) : 0;
    return [
      esc(label),
      `<div class="cell-metric-stack"><span class="cell-metric-val">${fmtNum(hourStats.plays)} rep.</span><span class="cell-metric-sub">${fmtMs(hourStats.ms)}</span></div>`,
      topTrack ? trackSubLink(topTrackId, topTrack.name, `${topTrack.artist} · ${fmtNum(topPlays)} rep. (${fmtMs(topMs)})`) : '—'
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
    ], 'hours-kpis')}
    <div class="grid-2">
      ${hourChart}
      ${dowChart}
    </div>
    ${dayHourChart}
    ${card('Las 4 franjas del día', table(['Franja', 'Reproducciones', 'Tiempo', '%', 'Artista #1', 'Canción #1'], blockRows, '', ['', 'n', 'n', 'n', '', ''], null, 'Comparación de las 4 franjas del día'))}
    ${card('Detalle por hora (00:00–23:00)', table(['Hora', 'Total de la hora', 'Canción #1'], hourTrackRows, '', ['c', 'n', ''], null, 'Actividad total y canción más escuchada en cada una de las 24 horas del día'))}`;
}


function paretoShare(list, n, byMs, total) {
  if (total <= 0 || list.length === 0) return '—';
  let sum = 0;
  const cap = Math.min(list.length, n);
  for (let i = 0; i < cap; i++) sum += byMs ? list[i].ms : list[i].plays;
  return fmtPct(sum / total);
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
