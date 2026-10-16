// test/views-xss.test.js — guardia de escaping de la capa de vistas.
// El sink final es appRoot.innerHTML = renderView(...) en app/main.js; las
// funciones de app/views.js arman el HTML que llega ahí e inyectan nombres de
// artista/canción/álbum que vienen de los datos del usuario.
//
// El test usa el camino real completo (parse → aggregate → render) con el
// payload inyectado como nombre en el JSON de entrada: eso cubre tanto el
// escaping de las vistas como el hecho de que el payload sobreviva intacto
// hasta el HTML (si el parser lo sanitizara, el test no probaría nada).
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

// Un JSON de historial con los TRES nombres del usuario reemplazados por el
// payload: artista, canción y álbum aparecen en casi todas las vistas.
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
      // reason_start/reason_end alimentan model.starts/model.ends, que son el
      // ÚNICO camino donde un string arbitrario del JSON entra como label de
      // barChart de sessionsView — la función que tenía el bug de doble
      // escape. Sin estas claves ese sink no se recorre end-to-end.
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
  // Guarda contra un test que pase por digestión: si el parser o el aggregate
  // sanitizaran el nombre, las aserciones de escaping de abajo no probarían nada.
  // Cubre también las LISTAS de las que dependen los tests 2 y 3 (no solo los
  // Map byId): si el payload no llegara al top, esos tests pasarían por vacío.
  return modelConPayload().then((model) => {
    const names = [
      ...model.tracks.byId.values(),
      ...model.artists.byId.values(),
      ...model.albums.byId.values(),
    ].map((e) => e.name);
    assert.ok(names.some((n) => n === XSS), 'el payload debe llegar al modelo sin sanitizar');
    assert.ok(names.some((n) => n === XSS2), 'el payload de artista debe llegar al modelo');

    // Rankings (rankCardHTML) y wrappedView.
    assert.equal(model.tracks.top.byPlays[0].name, XSS, 'el payload debe liderar el ranking de canciones');
    assert.equal(model.artists.top.byMs[0].name, XSS2, 'el payload debe liderar el top de artistas por tiempo');
    // reason_start/reason_end → model.starts/ends → barChart de sessionsView.
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
  // Además del loop, la vista del calendario CON año (calendarView), que el
  // loop no alcanza: sin id cae en calendarIndexView. El calendario no muestra
  // nombres, así que el payload no debe aparecer; lo que se ejercita aquí es el
  // paso del año de la ruta al aria-label del grid.
  const cal = renderView('calendar', model, 2024);
  assert.ok(!cal.includes('<img src=x'), 'calendarView no debe inyectar el payload crudo');
  assert.ok(cal.includes('Calendario de actividad 2024'), 'el año de la ruta debe llegar al aria-label');

  // El ranking de canciones renderiza el nombre solo (title = nombre); el de
  // álbumes conserva el title compuesto "álbum — artista". Ambos llevan datos
  // del usuario dentro de un atributo HTML: asertar el escape en cada forma,
  // no solo en el nombre pelado.
  const trackRanking = rankCardHTML(model, { tab: 'tracks' });
  assert.ok(trackRanking.includes('title="&lt;img src=x onerror=alert(1)&gt;"'), 'el title de canciones lleva el nombre escapado');
  assert.ok(!trackRanking.includes('title="<img'), 'ningún title de canciones lleva payload crudo');
  const albumRanking = rankCardHTML(model, { tab: 'albums' });
  assert.ok(albumRanking.includes('title="&lt;img src=z onerror=alert(3)&gt; — '), 'el title compuesto de álbumes empieza por el nombre escapado');
  assert.ok(!albumRanking.includes('title="<img'), 'ningún title de álbumes lleva payload crudo');
});

test('views-xss: las fichas por id también escapan (artist/track/album)', async () => {
  const model = await modelConPayload();
  // Buscar el id POR NOMBRE, no por posición: el orden de inserción de byId hoy
  // es de primer encuentro, pero si el agregado pre-dimensiona u ordena los
  // Map, tomar [0] haría que la aserción de abajo pasara por otro payload.
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
