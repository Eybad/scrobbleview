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
import { renderView, rankCardHTML, receiptText, emptyFiltersHTML, footerMetaText } from './views.js';
import { filterBarHTML, isFilterActive, BLOCKS, chipsHTML, isoDateToDay, locToISODate, rangeFromYear, rangeFromMonth, syncRangeShortcuts, normalizeRangeDays, filterStatusMessage, previousRange, filterParams, paramsToFilterState, advancedFilterCount } from './filter-ui.js';
import { modelToTables, exportFilename } from '../src/export.js';
import { toCSV } from '../src/export/csv.js';
import { buildZip } from '../src/export/zip.js';
import { save as cacheSave, load as cacheLoad, clear as cacheClear, cacheSummary, isAvailable as cacheAvailable, persist as cachePersist } from './storage.js';

const appRoot = document.getElementById('app-root');
const siteHeader = document.querySelector('.site-header');
const headerActions = document.getElementById('header-actions');
const siteFooter = document.querySelector('.site-footer');
const footerMeta = document.getElementById('footer-meta');
const tagline = document.querySelector('.tagline');

const LIMITS_STORAGE_KEY = 'scrobbleview:tableLimits';
const VALID_LIMITS = new Set([10, 25, 50, 100]);

function loadStoredLimits() {
  const map = new Map();
  let rankTopN = 10;
  try {
    const raw = localStorage.getItem(LIMITS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          const num = Number(v);
          if (!VALID_LIMITS.has(num)) continue;
          if (k === '__rank__') rankTopN = num;
          else map.set(k, num);
        }
      }
    }
  } catch {
    // localStorage may be disabled or unavailable in private contexts.
  }
  return { map, rankTopN };
}

