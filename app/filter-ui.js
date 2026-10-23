// app/filter-ui.js — barra de filtros (HTML puro; el wiring vive en main.js)
//
// El estado de filtro es el objeto plano de src/filters.js. Esta barra edita
// rango (presets), año, mes, día de semana, franja horaria y toggles
// skip/shuffle/offline. Los filtros cruzados por entidad (artista/canción/
// álbum) se aplican desde las fichas, no desde la barra.

import { RANGE_PRESETS, emptyFilterState } from '../src/filters.js';
import { esc, MONTHS_SHORT, fmtNum, fmtMs } from '../src/charts.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';

export const BLOCKS = [
  { id: 0, label: 'Madrugada', hours: [0, 1, 2, 3, 4, 5] },
  { id: 1, label: 'Mañana', hours: [6, 7, 8, 9, 10, 11] },
  { id: 2, label: 'Tarde', hours: [12, 13, 14, 15, 16, 17] },
  { id: 3, label: 'Noche', hours: [18, 19, 20, 21, 22, 23] }
];

// X = miércoles (convención de calendarios en español: dos M idénticas
// reintroducirían la ambigüedad que resolvimos en los íconos de cabecera).
const DOW_INITIALS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DOW_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

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

// Normaliza el par Desde/Hasta al editar una fecha: si el rango queda
// invertido, colapsa al día editado (patrón de los date range pickers de
// Polaris). Devuelve días epoch; null = sin fecha en ese lado.
export function normalizeRangeDays(fromDay, toDay, edited) {
  if (fromDay != null && toDay != null) {
    if (edited === 'from' && fromDay > toDay) return { fromDay, toDay: fromDay };
    if (edited === 'to' && toDay < fromDay) return { fromDay: toDay, toDay };
  }
  return { fromDay, toDay };
}

// Anuncio para lectores de pantalla tras cada re-agregado (región role="status"
// en main.js): los KPIs cambian visualmente, pero una región viva necesita el
// texto explícito (WCAG 4.1.3).
export function filterStatusMessage(totals) {
  return `${fmtNum(totals.records)} reproducciones · ${fmtMs(totals.ms)} escuchadas`;
}

// Rango completo de un año/mes en epoch-local seconds. Los dropdowns de
// año/mes son shortcuts que poblan Desde/Hasta: un solo mecanismo de rango,
// sin filtros temporales operando en paralelo.
export function rangeFromYear(y) {
  const fromDay = Math.floor(Date.UTC(y, 0, 1) / 86400000);
  const toDay = Math.floor(Date.UTC(y + 1, 0, 1) / 86400000) - 1;
  return { from: fromDay * 86400, to: toDay * 86400 + 86399 };
}

export function rangeFromMonth(ym) {
  const y = Math.floor(ym / 100);
  const m = ym % 100;
  const fromDay = Math.floor(Date.UTC(y, m - 1, 1) / 86400000);
  const toDay = Math.floor(Date.UTC(y, m, 1) / 86400000) - 1;
  return { from: fromDay * 86400, to: toDay * 86400 + 86399 };
}

// Período inmediato anterior de igual largo (para comparar % en los KPIs).
// Con rango de un solo día el anterior es el día previo; sin rango activo no
// hay "anterior" definido y la comparación no se muestra.
export function previousRange(range) {
  const len = range.to - range.from + 1;
  return { from: range.from - len, to: range.from - 1 };
}

// Detecta si el rango es exactamente un año o un mes completo (etiqueta corta
// del chip y sync inverso de los shortcuts). Solo cuenta un rango que arranque
// el día 1 a las 00:00 y termine al cierre de un día.
export function matchRangeShortcut(range) {
  const fromDay = Math.floor(range.from / 86400);
  const endsFullDay = range.to === Math.floor(range.to / 86400) * 86400 + 86399;
  if (range.from !== fromDay * 86400 || !endsFullDay) return { year: null, month: null };
  const c = civilFromDays(fromDay);
  if (c.d !== 1) return { year: null, month: null };
  const ym = c.y * 100 + c.m;
  const month = rangeFromMonth(ym);
  const year = rangeFromYear(c.y);
  return {
    year: year.from === range.from && year.to === range.to ? c.y : null,
    month: month.from === range.from && month.to === range.to ? ym : null
  };
}

