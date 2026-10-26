// parse.test.js — red de seguridad del scanner y del pipeline de parseo

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse/parse.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { syntheticJSON } from '../src/synthetic.js';

function assertSameDataset(a, b, label) {
  assert.deepEqual(a.t, b.t, `${label}: t`);
  assert.deepEqual(a.m, b.m, `${label}: m`);
  assert.deepEqual(a.tr, b.tr, `${label}: tr`);
  assert.deepEqual(a.ar, b.ar, `${label}: ar`);
  assert.deepEqual(a.al, b.al, `${label}: al`);
  assert.deepEqual(a.rs, b.rs, `${label}: rs`);
  assert.deepEqual(a.re, b.re, `${label}: re`);
  assert.deepEqual(a.flags, b.flags, `${label}: flags`);
  assert.equal(a.meta.tsMin, b.meta.tsMin, `${label}: tsMin`);
  for (const k of ['tracks', 'artists', 'albums', 'reasons']) {
    assert.equal(a.dicts[k].size, b.dicts[k].size, `${label}: dict ${k} size`);
    for (let i = 0; i < a.dicts[k].size; i++) {
      assert.equal(a.dicts[k].get(i), b.dicts[k].get(i), `${label}: dict ${k}[${i}]`);
    }
  }
  assert.deepEqual(a.meta.warnings, b.meta.warnings, `${label}: warnings`);
}

test('split-invariance: mismo dataset para todo tamaño de chunk', async () => {
  const json = syntheticJSON(500, 7);
  const ref = await parse(memoryBytes('ref', json), { chunkBytes: 262144 });
  for (const chunkBytes of [1, 2, 7, 64, 4096, 262144]) {
    const ds = await parse(memoryBytes(`c${chunkBytes}`, json), { chunkBytes });
    assertSameDataset(ds, ref, `chunk ${chunkBytes}`);
  }
});

test('allowlist: ip_addr/conn_country/incognito/platform nunca se materializan', async () => {
  const json = JSON.stringify([{
    ts: '2021-01-01T00:00:00Z',
    ms_played: 1000,
    master_metadata_track_name: 'T',
    master_metadata_album_artist_name: 'A',
    master_metadata_album_album_name: 'Al',
    spotify_track_uri: 'spotify:track:x',
    ip_addr: '1.2.3.4',
    conn_country: 'AR',
    offline_timestamp: 123,
    incognito_mode: true,
    platform: 'android',
    user_agent_decrypted: 'ua'
  }]);
  const ds = await parse(memoryBytes('allow', json));
  assert.equal(ds.meta.count, 1);
  const allStrings = [
    ...ds.dicts.tracks.strings,
    ...ds.dicts.artists.strings,
    ...ds.dicts.albums.strings,
    ...ds.dicts.reasons.strings
  ].join('\n');
  assert.ok(!allStrings.includes('1.2.3.4'), 'ip_addr materializado');
  assert.ok(!allStrings.includes('conn_country'), 'conn_country materializado');
  assert.ok(!allStrings.includes('incognito'), 'incognito_mode materializado');
  assert.ok(!allStrings.includes('android'), 'platform materializado');
  assert.ok(!allStrings.includes('user_agent'), 'user_agent materializado');
});

test('episodios descartados con warning', async () => {
  const json = JSON.stringify([
    { ts: '2021-01-01T00:00:00Z', ms_played: 1000, master_metadata_track_name: 'T', spotify_track_uri: 'spotify:track:x' },
    { ts: '2021-01-01T01:00:00Z', ms_played: 5000, spotify_track_uri: 'spotify:episode:y' }
  ]);
  const ds = await parse(memoryBytes('ep', json));
  assert.equal(ds.meta.count, 1);
  assert.ok(ds.meta.warnings.some((w) => w.code === 'EPISODE'));
});

test('evento sin ts → descartado con warning', async () => {
  const json = JSON.stringify([
    { ms_played: 1000, master_metadata_track_name: 'T' },
    { ts: '2021-01-01T00:00:00Z', ms_played: 2000, master_metadata_track_name: 'T2' }
  ]);
  const ds = await parse(memoryBytes('nots', json));
  assert.equal(ds.meta.count, 1);
  assert.ok(ds.meta.warnings.some((w) => w.code === 'NO_TS'));
});

