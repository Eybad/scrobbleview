import { fmtMs, fmtNum, fmtPct, esc, sparkline } from '../src/charts.js';
import { locToISODate } from './filter-ui.js';
import { formatSemanticRoute } from './routes.js';
import { calculateConstancy } from '../src/query.js';

export const ALL_COLUMNS = {
  artists: [
    { key: 'rank', label: '#', defaultVisible: true, sortKey: 'rank' },
    { key: 'name', label: 'Artista', defaultVisible: true, sortKey: 'name' },
    { key: 'ms', label: 'Tiempo', defaultVisible: true, sortKey: 'ms' },
    { key: 'plays', label: 'Reproducciones', defaultVisible: true, sortKey: 'plays' },
    { key: 'share', label: 'Cuota', defaultVisible: true, sortKey: 'metric' },
    { key: 'days', label: 'Días activos', defaultVisible: false, sortKey: 'days' },
    { key: 'months', label: 'Meses activos', defaultVisible: false, sortKey: 'months' },
    { key: 'firstTs', label: 'Primera vez', defaultVisible: false, sortKey: 'firstTs' },
    { key: 'lastTs', label: 'Última vez', defaultVisible: false, sortKey: 'lastTs' },
    { key: 'intensity', label: 'Intensidad', defaultVisible: false, sortKey: 'intensity' },
    { key: 'skipRate', label: 'Tasa de salto', defaultVisible: false, sortKey: 'skipRate' },
    { key: 'constancy', label: 'Constancia', defaultVisible: false, sortKey: 'constancy' },
    { key: 'longevity', label: 'Años activos', defaultVisible: false, sortKey: 'longevity' },
    { key: 'dominance', label: 'Canción dominante', defaultVisible: false, sortKey: 'dominance' },
    { key: 'deepCatalog', label: 'Catálogo', defaultVisible: false, sortKey: 'deepCatalog' },
    { key: 'forgotten', label: 'Última escucha y distancias', defaultVisible: false, sortKey: 'forgotten' },
    { key: 'trend', label: 'Tendencia', defaultVisible: true, sortKey: null }
  ],
  tracks: [
    { key: 'rank', label: '#', defaultVisible: true, sortKey: 'rank' },
    { key: 'name', label: 'Canción y Artista', defaultVisible: true, sortKey: 'name' },
    { key: 'ms', label: 'Tiempo', defaultVisible: true, sortKey: 'ms' },
    { key: 'plays', label: 'Reproducciones', defaultVisible: true, sortKey: 'plays' },
    { key: 'share', label: 'Cuota', defaultVisible: true, sortKey: 'metric' },
    { key: 'days', label: 'Días activos', defaultVisible: false, sortKey: 'days' },
    { key: 'months', label: 'Meses activos', defaultVisible: false, sortKey: 'months' },
    { key: 'firstTs', label: 'Primera vez', defaultVisible: false, sortKey: 'firstTs' },
    { key: 'lastTs', label: 'Última vez', defaultVisible: false, sortKey: 'lastTs' },
    { key: 'intensity', label: 'Intensidad', defaultVisible: false, sortKey: 'intensity' },
    { key: 'skipRate', label: 'Tasa de salto', defaultVisible: false, sortKey: 'skipRate' },
    { key: 'forgotten', label: 'Última escucha y distancias', defaultVisible: false, sortKey: 'forgotten' },
    { key: 'trend', label: 'Tendencia', defaultVisible: true, sortKey: null }
  ],
  albums: [
    { key: 'rank', label: '#', defaultVisible: true, sortKey: 'rank' },
    { key: 'name', label: 'Álbum y Artista', defaultVisible: true, sortKey: 'name' },
    { key: 'ms', label: 'Tiempo', defaultVisible: true, sortKey: 'ms' },
    { key: 'plays', label: 'Reproducciones', defaultVisible: true, sortKey: 'plays' },
    { key: 'share', label: 'Cuota', defaultVisible: true, sortKey: 'metric' },
    { key: 'days', label: 'Días activos', defaultVisible: false, sortKey: 'days' },
    { key: 'months', label: 'Meses activos', defaultVisible: false, sortKey: 'months' },
    { key: 'firstTs', label: 'Primera vez', defaultVisible: false, sortKey: 'firstTs' },
    { key: 'lastTs', label: 'Última vez', defaultVisible: false, sortKey: 'lastTs' },
    { key: 'intensity', label: 'Intensidad', defaultVisible: false, sortKey: 'intensity' },
    { key: 'skipRate', label: 'Tasa de salto', defaultVisible: false, sortKey: 'skipRate' },
    { key: 'trend', label: 'Tendencia', defaultVisible: true, sortKey: null }
  ]
};

