// test/export.test.js — export del modelo: JSON plano + ZIP de CSVs.
import test from 'node:test';
import assert from 'node:assert/strict';

import { modelToJSON, exportFilename, modelToTables } from '../src/export.js';
import { csvField, toCSV } from '../src/export/csv.js';
import { crc32, buildZip } from '../src/export/zip.js';
import { analyze } from '../src/analyze.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { syntheticJSON } from '../src/synthetic.js';

const UTC = fixedTz('utc', 0);

async function demoModel() {
  return analyze(memoryBytes('demo.json', syntheticJSON(800, 9)), { tz: UTC, now: 1704067200 });
}

function hasNonPlain(v, seen = new Set()) {
  if (v instanceof Map || v instanceof Set || ArrayBuffer.isView(v)) return true;
  if (v && typeof v === 'object') {
    if (seen.has(v)) return false;
    seen.add(v);
    return Object.values(v).some((x) => hasNonPlain(x, seen));
  }
  return false;
}

test('export: sobre con formato/versión y totales intactos', async () => {
  const model = await demoModel();
  const out = modelToJSON(model, { now: 1704067200 });
  assert.equal(out.format, 'scrobbleview-export');
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, 1704067200);
  assert.equal(out.model.totals.records, model.totals.records);
  assert.equal(out.model.totals.ms, model.totals.ms);
  assert.equal(Object.keys(out.model.artists.byId).length, model.artists.byId.size);
  assert.equal(Object.keys(out.model.tracks.byId).length, model.tracks.byId.size);
});

test('export: todo plano y serializable (sin Map/Set/typed arrays)', async () => {
  const model = await demoModel();
  const out = modelToJSON(model, { now: 1704067200 });
  assert.ok(!hasNonPlain(out), 'sin Map, Set ni vistas tipadas');
  const round = JSON.parse(JSON.stringify(out));
  assert.equal(round.model.totals.records, model.totals.records);
  assert.ok(round.model.cols.t.length > 0, 'columnas presentes');
});

test('export: nombre de archivo determinista', () => {
  assert.equal(exportFilename(1704067200), 'scrobbleview-20240101-000000.json');
});

test('csv: escaping de comillas, comas, saltos y valores nulos', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('a"b'), '"a""b"');
  assert.equal(csvField('a\nb'), '"a\nb"');
  assert.equal(csvField(42), '42');
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('csv: prefijos de fórmula neutralizados (CSV injection, OWASP)', () => {
  assert.equal(csvField('=WEBSERVICE("x")'), '"\'=WEBSERVICE(""x"")"');
  assert.equal(csvField('+cmd'), "'+cmd");
  assert.equal(csvField('@x'), "'@x");
  assert.equal(csvField('\tTab'), "'\tTab");
  assert.equal(csvField(-1), '-1', 'los números nunca son fórmulas');
  assert.equal(csvField('42'), '42');
});

test('csv: toCSV arma filas CRLF (RFC 4180)', () => {
  const csv = toCSV(['a', 'b'], [['1', 'x'], ['2', 'y,z']]);
  assert.equal(csv, 'a,b\r\n1,x\r\n2,"y,z"');
});

test('zip: crc32 contra vectores conocidos', () => {
  const bytes = (s) => new TextEncoder().encode(s);
  assert.equal(crc32(bytes('123456789')), 0xCBF43926);
  assert.equal(crc32(bytes('')), 0);
  assert.equal(crc32(bytes('The quick brown fox jumps over the lazy dog')), 0x414FA339);
});

test('zip: contenedor con firmas y offsets correctos', async () => {
  const name = 'tracks.csv';
  const data = new TextEncoder().encode('hola,mundo');
  const zip = await buildZip([{ name, bytes: data }]);
  const u8 = new Uint8Array(zip.buffer, zip.byteOffset, zip.byteLength);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const sig = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  assert.equal(sig(0), 'PK\x03\x04', 'firma del local header');
  assert.equal(dv.getUint16(8, true) === 8 || dv.getUint16(8, true) === 0, true, 'método deflate o store');
  assert.equal(dv.getUint32(14, true), crc32(data), 'CRC del dato sin comprimir');
  assert.equal(dv.getUint16(26, true), name.length, 'largo del nombre');
  assert.equal(sig(u8.length - 22), 'PK\x05\x06', 'EOCD al final (sin comentario)');
  assert.ok(String.fromCharCode(...u8.slice(30, -22)).includes('PK\x01\x02'), 'central directory presente');
});