test('JSON malformado → ParseError con byteOffset', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "ms_played": 100,}]';
  await assert.rejects(parse(memoryBytes('bad', json)), (err) => {
    assert.equal(err.code, 'E_PARSE');
    assert.ok(typeof err.byteOffset === 'number' && err.byteOffset >= 0);
    return true;
  });
});

test('tipo incorrecto → SchemaError', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "ms_played": "mucho"}]';
  await assert.rejects(parse(memoryBytes('schema', json)), (err) => {
    assert.equal(err.code, 'E_SCHEMA');
    return true;
  });
});

test('campos opcionales ausentes → default (id 0 = vacío) + warning', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "ms_played": 1000, "master_metadata_track_name": "T"}]';
  const ds = await parse(memoryBytes('opt', json));
  assert.equal(ds.meta.count, 1);
  assert.equal(ds.ar[0], 0);
  assert.equal(ds.al[0], 0);
  assert.equal(ds.rs[0], 0);
  assert.equal(ds.re[0], 0);
});

test('ms_played ausente → m=0 + flag ms_unknown', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "master_metadata_track_name": "T"}]';
  const ds = await parse(memoryBytes('noms', json));
  assert.equal(ds.m[0], 0);
  assert.equal(ds.flags[0] & 8, 8);
});

test('ts parseo: ISO con Z, offset y fracción', async () => {
  const { parseISOToEpoch } = await import('../src/parse/impl/ts.js');
  const enc = new TextEncoder();
  assert.equal(parseISOToEpoch(enc.encode('1970-01-01T00:00:00Z')), 0);
  assert.equal(parseISOToEpoch(enc.encode('1970-01-01T00:00:00.000Z')), 0);
  assert.equal(parseISOToEpoch(enc.encode('1970-01-01T01:00:00+01:00')), 0);
  assert.equal(parseISOToEpoch(enc.encode('1970-01-01T23:00:00-01:00')), 86400); // 23:00 UTC-1 = 00:00 UTC del día siguiente
  assert.equal(parseISOToEpoch(enc.encode('2020-01-02T03:04:05Z')), 1577934245);
  assert.equal(parseISOToEpoch(enc.encode('no-es-fecha')), null);
});

// La columna t es Int32Array (columns.js): un epoch > 0x7FFFFFFF desborda en
// silencio al storear y derive.js calcula una fecha equivocada sin avisar.
// El límite es el tope de Int32, NO el año 2100: el epoch de 2100 ya lo excede.
test('ts parseo: epoch fuera del rango de Int32 → null (fail-fast, no wrap)', async () => {
  const { parseISOToEpoch } = await import('../src/parse/impl/ts.js');
  const enc = new TextEncoder();
  assert.equal(parseISOToEpoch(enc.encode('2038-01-19T03:14:07Z')), 2147483647); // tope exacto, se acepta
  assert.equal(parseISOToEpoch(enc.encode('2038-01-19T03:14:08Z')), null); // 1 s más: desborda
  assert.equal(parseISOToEpoch(enc.encode('2100-01-01T00:00:00Z')), null); // 4.1e9 > 0x7FFFFFFF
  assert.equal(parseISOToEpoch(enc.encode('9999-12-31T23:59:59Z')), null);
  // El offset puede empujar el epoch hacia arriba: 03:14:07 en UTC-14 rebasa el tope.
  assert.equal(parseISOToEpoch(enc.encode('2038-01-19T03:14:07-14:00')), null);
  // Y hacia abajo, aceptando el mismo instante UTC que la aserción de arriba
  // (local = UTC − 14 h, o sea 2038-01-18T13:14:07 local = 2038-01-19T03:14:07Z).
  assert.equal(parseISOToEpoch(enc.encode('2038-01-18T13:14:07-14:00')), 2147483647);
});

