// test/views.test.js — contenido y estructura de las vistas (no escaping).
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderView } from '../app/views.js';
import { receiptText } from '../app/views.js';
import { rankCardHTML, emptyFiltersHTML, listenerArchetype } from '../app/views.js';
import { chipsHTML, filterBarHTML, locToISODate, isoDateToDay, rangeFromYear, rangeFromMonth, matchRangeShortcut, normalizeRangeDays, filterStatusMessage, previousRange, filterParams, paramsToFilterState, metricFromParams, advancedFilterCount } from '../app/filter-ui.js';
import { readFile } from 'node:fs/promises';
import { emptyFilterState } from '../src/filters.js';
import { analyze } from '../src/analyze.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { syntheticJSON } from '../src/synthetic.js';

const UTC = fixedTz('utc', 0);

async function demoModel() {
  return analyze(memoryBytes('demo.json', syntheticJSON(800, 9)), { tz: UTC, now: 1704067200 });
}

function json2y() {
  return JSON.stringify([
    { ts: '2023-06-01T02:00:00Z', ms_played: 60000, master_metadata_track_name: 'A', master_metadata_album_artist_name: 'X', spotify_track_uri: 'spotify:track:1' },
    { ts: '2023-06-01T02:05:00Z', ms_played: 60000, master_metadata_track_name: 'B', master_metadata_album_artist_name: 'Y', spotify_track_uri: 'spotify:track:2' },
    { ts: '2024-06-01T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'C', master_metadata_album_artist_name: 'Z', spotify_track_uri: 'spotify:track:3' }
  ]);
}

async function model2y() {
  return analyze(memoryBytes('2y.json', json2y()), { tz: UTC, now: 1704067200 });
}

test('wrapped: la canción del año enlaza por tk (no por tr)', async () => {
  const model = await demoModel();
  const top = model.tracks.top.byMs[0];
  const html = renderView('wrapped', model);
  assert.ok(html.includes(`#/track/${top.tk}`), 'el enlace usa la clave compuesta tk');
});

test('wrapped: título según año filtrado', async () => {
  const model = await demoModel();
  assert.ok(renderView('wrapped', model).includes('Tu año en resumen'));
  assert.ok(renderView('wrapped', model, null, { years: new Set([2024]) }).includes('Tu 2024 en resumen'));
});

test('wrapped: receiptText es texto plano sin HTML', async () => {
  const model = await demoModel();
  const text = receiptText(model);
  assert.ok(!text.includes('<') && !text.includes('>'), 'sin markup');
  assert.ok(text.includes(`Reproducciones: ${model.totals.records}`));
  assert.ok(text.split('\n').length >= 8, 'cubre las filas del recibo');
});

test('yearly: franjas por año (no el global)', async () => {
  const model = await model2y();
  const html = renderView('yearly', model);
  assert.ok(html.includes('2023 — Madrugada: 2'), 'desglose 2023');
  assert.ok(html.includes('2024 — Tarde: 1'), 'desglose 2024');
  assert.ok(html.includes('<ul class="legend">'), 'leyenda de franjas');
});

test('dashboard: rankings con álbumes/métrica/topN/buscador + tablas', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  for (const s of ['data-tab="albums"', 'data-metric="ms"', 'data-topn', 'data-search', 'Obsesión', 'Rachas', 'tasa de salto', 'Primera canción del día', 'Última canción del día']) {
    assert.ok(html.includes(s), `dashboard incluye ${s}`);
  }
  assert.ok(html.includes('→'), 'la racha trae fechas de inicio → fin');
});

test('dashboard: la evolución mensual rellena los meses sin datos', async () => {
  const model = await model2y();
  const dash = renderView('dashboard', model);
  assert.ok(dash.includes('jul 2023: 0 ms'), 'mes hueco entre jun 2023 y jun 2024 en cero');
});

test('rankings: barra proporcional translúcida por fila', async () => {
  const model = await demoModel();
  const html = rankCardHTML(model, { tab: 'artists', metric: 'plays' });
  assert.ok(html.includes('--bar-w:100.0%'), 'el primero ocupa el ancho completo');
  assert.ok(/--bar-w:\d+(?:\.\d+)?%/.test(html), 'filas proporcionales al máximo');
});

