import { locToISODate, advancedFilterCount } from './filter-ui.js';
import { esc } from '../src/charts.js';

export function formatPeriodLabel(state, model) {
  if (state.range) {
    return `${locToISODate(state.range.from)} – ${locToISODate(state.range.to)}`;
  }
  if (state.years && state.years.size === 1) {
    return `Año ${[...state.years][0]}`;
  }
  if (state.years && state.years.size > 1) {
    return `${state.years.size} años seleccionados`;
  }
  return 'Todo el historial';
}

export function contextBarHTML({ state, model, metric }) {
  if (!model) return '';
  const period = formatPeriodLabel(state, model);
  const hasExplicitPeriod = Boolean(state.range || state.years?.size);
  const advCount = advancedFilterCount(state, model.meta.lastTs ?? 0);
  const entityCount = (state.artistId ? 1 : 0) + (state.trackId ? 1 : 0) + (state.albumId ? 1 : 0);
  const totalFilters = advCount + entityCount;

  const filterLabel = `${totalFilters} filtro${totalFilters > 1 ? 's' : ''} aplicado${totalFilters > 1 ? 's' : ''}`;

  return `<aside class="context-bar" aria-label="Contexto de análisis y métrica">
    <div class="context-bar-inner">
      <div class="context-summary">
        <span class="context-pill context-period" title="Período activo"${hasExplicitPeriod ? '' : ' hidden'}>${esc(period)}</span>
        ${totalFilters > 0 ? `<button type="button" class="context-pill context-filter-btn" data-action="focus-filters" aria-label="Filtros activos: ${filterLabel}">${totalFilters} filtro${totalFilters > 1 ? 's' : ''}</button>` : ''}
      </div>
      <div class="context-controls">
        <div class="metric-switch" role="group" aria-label="Métrica">
          <button type="button" class="btn btn-sm ${metric === 'ms' ? 'btn-primary' : 'btn-ghost'}" data-metric="ms" aria-pressed="${metric === 'ms'}">Tiempo</button>
          <button type="button" class="btn btn-sm ${metric === 'plays' ? 'btn-primary' : 'btn-ghost'}" data-metric="plays" aria-pressed="${metric === 'plays'}">Reproducciones</button>
        </div>
      </div>
    </div>
  </aside>`;
}