function saveStoredLimits() {
  try {
    const obj = { __rank__: rankUI.topN };
    for (const [k, v] of tableLimits.entries()) obj[k] = v;
    localStorage.setItem(LIMITS_STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // Ignore storage quota or security errors.
  }
}

const initialLimits = loadStoredLimits();
let ds = null;
let derived = null;
let model = null; // modelo completo (sin filtros)
let current = null; // modelo activo (filtrado o completo)
let tz = null;
let state = emptyFilterState();
let rankUI = { tab: 'artists', metric: 'plays', topN: initialLimits.rankTopN, query: '' };
const tableLimits = initialLimits.map;
let cacheOffer = null; // null | 'save' | 'saved' | 'loaded' | 'error'
let advState = null;

// Toast para títulos de gráficos en táctil (se crea una vez: sobrevive a los
// re-renders porque vive fuera de #app-root; el texto va por textContent).
const toast = document.createElement('div');
toast.id = 'chart-toast';
toast.className = 'toast';
toast.setAttribute('role', 'status');
toast.setAttribute('aria-atomic', 'true');
toast.hidden = true;
document.body.appendChild(toast);
let toastTimer = 0;

// Región viva única para cambios asíncronos que no se anuncian solos
// (WCAG 4.1.3): re-agregado por filtros, resultados de búsqueda, copia de
// recibo. Persistente fuera de #app-root: sobrevive a los re-renders.
const liveRegion = document.createElement('p');
liveRegion.id = 'live-status';
liveRegion.className = 'visually-hidden';
liveRegion.setAttribute('role', 'status');
liveRegion.setAttribute('aria-atomic', 'true');
document.body.appendChild(liveRegion);

function announce(text) {
  liveRegion.textContent = text;
}

function announceFilters() {
  if (!current) return;
  announce(filterStatusMessage(current.totals));
}

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

async function analyze(sources, { onProgress }) {
  ds = await parse(sources, { onProgress });
  tz = buildTz(ds);
  derived = derive(ds, tz);
  model = aggregate(ds, { tz, now: Math.floor(Date.now() / 1000) });
  state = emptyFilterState();
  rankUI = { tab: 'artists', metric: 'plays', topN: rankUI.topN, query: '' };
  current = model;
  applyHashParams();
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
  rankUI = { tab: 'artists', metric: 'plays', topN: rankUI.topN, query: '' };
  current = model;
  applyHashParams();
  cacheOffer = 'loaded';
  return { ds, model, tz };
}

async function clearCached() {
  await cacheClear();
  cacheOffer = null;
  updateCacheToast();
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

// Totales del período inmediato anterior (comparación % en los KPIs del
// dashboard). Solo con rango activo: sin rango no hay "anterior" definido.
// Solo para la vista dashboard: las demás no muestran comparación.
function prevTotals() {
  if (!ds || !state.range) return null;
  const prev = applyFilters(ds, { ...state, range: previousRange(state.range) }, tz, derived);
  const prevModel = aggregate(filterDataset(ds, prev.indices), { tz, now: model.meta.generatedAt });
  return prevModel.totals;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query] = h.split('?');
  const [name, id] = path.split('/');
  return [name || 'dashboard', id || null, query || ''];
}

// La URL refleja el estado de filtros (deep-link + reload). replaceState: sin
// entrada de historial por cada chip (el Back queda para navegar vistas; al
// volver, los params del hash de esa entrada restauran sus filtros).
function syncHash() {
  const [name, id] = parseHash();
  const hash = `#/${name}${id != null ? `/${id}` : ''}${filterParams(state)}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

// The URL is authoritative on load, Back/Forward and manual hash changes.
// Restore state and its model together before any view reads either one.
function applyHashParams() {
  const [, , query] = parseHash();
  state = paramsToFilterState(query) ?? emptyFilterState();
  refreshModel();
}

function navHTML(active) {
  const link = (hash, label, view) => `<a href="#/${hash}"${active === view ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<nav class="app-nav" aria-label="Secciones">
    ${link('dashboard', 'Resumen', 'dashboard')}
    ${link('hours', 'Horarios', 'hours')}
    ${link('habits', 'Hábitos', 'habits')}
    ${link('sessions', 'Sesiones', 'sessions')}
    ${link('discovery', 'Descubrimiento', 'discovery')}
    ${link('yearly', 'Años', 'yearly')}
    ${link('calendar', 'Calendario', 'calendar')}
    ${link('wrapped', 'Resumen del año', 'wrapped')}
  </nav>`;
}

// Toast del guardado local: vive fuera de #app-root (sobrevive a los
// re-renders) y flotante (no consume fold: el banner en línea empujaba los
// datos más de media pantalla en móvil). La oferta 'save' es persistente
// hasta responder; 'saved'/'loaded'/'error' son transitorios y reinician
// el estado para que el próximo render no los reviva.
const cacheToast = document.createElement('div');
cacheToast.id = 'cache-toast';
cacheToast.className = 'cache-toast';
cacheToast.setAttribute('role', 'status');
cacheToast.setAttribute('aria-atomic', 'true');
cacheToast.hidden = true;
document.body.appendChild(cacheToast);
let cacheTimer = 0;

function updateCacheToast() {
  clearTimeout(cacheTimer);
  if (cacheOffer === 'save') {
    cacheToast.innerHTML = `<p>¿Guardar en este dispositivo? Se escribe tu historial completo (fechas, artistas, canciones) en claro en el disco, hasta que lo borres.</p>
      <div class="cache-actions">
        <button type="button" class="btn btn-primary" data-cache="save">Guardar</button>
        <button type="button" class="btn btn-link btn-quiet" data-cache="dismiss">No por ahora</button>
      </div>`;
    cacheToast.hidden = false;
    return;
  }
  if (cacheOffer === 'saved') cacheToast.innerHTML = `<p>Datos guardados en este dispositivo.</p>`;
  else if (cacheOffer === 'loaded') cacheToast.innerHTML = `<p>Mostrando los datos guardados en este dispositivo.</p>`;
  else if (cacheOffer === 'error') cacheToast.innerHTML = `<p>No se pudo guardar en este dispositivo (cuota o navegador). Podés seguir sin guardar.</p>`;
  else {
    cacheToast.hidden = true;
    return;
  }
  cacheToast.hidden = false;
  cacheTimer = setTimeout(() => { cacheOffer = null; cacheToast.hidden = true; }, 4000);
}

// Delegación única: los botones del toast se re-crean con cada estado.
cacheToast.addEventListener('click', async (e) => {
  const btn = e.target.closest?.('[data-cache]');
  if (!btn) return;
  if (btn.dataset.cache === 'save') {
    const ok = await cacheSave(ds);
    if (ok) {
      cacheOffer = 'saved';
      cachePersist(); // best-effort: pedir al SO que no evicte la caché
    } else {
      // Si falló y había caché previa, borrarla: datos viejos engañarían.
      await cacheClear();
      cacheOffer = 'error';
    }
  } else {
    cacheOffer = null; // No por ahora
  }
  updateCacheToast();
});

function buildViewContext(viewName) {
  return {
    years: state.years,
    prev: viewName === 'dashboard' ? prevTotals() : null,
    limits: tableLimits,
    rankUI
  };
}

function render() {
  if (!current) return;
  const [name, id] = parseHash();
  // Reconstruir el HTML resetea el scroll de la fila: se conserva y restaura
  // para que navegar no pegue un salto brusco (el bug se veía al tocar una
  // sección con el nav deslizado a la derecha).
  const navX = appRoot.querySelector('.app-nav')?.scrollLeft ?? 0;
  const isEmpty = isFilterActive(state) && current.totals.records === 0;
  const viewCtx = buildViewContext(name);
  appRoot.innerHTML = navHTML(name) + filterBarHTML(model, state) + `<div id="view-root">${isEmpty ? emptyFiltersHTML() : renderView(name, current, id, viewCtx)}</div>`;
  updateCacheToast();
  announceFilters();
  const nav = appRoot.querySelector('.app-nav');
  if (nav) {
    nav.scrollLeft = navX;
    // Fade izquierdo solo con scroll real: en reposo atenuaría la 1ra sección.
    const syncNavFade = () => {
      nav.classList.toggle('is-scrolled', nav.scrollLeft > 0);
      nav.classList.toggle('is-end', nav.scrollLeft + nav.clientWidth >= nav.scrollWidth - 2);
    };
    syncNavFade();
    nav.addEventListener('scroll', syncNavFade, { passive: true });
    // La sección activa entra en vista solo si no se ve (nearest = sin
    // movimiento cuando ya está visible; nunca scrollea la página).
    nav.querySelector('a[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  // Header actions y footer solo en la vista app: en inicio el footer repite
  // el aviso de privacidad y las acciones no aplican. La tagline también se
  // oculta: junto al nav compite con el título de la vista (el reload del
  // botón "Cargar archivos" la restaura).
  siteHeader?.classList.remove('site-header--home');
  headerActions?.removeAttribute('hidden');
  siteFooter?.removeAttribute('hidden');
  if (footerMeta && model) {
    footerMeta.textContent = footerMetaText(model);
    footerMeta.hidden = false;
  }
  tagline?.setAttribute('hidden', '');
  wireFilters();
  wireView();
}

// Cambio de filtro: re-agrega y actualiza SOLO la vista + los dinámicos de la
// barra (presets, meses, fechas, chips, fila de Limpiar). La barra persiste: no
// se pierde el foco ni el estado del <details> de avanzados.
function applyAndRenderView(focusSelector = null) {
  refreshModel();
  const [name, id] = parseHash();
  const root = document.getElementById('view-root');
  if (root) {
    const isEmpty = isFilterActive(state) && current.totals.records === 0;
    const viewCtx = buildViewContext(name);
    root.innerHTML = isEmpty ? emptyFiltersHTML() : renderView(name, current, id, viewCtx);
  }
  updateFilterDynamics();
  announceFilters();
  syncHash();
  wireView();
  if (focusSelector) appRoot.querySelector(focusSelector)?.focus();
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
  // Los shortcuts de año/mes reflejan el rango vigente (sync inverso): match
  // exacto → el valor, rango arbitrario → "Personalizado", sin rango →
  // placeholder. Nunca hay dos verdades sobre el período activo.
  syncRangeShortcuts(bar.querySelector('[data-filter="year"]'), document.getElementById('filter-month'), state.range);
  bar.querySelectorAll('[data-dow]').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(state.dows?.has(Number(btn.dataset.dow)) ?? false));
  });
  bar.querySelectorAll('[data-block]').forEach((btn) => {
    const b = BLOCKS.find((x) => x.id === Number(btn.dataset.block));
    const on = state.hours != null && b.hours.every((h) => state.hours.has(h));
    btn.setAttribute('aria-pressed', String(on));
  });
  bar.querySelectorAll('[data-toggle3]').forEach((sel) => {
    const key = sel.dataset.toggle3;
    sel.value = state[key] === true ? 'yes' : state[key] === false ? 'no' : '';
  });
  const badge = document.getElementById('filter-adv-badge');
  if (badge) {
    const activeAdvCount = advancedFilterCount(state, last);
    badge.textContent = String(activeAdvCount);
    badge.hidden = activeAdvCount === 0;
  }
  const from = bar.querySelector('[data-filter="from"]');
  if (from) from.value = state.range ? locToISODate(state.range.from) : '';
  const to = bar.querySelector('[data-filter="to"]');
  if (to) to.value = state.range ? locToISODate(state.range.to) : '';
  const chips = document.getElementById('filter-chips');
  if (chips) chips.innerHTML = chipsHTML(model, state);
}

function wireFilters() {
  const adv = appRoot.querySelector('.filter-advanced');
  if (adv) {
    adv.addEventListener('toggle', () => { advState = adv.open; });
    adv.open = advState ?? false;
  }

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

  appRoot.querySelectorAll('[data-filter="year"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (!v) return;
      state.range = rangeFromYear(Number(v));
      applyAndRenderView();
    });
  });
  appRoot.querySelectorAll('[data-filter="month"]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (!v) return;
      state.range = rangeFromMonth(Number(v));
      applyAndRenderView();
    });
  });

  // Rango personalizado con fechas (from/to en época local). `edited` dice qué
  // input disparó el cambio: si el par queda invertido, colapsa al día editado.
  const fromInput = appRoot.querySelector('[data-filter="from"]');
  const toInput = appRoot.querySelector('[data-filter="to"]');
  const onDate = (edited) => {
    const f = fromInput ? isoDateToDay(fromInput.value) : null;
    const t = toInput ? isoDateToDay(toInput.value) : null;
    if (f == null && t == null) {
      state.range = null;
    } else {
      const norm = normalizeRangeDays(f, t, edited);
      const first = model.meta.firstTs ?? 0;
      const lastTs = model.meta.lastTs ?? 0;
      state.range = {
        from: norm.fromDay != null ? norm.fromDay * 86400 : first,
        to: norm.toDay != null ? norm.toDay * 86400 + 86399 : lastTs
      };
    }
    applyAndRenderView();
  };
  if (fromInput) fromInput.addEventListener('change', () => onDate('from'));
  if (toInput) toInput.addEventListener('change', () => onDate('to'));

  appRoot.querySelectorAll('[data-dow]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = Number(btn.dataset.dow);
      const wasOn = state.dows?.has(d) ?? false;
      if (!state.dows) state.dows = new Set();
      if (!wasOn) state.dows.add(d);
      else state.dows.delete(d);
      if (state.dows.size === 7 || state.dows.size === 0) state.dows = null;
      applyAndRenderView();
    });
  });

  appRoot.querySelectorAll('[data-block]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = BLOCKS.find((x) => x.id === Number(btn.dataset.block));
      const wasOn = state.hours != null && b.hours.every((h) => state.hours.has(h));
      if (!state.hours) state.hours = new Set();
      if (!wasOn) b.hours.forEach((h) => state.hours.add(h));
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
}

// La vista se re-renderiza sin tocar la barra de filtros (persistencia de la barra).

let searchTimer = 0;

function syncTallTables(root) {
  root.querySelectorAll('.table-scroll--tall').forEach((wrap) => {
    const tenthRow = wrap.querySelector('tbody')?.rows?.[9];
    if (tenthRow) {
      const hBar = Math.max(0, wrap.offsetHeight - wrap.clientHeight);
      wrap.style.maxHeight = `${tenthRow.offsetTop + tenthRow.offsetHeight + hBar}px`;
    } else {
      wrap.style.removeProperty('max-height');
    }
  });
}

function updateRankCard(focusSel = null) {
  const card = document.getElementById('rank-card');
  if (!card || !current) return;
  // Mismo caso que el nav: conservar el scroll de las filas de tabs.
  const tabsX = [...card.querySelectorAll('.tabs')].map((t) => t.scrollLeft);
  card.innerHTML = rankCardHTML(current, rankUI);
  card.querySelectorAll('.tabs').forEach((t, i) => { t.scrollLeft = tabsX[i] ?? 0; });
  wireRankCard();
  syncTallTables(card);
  // El re-render destruye el control activado: devolverle el foco (teclado).
  if (focusSel) card.querySelector(focusSel)?.focus();
}

function wireRankCard() {
  const card = document.getElementById('rank-card');
  if (!card) return;
  card.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankUI.tab = btn.dataset.tab;
      updateRankCard(`[data-tab="${rankUI.tab}"]`);
    });
  });
  card.querySelectorAll('[data-metric]').forEach((btn) => {
    btn.addEventListener('click', () => {
      rankUI.metric = btn.dataset.metric;
      updateRankCard(`[data-metric="${rankUI.metric}"]`);
    });
  });
  const sel = card.querySelector('[data-topn]');
  if (sel) sel.addEventListener('change', () => {
    const nextTopN = Number(sel.value);
    if (!VALID_LIMITS.has(nextTopN)) return;
    rankUI.topN = nextTopN;
    saveStoredLimits();
    updateRankCard('[data-topn]');
  });
  // Flechas del tablist (APG, activación automática): la selección sigue al
  // foco; el re-render reposiciona el foco en el tab activado.
  const tablist = card.querySelector('[role="tablist"][aria-label="Rankings"]');
  if (tablist) tablist.addEventListener('keydown', (e) => {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === 'Home' ? tabs[0]
      : e.key === 'End' ? tabs[tabs.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    next.click();
  });
  const input = card.querySelector('[data-search]');
  if (input) input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const v = input.value;
    searchTimer = setTimeout(() => {
      rankUI.query = v;
      updateRankCard('[data-search]');
      const again = card.querySelector('[data-search]');
      if (again) again.setSelectionRange(again.value.length, again.value.length);
      // El cambio de tabla no se anuncia solo: la región viva da el conteo.
      const q = v.trim();
      if (q) {
        const n = card.querySelectorAll('tbody tr').length;
        announce(n > 0 ? `${n} ${n === 1 ? 'resultado' : 'resultados'} de “${q}”` : 'Sin resultados.');
      }
    }, 200);
  });
}

function wireView() {
  wireRankCard();
  syncTallTables(appRoot);

  appRoot.querySelectorAll('select[data-table-limit]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.tableLimit;
      const limit = Number(sel.value);
      if (!key || !VALID_LIMITS.has(limit)) return;
      tableLimits.set(key, limit);
      saveStoredLimits();
      applyAndRenderView(`select[data-table-limit="${key}"]`);
    });
  });

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

  // Copiar resumen en texto plano (con fallback a copia manual).
  appRoot.querySelectorAll('[data-action="copy-receipt"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const text = receiptText(current);
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = '¡Copiado!';
        announce('Resumen copiado al portapapeles.');
      } catch {
        const pre = document.getElementById('receipt-text');
        if (pre) {
          pre.textContent = text;
          pre.hidden = false;
        }
        btn.textContent = 'Copiá el texto de abajo';
        announce('No se pudo copiar automáticamente; copiá el texto de abajo.');
      }
    });
  });
}

// Acciones del header: DOM estático fuera de #app-root, se cablean una vez.
// Export descarga un .zip con un CSV por tabla (análisis en Sheets/Excel de
// Android): el JSON crudo colgaba los visores con decenas de MB. Blob +
// <a download>: sin red, CSP intacta.
async function exportModel() {
  if (!model) return;
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const entries = modelToTables(model).map(({ name, headers, rows }) => ({
    name: `${name}.csv`,
    // BOM: sin él Excel asume ANSI y rompe los acentos.
    bytes: encoder.encode(`\uFEFF${toCSV(headers, rows)}`)
  }));
  const zip = await buildZip(entries);
  const blob = new Blob([zip], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFilename(now).replace(/\.json$/, '.zip');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

headerActions?.querySelectorAll('[data-action="export"]').forEach((btn) => {
  btn.addEventListener('click', async (e) => {
    // El zip de historiales grandes tarda segundos: sin feedback el usuario
    // re-toca y encola otra descarga idéntica.
    const b = e.currentTarget;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await exportModel();
    } finally {
      b.disabled = false;
    }
  });
});
headerActions?.querySelectorAll('[data-action="reset"]').forEach((btn) => {
  btn.addEventListener('click', () => location.reload());
});

const inputApi = setupInput({
  analyze,
  onReady() {
    // Deep-link: un hash existente (posiblemente con params de filtro) manda;
    // solo la entrada sin hash aterriza en el dashboard.
    if (!location.hash) location.hash = '#/dashboard';
    render();
  },
  onError() {
    // El error ya se muestra en la vista de inicio (input.js).
  },
  onLoadCached: loadCached,
  onClearCached: clearCached
});

if (cacheAvailable()) {
  cacheSummary().then((summary) => inputApi.showCachedButtons(summary));
}

let lastView = parseHash()[0] || 'dashboard';
window.addEventListener('hashchange', () => {
  const [name] = parseHash();
  applyHashParams();
  render();
  if (name !== lastView) {
    lastView = name;
    window.scrollTo(0, 0);
  }
});

// Chips para quitar filtros activos + "Borrar todo". Delegado una sola vez:
// #filter-chips se re-renderiza en cada cambio (los listeners directos morirían
// al primero). El foco va a la fila de chips (tabindex -1).
appRoot.addEventListener('click', (e) => {
  const clearBtn = e.target.closest?.('[data-action="clear"]');
  if (clearBtn && appRoot.contains(clearBtn)) {
    state = emptyFilterState();
    applyAndRenderView();
    document.getElementById('filter-chips')?.focus();
    return;
  }
  const btn = e.target.closest?.('[data-unset]');
  if (!btn || !appRoot.contains(btn)) return;
  const k = btn.dataset.unset;
  if (k !== 'artistId' && k !== 'trackId' && k !== 'albumId' && k !== 'years' &&
    k !== 'months' && k !== 'range' && k !== 'skip' && k !== 'shuffle' && k !== 'offline' &&
    k !== 'dows' && k !== 'hours') return;
  state[k] = null;
  applyAndRenderView();
  document.getElementById('filter-chips')?.focus();
});

// Los enlaces internos llevan los filtros vigentes en el hash: el click los
// reescribe antes de navegar (deep-link y Back coherentes entre vistas).
appRoot.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href^="#/"]');
  if (!a || !appRoot.contains(a)) return;
  const f = filterParams(state);
  if (!f) return;
  const base = a.getAttribute('href').split('?')[0];
  a.setAttribute('href', base + f);
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

// Selector de rango sobre el calendario: toque = ese día (queda anclado);
// shift+click = rango desde el día anclado hasta el tocado. El rango activo
// aparece como chip; "Quitar filtros" lo limpia. En táctil solo hay día
// simple: los rangos largos quedan cubiertos por Desde/Hasta.
let calAnchor = null;
appRoot.addEventListener('click', (e) => {
  const rect = e.target.closest?.('rect[data-day]');
  if (!rect || !appRoot.contains(rect)) return;
  const day = Number(rect.dataset.day);
  if (!Number.isFinite(day)) return;
  if (e.shiftKey && calAnchor != null) {
    const [a, b] = calAnchor <= day ? [calAnchor, day] : [day, calAnchor];
    state.range = { from: a * 86400, to: b * 86400 + 86399 };
    calAnchor = null;
  } else {
    calAnchor = day;
    state.range = { from: day * 86400, to: day * 86400 + 86399 };
  }
  applyAndRenderView();
});

window.addEventListener('resize', () => syncTallTables(appRoot), { passive: true });