export function paginationControlsHTML(queryResult) {
  const { totalMatches, page, pageSize, totalPages, startRow, endRow } = queryResult;
  if (totalMatches === 0) return '';

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  const pageActions = pageSize === 'all' ? '' : `
    <button type="button" class="btn btn-sm btn-page" data-page="${page - 1}" data-page-action="previous" ${prevDisabled ? 'disabled aria-disabled="true"' : ''} aria-label="Página anterior">← Anterior</button>
    <span class="pagination-current">Página ${page} de ${totalPages}</span>
    <button type="button" class="btn btn-sm btn-page" data-page="${page + 1}" data-page-action="next" ${nextDisabled ? 'disabled aria-disabled="true"' : ''} aria-label="Página siguiente">Siguiente →</button>`;

  return `
    <nav class="pagination" aria-label="Paginación de resultados">
      <div class="pagination-info" aria-live="polite">
        Mostrando ${startRow}–${endRow} de ${totalMatches} ${totalMatches === 1 ? 'resultado' : 'resultados'}
      </div>
      <div class="pagination-actions">
        ${pageActions}
        <label class="pagination-size-label">
          <span>Filas:</span>
          <select class="pagination-select" data-page-size name="pageSize" aria-label="Filas por página">
            <option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option>
            <option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option>
            <option value="100" ${pageSize === 100 ? 'selected' : ''}>100</option>
            <option value="all" ${pageSize === 'all' ? 'selected' : ''}>Todas</option>
          </select>
        </label>
      </div>
    </nav>`;
}

export function densityControlsHTML(density = 'comfortable') {
  const isCompact = density === 'compact';
  return `
    <div class="density-controls" role="group" aria-label="Densidad de tabla">
      <button type="button" class="btn btn-sm ${!isCompact ? 'active' : ''}" data-density="comfortable" aria-pressed="${!isCompact}">Cómoda</button>
      <button type="button" class="btn btn-sm ${isCompact ? 'active' : ''}" data-density="compact" aria-pressed="${isCompact}">Compacta</button>
    </div>`;
}

export function columnsPickerHTML(tab, visibleCols) {
  const defs = ALL_COLUMNS[tab] || ALL_COLUMNS.artists;
  const optional = defs.filter((c) => !['rank', 'name', 'ms', 'plays', 'share'].includes(c.key));

  return `
    <details class="col-picker">
      <summary class="btn btn-sm btn-secondary" aria-label="Columnas visibles"><span>Columnas</span><span class="col-picker-summary-detail"> visibles</span></summary>
      <div class="col-picker-menu">
        <fieldset>
          <legend class="sr-only">Selección de columnas secundarias</legend>
          ${optional.map((col) => {
            const checked = visibleCols ? visibleCols.has(col.key) : col.defaultVisible;
            return `<label class="col-picker-item">
              <input type="checkbox" data-col-toggle="${col.key}" ${checked ? 'checked' : ''}>
              <span>${esc(col.label)}</span>
            </label>`;
          }).join('')}
        </fieldset>
        <div class="col-picker-actions">
          <button type="button" class="btn btn-quiet btn-sm" data-reset-cols>Restablecer</button>
        </div>
      </div>
    </details>`;
}

