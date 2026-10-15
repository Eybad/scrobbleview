// app/main.js — composition root
//
// Construye la tz del navegador (intl-tz) sobre el rango del dataset, cablea
// input → analyze → vistas → filtros, y hace routing por hash (#/dashboard,
// #/artist/123, #/calendar/2024, …). Los filtros re-agregan sobre un subconjunto
// del dataset (nunca se re-parsea).

import { parse } from '../src/parse/parse.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { derive } from '../src/aggregate/impl/derive.js';
import { intlTz } from '../src/aggregate/adapters/intl-tz.js';
import { applyFilters, filterDataset, emptyFilterState, RANGE_PRESETS } from '../src/filters.js';
import { setupInput } from './input.js';
import { renderView, rankCardHTML, receiptText } from './views.js';
import { filterBarHTML, isFilterActive, BLOCKS, chipsHTML, monthOptionsHTML, isoDateToDay, locToISODate } from './filter-ui.js';
import { modelToJSON, exportFilename } from '../src/export.js';
import { fmtNum, fmtMs } from '../src/charts.js';
import { save as cacheSave, load as cacheLoad, clear as cacheClear, hasCache, isAvailable as cacheAvailable, persist as cachePersist } from './storage.js';

const appRoot = document.getElementById('app-root');

let ds = null;
let derived = null; // derive(ds, tz): se calcula una vez por dataset+tz y se
let model = null; // modelo completo (sin filtros)
let current = null; // modelo activo (filtrado o completo)
let tz = null;
let state = emptyFilterState();
let rankUI = { tab: 'artists', metric: 'plays', topN: 10, query: '' };
let cacheOffer = null; // null | 'save' | 'saved' | 'error'

// Toast para títulos de gráficos en táctil (se crea una vez: sobrevive a los
// re-renders porque vive fuera de #app-root; el texto va por textContent).
const toast = document.createElement('div');
toast.id = 'chart-toast';
toast.className = 'toast';
toast.setAttribute('role', 'status');
toast.hidden = true;
document.body.appendChild(toast);
let toastTimer = 0;

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
  derived = derive(ds, tz);
  model = aggregate(ds, { tz, now: Math.floor(Date.now() / 1000) });
  state = emptyFilterState();
  rankUI = { tab: 'artists', metric: 'plays', topN: 10, query: '' };
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
  derived = derive(ds, tz);
  model = aggregate(ds, { tz, now: Math.floor(Date.now() / 1000) });
  state = emptyFilterState();
  rankUI = { tab: 'artists', metric: 'plays', topN: 10, query: '' };
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
  const { indices } = applyFilters(ds, state, tz, derived);
  const subset = filterDataset(ds, indices);
  current = aggregate(subset, { tz, now: model.meta.generatedAt });
}

// ---------- routing ----------

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return [name || 'dashboard', id || null];
}

function navHTML(active) {
  const link = (hash, label, view) => `<a href="#/${hash}"${active === view ? ' aria-current="page"' : ''}>${label}</a>`;
  // "Nuevos archivos" fuera del nav: es acción destructiva (recarga), no una
  // sección. En su propia fila no compite con las pestañas.
  return `<nav class="app-nav" aria-label="Secciones">
    ${link('dashboard', 'Resumen', 'dashboard')}
    ${link('sessions', 'Sesiones', 'sessions')}
    ${link('discovery', 'Descubrimiento', 'discovery')}
    ${link('yearly', 'Años', 'yearly')}
    ${link('calendar', 'Calendario', 'calendar')}
    ${link('wrapped', 'Resumen del año', 'wrapped')}
  </nav>
  <div class="app-actions">
    <button type="button" class="btn btn-secondary" data-action="export" title="Descarga el modelo completo (ignora los filtros activos)">Exportar datos</button>
    <button type="button" class="btn btn-accent-outline" data-action="reset">Nuevos archivos</button>
  </div>`;
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
  appRoot.innerHTML = cacheBannerHTML() + navHTML(name) + filterBarHTML(model, state, current.totals) + `<div id="view-root">${renderView(name, current, id, { years: state.years })}</div>`;
  wireFilters();
  wireView();
}