test('meta de vistas: sin zona horaria, archivos en plural y bytes humanizados', async () => {
  const model = await demoModel();
  const dash = renderView('dashboard', model);
  const firstMeta = dash.match(/view-meta">([^<]*)</)[1];
  assert.ok(!firstMeta.includes('·'), 'primera línea: solo el rango de fechas');
  assert.ok(dash.includes('view-meta-sub">1 archivo'), 'archivos y bytes en segunda línea más chica');
  assert.ok(dash.includes('1 archivo ·'), 'singular con una sola fuente');
  assert.ok(!dash.includes('zona '), 'sin "zona <tzId>" en el meta del dashboard');
  assert.ok(!dash.includes('archivo(s)'), 'sin archivo(s)');
  assert.ok(/[\d.,]+ (B|KB|MB|GB)</.test(dash), 'bytes humanizados con unidad');
  assert.ok(!dash.includes(' bytes<'), 'sin bytes crudos');
  const two = await analyze([
    memoryBytes('a.json', json2y()),
    memoryBytes('b.json', json2y())
  ], { tz: UTC, now: 1704067200 });
  assert.ok(renderView('dashboard', two).includes('2 archivos ·'), 'plural con dos fuentes');
  const wrapped = renderView('wrapped', model);
  assert.ok(wrapped.includes('view-meta">generado '), 'el meta de wrapped empieza en "generado" (sin tz)');
});

test('discovery: constancia y longevidad', async () => {
  const model = await demoModel();
  const html = renderView('discovery', model);
  assert.ok(html.includes('Constancia'), 'tabla de constancia');
  assert.ok(html.includes('Longevidad'), 'tabla de longevidad');
});

test('artist: reloj, álbumes y botón de filtro', async () => {
  const model = await demoModel();
  const ar = model.artists.top.byPlays[0].id;
  const html = renderView('artist', model, ar);
  assert.ok(html.includes('Reloj de escucha'), 'listeningClock del artista');
  assert.ok(html.includes('Álbumes de este artista'), 'lista de álbumes');
  assert.ok(html.includes(`data-filter-entity="artist:${ar}"`), 'botón de filtro por entidad');
});

test('track: racha máxima, enlace al álbum y botón de filtro', async () => {
  const model = await demoModel();
  const tk = model.tracks.top.byPlays[0].tk;
  const html = renderView('track', model, tk);
  assert.ok(html.includes('Racha máxima'), 'maxRun visible');
  assert.ok(html.includes(`data-filter-entity="track:${tk}"`), 'botón de filtro por entidad');
  assert.ok(html.includes('#/artist/'), 'enlace al artista');
});

test('album: canciones, fechas y botón de filtro', async () => {
  const model = await demoModel();
  const ak = [...model.albums.byId.keys()][0];
  const html = renderView('album', model, ak);
  assert.ok(html.includes('Canciones del álbum'), 'lista de canciones');
  assert.ok(html.includes('Primera escucha') && html.includes('Última escucha'), 'fechas');
  assert.ok(html.includes(`data-filter-entity="album:${ak}"`), 'botón de filtro por entidad');
});

test('album: el enlace al artista usa la parte alta de ak', async () => {
  // ak = ar*2^32 + al: el residuo es el id del álbum, NO el artista.
  const json = JSON.stringify([
    { ts: '2024-06-01T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'A', master_metadata_album_artist_name: 'X', master_metadata_album_album_name: 'Á1', spotify_track_uri: 'spotify:track:1' },
    { ts: '2024-06-02T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'B', master_metadata_album_artist_name: 'X', master_metadata_album_album_name: 'Á2', spotify_track_uri: 'spotify:track:2' }
  ]);
  const model = await analyze(memoryBytes('ak.json', json), { tz: UTC, now: 1704067200 });
  const ak2 = 4294967296 + 2; // artista 1 (X), álbum 2 (Á2)
  const html = renderView('album', model, ak2);
  assert.ok(html.includes('href="#/artist/1"'), 'enlace al artista X (ar=1)');
});

test('calendar: último año desplegado, anteriores en details', async () => {
  const model = await model2y();
  const html = renderView('calendar', model);
  assert.ok(html.includes('<details class="card calendar-year">'), 'años previos plegados');
  // El último año (2024) va desplegado fuera de details.
  const beforeDetails = html.split('<details')[0];
  assert.ok(beforeDetails.includes('2024'), 'último año desplegado');
});

test('rankings: canciones muestran solo el nombre; álbumes apilan con artista', async () => {
  const json = JSON.stringify([
    { ts: '2024-06-01T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'A', master_metadata_album_artist_name: 'X', master_metadata_album_album_name: 'Álbum', spotify_track_uri: 'spotify:track:1' }
  ]);
  const model = await analyze(memoryBytes('ranklines.json', json), { tz: UTC, now: 1704067200 });
  const tracks = rankCardHTML(model, { tab: 'tracks' });
  assert.ok(!tracks.includes('class="cell-sub"'), 'canciones sin artista en segunda línea');
  assert.ok(tracks.includes('title="A"'), 'tooltip de canción: solo el nombre');
  assert.ok(!tracks.includes('A — X'), 'sin título — artista en la celda de canciones');
  const albums = rankCardHTML(model, { tab: 'albums' });
  assert.ok(albums.includes('class="cell-sub"'), 'álbumes conservan artista en segunda línea');
  assert.ok(albums.includes('title="Álbum — X"'), 'tooltip de álbum: nombre completo');
});

test('rankings: título y artista escapados (canciones y álbumes)', async () => {
  const json = JSON.stringify([
    { ts: '2024-06-01T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'T<i>m</i>', master_metadata_album_artist_name: 'R&B "Live"', master_metadata_album_album_name: 'Ál<b>bum', spotify_track_uri: 'spotify:track:9' }
  ]);
  const model = await analyze(memoryBytes('xssrank.json', json), { tz: UTC, now: 1704067200 });
  const tracks = rankCardHTML(model, { tab: 'tracks' });
  assert.ok(tracks.includes('&lt;i&gt;'), 'título escapado');
  assert.ok(!tracks.includes('<i>'), 'sin markup crudo del título');
  assert.ok(!tracks.includes('R&amp;B'), 'el artista ya no aparece en el ranking de canciones');
  const albums = rankCardHTML(model, { tab: 'albums' });
  assert.ok(albums.includes('R&amp;B &quot;Live&quot;'), 'artista escapado en álbumes');
  assert.ok(albums.includes('&lt;b&gt;'), 'álbum escapado');
  assert.ok(!albums.includes('<b>'), 'sin markup crudo del álbum');
});

test('filter-ui: fechas custom dentro de los avanzados colapsables', async () => {
  const model = await demoModel();
  const bar = filterBarHTML(model, emptyFilterState());
  const details = bar.slice(bar.indexOf('<details'), bar.indexOf('</details>'));
  assert.ok(details.includes('data-filter="from"'), 'Desde dentro del details');
  assert.ok(details.includes('data-filter="to"'), 'Hasta dentro del details');
});

test('filter-ui: summary de avanzados con chevron a la izquierda y grupos marcados', async () => {
  const model = await demoModel();
  const bar = filterBarHTML(model, emptyFilterState());
  const summary = bar.slice(bar.indexOf('<summary>'), bar.indexOf('</summary>'));
  assert.ok(summary.includes('class="chevron"'), 'chevron presente en el summary');
  assert.ok(summary.indexOf('class="chevron"') < summary.indexOf('Fechas'), 'chevron a la izquierda del texto');
  const details = bar.slice(bar.indexOf('<details'), bar.indexOf('</details>'));
  assert.equal((details.match(/filter-group-start/g) || []).length, 2, 'dos inicios de grupo: días de semana y toggles');
});

test('filter-ui: chips de entidad y conversión de fechas', async () => {
  const model = await demoModel();
  const ar = model.artists.top.byPlays[0].id;
  const name = model.artists.byId.get(ar).name;
  const chips = chipsHTML(model, { artistId: ar, trackId: null, albumId: null, range: null, years: null, months: null, hours: null, dows: null, skip: null, shuffle: null, offline: null });
  assert.ok(chips.includes('data-unset="artistId"'), 'chip con unset');
  assert.ok(chips.includes(name), 'chip con el nombre de la entidad');
  assert.equal(locToISODate(1704067200), '2024-01-01');
  assert.equal(isoDateToDay('2024-01-01'), 19723);
  assert.equal(isoDateToDay('no-fecha'), null);
});

test('filter-ui: sin resumen en el pie (los KPIs ya reflejan el filtrado)', async () => {
  const model = await demoModel();
  const bar = filterBarHTML(model, emptyFilterState());
  assert.ok(!bar.includes('filter-summary'), 'sin span de resumen');
  assert.ok(!bar.includes('reproducciones'), 'sin métricas duplicadas en la barra');
  assert.ok(bar.includes('id="filter-chips" tabindex="-1"'), 'foco tras quitar chip va a la fila de chips');
});

test('filter-ui: días y franjas son chips conmutables (sin checkboxes)', async () => {
  const model = await demoModel();
  const st = emptyFilterState();
  st.dows = new Set([0]);
  st.hours = new Set([0, 1, 2, 3, 4, 5]);
  const bar = filterBarHTML(model, st);
  assert.ok(!bar.includes('type="checkbox"'), 'sin checkboxes nativos');
  const dows = [...bar.matchAll(/data-dow="(\d)"/g)].map((m) => m[1]);
  assert.deepEqual(dows, ['0', '1', '2', '3', '4', '5', '6'], '7 días en orden');
  assert.ok(bar.includes('data-dow="0" aria-pressed="true"'), 'lunes activo');
  assert.ok(bar.includes('data-dow="1" aria-pressed="false"'), 'martes inactivo');
  const blocks = [...bar.matchAll(/data-block="(\d)"/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['0', '1', '2', '3'], '4 franjas');
  assert.ok(bar.includes('data-block="0" aria-pressed="true"'), 'madrugada activa');
  assert.ok(bar.includes('chip-grid-7'), 'días en banda de una fila');
  assert.ok(bar.includes('chip-grid-4'), 'franjas en banda de una fila');
  assert.ok(bar.includes('toggle-grid'), 'toggles en grilla de 3 columnas');
});

test('filter-ui: año/mes son shortcuts que poblan el rango (un solo mecanismo)', () => {
  const y = rangeFromYear(2024);
  assert.equal(y.from, 19723 * 86400, '1 ene 2024');
  assert.equal(y.to, 20088 * 86400 + 86399, '31 dic 2024 (año bisiesto)');
  const m = rangeFromMonth(202403);
  assert.equal(m.from, 19783 * 86400, '1 mar 2024');
  assert.equal(m.to, 19813 * 86400 + 86399, '31 mar 2024');
  assert.equal(rangeFromMonth(202402).to, 19782 * 86400 + 86399, '29 feb 2024');
});

test('filter-ui: días y franjas activas proyectan chips de grupo al resumen', async () => {
  const model = await demoModel();
  const st = emptyFilterState();
  st.dows = new Set([1, 2, 3, 4]);
  st.hours = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  const chips = chipsHTML(model, st);
  assert.ok(chips.includes('data-unset="dows"'), 'chip de días');
  assert.ok(chips.includes('Días: M, X, J, V'), 'iniciales de los días activos');
  assert.ok(chips.includes('data-unset="hours"'), 'chip de franjas');
  assert.ok(chips.includes('Franjas: Mañana, Tarde'), 'franjas cubiertas por el estado');
  const plain = chipsHTML(model, emptyFilterState());
  assert.ok(!plain.includes('Días:') && !plain.includes('Franjas:'), 'sin grupos activos no hay chips de grupo');
});

test('filter-ui: chip de rango resume año/mes completo y acorta el resto', async () => {
  const model = await demoModel();
  const st = emptyFilterState();
  const year = chipsHTML(model, { ...st, range: rangeFromYear(2024) });
  assert.ok(year.includes('Año 2024'), 'año completo resumido');
  assert.ok(!year.includes('Rango:'), 'sin prefijo Rango');
  const month = chipsHTML(model, { ...st, range: rangeFromMonth(202403) });
  assert.ok(month.includes('mar 2024'), 'mes completo resumido');
  const custom = chipsHTML(model, { ...st, range: { from: 19783 * 86400 + 3600, to: 19813 * 86400 + 86399 } });
  assert.ok(custom.includes('2024-03-01 → 2024-03-31'), 'fechas crudas para rango arbitrario');
});

test('filter-ui: matchRangeShortcut detecta año/mes exactos', () => {
  assert.deepEqual(matchRangeShortcut(rangeFromYear(2024)), { year: 2024, month: null });
  assert.deepEqual(matchRangeShortcut(rangeFromMonth(202402)), { year: null, month: 202402 }, 'bisiesto');
  assert.deepEqual(matchRangeShortcut({ from: 19784 * 86400, to: 19813 * 86400 + 86399 }), { year: null, month: null }, 'no arranca el 1');
  assert.deepEqual(matchRangeShortcut({ from: 19783 * 86400, to: 19813 * 86400 }), { year: null, month: null }, 'no termina en fin de día');
  assert.deepEqual(matchRangeShortcut({ from: 0, to: 86399 }), { year: null, month: null }, 'un día suelto no es un mes completo');
});

test('filter-ui: Borrar todo vive en la fila de chips (sin fila propia)', async () => {
  const model = await demoModel();
  const bar = filterBarHTML(model, emptyFilterState());
  assert.ok(!bar.includes('data-clear-row'), 'sin fila dedicada de Limpiar');
  assert.ok(!bar.includes('Borrar todo'), 'sin botón de limpiar sin filtros');
  const st = emptyFilterState();
  st.range = { from: 0, to: 86399 };
  const bar2 = filterBarHTML(model, st);
  const chipsRow = bar2.slice(bar2.indexOf('id="filter-chips"'), bar2.indexOf('<details'));
  assert.ok(chipsRow.includes('data-action="clear"'), 'Borrar todo dentro de la fila de chips');
  assert.ok(chipsRow.includes('Borrar todo'), 'etiqueta compacta');
});

test('contraste: muted sobre surface-2 cumple WCAG AA (≥ 4.5:1)', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const hexVar = (name) => {
    const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(m, `variable --${name} presente en style.css`);
    return m[1];
  };
  const luminance = (hexStr) => {
    const channels = [0, 2, 4].map((i) => parseInt(hexStr.slice(1 + i, 3 + i), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const l1 = luminance(hexVar('text-muted'));
  const l2 = luminance(hexVar('surface-2'));
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  assert.ok(ratio >= 4.5, `contraste ${ratio.toFixed(2)}:1 ≥ 4.5:1 (botones quiet y texto del toast)`);
  assert.ok(css.includes('.btn-link.btn-quiet:hover'), 'el hover del descarte gana la cascada (no hereda el accent de btn-link)');
});

test('css: el hover de filas no aplica en táctil ni tapa la barra', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const mq = css.indexOf('@media (hover: hover)');
  assert.ok(mq >= 0, 'media query (hover: hover) presente');
  assert.ok(css.indexOf('tbody tr:hover td') > mq, 'hover genérico de fila dentro de la media query');
  assert.ok(css.indexOf('tr:hover td:first-child') > mq, 'sync de celda sticky dentro de la media query');
  const sel = 'tr[style*="--bar-w"]:hover td:not(:first-child)';
  assert.ok(css.includes(sel), 'regla de hover para filas con barra');
  const block = css.slice(css.indexOf(sel));
  const body = block.slice(block.indexOf('{') + 1, block.indexOf('}'));
  assert.ok(body.includes('background: transparent'), 'tds transparentes en hover: el gradiente del tr sigue visible');
});

test('filter-ui: rango invertido colapsa al día editado', () => {
  assert.deepEqual(normalizeRangeDays(200, 100, 'from'), { fromDay: 200, toDay: 200 }, 'Desde > Hasta: gana el editado');
  assert.deepEqual(normalizeRangeDays(200, 100, 'to'), { fromDay: 100, toDay: 100 }, 'Hasta < Desde: gana el editado');
  assert.deepEqual(normalizeRangeDays(100, 200, 'from'), { fromDay: 100, toDay: 200 }, 'rango válido pasa intacto');
  assert.deepEqual(normalizeRangeDays(null, 200, 'to'), { fromDay: null, toDay: 200 }, 'lado vacío no se inventa');
  assert.deepEqual(normalizeRangeDays(100, null, 'from'), { fromDay: 100, toDay: null }, 'lado vacío no se inventa');
  assert.deepEqual(normalizeRangeDays(null, null, 'from'), { fromDay: null, toDay: null }, 'todo vacío pasa');
});

test('filter-ui: el announcer resume el resultado del filtrado', () => {
  const msg = filterStatusMessage({ records: 2538, ms: 5.5 * 3600000 });
  assert.ok(msg.includes('2.538'), 'conteo con separador de miles');
  assert.ok(msg.includes('5h 30m'), 'tiempo humanizado');
});

test('filter-ui: min/max de los date inputs acotados al dataset', async () => {
  const model = await demoModel();
  const bar = filterBarHTML(model, emptyFilterState());
  const details = bar.slice(bar.indexOf('<details'), bar.indexOf('</details>'));
  assert.ok(details.includes(`min="${locToISODate(model.meta.firstTs)}"`), 'Desde acotado al primer ts');
  assert.ok(details.includes(`max="${locToISODate(model.meta.lastTs)}"`), 'Hasta acotado al último ts');
});

test('empty state: mensaje y botón de limpiar cuando el filtro no matchea nada', () => {
  const html = emptyFiltersHTML();
  assert.ok(html.includes('Ningún resultado'), 'mensaje claro');
  assert.ok(html.includes('data-action="clear"'), 'botón que limpia (delegación existente)');
});

test('tablas: caption visualmente oculto para lectores de pantalla', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  const captions = (html.match(/<caption class="visually-hidden">/g) || []).length;
  assert.ok(captions >= 5, `${captions} captions en el dashboard (obsesión, rachas, salto, primera, última, rankings)`);
  const sessions = renderView('sessions', model);
  assert.ok(sessions.includes('<caption class="visually-hidden">Sesiones más largas</caption>'), 'caption de sesiones');
});

test('chart-scroll: regiones focables con nombre (scroll sin controles adentro)', async () => {
  const model = await demoModel();
  const dash = renderView('dashboard', model);
  assert.ok(dash.includes('class="chart-scroll chart-scroll--heat" tabindex="0" role="region" aria-label='), 'heatmap del dashboard');
  const artist = renderView('artist', model, model.artists.top.byPlays[0].id);
  assert.ok(artist.includes('class="chart-scroll chart-scroll--clock" tabindex="0" role="region" aria-label='), 'reloj del artista');
  const wrapped = renderView('wrapped', model);
  assert.ok(wrapped.includes('class="chart-scroll chart-scroll--clock" tabindex="0" role="region" aria-label='), 'reloj de wrapped');
  const cal = renderView('calendar', model);
  assert.ok(cal.includes('class="chart-scroll chart-scroll--cal" tabindex="0" role="region" aria-label='), 'calendario');
});

test('fallback de tabla para relojes y calendario (paridad con el heatmap)', async () => {
  const model = await demoModel();
  const artist = renderView('artist', model, model.artists.top.byPlays[0].id);
  assert.ok(artist.includes('class="table-fallback"'), 'reloj del artista con fallback');
  assert.ok(artist.includes('Reproducciones por hora y día'), 'caption del reloj');
  const wrapped = renderView('wrapped', model);
  assert.ok(wrapped.includes('class="table-fallback"'), 'reloj de wrapped con fallback');
  const year = [...model.yearly.keys()].sort((a, b) => b - a)[0];
  const cal = renderView('calendar', model, year);
  assert.ok(cal.includes('class="table-fallback"'), 'calendario con fallback');
  assert.ok(cal.includes(`Tiempo escuchado por día en ${year}`), 'caption del calendario');
  const idx = renderView('calendar', model);
  assert.ok(idx.includes('class="table-fallback"'), 'índice de calendario con fallback por año');
});

test('bar/line/stacked dentro de scroll con piso (labels legibles en móvil)', async () => {
  const model = await demoModel();
  const dash = renderView('dashboard', model);
  assert.ok(dash.includes('chart-scroll--bar'), 'wrapper presente en el dashboard');
  // Misma regla que heat/clock/cal: región focable con nombre (el scroll
  // horizontal es inalcanzable por teclado sin tabindex).
  assert.ok(dash.includes('class="chart-scroll chart-scroll--bar" tabindex="0" role="region" aria-label='), 'región focable con nombre');
  const evo = dash.slice(dash.indexOf('Evolución mensual'));
  assert.ok(evo.slice(0, 300).includes('chart-scroll--bar'), 'evolución mensual envuelta');
  const artist = renderView('artist', model, model.artists.top.byPlays[0].id);
  assert.ok(artist.includes('chart-scroll--bar'), 'evolución del artista envuelta');
  const track = renderView('track', model, model.tracks.top.byPlays[0].tk);
  assert.ok(track.includes('chart-scroll--bar'), 'evolución de la canción envuelta');
  const album = renderView('album', model, [...model.albums.byId.keys()][0]);
  assert.ok(album.includes('chart-scroll--bar'), 'evolución del álbum envuelta');
  const sessions = renderView('sessions', model);
  assert.equal((sessions.match(/chart-scroll--bar/g) || []).length, 4, 'los 4 barCharts de sesiones envueltos');
  const discovery = renderView('discovery', model);
  assert.ok(discovery.includes('chart-scroll--bar'), 'línea de descubrimiento envuelta');
  const yearly = renderView('yearly', model);
  assert.ok(yearly.includes('chart-scroll--bar'), 'franjas por año envueltas');
  const wrapped = renderView('wrapped', model);
  assert.ok(wrapped.includes('chart-scroll--bar'), 'sprint de wrapped envuelto');
});

test('dashboard: leyenda de la escala del heatmap', async () => {
  const model = await demoModel();
  const dash = renderView('dashboard', model);
  assert.ok(dash.includes('class="heat-legend"'), 'leyenda bajo el heatmap');
  assert.ok(dash.includes('sin actividad'), 'nivel cero rotulado');
});

test('filter-ui: previousRange devuelve el período inmediato anterior de igual largo', () => {
  const r = { from: 100 * 86400, to: 106 * 86400 + 86399 };
  const p = previousRange(r);
  assert.equal(p.from, 93 * 86400, 'mismo largo hacia atrás');
  assert.equal(p.to, 99 * 86400 + 86399, 'termina el día antes del rango');
});

test('filter-ui: params de URL serializan y restauran el estado de filtros', () => {
  const st = emptyFilterState();
  st.range = { from: 19723 * 86400, to: 20088 * 86400 + 86399 };
  st.dows = new Set([1, 4]);
  st.hours = new Set([6, 7]);
  st.skip = true;
  st.offline = false;
  st.artistId = 7;
  const q = filterParams(st);
  assert.ok(q.startsWith('?'), 'prefijo de query');
  assert.ok(q.includes(`r=${19723 * 86400}-`), 'rango serializado en segundos epoch');
  const back = paramsToFilterState(q.slice(1));
  assert.equal(back.range.from, st.range.from, 'rango ida y vuelta');
  assert.equal(back.range.to, st.range.to, 'rango ida y vuelta');
  assert.deepEqual([...back.dows].sort(), [1, 4], 'días ida y vuelta');
  assert.deepEqual([...back.hours].sort(), [6, 7], 'franjas ida y vuelta');
  assert.equal(back.skip, true, 'toggle 3 estados ida y vuelta');
  assert.equal(back.offline, false, 'toggle 3 estados ida y vuelta');
  assert.equal(back.artistId, 7, 'entidad ida y vuelta');
  assert.equal(back.shuffle, null, 'lo ausente vuelve como null');
  assert.equal(back.trackId, null, 'lo ausente vuelve como null');
  assert.equal(back.albumId, null, 'lo ausente vuelve como null');
});

test('filter-ui: sin filtros no hay params; query ausente y basura no rompen', () => {
  assert.equal(filterParams(emptyFilterState()), '', 'estado limpio no ensucia la URL');
  assert.equal(paramsToFilterState(''), null, 'sin query → null: el caller conserva el estado');
  const back = paramsToFilterState('r=abc-d&d=99&s=maybe&ar=-3&h=24,25');
  assert.equal(back.range, null, 'rango basura descartado');
  assert.equal(back.dows, null, 'día fuera de 0-6 descartado');
  assert.equal(back.skip, null, 'toggle inválido → null');
  assert.equal(back.artistId, null, 'id negativo → null');
  assert.equal(back.hours, null, 'hora fuera de 0-23 descartada');
});

test('filter-ui: plural real de meses en el chip', async () => {
  const model = await demoModel();
  const one = chipsHTML(model, { ...emptyFilterState(), months: new Set([202403]) });
  assert.ok(one.includes('1 mes'), 'singular');
  assert.ok(!one.includes('mes(es)'), 'sin mes(es)');
  const three = chipsHTML(model, { ...emptyFilterState(), months: new Set([202401, 202402, 202403]) });
  assert.ok(three.includes('3 meses'), 'plural');
});

test('filter-ui: la ✕ del chip queda fuera del nombre accesible', async () => {
  const model = await demoModel();
  const st = emptyFilterState();
  st.range = { from: 0, to: 86399 };
  const chips = chipsHTML(model, st);
  assert.ok(chips.includes('<span aria-hidden="true">✕</span>'), '✕ decorativa, no leída por lectores');
});

test('dashboard: comparación contra el período anterior en KPIs', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model, null, { prev: { records: 100, ms: 3600000 } });
  assert.ok(html.includes('vs período anterior'), 'delta visible');
  const empty = renderView('dashboard', model, null, { prev: { records: 0, ms: 0 } });
  assert.ok(empty.includes('anterior sin datos'), 'previo vacío no divide por cero');
  const none = renderView('dashboard', model);
  assert.ok(!none.includes('vs período anterior'), 'sin prev no hay comparación');
});

test('dashboard: card de récords', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  for (const s of ['Récords', 'Día más intenso', 'Mes más intenso', 'Sesión más larga', 'Maratón']) {
    assert.ok(html.includes(s), `récord: ${s}`);
  }
});

test('wrapped: milestones de primera vez', async () => {
  const model = await demoModel();
  const html = renderView('wrapped', model);
  assert.ok(html.includes('Primera escucha'), 'primera escucha general');
  assert.ok(html.includes('Primera vez con'), 'primera vez con artista/canción del año');
});

test('wrapped: arquetipo de oyente', async () => {
  const model = await demoModel();
  const a = listenerArchetype(model);
  assert.ok(a && a.label.length > 0, 'label no vacío');
  assert.ok(a.detail.includes('%'), 'detalle con porcentajes');
  assert.ok(renderView('wrapped', model).includes('Perfil de escucha'), 'visible en wrapped');
  assert.equal(listenerArchetype({ totals: { records: 0 } }), null, 'sin datos no hay arquetipo');
});

test('rankings: sparkline de evolución mensual por fila', async () => {
  const model = await demoModel();
  const html = rankCardHTML(model, { tab: 'artists', metric: 'plays' });
  assert.ok(html.includes('class="sparkline"'), 'sparkline por fila de artistas');
  assert.ok(html.includes('Tendencia'), 'columna de tendencia');
  const tracks = rankCardHTML(model, { tab: 'tracks', metric: 'ms' });
  assert.ok(tracks.includes('class="sparkline"'), 'sparkline de canciones por tiempo');
  const albums = rankCardHTML(model, { tab: 'albums', metric: 'plays' });
  assert.ok(albums.includes('class="sparkline"'), 'álbumes suman la evolución de sus canciones');
});

test('rankings: tabs con patrón APG (roving tabindex + panel etiquetado)', async () => {
  const model = await demoModel();
  const html = rankCardHTML(model, { tab: 'tracks' });
  assert.ok(html.includes('id="rank-tab-tracks" aria-selected="true" tabindex="0"'), 'tab activo focable');
  assert.ok(html.includes('id="rank-tab-artists" aria-selected="false" tabindex="-1"'), 'tab inactivo fuera del orden de tabulación');
  assert.ok(html.includes('role="tabpanel" id="rank-panel" tabindex="0" aria-labelledby="rank-tab-tracks"'), 'panel focable y etiquetado por el tab activo');
});

test('calendario: los días filtran al tocar (selector de rango)', async () => {
  const model = await demoModel();
  const html = renderView('calendar', model);
  assert.ok(html.includes('data-day='), 'celdas del calendario interactivas');
  assert.ok(html.includes('tocá un día'), 'hint de interacción visible');
});

test('traducciones: KPIs de umbral interpolados desde meta', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  assert.ok(html.includes('Reproducciones (+30 s)'), 'minMs default 30000 → +30 s');
  assert.ok(html.includes('Cortadas (&lt;10 s)'), 'skipThresholdMs default 10000 → <10 s escapado');
  const custom = { ...model, meta: { ...model.meta, minMs: 1500, skipThresholdMs: 500 } };
  const htmlCustom = renderView('dashboard', custom);
  assert.ok(htmlCustom.includes('Reproducciones (+1,5 s)'), 'sub-segundo con coma decimal');
  assert.ok(htmlCustom.includes('Cortadas (&lt;500 ms)'), 'menos de 1 s en ms');
});

test('traducciones: chips y toggles de shuffle/offline en español', async () => {
  const model = await demoModel();
  const base = { artistId: null, trackId: null, albumId: null, range: null, years: null, months: null, hours: null, dows: null, skip: null, shuffle: null, offline: null };
  const on = chipsHTML(model, { ...base, shuffle: true, offline: true });
  assert.ok(on.includes('Solo aleatorio'), 'shuffle activo');
  assert.ok(on.includes('Solo sin conexión'), 'offline activo');
  const off = chipsHTML(model, { ...base, shuffle: false, offline: false });
  assert.ok(off.includes('Sin aleatorio'), 'shuffle excluido');
  assert.ok(off.includes('Con conexión'), 'offline excluido dice "Con conexión"');
  const bar = filterBarHTML(model, emptyFilterState());
  assert.ok(bar.includes('Aleatorio <select'), 'toggle de shuffle');
  assert.ok(bar.includes('Sin conexión <select'), 'toggle de offline');
});

test('traducciones: razones de inicio/fin en español', async () => {
  const model = await demoModel();
  const html = renderView('sessions', model);
  assert.ok(html.includes('Canción completa'), 'trackdone');
  assert.ok(html.includes('Botón siguiente'), 'fwdbtn');
  assert.ok(html.includes('Clic en pista'), 'clickrow');
  assert.ok(html.includes('Control remoto'), 'remote');
  assert.ok(html.includes('Cierre de sesión'), 'endplay/logout');
  assert.ok(html.includes('Pausa de 30 min entre sesiones'), 'meta de sesiones sin "Gap"');
  const unknown = { ...model, starts: new Map([['weird-code', 3]]) };
  assert.ok(renderView('sessions', unknown).includes('weird-code'), 'código sin mapeo queda crudo');
});

test('traducciones: wrapped legible (concentración, evolución, resumen)', async () => {
  const model = await demoModel();
  const html = renderView('wrapped', model);
  const eff = Math.max(1, Math.round(model.concentration.artists.effective));
  const noun = eff === 1 ? 'artista base' : 'artistas base';
  assert.ok(html.includes(`~${eff} ${noun}`), 'valor principal = efectivos redondeados');
  assert.ok(html.includes(`Equivale a repartir tu tiempo en partes iguales entre ${eff}`), 'descripción corta');
  const flat = html.replace(/\s+/g, ' ');
  assert.match(flat, /Concentración \(HHI\)<\/dt><dd>[^<]*%/, 'HHI como porcentaje');
  assert.ok(html.includes('Evolución de '), 'sprint → evolución del artista top');
  assert.ok(html.includes('Copiar resumen en texto'), 'botón de copia');
  assert.ok(!html.includes('Recibo') && !html.includes('Copiar recibo'), 'sin "Recibo"');
  assert.ok(html.includes('Con aleatorio'), 'fila del recibo con término unificado');
});

test('traducciones: dashboard sin jerga y hint táctil del calendario', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  assert.ok(html.includes('Obsesión (reproducciones por día activo)'), 'sin "plays"');
  assert.ok(html.includes('Tiempo escuchado por hora y día'), 'caption del heatmap');
  assert.ok(!html.includes('(ms)'), 'caption sin unidad técnica');
  const cal = renderView('calendar', model);
  assert.ok(cal.includes('class="hint-shift"'), 'hint de shift+click marcado para CSS');
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const mq = css.indexOf('@media (pointer: coarse)');
  assert.ok(mq >= 0, 'media query (pointer: coarse) presente');
  assert.ok(css.indexOf('.hint-shift') > mq, '.hint-shift oculto dentro de la media query');
});

test('filter-ui: global metric switch, advanced filter badge, and m=ms serialization', async () => {
  const model = await demoModel();
  const state = emptyFilterState();
  const barPlays = filterBarHTML(model, state, { metric: 'plays' });
  assert.ok(barPlays.includes('data-global-metric="plays" aria-pressed="true"'));
  assert.ok(barPlays.includes('data-global-metric="ms" aria-pressed="false"'));
  const barMs = filterBarHTML(model, state, { metric: 'ms' });
  assert.ok(barMs.includes('data-global-metric="ms" aria-pressed="true"'));

  assert.equal(advancedFilterCount(state, model.meta.lastTs), 0);
  state.dows = new Set([0, 1]);
  state.skip = false;
  assert.equal(advancedFilterCount(state, model.meta.lastTs), 2);
  const barAdvanced = filterBarHTML(model, state);
  assert.ok(barAdvanced.includes('id="filter-adv-badge">2<'));

  assert.equal(filterParams(emptyFilterState(), 'ms'), '?m=ms');
  assert.equal(metricFromParams('m=ms'), 'ms');
  assert.equal(metricFromParams(''), 'plays');
  assert.equal(metricFromParams('m=invalid'), 'plays');
});

test('rankings and css: Top 100 option, skip-link, base links, and no invalid --sp-5', async () => {
  const model = await demoModel();
  const rankHtml = rankCardHTML(model, { topN: 100 });
  assert.ok(rankHtml.includes('<option value="100" selected>Top 100</option>'));

  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes('class="skip-link"'));
  assert.ok(html.includes('id="main-content"'));

  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  assert.ok(!css.includes('var(--sp-5)'));
  assert.ok(css.includes('.skip-link'));
  assert.ok(/^\s*a\s*\{/m.test(css));
});

test('hours view: 24-hour #1 tracks, 4 blocks comparison, and metric switching', async () => {
  const model = await demoModel();
  const playsHtml = renderView('hours', model, null, { metric: 'plays' });
  assert.ok(playsHtml.includes('Canción #1 de cada hora'));
  assert.ok(playsHtml.includes('00:00') && playsHtml.includes('23:00'));
  assert.ok(playsHtml.includes('Artista #1') && playsHtml.includes('Canción #1'));
  assert.ok(playsHtml.includes('Fin de semana'));

  const msHtml = renderView('hours', model, null, { metric: 'ms' });
  assert.ok(msHtml.includes('Tiempo'));
});

test('habits view: concentration, Pareto curve, monthly behavior, transitions, pairs, and catalog curiosities', async () => {
  const model = await demoModel();
  const html = renderView('habits', model);
  for (const label of [
    'Efectivos exp(H)',
    'Gini',
    'Entropía norm.',
    'Curva de Pareto',
    'Saltos por mes',
    'Aleatorio por mes',
    'Transiciones entre artistas',
    'Pares de inicio',
    'One-hit wonders',
    'Catálogo profundo',
    'Artistas olvidados',
    'Canciones olvidadas'
  ]) {
    assert.ok(html.includes(label), `habits view includes ${label}`);
  }
});

test('sessions, discovery, yearly, and calendar enrichments and metric switching', async () => {
  const model = await model2y();
  const sess = renderView('sessions', model);
  assert.ok(sess.includes('Reproducciones mediana'));
  assert.ok(sess.includes('Sesiones por mes'));
  assert.ok(sess.includes('Sesiones por día de la semana'));
  assert.ok(sess.includes('data-table-limit="sessions-dur"'));

  const disc = renderView('discovery', model);
  assert.ok(disc.includes('data-table-limit="disc-constancy"'));
  assert.ok(disc.includes('Repetidas'));

  const yearlyPlays = renderView('yearly', model, null, { metric: 'plays' });
  assert.ok(yearlyPlays.includes('Álbumes'));
  assert.ok(yearlyPlays.includes('Artista #1'));
  assert.ok(yearlyPlays.includes('Canción #1'));
  const yearlyMs = renderView('yearly', model, null, { metric: 'ms' });
  assert.ok(yearlyMs.includes('2023 — Madrugada: 2m'));

  const calIdx = renderView('calendar', model);
  const yearDetails = calIdx.slice(calIdx.indexOf('<details class="card calendar-year">'));
  const summarySection = yearDetails.slice(yearDetails.indexOf('<summary>'), yearDetails.indexOf('</summary>'));
  assert.ok(summarySection.includes('class="chevron"'));
  assert.ok(!summarySection.includes('<a '), 'summary does not wrap a competing link');

  const calPlays = renderView('calendar', model, 2024, { metric: 'plays' });
  assert.ok(calPlays.includes('Reproducciones por día en 2024'));
});

test('dashboard: unified KPIs, records grid, separated skip rate tables, and metric switching', async () => {
  const model = await demoModel();
  const dash = renderView('dashboard', model);
  assert.ok(dash.includes('Duración promedio'));
  assert.ok(dash.includes('Completadas'));
  assert.ok(dash.includes('records-grid'));
  assert.ok(dash.includes('Mayor tasa de salto — Artistas'));
  assert.ok(dash.includes('Mayor tasa de salto — Canciones'));
  assert.ok(dash.includes('Menor tasa de salto'));
  assert.ok(dash.includes('data-table-limit="dash-obsession"'));
  assert.equal((dash.match(/<dl class="kpis">/g) || []).length, 1, 'single unified KPI grid in dashboard');

  const dashPlays = renderView('dashboard', model, null, { metric: 'plays' });
  assert.ok(dashPlays.includes('Reproducciones por hora y día'));
});

test('wrapped: hero archetype card and unified receipt with share button', async () => {
  const model = await demoModel();
  const html = renderView('wrapped', model, null, { metric: 'ms' });
  assert.ok(html.includes('hero-archetype'));
  assert.ok(!html.includes('<h2>Compartir</h2>'), 'share button is unified into the summary card');
  assert.ok(html.includes('Tiempo escuchado por hora y día'), 'wrapped clock switches to ms when metric=ms');
});

test('detail views (artist, track, album): firstTrack, active months, clockMs, sparklines, and table limits', async () => {
  const model = await demoModel();
  const ar = model.artists.top.byPlays[0].id;
  const artistPlays = renderView('artist', model, ar, { metric: 'plays' });
  assert.ok(artistPlays.includes('Primera canción'));
  assert.ok(artistPlays.includes('Meses activos'));
  assert.ok(artistPlays.includes('data-table-limit="artist-tracks"'));
  assert.ok(artistPlays.includes('class="sparkline"'));

  const artistMs = renderView('artist', model, ar, { metric: 'ms' });
  assert.ok(artistMs.includes('Tiempo escuchado por hora y día'));

  const tk = model.tracks.top.byPlays[0].tk;
  const trackHtml = renderView('track', model, tk, { metric: 'plays' });
  assert.ok(trackHtml.includes('Meses activos'));
  assert.ok(trackHtml.includes('Duración media'));

  const ak = [...model.albums.byId.keys()][0];
  const albumHtml = renderView('album', model, ak, { metric: 'ms' });
  assert.ok(albumHtml.includes('data-table-limit="album-tracks"'));
  assert.ok(albumHtml.includes('class="sparkline"'));
});
