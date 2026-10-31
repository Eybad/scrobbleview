// Exercise the real parse → aggregate → render path at the HTML sink.
import test from 'node:test';
import assert from 'node:assert/strict';

import { renderView, VIEWS, rankCardHTML } from '../app/views.js';
import { analyze } from '../src/analyze.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';

const UTC = fixedTz('utc', 0);
const XSS = '<img src=x onerror=alert(1)>';
const XSS2 = '<img src=y onerror=alert(2)>';
const XSS3 = '<img src=z onerror=alert(3)>';

function jsonConPayload(n) {
  const events = [];
  for (let i = 0; i < n; i++) {
    events.push({
      ts: `2024-0${(i % 3) + 1}-1${i % 9}T1${i % 9}:30:00Z`,
      ms_played: 180000,
      master_metadata_track_name: i % 2 === 0 ? XSS : `canción ${i}`,
      master_metadata_album_artist_name: i % 3 === 0 ? XSS2 : `artista ${i % 5}`,
      master_metadata_album_album_name: i % 4 === 0 ? XSS3 : `álbum ${i % 3}`,
      spotify_track_uri: `spotify:track:${i}`,
      reason: 'playlist',

      reason_start: XSS,
      reason_end: XSS2,
      shuffle: false,
      incognito_mode: false,
    });
  }
  return JSON.stringify(events);
}

async function modelConPayload(n = 60) {
  return analyze(memoryBytes('x.json', jsonConPayload(n)), { tz: UTC, now: 1704067200 });
}

test('views-xss: el payload de los nombres sobrevive hasta el modelo (el test no es vacío)', () => {
  return modelConPayload().then((model) => {
    const names = [
      ...model.tracks.byId.values(),
      ...model.artists.byId.values(),
      ...model.albums.byId.values(),
    ].map((e) => e.name);
    assert.ok(names.some((n) => n === XSS), 'el payload debe llegar al modelo sin sanitizar');
    assert.ok(names.some((n) => n === XSS2), 'el payload de artista debe llegar al modelo');

    assert.equal(model.tracks.top.byPlays[0].name, XSS, 'el payload debe liderar el ranking de canciones');
    assert.equal(model.artists.top.byMs[0].name, XSS2, 'el payload debe liderar el top de artistas por tiempo');
    assert.ok(model.starts.has(XSS), 'reason_start debe llegar a model.starts');
    assert.ok(model.ends.has(XSS2), 'reason_end debe llegar a model.ends');
  });
});

test('views-xss: los nombres del usuario quedan escapados en todas las vistas', async () => {
  const model = await modelConPayload();
  for (const name of Object.keys(VIEWS)) {
    const html = renderView(name, model);
    assert.ok(!html.includes('<img src=x'), `la vista "${name}" no debe inyectar el payload crudo`);
    assert.ok(!html.includes('<img src=y'), `la vista "${name}" no debe inyectar el payload de artista`);
    assert.ok(!html.includes('<img src=z'), `la vista "${name}" no debe inyectar el payload de álbum`);
  }
  const cal = renderView('calendar', model, 2024);
  assert.ok(!cal.includes('<img src=x'), 'calendarView no debe inyectar el payload crudo');
  assert.ok(cal.includes('Calendario de actividad 2024'), 'el año de la ruta debe llegar al aria-label');

  const trackRanking = rankCardHTML(model, { tab: 'tracks' });
  assert.ok(trackRanking.includes('title="&lt;img src=x onerror=alert(1)&gt;"'), 'el title de canciones lleva el nombre escapado');
  assert.ok(!trackRanking.includes('title="<img'), 'ningún title de canciones lleva payload crudo');
  const albumRanking = rankCardHTML(model, { tab: 'albums' });
  assert.ok(albumRanking.includes('title="&lt;img src=z onerror=alert(3)&gt; — '), 'el title compuesto de álbumes empieza por el nombre escapado');
  assert.ok(!albumRanking.includes('title="<img'), 'ningún title de álbumes lleva payload crudo');
});

test('views-xss: las fichas por id también escapan (artist/track/album)', async () => {
  const model = await modelConPayload();
  const idOf = (map, name) => [...map.entries()].find(([, e]) => e.name === name)[0];
  const artistId = idOf(model.artists.byId, XSS2);
  const trackId = idOf(model.tracks.byId, XSS);
  const albumId = idOf(model.albums.byId, XSS3);
  for (const [name, id] of [['artist', artistId], ['track', trackId], ['album', albumId]]) {
    const html = renderView(name, model, id);
    assert.ok(!html.includes('<img src=x'), `ficha ${name}: sin payload crudo`);
    assert.ok(!html.includes('<img src=y'), `ficha ${name}: sin payload de artista crudo`);
    assert.ok(html.includes('&lt;img'), `ficha ${name}: el payload debe aparecer escapado`);
  }
});

test('views-xss: renderView con nombre desconocido escapa el nombre', () => {
  const html = renderView('<img src=x onerror=alert(1)>', null);
  assert.ok(!html.includes('<img'), 'sin tag inyectado');
  assert.ok(html.includes('&lt;img'), 'nombre de vista escapado');
});

test('views-xss: renderView bloquea prototype pollution y métodos heredados', () => {
  for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const html = renderView(name, null);
    assert.ok(html.includes('Vista desconocida'), `"${name}" no debe resolverse a una vista`);
  }
});
