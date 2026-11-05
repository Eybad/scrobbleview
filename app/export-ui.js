import { fmtNum } from '../src/charts.js';
import { isFilterActive, locToISODate } from './filter-ui.js';
import { describeCatalogQuery, catalogOrderLabel } from './catalog-query.js';

function captureContext(context) {
  const { filterState, exploreState } = context;
  return {
    metric: context.metric,
    compareRanges: context.compareRanges,
    filterState: {
      ...filterState,
      range: filterState.range ? { ...filterState.range } : null,
      ...Object.fromEntries(['years', 'months', 'hours', 'dows'].map((key) => [key, filterState[key] ? new Set(filterState[key]) : null]))
    },
    exploreState: exploreState ? {
      tab: exploreState.tab,
      query: exploreState.query,
      sortBy: exploreState.sortBy,
      sortDir: exploreState.sortDir,
      page: exploreState.page,
      pageSize: exploreState.pageSize,
      minPlays: exploreState.minPlays,
      minMonths: exploreState.minMonths
    } : null
  };
}

function summarizeFilters(filters, model) {
  const parts = [];
  if (filters.range) parts.push(`${locToISODate(filters.range.from)} a ${locToISODate(filters.range.to)}`);
  if (filters.years?.size) parts.push(`años ${[...filters.years].sort((a, b) => a - b).join(', ')}`);
  if (filters.months?.size) parts.push(`${filters.months.size} meses seleccionados`);
  if (filters.dows?.size) parts.push(`${filters.dows.size} días de semana seleccionados`);
  if (filters.hours?.size) parts.push(`${filters.hours.size} horas seleccionadas`);
  for (const [id, kind, label] of [
    [filters.artistId, 'artists', 'Artista'],
    [filters.trackId, 'tracks', 'Canción'],
    [filters.albumId, 'albums', 'Álbum']
  ]) {
    if (id == null) continue;
    const entity = model[kind].byId.get(id);
    parts.push(`${label}: ${entity ? `${entity.name}${entity.artist ? ` — ${entity.artist}` : ''}` : id}`);
  }
  for (const [key, label] of [['skip', 'Saltada'], ['shuffle', 'Aleatoria'], ['offline', 'Sin conexión']]) {
    if (filters[key] != null) parts.push(`${label}: ${filters[key] === 'unknown' ? 'desconocida' : filters[key] ? 'sí' : 'no'}`);
  }
  return parts.length ? parts.join('; ') : 'sin filtros analíticos';
}

