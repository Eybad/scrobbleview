import { DOW_SHORT, esc, fmtMs, fmtNum } from '../../src/charts.js';
import { civilFromDays } from '../../src/aggregate/impl/derive.js';
import { contractedBarChart, contractedLineChart } from '../chart-view.js';
import { card, cardWithLimit, entityLinks, fillMonths, fmtLocal, kpis, monthLabel, pctOf, reasonLabel, resolveLimit, sortedMonths, table } from './shared.js';

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
    ], 'sessions-kpis')}
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
