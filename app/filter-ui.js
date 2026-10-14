// app/filter-ui.js — barra de filtros (HTML puro; el wiring vive en main.js)
//
// El estado de filtro es el objeto plano de src/filters.js. Esta barra edita
// rango (presets), año, mes, día de semana, franja horaria y toggles
// skip/shuffle/offline. Los filtros cruzados por entidad (artista/canción/
// álbum) se aplican desde las fichas, no desde la barra.

import { RANGE_PRESETS } from '../src/filters.js';
import { esc, fmtNum, fmtMs, MONTHS_SHORT, DOW_SHORT } from '../src/charts.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';

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

// epoch-local (segundos) → 'YYYY-MM-DD' para <input type="date">.
export function locToISODate(loc) {
  const c = civilFromDays(Math.floor(loc / 86400));
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' → día (días desde epoch). null si inválida.
export function isoDateToDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const day = Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
  return Number.isFinite(day) ? day : null;
}

export function monthOptionsHTML(model, state) {
  const months = [...model.monthly.keys()].sort((a, b) => a - b);
  return `<option value="">Todos los meses</option>` +
    months
      .filter((mi) => !state.years || state.years.has(Math.floor(mi / 100)))
      .map((mi) => `<option value="${esc(String(mi))}" ${state.months?.has(mi) ? 'selected' : ''}>${esc(MONTHS_SHORT[(mi % 100) - 1])} ${esc(String(Math.floor(mi / 100)))}</option>`)
      .join('');
}

// Nombre de la entidad filtrada (para el chip). null si no hay filtro.
export function entityChip(model, state) {
  if (state.artistId != null) {
    const a = model.artists.byId.get(state.artistId);
    return { kind: 'artistId', label: `Artista: ${a ? a.name : state.artistId}` };
  }
  if (state.trackId != null) {
    const t = model.tracks.byId.get(state.trackId);
    return { kind: 'trackId', label: `Canción: ${t ? `${t.name} — ${t.artist}` : state.trackId}` };
  }
  if (state.albumId != null) {
    const al = model.albums.byId.get(state.albumId);
    return { kind: 'albumId', label: `Álbum: ${al ? `${al.name} — ${al.artist}` : state.albumId}` };
  }
  return null;
}

export function chipsHTML(model, state) {
  const chips = [];
  const entity = entityChip(model, state);
  if (entity) chips.push({ unset: entity.kind, label: entity.label });
  if (state.range) chips.push({ unset: 'range', label: `Rango: ${locToISODate(state.range.from)} → ${locToISODate(state.range.to)}` });
  if (state.years) for (const y of [...state.years].sort()) chips.push({ unset: 'years', label: `Año ${y}` });
  if (state.months) chips.push({ unset: 'months', label: `${state.months.size} mes(es)` });
  for (const k of ['skip', 'shuffle', 'offline']) {
    if (state[k] != null) {
      const name = k === 'skip' ? 'Saltadas' : k === 'shuffle' ? 'Shuffle' : 'Offline';
      chips.push({ unset: k, label: state[k] ? `Solo ${name.toLowerCase()}` : `Sin ${name.toLowerCase()}` });
    }
  }
  if (!chips.length) return '';
  return chips.map((c) => `<button type="button" class="chip chip-active" data-unset="${c.unset}">${esc(c.label)} ✕</button>`).join('');
}

export function filterBarHTML(model, state, counts = null) {
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  const lastTs = model.meta.lastTs ?? 0;

  const presets = RANGE_PRESETS.map((p) => {
    const active = p.id === 'all'
      ? !state.range
      : state.range != null && state.range.from === lastTs - p.days * 86400 && state.range.to === lastTs;
    return `<button type="button" data-preset="${p.id}" class="${active ? 'active' : ''}" aria-pressed="${active}">${p.label}</button>`;
  }).join('');

  const yearOpts = `<option value="">Todos los años</option>` +
    years.map((y) => `<option value="${esc(String(y))}" ${state.years?.has(y) ? 'selected' : ''}>${esc(String(y))}</option>`).join('');
  const monthOpts = monthOptionsHTML(model, state);

  const dows = DOW_SHORT.map((l, d) => {
    const on = state.dows?.has(d) ?? false;
    return `<label class="chip"><input type="checkbox" data-dow="${d}" ${on ? 'checked' : ''}> ${l}</label>`;
  }).join('');

  const blocks = BLOCKS.map((b) => {
    const on = state.hours != null && b.hours.every((h) => state.hours.has(h));
    return `<label class="chip"><input type="checkbox" data-block="${b.id}" ${on ? 'checked' : ''}> ${b.label}</label>`;
  }).join('');

  // 3 estados: Todos (null) / Solo sí (true) / Excluir (false).
  const toggles = ['skip', 'shuffle', 'offline'].map((k) => {
    const label = k === 'skip' ? 'Saltadas' : k === 'shuffle' ? 'Shuffle' : 'Offline';
    const v = state[k] === true ? 'yes' : state[k] === false ? 'no' : '';
    return `<label class="chip">${label} <select data-toggle3="${k}" aria-label="${label}">
      <option value="" ${v === '' ? 'selected' : ''}>Todos</option>
      <option value="yes" ${v === 'yes' ? 'selected' : ''}>Solo sí</option>
      <option value="no" ${v === 'no' ? 'selected' : ''}>Excluir</option>
    </select></label>`;
  }).join('');

  const fromISO = state.range ? locToISODate(state.range.from) : '';
  const toISO = state.range ? locToISODate(state.range.to) : '';

  const summary = counts
    ? `${fmtNum(counts.records)} reproducciones · ${fmtMs(counts.ms)}`
    : `${fmtNum(model.totals.records)} reproducciones · ${fmtMs(model.totals.ms)}`;

  return `<div class="filter-bar" id="filter-bar" role="group" aria-label="Filtros">
    <div class="filter-row">${presets}</div>
    <div class="filter-row">
      <label>Desde <input type="date" data-filter="from" value="${fromISO}"></label>
      <label>Hasta <input type="date" data-filter="to" value="${toISO}"></label>
    </div>
    <div class="filter-row" id="filter-chips">${chipsHTML(model, state)}</div>
    <details class="filter-advanced">
      <summary>Filtros avanzados</summary>
      <div class="filter-row">
        <select data-filter="year" aria-label="Año">${yearOpts}</select>
        <select data-filter="month" aria-label="Mes" id="filter-month">${monthOpts}</select>
      </div>
      <div class="filter-row">${dows}</div>
      <div class="filter-row">${blocks}</div>
      <div class="filter-row">${toggles}</div>
    </details>
    <div class="filter-row">
      <button type="button" id="filter-clear" data-action="clear" ${isFilterActive(state) ? '' : 'disabled'}>Limpiar filtros</button>
      <span class="filter-summary" id="filter-summary" tabindex="-1">${esc(summary)}</span>
    </div>
  </div>`;
}