function downloadArchive(document, result) {
  const { Blob, URL } = document.defaultView;
  const blob = new Blob([result.bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function createExportUI({ document, getContext, client, beginProcessing, announce, reportError }) {
  const dialog = document.getElementById('dialog-export');
  const form = document.getElementById('export-form');
  let pendingContext = null;

  async function exportArchive(scope, context) {
    const label = scope === 'selection' ? 'Exportando selección analítica'
      : scope === 'table' ? 'Exportando tabla actual'
        : 'Preparando exportación';
    const job = beginProcessing(label, 'export');
    let result;
    try {
      result = await client.request('export', {
        scope,
        filterState: scope === 'all' ? undefined : context.filterState,
        metric: context.metric,
        exploreState: scope === 'table' ? context.exploreState : undefined,
        compareRanges: context.compareRanges ?? undefined
      }, { onProgress: job.progress });
    } finally {
      job.finish();
    }
    if (!result?.bytes) return;
    downloadArchive(document, result);
    if (scope === 'table') announce(`Descargadas ${fmtNum(result.totalMatches)} filas con su metadata.`);
  }

  function openDialog(defaultScope, current, context) {
    if (current.filterBusy) {
      announce('Esperá a que termine la actualización de filtros antes de exportar.');
      return true;
    }
    if (!dialog || typeof dialog.showModal !== 'function') return false;

    const { model, confirmedModel } = current;
    if (!confirmedModel) return true;
    pendingContext = context;

    const allDesc = document.getElementById('export-all-desc');
    if (allDesc) allDesc.textContent = `${fmtNum(model.totals.records)} reproducciones de todo el historial, sin filtros analíticos.`;

    const optSelection = document.getElementById('export-opt-selection');
    const selDesc = document.getElementById('export-selection-desc');
    const hasFilters = isFilterActive(context.filterState);
    if (optSelection && selDesc) {
      optSelection.classList.toggle('is-disabled', !hasFilters);
      optSelection.querySelector('input').disabled = !hasFilters;
      selDesc.textContent = hasFilters
        ? `${fmtNum(confirmedModel.totals.records)} reproducciones; ${summarizeFilters(context.filterState, model)}.`
        : 'No hay filtros analíticos activos.';
    }

    const optTable = document.getElementById('export-opt-table');
    const tableDesc = document.getElementById('export-table-desc');
    const hasTable = current.viewName === 'explore' && confirmedModel;
    if (optTable) {
      optTable.hidden = !hasTable;
      if (hasTable) {
        const tableButton = document.querySelector('#explore-card [data-action="export-table"]');
        const totalMatches = Number(tableButton?.dataset.totalMatches);
        const effectiveDir = tableButton?.dataset.sortDirection;
        const tableRadio = optTable.querySelector('input[name="export-scope"]');
        const hasRenderedQuery = Number.isSafeInteger(totalMatches) && totalMatches >= 0
          && (effectiveDir === 'asc' || effectiveDir === 'desc');
        if (tableRadio) tableRadio.disabled = !hasRenderedQuery;
        const { tab, options } = describeCatalogQuery(confirmedModel, {
          metric: context.metric,
          exploreState: context.exploreState
        });
        const tabName = tab === 'artists' ? 'artistas' : tab === 'tracks' ? 'canciones' : 'álbumes';
        const criteria = [];
        if (options.query) criteria.push(`búsqueda “${options.query}”`);
        if (options.minPlays != null) criteria.push(`mínimo ${options.minPlays} reproducciones`);
        if (options.minMonths != null) criteria.push(`mínimo ${options.minMonths} meses activos`);
        if (options.minKnownSkips != null) criteria.push(`mínimo ${options.minKnownSkips} saltos conocidos`);
        const criterion = criteria.length ? criteria.join('; ') : 'sin búsqueda ni umbrales adicionales';
        const metricLabel = context.metric === 'ms' ? 'tiempo escuchado' : 'reproducciones';
        if (tableDesc) {
          tableDesc.textContent = hasRenderedQuery
            ? `${fmtNum(totalMatches)} ${tabName}; selección: ${summarizeFilters(context.filterState, model)}; métrica principal: ${metricLabel}; ${criterion}; orden: ${catalogOrderLabel(options.sortBy, effectiveDir)}. Descarga un ZIP con el CSV y su metadata.`
            : 'No se pudo confirmar el conteo de la tabla actual. Volvé a abrir Explorar antes de exportarla.';
        }
      }
    }

    const tableScopeAvailable = hasTable && !form?.querySelector('input[name="export-scope"][value="table"]')?.disabled;
    const selectedScope = tableScopeAvailable || defaultScope !== 'table' ? defaultScope : 'all';
    const radio = form?.querySelector(`input[name="export-scope"][value="${selectedScope}"]`);
    if (radio && !radio.disabled) radio.checked = true;
    else {
      const allRadio = form?.querySelector('input[name="export-scope"][value="all"]');
      if (allRadio) allRadio.checked = true;
    }
    dialog.showModal();
    return true;
  }

  function handleError(error) {
    if (error.code !== 'E_ABORT') reportError(error);
  }

  dialog?.querySelector('[data-action="close-export"]')?.addEventListener('click', () => dialog.close());
  if (dialog) {
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const scope = new document.defaultView.FormData(form).get('export-scope') || 'all';
      dialog.close();
      try {
        if (!getContext().model) return;
        await exportArchive(scope, pendingContext ?? captureContext(getContext()));
      } catch (error) {
        handleError(error);
      } finally {
        pendingContext = null;
      }
    });
  }

  return {
    async start({ scope = 'all', trigger } = {}) {
      if (trigger?.disabled) return;
      const current = getContext();
      if (!current.model) return;
      const context = captureContext(current);
      if (openDialog(scope, current, context)) return;
      if (trigger) trigger.disabled = true;
      try {
        await exportArchive(scope, context);
      } catch (error) {
        handleError(error);
      } finally {
        if (trigger) trigger.disabled = false;
      }
    }
  };
}