test('zip: round-trip del contenido comprimido', async () => {
  if (typeof CompressionStream !== 'function' || typeof DecompressionStream !== 'function') return;
  // Payload repetido: deflate de un string corto agranda (overhead) y caería
  // al fallback store, que es el comportamiento correcto pero no este test.
  const data = new TextEncoder().encode('hola,mundo\n'.repeat(100));
  const zip = await buildZip([{ name: 'a.csv', bytes: data }]);
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  assert.equal(dv.getUint16(8, true), 8, 'deflate-raw cuando la API existe');
  const compSize = dv.getUint32(18, true);
  const nameLen = dv.getUint16(26, true);
  const payload = zip.slice(30 + nameLen, 30 + nameLen + compSize);
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  assert.equal(await new Response(stream).text(), new TextDecoder().decode(data));
});

test('export: modelToTables aplana el modelo a tablas relacionales', async () => {
  const model = await demoModel();
  const tables = modelToTables(model);
  const byName = new Map(tables.map((t) => [t.name, t]));
  for (const n of ['artists', 'tracks', 'albums', 'sessions', 'monthly']) {
    assert.ok(byName.has(n), `tabla ${n} presente`);
  }
  const artists = byName.get('artists');
  assert.equal(artists.rows.length, model.artists.byId.size, 'una fila por artista');
  assert.ok(artists.headers.includes('name') && artists.headers.includes('plays'), 'columnas de artista');
  const tracks = byName.get('tracks');
  assert.ok(tracks.headers.includes('artist_id'), 'clave foránea de artista');
  assert.equal(tracks.rows.length, model.tracks.byId.size, 'una fila por canción');
  const sessions = byName.get('sessions');
  assert.equal(sessions.rows.length, model.sessions.length, 'una fila por sesión');
  const monthly = byName.get('monthly');
  assert.equal(monthly.rows.length, model.monthly.size, 'una fila por mes');
});

test('export: artist_id de albums es el artista (parte alta de ak)', async () => {
  // Dos álbumes del mismo artista: el segundo tiene al=2 con ar=1
  // (ak = 1*2^32 + 2). En el demo ar === al siempre (mismo orden de interning).
  const model = await analyze(memoryBytes('ak.json', JSON.stringify([
    { ts: '2024-06-01T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'A', master_metadata_album_artist_name: 'X', master_metadata_album_album_name: 'Á1', spotify_track_uri: 'spotify:track:1' },
    { ts: '2024-06-02T14:00:00Z', ms_played: 60000, master_metadata_track_name: 'B', master_metadata_album_artist_name: 'X', master_metadata_album_album_name: 'Á2', spotify_track_uri: 'spotify:track:2' }
  ])), { tz: UTC, now: 1704067200 });
  const albums = modelToTables(model).find((t) => t.name === 'albums');
  const row = albums.rows.find(([ak]) => Math.floor(ak / 4294967296) !== ak % 4294967296);
  assert.ok(row, 'hay álbumes con artista ≠ id de álbum');
  assert.equal(row[1], Math.floor(row[0] / 4294967296), 'artist_id = ar');
});

test('CSV tables preserve album-track attribution without assigning global totals to one album', async () => {
  const model = await analyze(memoryBytes('albums.json', JSON.stringify([
    ['2024-01-01T12:00:00Z', 'Album A', 'spotify:track:1'],
    ['2024-02-01T12:00:00Z', 'Album B', 'spotify:track:2']
  ].map(([ts, album, spotify_track_uri]) => ({
    ts, spotify_track_uri, ms_played: 180000,
    master_metadata_track_name: 'Shared',
    master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: album
  })))), { tz: UTC, now: 1704067200 });
  const tables = new Map(modelToTables(model).map(table => [table.name, table]));
  const tracks = tables.get('tracks');
  const record = Object.fromEntries(tracks.headers.map((header, index) => [header, tracks.rows[0][index]]));
  assert.equal(record.plays, 2);
  assert.equal(record.ms, 360000);
  assert.equal(record.album_id, 0);
  const albumTracks = tables.get('album_tracks');
  assert.ok(albumTracks, 'album-track relation is exported');
  const rows = albumTracks.rows.map(row => Object.fromEntries(albumTracks.headers.map((header, index) => [header, row[index]])));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.album_id, row.track_id, row.plays, row.ms]), [
    [4294967297, 4294967297, 1, 180000],
    [4294967298, 4294967297, 1, 180000]
  ]);
});
