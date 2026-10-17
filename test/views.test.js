// test/views.test.js — contenido y estructura de las vistas (no escaping).
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderView } from '../app/views.js';
import { receiptText } from '../app/views.js';
import { rankCardHTML } from '../app/views.js';
import { chipsHTML, filterBarHTML, locToISODate, isoDateToDay, rangeFromYear, rangeFromMonth, matchRangeShortcut } from '../app/filter-ui.js';
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
