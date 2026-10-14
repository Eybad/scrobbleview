// app/main.js — composition root
//
// Construye la tz del navegador (intl-tz) sobre el rango del dataset, cablea
// input → analyze → vistas → filtros, y hace routing por hash (#/dashboard,
// #/artist/123, #/calendar/2024, …). Los filtros re-agregan sobre un subconjunto
// del dataset (nunca se re-parsea).

import { parse } from '../src/parse/parse.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { intlTz } from '../src/aggregate/adapters/intl-tz.js';
import { applyFilters, filterDataset, emptyFilterState, RANGE_PRESETS } from '../src/filters.js';
import { setupInput } from './input.js';
import { renderView } from './views.js';
import { filterBarHTML, isFilterActive, BLOCKS } from './filter-ui.js';
import { save as cacheSave, load as cacheLoad, clear as cacheClear, hasCache, isAvailable as cacheAvailable, persist as cachePersist } from './storage.js';

const appRoot = document.getElementById('app-root');

let ds = null;
let model = null; // modelo completo (sin filtros)
let current = null; // modelo activo (filtrado o completo)
let tz = null;
let state = emptyFilterState();
let cacheOffer = null; // null | 'save' | 'saved' | 'error'

// ---------- tz del navegador sobre el rango del dataset ----------

function buildTz(dataset) {
  // min/max real de t: el dataset concatena fuentes en orden de archivo, así
  // que t[0] y t[count-1] NO son necesariamente los extremos. Con un rango
  // invertido o acortado, los eventos fuera de la tabla quedaban con el offset
  // equivocado en silencio.
  const n = dataset.meta.count;
  let lo = dataset.t[0];
  let hi = dataset.t[0];
  for (let i = 1; i < n; i++) {
    if (dataset.t[i] < lo) lo = dataset.t[i];
    if (dataset.t[i] > hi) hi = dataset.t[i];
  }
  const first = lo + dataset.meta.tsMin;
  const last = hi + dataset.meta.tsMin;
  const iana = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return intlTz(iana, { startSec: first - 86400, endSec: last + 86400 });
}

// ---------- análisis ----------

async function analyze(sources, { onProgress }) {
  ds = await parse(sources, { onProgress });
  tz = buildTz(ds);
  model = aggregate(ds, { tz, now: Math.floor(Date.now() / 1000) });
  state = emptyFilterState();
  current = model;
  cacheOffer = cacheAvailable() ? 'save' : null;
  return { ds, model, tz };
}

// Carga el dataset guardado en IndexedDB (sin re-parsear). Devuelve null si no hay caché.
async function loadCached() {
  const cached = await cacheLoad();
  if (!cached) return null;
  ds = cached;
  tz = buildTz(ds);
  model = aggregate(ds, { tz, now: Math.floor(Date.now() / 1000) });
  state = emptyFilterState();
  current = model;
  cacheOffer = 'saved';
  return { ds, model, tz };
}

async function clearCached() {
  await cacheClear();
  cacheOffer = null;
  inputApi.showCachedButtons(false);
}

function refreshModel() {
  if (!ds) return;
  if (!isFilterActive(state)) {
    current = model;
    return;
  }
  const { indices } = applyFilters(ds, state, tz);
  const subset = filterDataset(ds, indices);
  current = aggregate(subset, { tz, now: model.meta.generatedAt });
}

// ---------- routing ----------

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return [name || 'dashboard', id || null];
}

function navHTML() {
  return `<nav class="app-nav" aria-label="Secciones">
    <a href="#/dashboard">Resumen</a>
    <a href="#/sessions">Sesiones</a>
    <a href="#/discovery">Descubrimiento</a>
    <a href="#/yearly">Años</a>
    <a href="#/calendar">Calendario</a>
    <a href="#/wrapped">Resumen del año</a>
    <button type="button" class="btn btn-secondary" data-action="reset">Nuevos archivos</button>
  </nav>`;
}

function cacheBannerHTML() {
  if (cacheOffer === 'save') {
    return `<div class="cache-banner" role="status">
      <p>¿Guardar en este dispositivo? Se escribe tu historial completo (fechas, artistas, canciones) en claro en el disco, hasta que lo borres.</p>
      <div class="cache-actions">
        <button type="button" class="btn btn-secondary" data-cache="save">Guardar</button>
        <button type="button" class="btn btn-link" data-cache="dismiss">No por ahora</button>
      </div>
    </div>`;
  }
  if (cacheOffer === 'saved') {
    return `<div class="cache-banner" role="status">
      <p>Datos guardados en este dispositivo.</p>
      <button type="button" class="btn btn-link" data-cache="clear">Borrar datos guardados</button>
    </div>`;
  }
  if (cacheOffer === 'error') {
    return `<div class="cache-banner" role="status">
      <p>No se pudo guardar en este dispositivo (cuota o navegador). Podés seguir sin guardar.</p>
    </div>`;
  }
  return '';
}

