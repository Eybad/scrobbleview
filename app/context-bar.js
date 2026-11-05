import { locToISODate, rangeFromMonth, rangeFromYear } from './filter-ui.js';
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
  const requestedRange = state.range ?? selectedPeriodRange(state);
  const observedStart = model.meta.firstTs;
  const observedEnd = model.meta.lastTs;
  const incompleteRange = requestedRange && Number.isFinite(observedStart) && Number.isFinite(observedEnd)
    && (requestedRange.from < observedStart || requestedRange.to > observedEnd);

  return `<aside class="context-bar" aria-label="Contexto de análisis y métrica">
    <div class="context-bar-inner">
      <div class="context-summary">
        <div class="context-period-slot">
          <span class="context-pill context-period" title="Período seleccionado">${esc(period)}</span>
          <div id="filter-progress" class="processing-slot processing-slot--filter" hidden>
            <p id="filter-processing-status" role="status" aria-live="off" aria-atomic="true"></p>
            <progress id="filter-processing-progress" max="1" value="0" aria-label="Progreso de actualización"></progress>
            <button type="button" class="btn btn-secondary btn-sm" id="cancel-filter-processing" aria-label="Cancelar actualización">Cancelar</button>
            <button type="button" class="btn btn-secondary btn-sm" id="reset-filter-processing" data-action="clear" hidden>Restablecer filtros</button>
          </div>
        </div>
        ${incompleteRange ? '<span class="context-coverage-warning">El rango observado no abarca todo el período seleccionado.</span>' : ''}
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

function selectedPeriodRange(state) {
  const ranges = [];
  for (const year of state.years ?? []) ranges.push(rangeFromYear(year));
  for (const month of state.months ?? []) ranges.push(rangeFromMonth(month));
  if (!ranges.length) return null;
  return {
    from: Math.min(...ranges.map((range) => range.from)),
    to: Math.max(...ranges.map((range) => range.to))
  };
}