// Validación estricta del timestamp: dígitos ASCII, separadores, offset
// completo, rangos de offset y días reales por mes. Nunca devuelve NaN:
// un offset truncado ("-04") antes pasaba el chequeo `t === null` de parse.js
// como NaN y corrompía la columna t (Int32Array lo storea como 0).
test('ts parseo: validación estricta (nunca NaN, días reales, offset completo)', async () => {
  const { parseISOToEpoch } = await import('../src/parse/impl/ts.js');
  const enc = new TextEncoder();
  const t = (s) => parseISOToEpoch(enc.encode(s));
  // Offset truncado → null (no NaN).
  assert.equal(t('2020-01-02T03:04:05-04'), null);
  assert.equal(t('2020-01-02T03:04:05+02'), null);
  for (const bad of ['2020-01-02T03:04:05-04', '2020-01-02T03:04:05+02', '2020-01-02T03:04:05+']) {
    assert.ok(t(bad) === null, `${bad} debe ser null, nunca NaN`);
  }
  // No-dígitos y separadores inválidos.
  assert.equal(t('202A-01-02T03:04:05Z'), null);
  assert.equal(t('2020/01/02T03:04:05Z'), null);
  assert.equal(t('2020-01-02X03:04:05Z'), null);
  assert.equal(t('2020-01-02T03-04-05Z'), null);
  // El espacio como separador fecha/hora se acepta (variante habitual).
  assert.equal(t('2020-01-02 03:04:05Z'), 1577934245);
  // Offset fuera de rango.
  assert.equal(t('2020-01-02T03:04:05+24:00'), null);
  assert.equal(t('2020-01-02T03:04:05+02:60'), null);
  assert.equal(t('2020-01-02T03:04:05+2X:00'), null);
  // Días inexistentes (incluye bisiestos).
  assert.equal(t('2024-02-31T00:00:00Z'), null);
  assert.equal(t('2023-02-29T00:00:00Z'), null);
  assert.equal(t('2020-04-31T00:00:00Z'), null);
  assert.equal(t('2024-02-29T00:00:00Z'), 1709164800); // 2024 bisiesto: válido
  // Sanos siguen pasando (fracción + offset combinado también).
  assert.equal(t('2020-01-02T03:04:05.123Z'), 1577934245);
  assert.equal(t('1970-01-01T01:00:00.000+01:00'), 0);
});

test('interning: duplicados → mismo id; escapes → mismo id', async () => {
  const { Interner } = await import('../src/parse/impl/intern.js');
  const enc = new TextEncoder();
  const interner = new Interner();
  const a = interner.add(enc.encode('Canción'));
  const b = interner.add(enc.encode('Canción'));
  assert.equal(a, b);
  const c = interner.add(enc.encode('Canci\\u00f3n'));
  assert.equal(c, a);
  assert.equal(interner.get(a), 'Canción');
  assert.equal(interner.get(0), '');
});

// fromParts rehidrata desde la caché IndexedDB. count ya se acota contra la
// longitud de los arrays, pero los RANGOS de bytes no: keys.subarray(start, end)
// recorta en silencio y una caché corrupta entraría como entidad truncada o vacía
// en vez de caer en el miss (storage.js:146 devuelve null ante excepción).
test('interning: caché corrupta → RangeError, no entidad truncada', async () => {
  const { Interner } = await import('../src/parse/impl/intern.js');
  const keys = new Uint8Array([65, 66, 67]);
  // offsets[1] + lengths[1] = 99 > keys.length = 3
  const corrupt = { keys, offsets: new Uint32Array([0, 2]), lengths: new Uint32Array([1, 97]), count: 2 };
  assert.throws(() => Interner.fromParts(corrupt), RangeError);
  // length que se sale por el mismo motivo, con start válido
  assert.throws(
    () => Interner.fromParts({ keys, offsets: new Uint32Array([0, 0]), lengths: new Uint32Array([1, 4]), count: 2 }),
    RangeError,
  );
  // Sanity: el caso bien formado NO lanza y rehidrata las claves tal cual.
  // (fromParts no reserva el id 0 para la cadena vacía: ese caso está en
  // insert(); aquí las claves vienen tal cual de la caché serializada.)
  const ok = Interner.fromParts({ keys, offsets: new Uint32Array([0, 1]), lengths: new Uint32Array([1, 2]), count: 2 });
  assert.equal(ok.size, 2);
  assert.equal(ok.get(0), 'A');
  assert.equal(ok.get(1), 'BC');
});

test('archivo vacío → EmptyFileError', async () => {
  await assert.rejects(parse(memoryBytes('empty', '[]')), (err) => err.code === 'E_EMPTY');
});

