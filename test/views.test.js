// test/views.test.js — contenido y estructura de las vistas (no escaping).
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderView } from '../app/views.js';
import { receiptText } from '../app/views.js';
import { rankCardHTML } from '../app/views.js';
import { chipsHTML, filterBarHTML, locToISODate, isoDateToDay } from '../app/filter-ui.js';
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