function render() {
  if (!current) return;
  const [name, id] = parseHash();
  appRoot.innerHTML = cacheBannerHTML() + navHTML() + filterBarHTML(model, state, current.totals) + renderView(name, current, id);
  wireInteractions();
}

// ---------- interacciones ----------

function applyAndRender() {
  refreshModel();
  render();
}

function wireInteractions() {
  // Tabs de rankings.
  appRoot.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.tabs');
      group.querySelectorAll('[data-tab]').forEach((b) => {
        const on = b === btn;
        b.setAttribute('aria-selected', String(on));
        b.classList.toggle('active', on);
      });
      group.parentElement.querySelectorAll('[data-panel]').forEach((p) => {
        p.hidden = p.dataset.panel !== btn.dataset.tab;
      });
    });
  });

  // Presets de rango.
  appRoot.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = RANGE_PRESETS.find((x) => x.id === btn.dataset.preset);
      if (p.id === 'all') {
        state.range = null;
      } else {
        const last = model.meta.lastTs;
        state.range = { from: last - p.days * 86400, to: last };
      }
      applyAndRender();
    });
  });

  // Año / mes.
  appRoot.querySelectorAll('[data-filter="year"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      state.years = v ? new Set([Number(v)]) : null;
      if (v) state.months = null;
      applyAndRender();
    });
  });
  appRoot.querySelectorAll('[data-filter="month"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (v) {
        const mi = Number(v);
        state.months = new Set([mi]);
        state.years = new Set([Math.floor(mi / 100)]);
      } else {
        state.months = null;
      }
      applyAndRender();
    });
  });

  // Días de semana.
  appRoot.querySelectorAll('[data-dow]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const d = Number(cb.dataset.dow);
      if (!state.dows) state.dows = new Set();
      if (cb.checked) state.dows.add(d);
      else state.dows.delete(d);
      if (state.dows.size === 7 || state.dows.size === 0) state.dows = null;
      applyAndRender();
    });
  });

  // Franjas horarias.
  appRoot.querySelectorAll('[data-block]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const b = BLOCKS.find((x) => x.id === Number(cb.dataset.block));
      if (!state.hours) state.hours = new Set();
      if (cb.checked) b.hours.forEach((h) => state.hours.add(h));
      else b.hours.forEach((h) => state.hours.delete(h));
      if (state.hours.size === 24 || state.hours.size === 0) state.hours = null;
      applyAndRender();
    });
  });

  // Toggles skip/shuffle/offline (allowlist explícita).
  const TOGGLES = new Set(['skip', 'shuffle', 'offline']);
  appRoot.querySelectorAll('[data-toggle]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (!TOGGLES.has(cb.dataset.toggle)) return;
      state[cb.dataset.toggle] = cb.checked ? true : null;
      applyAndRender();
    });
  });

  // Limpiar / reset.
  appRoot.querySelectorAll('[data-action="clear"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state = emptyFilterState();
      applyAndRender();
    });
  });
  appRoot.querySelectorAll('[data-action="reset"]').forEach((btn) => {
    btn.addEventListener('click', () => location.reload());
  });

  // Caché IndexedDB (banner).
  appRoot.querySelectorAll('[data-cache]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const a = btn.dataset.cache;
      if (a === 'save') {
        const ok = await cacheSave(ds);
        if (ok) {
          cacheOffer = 'saved';
          cachePersist(); // best-effort: pedir al SO que no evicte la caché
        } else {
          // Si falló y había caché previa, borrarla: datos viejos engañarían.
          await cacheClear();
          cacheOffer = 'error';
        }
      } else if (a === 'dismiss') {
        cacheOffer = null;
      } else if (a === 'clear') {
        await clearCached();
      }
      render();
    });
  });
}

// ---------- arranque ----------

const inputApi = setupInput({
  analyze,
  onReady() {
    location.hash = '#/dashboard';
    render();
  },
  onError() {
    // El error ya se muestra en la vista de inicio (input.js).
  },
  onLoadCached: loadCached,
  onClearCached: clearCached
});

// Si hay caché guardada, ofrecer cargarla sin re-parsear.
if (cacheAvailable()) {
  hasCache().then((c) => inputApi.showCachedButtons(c));
}

window.addEventListener('hashchange', render);