// Cambio de filtro: re-agrega y actualiza SOLO la vista + los dinámicos de la
// barra (presets, meses, fechas, chips, resumen). La barra persiste: no se
// pierde el foco ni el estado del <details> de avanzados.
function applyAndRenderView() {
  refreshModel();
  const [name, id] = parseHash();
  const root = document.getElementById('view-root');
  if (root) root.innerHTML = renderView(name, current, id, { years: state.years });
  updateFilterDynamics();
  wireView();
}

// Sincroniza los controles de la barra con el estado (sin re-renderizarla).
function updateFilterDynamics() {
  const bar = document.getElementById('filter-bar');
  if (!bar || !model || !current) return;
  const last = model.meta.lastTs ?? 0;
  bar.querySelectorAll('[data-preset]').forEach((btn) => {
    const p = RANGE_PRESETS.find((x) => x.id === btn.dataset.preset);
    const active = p.id === 'all'
      ? !state.range
      : state.range != null && state.range.from === last - p.days * 86400 && state.range.to === last;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const month = document.getElementById('filter-month');
  if (month) month.innerHTML = monthOptionsHTML(model, state);
  const from = bar.querySelector('[data-filter="from"]');
  if (from) from.value = state.range ? locToISODate(state.range.from) : '';
  const to = bar.querySelector('[data-filter="to"]');
  if (to) to.value = state.range ? locToISODate(state.range.to) : '';
  const chips = document.getElementById('filter-chips');
  if (chips) chips.innerHTML = chipsHTML(model, state);
  const summary = document.getElementById('filter-summary');
  if (summary) summary.textContent = `${fmtNum(current.totals.records)} reproducciones · ${fmtMs(current.totals.ms)}`;
  const clear = document.getElementById('filter-clear');
  if (clear) {
    if (isFilterActive(state)) clear.removeAttribute('disabled');
    else clear.setAttribute('disabled', '');
  }
}

function wireFilters() {
  // Avanzados: cerrados en móvil, abiertos en desktop (progresivo, sin
  // framework). Se respeta el toggle manual dentro de cada montaje.
  const adv = appRoot.querySelector('.filter-advanced');
  if (adv) {
    if (!adv.dataset.touched && window.matchMedia('(min-width: 700px)').matches) adv.open = true;
    adv.addEventListener('toggle', () => { adv.dataset.touched = '1'; }, { once: true });
  }

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
      applyAndRenderView();
    });
  });

  // Año / mes.
  appRoot.querySelectorAll('[data-filter="year"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      state.years = v ? new Set([Number(v)]) : null;
      if (v) state.months = null;
      applyAndRenderView();
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
      applyAndRenderView();
    });
  });

  // Rango personalizado con fechas (from/to en época local).
  const fromInput = appRoot.querySelector('[data-filter="from"]');
  const toInput = appRoot.querySelector('[data-filter="to"]');
  const onDate = () => {
    const f = fromInput ? isoDateToDay(fromInput.value) : null;
    const t = toInput ? isoDateToDay(toInput.value) : null;
    if (f == null && t == null) {
      state.range = null;
    } else {
      const first = model.meta.firstTs ?? 0;
      const lastTs = model.meta.lastTs ?? 0;
      state.range = {
        from: f != null ? f * 86400 : first,
        to: t != null ? t * 86400 + 86399 : lastTs
      };
    }
    applyAndRenderView();
  };
  if (fromInput) fromInput.addEventListener('change', onDate);
  if (toInput) toInput.addEventListener('change', onDate);

  // Días de semana.
  appRoot.querySelectorAll('[data-dow]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const d = Number(cb.dataset.dow);
      if (!state.dows) state.dows = new Set();
      if (cb.checked) state.dows.add(d);
      else state.dows.delete(d);
      if (state.dows.size === 7 || state.dows.size === 0) state.dows = null;
      applyAndRenderView();
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
      applyAndRenderView();
    });
  });

  // Toggles skip/shuffle/offline de 3 estados (Todos / Solo sí / Excluir).
  appRoot.querySelectorAll('[data-toggle3]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const k = sel.dataset.toggle3;
      if (k !== 'skip' && k !== 'shuffle' && k !== 'offline') return;
      state[k] = sel.value === '' ? null : sel.value === 'yes';
      applyAndRenderView();
    });
  });

  // Limpiar / reset.
  appRoot.querySelectorAll('[data-action="clear"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state = emptyFilterState();
      applyAndRenderView();
    });
  });
  appRoot.querySelectorAll('[data-action="reset"]').forEach((btn) => {
    btn.addEventListener('click', () => location.reload());
  });

  // Exportar el modelo completo procesado como JSON (análisis externo).
  // Descarga por Blob + <a download>: sin red, CSP intacta.
  appRoot.querySelectorAll('[data-action="export"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!model) return;
      const plain = modelToJSON(model, { now: Math.floor(Date.now() / 1000) });
      const blob = new Blob([JSON.stringify(plain)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename(plain.exportedAt);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
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

// ---------- vista (se re-renderiza sin tocar la barra de filtros) ----------

let searchTimer = 0;

function updateRankCard() {
  const card = document.getElementById('rank-card');
  if (!card || !current) return;
  card.innerHTML = rankCardHTML(current, rankUI);
  wireRankCard();
}

function wireRankCard() {
  const card = document.getElementById('rank-card');
  if (!card) return;
  card.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankUI.tab = btn.dataset.tab;
      updateRankCard();
    });
  });
  card.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankUI.metric = btn.dataset.metric;
      updateRankCard();
    });
  });
  const sel = card.querySelector('[data-topn]');
  if (sel) sel.addEventListener('change', () => {
    rankUI.topN = Number(sel.value);
    updateRankCard();
  });
  const input = card.querySelector('[data-search]');
  if (input) input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const v = input.value;
    searchTimer = setTimeout(() => {
      rankUI.query = v;
      updateRankCard();
      const again = card.querySelector('[data-search]');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }, 200);
  });
}

