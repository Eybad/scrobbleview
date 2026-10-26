// test/views.test.js — contenido y estructura de las vistas (no escaping).
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderView } from '../app/views.js';
import { receiptText } from '../app/views.js';
import { rankCardHTML, emptyFiltersHTML, listenerArchetype, footerMetaText } from '../app/views.js';
import { chipsHTML, filterBarHTML, locToISODate, isoDateToDay, rangeFromYear, rangeFromMonth, matchRangeShortcut, normalizeRangeDays, filterStatusMessage, previousRange, filterParams, paramsToFilterState, advancedFilterCount } from '../app/filter-ui.js';
import { readFile } from 'node:fs/promises';
import { emptyFilterState } from '../src/filters.js';
import { analyze } from '../src/analyze.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { offsetTable } from '../src/aggregate/adapters/offset-table.js';
import { syntheticJSON } from '../src/synthetic.js';
import { lineChart, sparkline, fmtMs } from '../src/charts.js';

const UTC = fixedTz('utc', 0);

test('wrapped first listen follows UTC chronology during a repeated local hour', async () => {
  const model = await analyze(memoryBytes('dst.json', JSON.stringify([
    ['2024-11-03T05:50:00Z', 'Earlier'],
    ['2024-11-03T06:10:00Z', 'Later']
  ].map(([ts, name]) => ({
    ts, ms_played: 180000, master_metadata_track_name: name,
    master_metadata_album_artist_name: 'Artist', spotify_track_uri: `spotify:track:${name}`
  })))), { tz: offsetTable('ny', [[0, -240], [1730613600, -300]]), now: 1730617200 });
  const html = renderView('wrapped', model);
  assert.ok(html.includes('<span>Primera escucha</span><span>3 nov 2024, 01:50</span>'));
  assert.equal([...model.artists.byId.values()][0].firstTrack, 'Earlier');
});

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