export function catalogTableHTML(queryResult, {
  tab = 'artists',
  metric = 'ms',
  sortBy = 'metric',
  sortDir = 'desc',
  query = '',
  visibleCols = null,
  density = 'comfortable',
  queryParamStr = '',
  spark = null
} = {}) {
  const { rows, totalMatches, totalItems } = queryResult;

  if (totalMatches === 0) {
    if (query) {
      return `
        <div class="empty-state">
          <p class="empty">Sin coincidencias para “${esc(query)}”.</p>
          <p class="empty-hint">Probá con otro término o limpiá la búsqueda para ver el catálogo completo.</p>
          <p><button type="button" class="btn btn-secondary" data-clear-search>Limpiar búsqueda</button></p>
        </div>`;
    }
    return `
      <div class="empty-state">
        <p class="empty">No hay registros con los filtros actuales.</p>
        <p class="empty-hint">Ajustá el período o los filtros activos para ver estadísticas.</p>
      </div>`;
  }

  const defs = ALL_COLUMNS[tab] || ALL_COLUMNS.artists;
  const activeCols = defs.filter((col) => {
    if (['rank', 'name', 'ms', 'plays', 'share'].includes(col.key)) return true;
    if (col.sortKey === sortBy || (col.key === 'skipRate' && sortBy === 'lowSkipRate')) return true;
    if (col.key === 'trend' && !spark) return false;
    return visibleCols ? visibleCols.has(col.key) : col.defaultVisible;
  });

  const headerCells = activeCols.map((col) => {
    if (!col.sortKey) {
      return `<th scope="col" class="${col.key === 'trend' ? 'col-trend' : ''}">${esc(col.label)}</th>`;
    }
    const isMetricSort = sortBy === 'metric';
    const isSorted = (col.key === 'rank' && sortBy === 'rank') ||
      (col.key === 'ms' && ((isMetricSort && metric === 'ms') || sortBy === 'ms')) ||
      (col.key === 'plays' && ((isMetricSort && metric === 'plays') || sortBy === 'plays')) ||
      (col.key !== 'share' && col.key !== 'rank' && col.key !== 'ms' && col.key !== 'plays' && (sortBy === col.sortKey || (col.key === 'skipRate' && sortBy === 'lowSkipRate')));

    const currentAriaSort = isSorted
      ? (sortDir === 'asc' ? 'ascending' : 'descending')
      : 'none';

    const nextDir = isSorted
      ? (sortDir === 'asc' ? 'desc' : 'asc')
      : (col.sortKey === 'name' || col.sortKey === 'artist' || col.sortKey === 'rank' ? 'asc' : 'desc');

    const sortIndicator = isSorted ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    const numericClass = ['ms', 'plays', 'share', 'days', 'months', 'intensity', 'skipRate', 'constancy', 'longevity'].includes(col.key) ? 'n' : '';

    const sizingClass = {
      rank: 'col-rank',
      name: 'col-name-head',
      ms: 'col-time',
      plays: 'col-plays',
      share: 'col-share'
    }[col.key] ?? '';

    return `<th scope="col" class="${numericClass} ${sizingClass}" aria-sort="${currentAriaSort}">
      <button type="button" class="btn-sort" data-sort="${col.sortKey}" data-dir="${nextDir}" aria-label="Ordenar por ${esc(col.label)}">
        <span>${esc(col.label)}</span><span class="sort-icon" aria-hidden="true">${sortIndicator}</span>
      </button>
    </th>`;
  }).join('');

  let maxVal = 0;
  for (const row of rows) {
    const value = metric === 'ms' ? (row.item.ms ?? 0) : (row.item.plays ?? 0);
    if (value > maxVal) maxVal = value;
  }

  const bodyRows = rows.map((r) => {
    const it = r.item;
    const isTrack = tab === 'tracks';
    const isAlbum = tab === 'albums';

    let linkHref = null;
    if (tab === 'artists') linkHref = formatSemanticRoute('artist', it, queryParamStr);
    else if (isTrack) linkHref = formatSemanticRoute('track', it, queryParamStr);
    else if (isAlbum) linkHref = formatSemanticRoute('album', it, queryParamStr);

    const fullTitle = isTrack || isAlbum
      ? `${it.name} — ${it.artist}`
      : it.name;

    const nameCellContent = isTrack || isAlbum
      ? `<span class="cell-entity">
          <a class="cell-link" href="${esc(linkHref)}" title="${esc(fullTitle)}">
            <span class="cell-name">${esc(it.name)}</span>
            <span class="cell-sub">${esc(it.artist)}</span>
          </a>
          <button type="button" class="btn-name-expand" data-expand-name aria-label="Expandir nombre" aria-expanded="false" title="Expandir nombre"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5.5 3 4.5 5-4.5 5"/></svg></button>
        </span>`
      : `<span class="cell-entity">
          <a class="cell-link" href="${esc(linkHref)}" title="${esc(it.name)}">
            <span class="cell-name">${esc(it.name)}</span>
          </a>
          <button type="button" class="btn-name-expand" data-expand-name aria-label="Expandir nombre" aria-expanded="false" title="Expandir nombre"><svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5.5 3 4.5 5-4.5 5"/></svg></button>
        </span>`;

    const cells = activeCols.map((col) => {
      switch (col.key) {
        case 'rank':
          return `<td class="c col-rank" data-label="#">${r.metricRank}</td>`;
        case 'name':
          return `<td class="col-name" data-label="Nombre">${nameCellContent}</td>`;
        case 'ms':
          return `<td class="n col-time" data-label="Tiempo">${fmtMs(it.ms ?? 0)}</td>`;
        case 'plays':
          return `<td class="n col-plays" data-label="Reproducciones">${fmtNum(it.plays ?? 0)}</td>`;
        case 'share':
          return `<td class="n col-share" data-label="Cuota">${fmtPct(r.share)}</td>`;
        case 'days':
          return `<td class="n" data-label="Días">${fmtNum(it.days?.size ?? it.days ?? 0)}</td>`;
        case 'months':
          return `<td class="n" data-label="Meses">${fmtNum(it.months?.size ?? it.months ?? 0)}</td>`;
        case 'firstTs':
          return `<td class="c" data-label="Primera vez">${it.firstTs != null ? locToISODate(it.firstTs) : '—'}</td>`;
        case 'lastTs':
          return `<td class="c" data-label="Última vez">${it.lastTs != null ? locToISODate(it.lastTs) : '—'}</td>`;
        case 'intensity': {
          const d = it.days?.size ?? it.days ?? 0;
          return `<td class="n" data-label="Intensidad">${d > 0 ? ((it.plays ?? 0) / d).toFixed(1) : '—'}</td>`;
        }
        case 'skipRate': {
          const known = it.skipKnown ?? 0;
          return `<td class="n" data-label="Tasa de salto">${known > 0 ? `${fmtPct((it.skips ?? 0) / known)} <small>(${fmtNum(it.skips ?? 0)}/${fmtNum(known)})</small>` : '—'}</td>`;
        }
        case 'constancy': {
          const value = calculateConstancy(it);
          return `<td class="n" data-label="Constancia">${value ? `${fmtPct(value.coverage)} <small>(${fmtNum(value.months)}/${fmtNum(value.span)} meses)</small>` : '—'}</td>`;
        }
        case 'longevity':
          return `<td class="n" data-label="Años activos">${fmtNum(it.years?.size ?? 0)}</td>`;
        case 'dominance':
          return `<td data-label="Canción dominante">${it.dominantTrack ? `${esc(it.dominantTrack.name)} · ${fmtPct(it.dominance)}` : '—'}</td>`;
        case 'deepCatalog':
          return `<td class="n" data-label="Catálogo">${fmtNum(it.tracks?.size ?? 0)} canciones · ${fmtNum(it.albums?.size ?? 0)} álbumes</td>`;
        case 'forgotten':
          return `<td data-label="Última escucha y distancias">${it.lastTs != null ? locToISODate(it.lastTs) : '—'} · ${it.daysSinceEnd == null ? '—' : fmtNum(it.daysSinceEnd)} ${it.daysSinceEnd === 1 ? 'día' : 'días'} entre última escucha y fin del historial · ${it.daysSinceNow == null ? '—' : fmtNum(it.daysSinceNow)} ${it.daysSinceNow === 1 ? 'día' : 'días'} desde última escucha hasta hoy</td>`;
        case 'trend': {
          if (!spark) return `<td></td>`;
          const pts = spark(it);
          const hasPts = pts && pts.some((v) => v > 0);
          return `<td class="col-trend" data-label="Tendencia">${hasPts ? sparkline({ points: pts, width: 80, height: 24 }) : '—'}</td>`;
        }
        default:
          return `<td></td>`;
      }
    }).join('');

    const rowVal = metric === 'ms' ? (it.ms ?? 0) : (it.plays ?? 0);
    const barW = maxVal > 0 ? ((rowVal / maxVal) * 100).toFixed(1) : '0';

    return `<tr style="--bar-w:${barW}%">${cells}</tr>`;
  }).join('');

  const densityClass = density === 'compact' ? 'table--compact' : '';
  const tableName = tab === 'artists' ? 'Artistas' : tab === 'tracks' ? 'Canciones' : 'Álbumes';
  const matchLabel = totalMatches === 1 ? 'coincidencia' : 'coincidencias';

  return `
    <div class="table-scroll catalog-table-wrap ${densityClass}" tabindex="0" role="region" aria-label="${tableName} del catálogo" aria-describedby="catalog-scroll-hint">
      <table class="catalog-table">
        <caption class="visually-hidden">${tableName}: ${totalMatches} ${matchLabel}</caption>
        <thead>
          <tr>${headerCells}</tr>
        </thead>
        <tbody>
          ${bodyRows}
        </tbody>
      </table>
    </div>
    <p class="catalog-scroll-hint" id="catalog-scroll-hint" data-catalog-scroll-hint hidden>Deslizá para ver más columnas</p>`;
}