function wireView() {
  wireRankCard();

  // Filtro cruzado por entidad desde las fichas (el foco va al chip creado).
  appRoot.querySelectorAll('[data-filter-entity]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [kind, raw] = btn.dataset.filterEntity.split(':');
      const id = Number(raw);
      if (!Number.isFinite(id)) return;
      state.artistId = state.trackId = state.albumId = null;
      if (kind === 'artist') state.artistId = id;
      else if (kind === 'track') state.trackId = id;
      else if (kind === 'album') state.albumId = id;
      else return;
      applyAndRenderView();
      document.querySelector('#filter-chips [data-unset]')?.focus();
    });
  });

  // Copiar recibo en texto plano (con fallback a copia manual).
  appRoot.querySelectorAll('[data-action="copy-receipt"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = receiptText(current);
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '¡Copiado!';
      } catch {
        const pre = document.getElementById('receipt-text');
        if (pre) {
          pre.textContent = text;
          pre.hidden = false;
        }
        btn.textContent = 'Copiá el texto de abajo';
      }
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

let lastView = parseHash()[0] || 'dashboard';
window.addEventListener('hashchange', () => {
  const [name] = parseHash();
  render();
  if (name !== lastView) {
    lastView = name;
    window.scrollTo(0, 0);
  }
});

// Chips para quitar filtros activos. Delegado una sola vez: #filter-chips se
// re-renderiza en cada cambio (los listeners directos morirían al primero).
// El foco va al resumen (tabindex -1).
appRoot.addEventListener('click', (e) => {
  const btn = e.target.closest?.('[data-unset]');
  if (!btn || !appRoot.contains(btn)) return;
  const k = btn.dataset.unset;
  if (k !== 'artistId' && k !== 'trackId' && k !== 'albumId' && k !== 'years' &&
    k !== 'months' && k !== 'range' && k !== 'skip' && k !== 'shuffle' && k !== 'offline') return;
  state[k] = null;
  applyAndRenderView();
  document.getElementById('filter-summary')?.focus();
});

// Títulos de gráficos en táctil: el <title> del SVG no se muestra al toque.
// Delegado una sola vez (sobrevive a los re-renders). Solo sin hover.
appRoot.addEventListener('click', (e) => {
  if (!window.matchMedia('(hover: none)').matches) return;
  const svg = e.target.closest?.('svg.chart');
  if (!svg) return;
  const holder = e.target.closest('g') ?? e.target;
  const title = holder.querySelector?.('title');
  if (!title || !title.textContent) return;
  toast.textContent = title.textContent;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3000);
});