test('meta de vistas: rango destacado en dashboard y metadatos de carga en footer', async () => {
  const model = await demoModel();
  const dash = renderView('dashboard', model);
  assert.ok(!dash.includes('>Tu resumen<'), 'sin título visible redundante "Tu resumen"');
  assert.ok(dash.includes('<h1 class="visually-hidden">Resumen</h1>'), 'h1 accesible conservado');
  const firstMeta = dash.match(/view-range">([^<]*)</)[1];
  assert.ok(firstMeta.includes('→') && !firstMeta.includes('·'), 'primera línea: solo el rango de fechas con hora y minuto');
  assert.ok(!dash.includes('archivos ·') && !dash.includes('Se ignoraron:'), 'metadatos de archivos y warnings retirados del encabezado de Resumen');

  const meta1 = footerMetaText(model);
  assert.ok(meta1.startsWith('1 archivo · '), 'singular con una sola fuente en footer');
  assert.ok(!meta1.includes('zona '), 'sin zona horaria');
  assert.ok(!meta1.includes('archivo(s)'), 'sin archivo(s)');
  assert.ok(/[\d.,]+ (B|KB|MB|GB)/.test(meta1), 'bytes humanizados con unidad');

  const twoWithWarnings = await analyze([
    memoryBytes('a.json', json2y()),
    memoryBytes('b.json', JSON.stringify([
      { ts: '2024-06-01T14:00:00Z', ms_played: 60000, episode_name: 'Ep 1', spotify_episode_uri: 'spotify:episode:1' },
      { ts: '2024-06-02T14:00:00Z', ms_played: 60000, episode_name: 'Ep 2', spotify_episode_uri: 'spotify:episode:2' }
    ]))
  ], { tz: UTC, now: 1704067200 });
  const meta2 = footerMetaText(twoWithWarnings);
  assert.ok(meta2.includes('2 archivos · '), 'plural con dos fuentes');
  assert.ok(meta2.includes(' · 2 episodios de podcast ignorados'), 'warnings integrados con punto medio en el footer');

  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const footerIdx = html.indexOf('<footer class="site-footer"');
  const footerHtml = html.slice(footerIdx);
  assert.ok(footerHtml.includes('id="footer-meta"'), 'bloque compacto de metadatos presente en el footer');
  assert.ok(footerHtml.indexOf('id="footer-meta"') < footerHtml.indexOf('Tus datos se procesan localmente'), 'metadatos justo encima del aviso de privacidad');

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

test('album views and sparklines isolate shared tracks by album for both metrics', async () => {
  const json = JSON.stringify([
    ['2024-01-01T12:00:00Z', 180000, 'Album A', 'spotify:track:1'],
    ['2024-02-01T12:00:00Z', 180000, 'Album B', 'spotify:track:2'],
    ['2024-02-01T12:03:00Z', 60000, 'Album B', 'spotify:track:2']
  ].map(([ts, ms_played, album, spotify_track_uri]) => ({
    ts, ms_played, spotify_track_uri,
    master_metadata_track_name: 'Shared song',
    master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: album
  })));
  const model = await analyze(memoryBytes('albums.json', json), { tz: UTC, now: 1704067200 });
  assert.equal(model.tracks.byId.size, 1);
  const albums = [...model.albums.byId.values()];
  for (const [index, album] of albums.entries()) {
    for (const metric of ['plays', 'ms']) {
      const values = metric === 'plays'
        ? (index === 0 ? [1, 0] : [0, 2])
        : (index === 0 ? [180000, 0] : [0, 240000]);
      const html = renderView('album', model, album.id, { metric });
      const row = html.match(/<tr\b[^>]*>.*Shared song.*?<\/tr>/)?.[0];
      assert.ok(row);
      assert.ok(row.includes(`class="cell-metric-val">${metric === 'plays' ? (index === 0 ? '1' : '2') : (index === 0 ? '3 min 0s' : '4 min 0s')}</span>`));
      assert.ok(row.includes(sparkline({ points: values, width: 80, height: 24 })), `${album.name}: track sparkline, ${metric}`);
      assert.ok(html.includes(lineChart({
        points: [{ label: 'ene 2024', y: values[0] }, { label: 'feb 2024', y: values[1] }],
        format: metric === 'ms' ? fmtMs : String
      })), `${album.name}: monthly evolution, ${metric}`);
      const ranking = rankCardHTML(model, { tab: 'albums', metric });
      const albumRow = (ranking.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [])
        .find(value => value.includes(`href="#/album/${album.id}"`));
      assert.ok(albumRow?.includes(sparkline({ points: values, width: 80, height: 24 })), `${album.name}: ranking sparkline, ${metric}`);
    }
  }
  const trackHtml = renderView('track', model, [...model.tracks.byId.keys()][0]);
  for (const album of albums) assert.ok(trackHtml.includes(`href="#/album/${album.id}"`));
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
  assert.ok(msg.includes('5h 30 min'), 'tiempo humanizado');
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

test('dashboard: card de récords sin NaN y con clases alineadas al CSS', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  for (const s of ['Récords', 'Día más intenso', 'Mes más intenso', 'Sesión más larga', 'Maratón']) {
    assert.ok(html.includes(s), `récord: ${s}`);
  }
  assert.ok(!html.includes('NaN'), 'sin NaN en días sin actividad ni en récords');
  assert.ok(html.includes('class="record-item"'), 'usa .record-item definido en style.css');
  assert.ok(html.includes('class="record-value"'), 'usa .record-value definido en style.css');
  assert.ok(html.includes('class="record-sub"'), 'usa .record-sub definido en style.css');
  assert.ok(!html.includes('class="record-tile"'), 'sin clase huérfana .record-tile');
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

test('traducciones: KPIs de umbral con sub debajo del número y nombres naturales', async () => {
  const model = await demoModel();
  const html = renderView('dashboard', model);
  assert.ok(html.includes('<dt>Reproducciones significativas</dt>'), 'nombre natural para plays >= minMs');
  assert.ok(html.includes(`<dd>${model.totals.playsSignificant.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}<span class="kpi-sub">≥30 s</span></dd>`), '+30 s debajo del número');
  assert.ok(html.includes('<dt>Reproducciones cortas</dt>'), 'nombre natural para plays < skipThresholdMs');
  assert.ok(html.includes(`<dd>${model.totals.playsSkipped.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}<span class="kpi-sub">&lt;10 s</span></dd>`), '<10 s debajo del número');
  assert.ok(html.includes('<dt>Final con código trackdone</dt>') && html.includes('otros finales'), 'end codes are labeled explicitly');
  assert.ok(html.includes('<dt>En aleatorio</dt>'), 'En aleatorio en vez de Con aleatorio');
  const custom = { ...model, meta: { ...model.meta, minMs: 1500, skipThresholdMs: 500 } };
  const htmlCustom = renderView('dashboard', custom);
  assert.ok(htmlCustom.includes('<span class="kpi-sub">≥1,5 s</span>'), 'sub-segundo con coma decimal debajo');
  assert.ok(htmlCustom.includes('<span class="kpi-sub">&lt;500 ms</span>'), 'menos de 1 s en ms debajo');
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
  assert.ok(html.includes('Una pausa de más de 30 min inicia otra sesión'), 'session gap is explained');
  assert.ok(html.includes('Duración estimada'), 'estimated duration is distinguished from listened time');
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
  assert.ok(html.includes('En aleatorio'), 'fila del recibo con término unificado');
  assert.ok(html.includes('<li><span>Tiempo escuchado</span>'), 'resumen de wrapped incluye tiempo escuchado');
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

test('filter-ui: sin switch global de métrica (solo en rankings) y badge de filtros avanzados', async () => {
  const model = await demoModel();
  const state = emptyFilterState();
  const bar = filterBarHTML(model, state);
  assert.ok(!bar.includes('data-global-metric'), 'el switch de métrica se quitó de la barra principal');
  assert.ok(!bar.includes('metric-global'), 'sin contenedor metric-global en la barra principal');

  const rankHtml = rankCardHTML(model, { tab: 'artists', metric: 'plays' });
  assert.ok(rankHtml.includes('data-metric="plays"') && rankHtml.includes('data-metric="ms"'), 'el switch de métrica vive solo en rankings');

  assert.equal(advancedFilterCount(state, model.meta.lastTs), 0);
  state.dows = new Set([0, 1]);
  state.skip = false;
  assert.equal(advancedFilterCount(state, model.meta.lastTs), 2);
  const barAdvanced = filterBarHTML(model, state);
  assert.ok(barAdvanced.includes('id="filter-adv-badge">2<'));
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

test('hours view: 24-hour grouped detail table, 4 blocks comparison, and metric switching', async () => {
  const model = await demoModel();
  const playsHtml = renderView('hours', model, null, { metric: 'plays' });
  assert.ok(playsHtml.includes('Detalle por hora (00:00–23:00)'));
  assert.ok(playsHtml.includes('Total de la hora'));
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
  assert.ok(yearlyMs.includes('2023 — Madrugada: 2 min'));

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
  assert.ok(dash.includes('Final con código trackdone'));
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
  assert.ok(html.includes('Tiempo escuchado por hora y día'), 'wrapped clock uses ms');
});

test('detail views (artist, track, album): firstTrack, active months, clockMs, sparklines, time stats, and table limits', async () => {
  const model = await demoModel();
  const ar = model.artists.top.byPlays[0].id;
  const artistHtml = renderView('artist', model, ar);
  assert.ok(artistHtml.includes('Primera canción'));
  assert.ok(artistHtml.includes('Meses activos'));
  assert.ok(artistHtml.includes('data-table-limit="artist-tracks"'));
  assert.ok(artistHtml.includes('class="sparkline"'));
  assert.ok(artistHtml.includes('class="cell-metric-sub"'), 'canciones y álbumes en ficha de artista muestran también el tiempo escuchado');
  const artistMs = renderView('artist', model, ar, { metric: 'ms' });
  assert.ok(artistMs.includes('Tiempo escuchado por hora y día'));

  const tk = model.tracks.top.byPlays[0].tk;
  const trackHtml = renderView('track', model, tk);
  assert.ok(trackHtml.includes('Meses activos'));
  assert.ok(!trackHtml.includes('<dt>Meses activos</dt><dd>0</dd>'), 'track active months is populated and non-zero');
  assert.ok(trackHtml.includes('Duración media'));

  const ak = [...model.albums.byId.keys()][0];
  const albumHtml = renderView('album', model, ak);
  assert.ok(albumHtml.includes('data-table-limit="album-tracks"'));
  assert.ok(albumHtml.includes('class="sparkline"'));
  assert.ok(albumHtml.includes('reproducciones · '), 'encabezado de álbum muestra reproducciones y tiempo');
  assert.ok(albumHtml.includes('class="cell-metric-sub"'), 'canciones del álbum muestran también el tiempo escuchado');
});

test('table limits: resolveLimit reads ctx.limits Map, slices DOM rows, enables tall scroll at >=25, and preserves rankUI', async () => {
  const model = await demoModel();
  const limits = new Map([
    ['dash-skip-trk', 25],
    ['habits-deep', 50]
  ]);
  const dash = renderView('dashboard', model, null, {
    metric: 'ms',
    limits,
    rankUI: { tab: 'tracks', metric: 'ms', topN: 25, query: '' }
  });
  const skipSection = dash.slice(dash.indexOf('data-table-limit="dash-skip-trk"'));
  assert.ok(skipSection.slice(0, 300).includes('<option value="25" selected>Top 25</option>'), 'dash-skip-trk reflects limit 25 from Map');
  assert.ok(skipSection.slice(0, 600).includes('table-scroll--tall'), 'tall scroll enabled when limit >= 25');

  const obsSection = dash.slice(dash.indexOf('data-table-limit="dash-obsession"'), dash.indexOf('data-table-limit="dash-binge"'));
  assert.ok(!obsSection.includes('table-scroll--tall'), 'default Top 10 does not enable tall scroll');

  assert.ok(dash.includes('id="rank-tab-tracks" aria-selected="true"'), 'dashboard preserves rankUI.tab');
  assert.ok(dash.includes('<option value="25" selected>Top 25</option>'), 'dashboard preserves rankUI.topN');

  const habits = renderView('habits', model, null, { limits });
  const deepSection = habits.slice(habits.indexOf('data-table-limit="habits-deep"'));
  assert.ok(deepSection.slice(0, 300).includes('<option value="50" selected>Top 50</option>'), 'habits-deep reflects limit 50 from Map');
  const deepTbody = deepSection.slice(deepSection.indexOf('<tbody>'), deepSection.indexOf('</tbody>'));
  const renderedRows = (deepTbody.match(/<tr/g) || []).length;
  assert.ok(renderedRows > 10 && renderedRows <= 50, `DOM renders active slice (${renderedRows} rows)`);
});

test('mobile rankings (Option 1B), filter-dates alignment, habits NaN/undefined guard, and wrapped hero classes', async () => {
  const model = await demoModel();

  const rankHtml = rankCardHTML(model, { tab: 'artists', metric: 'ms' });
  assert.ok(rankHtml.includes('class="col-trend"'), 'desktop trend column marked with col-trend');
  assert.ok(rankHtml.includes('class="cell-metric-stack"'), 'metric cell stacks value + mobile sparkline (Option 1B)');
  assert.ok(rankHtml.includes('class="cell-spark-mobile"'), 'mobile sparkline wrapper present');
  assert.ok(rankHtml.includes('<span class="cell-name">'), 'artist names wrapped in .cell-name for ellipsis truncation');

  const bar = filterBarHTML(model, emptyFilterState());
  const details = bar.slice(bar.indexOf('<details'), bar.indexOf('</details>'));
  assert.equal((details.match(/class="filter-row filter-dates"/g) || []).length, 2, 'both Desde/Hasta and Año/Mes use 2-col filter-dates grid');

  const habits = renderView('habits', model);
  assert.ok(!habits.includes('NaN'), 'habits view has no NaN values');
  assert.ok(!habits.includes('undefined'), 'habits view has no undefined values');

  const wrapped = renderView('wrapped', model);
  assert.ok(wrapped.includes('class="hero-eyebrow"'), 'wrapped hero uses .hero-eyebrow from style.css');
  assert.ok(wrapped.includes('class="hero-title"'), 'wrapped hero uses .hero-title from style.css');
});

test('css polish: no left accent border on range/records/hero, full-width aligned tabs, scrollbar spacing, and z-index 3 on sticky # corner', async () => {
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const blockOf = (sel) => {
    const idx = css.indexOf(sel);
    assert.ok(idx >= 0, `selector ${sel} exists`);
    return css.slice(idx, css.indexOf('}', idx) + 1);
  };
  assert.ok(!blockOf('.view-range {').includes('border-left'), '.view-range has no left accent border');
  assert.ok(!blockOf('.record-item {').includes('border-left'), '.record-item has no left accent border');
  assert.ok(!blockOf('.hero-archetype {').includes('border-left'), '.hero-archetype has no left accent border');

  const tabsBtn = blockOf('.tabs button {');
  assert.ok(tabsBtn.includes('flex: 1 1 0'), '.tabs button distributes full width equally');
  assert.ok(tabsBtn.includes('justify-content: center'), '.tabs button centers its label');

  const tableScroll = blockOf('.table-scroll {');
  assert.ok(tableScroll.includes('var(--sp-3)'), '.table-scroll leaves bottom padding for scrollbar');
  const chartScroll = blockOf('.chart-scroll {');
  assert.ok(chartScroll.includes('padding-bottom: var(--sp-3)'), '.chart-scroll leaves bottom padding for scrollbar');

  const stickyLeftIdx = css.indexOf('.table-scroll table th:first-child');
  const tallCornerIdx = css.indexOf('.table-scroll--tall table thead th:first-child');
  assert.ok(tallCornerIdx > stickyLeftIdx, 'sticky # corner z-index: 3 declared after sticky-left rule');

  const rankTable = blockOf('.table-scroll table.rank-table {');
  assert.ok(rankTable.includes('width: 100%') && rankTable.includes('table-layout: fixed'), 'rank-table uses fixed 100% width without horizontal overflow');
});

test('all Top 10/25/50/100 tables include # column and tall scroll fits at least 10 rows (>= 38rem)', async () => {
  const baseModel = await demoModel();
  const ar = baseModel.artists.top.byPlays[0].id;
  const ak = [...baseModel.albums.byId.keys()][0];
  const model = {
    ...baseModel,
    transitions: {
      ...baseModel.transitions,
      top: [{ from: ar, to: ar, fromName: 'A', toName: 'A', count: 5, repeat: true }]
    },
    tables: {
      ...baseModel.tables,
      obsession: [{ tk: 1, name: 'T', artist: 'A', intensity: 3.5, days: new Set([1, 2]), plays: 20, ms: 60000 }],
      oneHitWonders: [{ id: ar, name: 'A', plays: 20, ms: 60000, share: 0.9, topTrack: { tk: 1, name: 'T', plays: 18 } }],
      forgotten: {
        artists: [{ id: ar, name: 'A', plays: 20, ms: 60000, lastTs: 1700000000 }],
        tracks: [{ tk: 1, name: 'T', artist: 'A', plays: 20, ms: 60000, lastTs: 1700000000 }]
      }
    }
  };
  const viewsToCheck = [
    ['dashboard', renderView('dashboard', model)],
    ['artist', renderView('artist', model, ar)],
    ['album', renderView('album', model, ak)],
    ['sessions', renderView('sessions', model)],
    ['discovery', renderView('discovery', model)],
    ['habits', renderView('habits', model)]
  ];

  let totalTopTables = 0;
  for (const [viewName, html] of viewsToCheck) {
    const matches = [...html.matchAll(/data-(?:table-limit|topn)(?:="([^"]*)")?/g)];
    for (const m of matches) {
      const key = m[1] || 'rank-topn';
      const afterSelect = html.slice(m.index);
      const tableStart = afterSelect.indexOf('<table');
      assert.ok(tableStart >= 0, `${viewName} (${key}) renders a <table>`);
      const tableEnd = afterSelect.indexOf('</table>', tableStart);
      const tableHtml = afterSelect.slice(tableStart, tableEnd);
      assert.ok(
        tableHtml.includes('<th scope="col" class="c">#</th>'),
        `${viewName} (${key}) has # as centered first column header`
      );
      if (/<tbody><tr[\s>]/.test(tableHtml)) {
        assert.ok(
          tableHtml.includes('<td class="c">1</td>'),
          `${viewName} (${key}) numbers rows starting at 1`
        );
      }
      totalTopTables++;
    }
  }
  assert.equal(totalTopTables, 25, 'all 25 Top 10/25/50/100 tables checked');

  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const tallIdx = css.indexOf('.table-scroll--tall {');
  const tallBlock = css.slice(tallIdx, css.indexOf('}', tallIdx) + 1);
  const maxH = tallBlock.match(/max-height:\s*(\d+(?:\.\d+)?)rem/);
  assert.ok(maxH && Number(maxH[1]) >= 38, `tall scroll max-height (${maxH?.[1]}rem) fits at least 10 rows without cutting at 7`);
  assert.ok(tallBlock.includes('padding-bottom: 0'), 'tall scroll removes bottom padding so 10-row height is exact');

  const mainJs = await readFile(new URL('../app/main.js', import.meta.url), 'utf8');
  assert.ok(mainJs.includes('function syncTallTables') && mainJs.includes('rows?.[9]'), 'main.js measures the 10th row (rows[9]) so tall scroll always shows 10 rows');
});

test('home page UI: conditional storage hierarchy, cache card with metadata & trash icon, clean drop-zone badges, Spotify help details, and left-aligned privacy pill', async () => {
  const { summaryFromMetaAndT } = await import('../app/storage.js');
  const { formatCacheMeta } = await import('../app/input.js');

  const summary = summaryFromMetaAndT(
    { count: 42300, tsMin: 1546300800, sources: ['a.json', 'b.json'] },
    new Int32Array([0, 220924800])
  );
  assert.deepEqual(summary, { count: 42300, fromYear: 2019, toYear: 2026, sourcesCount: 2 });
  assert.equal(formatCacheMeta(summary), 'Última carga: 42.300 reproducciones · 2019–2026');
  assert.equal(
    formatCacheMeta({ count: 1500, fromYear: 2024, toYear: 2024, sourcesCount: 1 }),
    'Última carga: 1.500 reproducciones · 2024'
  );

  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/style.css', import.meta.url), 'utf8');
  const inputJs = await readFile(new URL('../app/input.js', import.meta.url), 'utf8');

  assert.ok(html.includes('id="cache-card" class="cache-card" hidden'), 'cache-card hidden by default when no cached data exists');
  const cacheCardChunk = html.slice(html.indexOf('id="cache-card"'), html.indexOf('id="drop-zone"'));
  assert.ok(cacheCardChunk.includes('id="btn-cached"'), 'btn-cached lives inside cache-card');
  assert.ok(cacheCardChunk.includes('id="cache-meta"'), 'cache-meta lives inside cache-card');
  assert.ok(cacheCardChunk.includes('id="btn-cached-clear"'), 'trash delete button grouped inside cache-card on the right');

  const dropZoneChunk = html.slice(html.indexOf('id="drop-zone"'), html.indexOf('<div class="actions">'));
  assert.ok(dropZoneChunk.includes('Acepta <code>.zip</code> o múltiples <code>.json</code> de Spotify'), 'short single-line .zip and .json badges');
  assert.ok(!dropZoneChunk.includes('Streaming_History_Audio_'), 'long literal filename moved out of drop-zone');

  const actionsChunk = html.slice(html.indexOf('<div class="actions">'), html.indexOf('<p id="status"'));
  assert.ok(actionsChunk.includes('id="btn-upload-alt"') && actionsChunk.includes('hidden'), 'secondary upload button hidden by default and shown when cache exists');
  assert.ok(actionsChunk.includes('id="btn-demo"'), 'demo button in actions');
  assert.ok(inputJs.includes('zone.hidden = active'), 'drop-zone hidden when cache card is active (Tarjeta arriba + 2 botones)');

  assert.ok(html.includes('<details class="home-help">'), 'collapsible guide for downloading Spotify history');
  assert.ok(html.includes('¿Cómo descargo mi historial de Spotify?'), 'onboarding summary text present');
  assert.ok(html.includes('Historial de reproducción ampliado'), 'guide mentions extended streaming history');
  assert.ok(html.includes('100% local y offline:'), 'concise privacy pill copy');

  const blockOf = (sel) => {
    const idx = css.indexOf(sel);
    assert.ok(idx >= 0, `selector ${sel} exists in style.css`);
    return css.slice(idx, css.indexOf('}', idx) + 1);
  };

  assert.ok(!blockOf('.drop-zone-files {').includes('border-top'), 'no internal horizontal line inside dashed drop-zone');
  assert.ok(blockOf('.drop-zone-badge {').includes('rgba(29, 185, 84, 0.12)'), 'drop-zone badge has subtle green tint');
  assert.ok(blockOf('.drop-zone-icon {').includes('var(--accent)'), 'drop-zone icon uses green accent');
  assert.ok(blockOf('.privacy-note {').includes('text-align: left'), 'privacy pill left-aligned with lock on the left');
  assert.ok(!blockOf('#view-home {').includes('margin: auto'), '#view-home uses controlled top margin instead of margin: auto');
});