// Etiqueta del chip de rango: un año/mes completo se resume ("Año 2024",
// "mar 2024"); el resto muestra las fechas sin prefijo (el chip ya es un rango).
export function rangeChipLabel(range) {
  const m = matchRangeShortcut(range);
  if (m.year != null) return `Año ${m.year}`;
  if (m.month != null) return `${MONTHS_SHORT[(m.month % 100) - 1]} ${Math.floor(m.month / 100)}`;
  return `${locToISODate(range.from)} → ${locToISODate(range.to)}`;
}

// Sync inverso de los shortcuts: los selects reflejan el rango vigente (match
// exacto → el valor; rango arbitrario → "Personalizado"; sin rango →
// placeholder). Cierra el ciclo fechas → dropdown y evita las dos verdades
// contradictorias (fechas en 2028 con el dropdown en "Todos los años").
export function syncRangeShortcuts(yearSel, monthSel, range) {
  const match = range ? matchRangeShortcut(range) : { year: null, month: null };
  const assign = (sel, exact) => {
    if (!sel) return;
    if (!range) {
      sel.value = '';
      return;
    }
    const hasOption = exact != null && [...sel.options].some((o) => o.value === String(exact));
    sel.value = hasOption ? String(exact) : 'custom';
  };
  assign(yearSel, match.year);
  assign(monthSel, match.month);
}

export function monthOptionsHTML(model, state) {
  const months = [...model.monthly.keys()].sort((a, b) => a - b);
  return `<option value="">Todos los meses</option>` +
    months
      .filter((mi) => !state.years || state.years.has(Math.floor(mi / 100)))
      .map((mi) => `<option value="${esc(String(mi))}" ${state.months?.has(mi) ? 'selected' : ''}>${esc(MONTHS_SHORT[(mi % 100) - 1])} ${esc(String(Math.floor(mi / 100)))}</option>`)
      .join('') +
    // Estado display-only (disabled): lo asigna syncRangeShortcuts cuando el
    // rango vigente no coincide con ningún mes de la lista.
    `<option value="custom" disabled>Personalizado</option>`;
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
  if (state.range) chips.push({ unset: 'range', label: rangeChipLabel(state.range) });
  if (state.years) for (const y of [...state.years].sort()) chips.push({ unset: 'years', label: `Año ${y}` });
  if (state.months) chips.push({ unset: 'months', label: `${state.months.size} ${state.months.size === 1 ? 'mes' : 'meses'}` });
  // Todo filtro que afecta el cómputo proyecta su chip: sin esto, los días y
  // franjas activos son invisibles con el panel cerrado (filtros fantasma).
  if (state.dows) {
    const names = [...state.dows].sort((a, b) => a - b).map((d) => DOW_INITIALS[d]).join(', ');
    chips.push({ unset: 'dows', label: `Días: ${names}` });
  }
  if (state.hours) {
    const covered = BLOCKS.filter((b) => b.hours.every((h) => state.hours.has(h)));
    const leftover = [...state.hours].filter((h) => !covered.some((b) => b.hours.includes(h))).sort((a, b) => a - b);
    const parts = [...covered.map((b) => b.label), ...leftover.map((h) => `${h}h`)];
    chips.push({ unset: 'hours', label: `Franjas: ${parts.join(', ')}` });
  }
  for (const k of ['skip', 'shuffle', 'offline']) {
    if (state[k] == null) continue;
    // offline=false es "con conexión": el "Sin" genérico diría "Sin sin conexión".
    if (k === 'offline') {
      chips.push({ unset: k, label: state[k] ? 'Solo sin conexión' : 'Con conexión' });
      continue;
    }
    const name = k === 'skip' ? 'saltadas' : 'aleatorio';
    chips.push({ unset: k, label: state[k] ? `Solo ${name}` : `Sin ${name}` });
  }
  // Borrar todo vive al final de la fila de chips: sin filtros no hay chips ni
  // botón (la fila colapsa), así que nunca flota un control muerto.
  const clearBtn = isFilterActive(state) ? '<button type="button" data-action="clear">Borrar todo</button>' : '';
  if (!chips.length && !clearBtn) return '';
  return chips.map((c) => `<button type="button" class="chip chip-active" data-unset="${c.unset}">${esc(c.label)} <span aria-hidden="true">✕</span></button>`).join('') + clearBtn;
}

