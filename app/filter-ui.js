// app/filter-ui.js — barra de filtros (HTML puro; el wiring vive en main.js)
//
// El estado de filtro es el objeto plano de src/filters.js. Esta barra edita
// rango (presets), año, mes, día de semana, franja horaria y toggles
// skip/shuffle/offline. Los filtros cruzados por entidad (artista/canción/
// álbum) se aplican desde las fichas, no desde la barra.

import { RANGE_PRESETS } from '../src/filters.js';
import { esc, fmtNum, fmtMs, MONTHS_SHORT, DOW_SHORT } from '../src/charts.js';

export const BLOCKS = [
  { id: 0, label: 'Madrugada', hours: [0, 1, 2, 3, 4, 5] },
  { id: 1, label: 'Mañana', hours: [6, 7, 8, 9, 10, 11] },
  { id: 2, label: 'Tarde', hours: [12, 13, 14, 15, 16, 17] },
  { id: 3, label: 'Noche', hours: [18, 19, 20, 21, 22, 23] }
];

export function isFilterActive(state) {
  return state.range || state.years || state.months || state.hours || state.dows ||
    state.artistId != null || state.trackId != null || state.albumId != null ||
    state.skip != null || state.shuffle != null || state.offline != null;
}

export function filterBarHTML(model, state, counts = null) {
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  const months = [...model.monthly.keys()].sort((a, b) => a - b);
  const lastTs = model.meta.lastTs ?? 0;

  const presets = RANGE_PRESETS.map((p) => {
    const active = p.id === 'all'
      ? !state.range
      : state.range != null && state.range.from === lastTs - p.days * 86400 && state.range.to === lastTs;
    return `<button type="button" data-preset="${p.id}" class="${active ? 'active' : ''}" aria-pressed="${active}">${p.label}</button>`;
  }).join('');

  const yearOpts = `<option value="">Todos los años</option>` +
    years.map((y) => `<option value="${esc(String(y))}" ${state.years?.has(y) ? 'selected' : ''}>${esc(String(y))}</option>`).join('');
  const monthOpts = `<option value="">Todos los meses</option>` +
    months
      .filter((mi) => !state.years || state.years.has(Math.floor(mi / 100)))
      .map((mi) => `<option value="${esc(String(mi))}" ${state.months?.has(mi) ? 'selected' : ''}>${esc(MONTHS_SHORT[(mi % 100) - 1])} ${esc(String(Math.floor(mi / 100)))}</option>`)
      .join('');

  const dows = DOW_SHORT.map((l, d) => {
    const on = state.dows?.has(d) ?? false;
    return `<label class="chip"><input type="checkbox" data-dow="${d}" ${on ? 'checked' : ''}> ${l}</label>`;
  }).join('');

  const blocks = BLOCKS.map((b) => {
    const on = state.hours != null && b.hours.every((h) => state.hours.has(h));
    return `<label class="chip"><input type="checkbox" data-block="${b.id}" ${on ? 'checked' : ''}> ${b.label}</label>`;
  }).join('');

  const toggles = ['skip', 'shuffle', 'offline'].map((k) => {
    const on = state[k] === true;
    const label = k === 'skip' ? 'Saltadas' : k === 'shuffle' ? 'Shuffle' : 'Offline';
    return `<label class="chip"><input type="checkbox" data-toggle="${k}" ${on ? 'checked' : ''}> ${label}</label>`;
  }).join('');

  const summary = counts
    ? `${fmtNum(counts.records)} reproducciones · ${fmtMs(counts.ms)}`
    : `${fmtNum(model.totals.records)} reproducciones · ${fmtMs(model.totals.ms)}`;

  return `<div class="filter-bar" role="group" aria-label="Filtros">
    <div class="filter-row">${presets}</div>
    <div class="filter-row">
      <select data-filter="year" aria-label="Año">${yearOpts}</select>
      <select data-filter="month" aria-label="Mes">${monthOpts}</select>
    </div>
    <div class="filter-row">${dows}</div>
    <div class="filter-row">${blocks}${toggles}</div>
    <div class="filter-row">
      <button type="button" data-action="clear" ${isFilterActive(state) ? '' : 'disabled'}>Limpiar filtros</button>
      <span class="filter-summary">${esc(summary)}</span>
    </div>
  </div>`;
}