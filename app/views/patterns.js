import { DOW_LONG, esc, fmtMs, fmtNum } from '../../src/charts.js';
import { contractedBarChart } from '../chart-view.js';
import { card, dayHourHeatChart, entityLinks, kpis, pctOf, table, topEntityInMap } from './shared.js';

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
    ])}
    <div class="grid-2">
      ${hourChart}
      ${dowChart}
    </div>
    ${dayHourChart}
    ${card('Las 4 franjas del día', table(['Franja', 'Reproducciones', 'Tiempo', '%', 'Artista #1', 'Canción #1'], blockRows, '', ['', 'n', 'n', 'n', '', ''], null, 'Comparación de las 4 franjas del día'))}
    ${card('Detalle por hora (00:00–23:00)', table(['Hora', 'Total de la hora', 'Canción #1'], hourTrackRows, '', ['c', 'n', ''], null, 'Actividad total y canción más escuchada en cada una de las 24 horas del día'))}`;
}