export function advancedFilterCount(state, lastTs = 0) {
  let count = 0;
  if (state.range != null) {
    const isQuickPreset = RANGE_PRESETS.some((preset) => preset.id !== 'all' &&
      state.range.from === lastTs - preset.days * 86400 &&
      state.range.to === lastTs);
    if (!isQuickPreset) count++;
  }
  if (state.dows) count++;
  if (state.hours) count++;
  if (state.skip != null) count++;
  if (state.shuffle != null) count++;
  if (state.offline != null) count++;
  return count;
}

// Serialización del estado de filtros a query de URL (deep-link + reload).
// Solo lo que la UI puede producir: rango, días, franjas, toggles 3-estado y
// entidad. years/months son paths muertos de la API pura: no se serializan.
// Los valores (dígitos, coma, guión, yes/no) son URL-safe: sin encodeo.
export function filterParams(state, metric = 'plays') {
  const parts = [];
  if (metric === 'ms') parts.push('m=ms');
  if (state.range) parts.push(`r=${state.range.from}-${state.range.to}`);
  if (state.dows) parts.push(`d=${[...state.dows].sort((a, b) => a - b).join(',')}`);
  if (state.hours) parts.push(`h=${[...state.hours].sort((a, b) => a - b).join(',')}`);
  if (state.skip != null) parts.push(`s=${state.skip ? 'yes' : 'no'}`);
  if (state.shuffle != null) parts.push(`f=${state.shuffle ? 'yes' : 'no'}`);
  if (state.offline != null) parts.push(`o=${state.offline ? 'yes' : 'no'}`);
  if (state.artistId != null) parts.push(`ar=${state.artistId}`);
  if (state.trackId != null) parts.push(`tk=${state.trackId}`);
  if (state.albumId != null) parts.push(`al=${state.albumId}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function metricFromParams(search) {
  if (!search) return 'plays';
  const params = new URLSearchParams(search);
  return params.get('m') === 'ms' ? 'ms' : 'plays';
}

// Inversa: query → estado completo (cada filtro ausente vuelve como vacío:
// los params son la verdad completa, no un delta). null si no hay query:
// el caller conserva el estado vigente (navegar no resetea filtros).
export function paramsToFilterState(search) {
  if (!search) return null;
  const p = new URLSearchParams(search);
  if (![...p.keys()].length) return null;
  const state = emptyFilterState();
  const nums = (v) => v.split(',').map(Number).filter(Number.isFinite);
  const r = p.get('r');
  if (r) {
    const [from, to] = r.split('-').map(Number);
    if (Number.isFinite(from) && Number.isFinite(to) && to >= from) state.range = { from, to };
  }
  if (p.get('d')) {
    const dows = nums(p.get('d')).filter((d) => d >= 0 && d <= 6);
    if (dows.length) state.dows = new Set(dows);
  }
  if (p.get('h')) {
    const hours = nums(p.get('h')).filter((h) => h >= 0 && h <= 23);
    if (hours.length) state.hours = new Set(hours);
  }
  const tri = (v) => (v === 'yes' ? true : v === 'no' ? false : null);
  state.skip = tri(p.get('s'));
  state.shuffle = tri(p.get('f'));
  state.offline = tri(p.get('o'));
  const id = (v) => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  state.artistId = id(p.get('ar'));
  state.trackId = id(p.get('tk'));
  state.albumId = id(p.get('al'));
  return state;
}

export function filterBarHTML(model, state, opts = {}) {
  const metric = opts.metric === 'ms' ? 'ms' : 'plays';
  const years = [...model.yearly.keys()].sort((a, b) => a - b);
  const lastTs = model.meta.lastTs ?? 0;
  const activeAdvCount = advancedFilterCount(state, lastTs);

  const presets = RANGE_PRESETS.map((p) => {
    const active = p.id === 'all'
      ? !state.range
      : state.range != null && state.range.from === lastTs - p.days * 86400 && state.range.to === lastTs;
    return `<button type="button" data-preset="${p.id}" class="${active ? 'active' : ''}" aria-pressed="${active}">${p.label}</button>`;
  }).join('');

  const metricSwitch = `<div class="tabs metric-global" role="group" aria-label="Métrica">
    <button type="button" data-global-metric="plays" aria-pressed="${metric === 'plays'}" class="${metric === 'plays' ? 'active' : ''}">Reproducciones</button>
    <button type="button" data-global-metric="ms" aria-pressed="${metric === 'ms'}" class="${metric === 'ms' ? 'active' : ''}">Tiempo</button>
  </div>`;

  const yearOpts = `<option value="">Todos los años</option>` +
    years.map((y) => `<option value="${esc(String(y))}" ${state.years?.has(y) ? 'selected' : ''}>${esc(String(y))}</option>`).join('') +
    `<option value="custom" disabled>Personalizado</option>`;
  const monthOpts = monthOptionsHTML(model, state);

  const dows = DOW_INITIALS.map((l, d) => {
    const on = state.dows?.has(d) ?? false;
    return `<button type="button" class="chip-toggle" data-dow="${d}" aria-pressed="${on}" aria-label="${DOW_LONG[d]}" title="${DOW_LONG[d]}">${l}</button>`;
  }).join('');

  const blocks = BLOCKS.map((b) => {
    const on = state.hours != null && b.hours.every((h) => state.hours.has(h));
    return `<button type="button" class="chip-toggle" data-block="${b.id}" aria-pressed="${on}">${b.label}</button>`;
  }).join('');

  // 3 estados: Todos (null) / Solo sí (true) / Excluir (false).
  const toggles = ['skip', 'shuffle', 'offline'].map((k) => {
    const label = k === 'skip' ? 'Saltadas' : k === 'shuffle' ? 'Aleatorio' : 'Sin conexión';
    const v = state[k] === true ? 'yes' : state[k] === false ? 'no' : '';
    return `<label class="chip">${label} <select name="toggle-${k}" autocomplete="off" data-toggle3="${k}" aria-label="${label}">
      <option value="" ${v === '' ? 'selected' : ''}>Todos</option>
      <option value="yes" ${v === 'yes' ? 'selected' : ''}>Solo sí</option>
      <option value="no" ${v === 'no' ? 'selected' : ''}>Excluir</option>
    </select></label>`;
  }).join('');

  const fromISO = state.range ? locToISODate(state.range.from) : '';
  const toISO = state.range ? locToISODate(state.range.to) : '';
  // Guards min/max (Carbon): el date picker no ofrece fechas que el dataset
  // no cubre; el valor manual fuera de rango lo recorta normalizeRangeDays.
  const minISO = model.meta.firstTs != null ? locToISODate(model.meta.firstTs) : null;
  const maxISO = model.meta.lastTs != null ? locToISODate(model.meta.lastTs) : null;

  // Sin resumen de conteos en el pie: los KPIs de la vista ya reflejan el
  // filtrado (la vista entera se re-agrega), sería duplicación. "Borrar todo"
  // vive dentro de la fila de chips (chipsHTML): sin filtros la fila colapsa.
  return `<div class="filter-bar" id="filter-bar" role="group" aria-label="Filtros">
    <div class="filter-row filter-top-row"><div class="filter-presets">${presets}</div>${metricSwitch}</div>
    <div class="filter-row" id="filter-chips" tabindex="-1">${chipsHTML(model, state)}</div>
    <details class="filter-advanced">
      <summary><svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>Fechas y filtros avanzados<span class="filter-badge" id="filter-adv-badge"${activeAdvCount > 0 ? '' : ' hidden'}>${activeAdvCount}</span></summary>
      <div class="filter-row filter-dates">
        <label class="field">Desde <input type="date" name="filter-from" autocomplete="off" data-filter="from" value="${fromISO}"${minISO ? ` min="${minISO}"` : ''}></label>
        <label class="field">Hasta <input type="date" name="filter-to" autocomplete="off" data-filter="to" value="${toISO}"${maxISO ? ` max="${maxISO}"` : ''}></label>
      </div>
      <div class="filter-row">
        <label class="field">Año <select name="filter-year" autocomplete="off" data-filter="year" aria-label="Año">${yearOpts}</select></label>
        <label class="field">Mes <select name="filter-month" autocomplete="off" data-filter="month" aria-label="Mes" id="filter-month">${monthOpts}</select></label>
      </div>
      <div class="filter-row filter-group-start filter-group">
        <p class="filter-caption">Días</p>
        <div class="chip-grid chip-grid-7" role="group" aria-label="Días de semana">${dows}</div>
      </div>
      <div class="filter-row filter-group">
        <p class="filter-caption">Franjas del día</p>
        <div class="chip-grid chip-grid-4" role="group" aria-label="Franjas del día">${blocks}</div>
      </div>
      <div class="filter-row filter-group-start toggle-grid">${toggles}</div>
    </details>
  </div>`;
}