// Spotify puede agregar campos con objetos/arrays anidados en el futuro: si la
// clave no está en el ALLOWLIST, el scanner debe saltar el subárbol completo
// (con contador de profundidad, respetando strings/escapes internos) en vez de
// fallar con "Se esperaba valor". Incluye llaves dentro de strings y corte
// a mitad del subárbol (chunkBytes chico) para la invariancia entre chunks.
test('clave desconocida con objeto/array anidado → se ignora, el evento pasa', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "ms_played": 1000, "master_metadata_track_name": "T", "spotify_track_uri": "spotify:track:1", "futuro": {"a": [1, {"b": "x } y"}], "c": "ho}la", "q": "a\\"b"}, "lista": [1, 2, {"z": "}"}]}]';
  for (const chunkBytes of [262144, 7]) {
    const ds = await parse(memoryBytes('nested', json), { chunkBytes });
    assert.equal(ds.meta.count, 1);
    assert.equal(ds.m[0], 1000);
    assert.equal(ds.dicts.tracks.get(ds.tr[0]), 'T');
  }
});

// Un ms_played negativo (JSON manipulado) antes se storeaba tal cual en
// Uint32Array: -1 → 4294967295 (~49,7 días en una pista). Ahora se acota a 0
// con warning BAD_MS y el evento se conserva (cuenta como reproducción).
test('ms_played negativo o imposible → m=0 + warning BAD_MS', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "ms_played": -5, "master_metadata_track_name": "A", "spotify_track_uri": "spotify:track:1"}, {"ts": "2021-01-01T00:01:00Z", "ms_played": 100000000000, "master_metadata_track_name": "B", "spotify_track_uri": "spotify:track:2"}, {"ts": "2021-01-01T00:02:00Z", "ms_played": 1000, "master_metadata_track_name": "C", "spotify_track_uri": "spotify:track:3"}]';
  const ds = await parse(memoryBytes('badms', json));
  assert.equal(ds.meta.count, 3);
  assert.equal(ds.meta.warnings.filter((w) => w.code === 'BAD_MS').length, 2);
  let total = 0;
  for (let i = 0; i < ds.meta.count; i++) total += ds.m[i];
  assert.equal(total, 1000);
});

// Con varias fuentes, el error debe decir QUÉ archivo falló.
test('ParseError incluye el label del archivo que falló', async () => {
  const json = '[{"ts": "2021-01-01T00:00:00Z", "ms_played": 100,]';
  await assert.rejects(parse(memoryBytes('mi-archivo.json', json)), (err) => {
    assert.equal(err.code, 'E_PARSE');
    assert.ok(String(err.message).includes('mi-archivo.json'));
    return true;
  });
});

test('archivo que no es array → ParseError', async () => {
  await assert.rejects(parse(memoryBytes('obj', '{"a":1}')), (err) => err.code === 'E_PARSE');
});

test('node-fs-bytes: lee un archivo real', async () => {
  const { nodeFsBytes } = await import('../src/parse/adapters/node-fs-bytes.js');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('./fixtures/sample.json', import.meta.url));
  const ds = await parse(nodeFsBytes(path));
  assert.equal(ds.meta.count, 2);
  assert.equal(ds.meta.sources[0], path);
});

test('progreso: onProgress reporta avance', async () => {
  const json = syntheticJSON(100, 3);
  const seen = [];
  await parse(memoryBytes('prog', json), {
    chunkBytes: 1024,
    onProgress: (frac, label) => seen.push([frac, label])
  });
  assert.ok(seen.length > 0);
  assert.equal(seen[seen.length - 1][0], 1);
  assert.equal(seen[seen.length - 1][1], 'prog');
});

test('strict JSON grammar agrees with JSON.parse across chunk boundaries', async () => {
  const event = '{"ts":"2024-01-01T10:03:00Z","master_metadata_track_name":"T","ms_played":1000}';
  const invalid = [
    `[,${event}]`, `[${event}${event}]`, `[${event},,${event}]`,
    `[${event.replace('1000', '1x')}]`, `[${event.replace('1000', '01')}]`,
    `[${event.replace('1000', '1.')}]`, `[${event.replace('1000', '1e+')}]`,
    `[${event.replace('"T"', '"\\q"')}]`, `[${event.replace('"T"', '"\\u00xz"')}]`,
    `[${event.replace('"T"', '"line\nbreak"')}]`,
    `[${event.slice(0, -1)},"ignored": {"x": [1 2]}}]`,
    `[${event.slice(0, -1)},"ignored": {"x": [1,]}}]`,
    `[${event.slice(0, -1)},"ignored": {"x": tru}}]`,
    `[${event.slice(0, -1)},"ignored": "\\q"}]`
  ];
  for (const json of invalid) {
    assert.throws(() => JSON.parse(json), SyntaxError);
    for (const chunkBytes of [1, 7, 262144]) {
      await assert.rejects(parse(memoryBytes('invalid', json), { chunkBytes }),
        (err) => err.code === 'E_PARSE' && Number.isInteger(err.byteOffset), json);
    }
  }
  for (const value of [null, false, -1.25e2, [], {}, { nested: [true, null, 'x\\y', '\ud800'] }]) {
    const json = `[${event.slice(0, -1)},"ignored":${JSON.stringify(value)}}]`;
    assert.equal(JSON.parse(json).length, 1);
    const ds = await parse(memoryBytes('valid', json), { chunkBytes: 1 });
    assert.equal(ds.meta.count, 1);
    assert.equal(ds.m[0], 1000);
  }
});

test('escaped field names and track identities use decoded JSON strings', async () => {
  const names = ['\\u0041', 'A', '\ufffd', '\ud800', '\ud801'];
  const events = names.map((name) => ({ ts: '2024-01-01T10:03:00Z', master_metadata_track_name: name }));
  let json = JSON.stringify(events);
  json = json.replace('"ts"', '"\\u0074s"').replace('"A"', '"\\u0041"');
  const ds = await parse(memoryBytes('canonical', json), { chunkBytes: 1 });
  assert.deepEqual(Array.from(ds.tr, (id) => ds.dicts.tracks.get(id)), names);
  assert.equal(new Set(ds.tr).size, names.length);
});

test('invalid timestamp digits and suffixes are reported as BAD_TS', async () => {
  const invalid = ['2024-01-01Txx:03:00Z', '2024-01-01T10:xx:00Z',
    '2024-01-01T10:03:xxZ', '2024-01-01T10:03:00Zjunk',
    '2024-01-01T10:03:00+01:00junk', '2024-01-01T10:03:60Z'];
  const events = [...invalid, '2024-01-01T10:03:00Z'].map((ts) => ({ ts, master_metadata_track_name: 'T' }));
  const ds = await parse(memoryBytes('timestamps', JSON.stringify(events)), { chunkBytes: 1 });
  assert.equal(ds.meta.count, 1);
  assert.equal(ds.meta.warnings.filter((w) => w.code === 'BAD_TS').length, invalid.length);
});

test('input budgets and cancellation fail atomically and close the source', async () => {
  const json = '[{"ts":"2024-01-01T00:00:00Z","master_metadata_track_name":"T"}]';
  for (const [options, code] of [
    [{ maxBytes: 8 }, 'E_LIMIT_BYTES'], [{ maxEvents: 1 }, 'E_LIMIT_EVENTS'],
    [{ maxTokenBytes: 3 }, 'E_LIMIT_TOKEN'], [{ maxDepth: 1 }, 'E_LIMIT_DEPTH']
  ]) {
    let closed = false;
    const source = memoryBytes('limited', options.maxEvents ? json.replace('}]', '},{"ts":"2024-01-02T00:00:00Z","master_metadata_track_name":"U"}]') : json);
    source.close = async () => { closed = true; };
    await assert.rejects(parse(source, options), (err) => err.code === code);
    assert.equal(closed, true);
  }
  const controller = new AbortController();
  await assert.rejects(parse(memoryBytes('cancelled', json), {
    signal: controller.signal,
    onProgress() { controller.abort(); }
  }), (err) => err.code === 'E_ABORT');
});

test('overlapping sources are reported without deleting legitimate events', async () => {
  const json = JSON.stringify([{ ts: '2024-01-01T00:00:00Z', master_metadata_track_name: 'T', ms_played: 180000 }]);
  const ds = await parse([memoryBytes('first', json), memoryBytes('second', json)]);
  assert.equal(ds.meta.count, 2);
  assert.ok(ds.meta.warnings.some((warning) => warning.code === 'OVERLAPPING_SOURCES'));
});
