// test/zip.test.js — adapter zip-bytes: expandir el zip de Spotify a ByteSources
//
// Fixtures: el propio buildZip del proyecto (export) como writer de referencia
// + zips mínimos artesanales para bordes que buildZip no produce (encriptado,
// método exótico, Zip64). Node ≥ 21.2: DecompressionStream('deflate-raw').

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildZip, crc32 } from '../src/export/zip.js';
import { zipSources } from '../src/parse/adapters/zip-bytes.js';
import { analyze } from '../src/analyze.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { syntheticJSON } from '../src/synthetic.js';

const encoder = new TextEncoder();
const UTC = fixedTz('utc', 0);

const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

async function readAll(src) {
  const chunks = [];
  for (;;) {
    const { done, value } = await src.next();
    if (done) break;
    chunks.push(value);
  }
  await src.close();
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// Bytes incompresibles (random criptográfico): buildZip cae a store (method 0).
function incompressible(n) {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// Zip mínimo de un store entry con flags/métodos arbitrarios (writer ajeno).
function craftZip({ name = 'Streaming_History_Audio_0.json', payload = encoder.encode('[]'), flags = 0, method = 0 }) {
  const nameBytes = encoder.encode(name);
  const crc = crc32(payload);
  const local = [
    ...u32(0x04034b50), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0),
    ...u32(crc), ...u32(payload.length), ...u32(payload.length),
    ...u16(nameBytes.length), ...u16(0), ...nameBytes, ...payload
  ];
  const centralOffset = local.length;
  const central = [
    ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0),
    ...u32(crc), ...u32(payload.length), ...u32(payload.length),
    ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
    ...u32(0), ...nameBytes
  ];
  const eocd = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1),
    ...u32(central.length), ...u32(centralOffset), ...u16(0)
  ];
  return new Uint8Array([...local, ...central, ...eocd]);
}

test('zip: expande Streaming_History_Audio y descarta el resto', async () => {
  const a = encoder.encode('[{"ts":"2024-01-01T10:00:00Z"}]');
  const b = encoder.encode('[{"ts":"2024-02-01T10:00:00Z"}]');
  const zip = await buildZip([
    { name: 'Streaming_History_Audio_2023.json', bytes: a },
    { name: 'Userdata.json', bytes: encoder.encode('{}') },
    { name: 'Covers/cover.jpg', bytes: incompressible(64) },
    { name: 'Streaming_History_Audio_2024.json', bytes: b }
  ]);
  const sources = await zipSources(new Blob([zip]));
  assert.equal(sources.length, 2);
  assert.equal(sources[0].label, 'Streaming_History_Audio_2023.json');
  assert.equal(sources[1].label, 'Streaming_History_Audio_2024.json');
  assert.equal(sources[0].totalBytes, a.length);
  assert.deepEqual(await readAll(sources[0]), a);
  assert.deepEqual(await readAll(sources[1]), b);
});

test('zip: entrada store (writer ajeno) round-trip exacto', async () => {
  const raw = incompressible(4096);
  const zip = craftZip({ payload: raw });
  const sources = await zipSources(new Blob([zip]));
  assert.equal(sources.length, 1);
  assert.deepEqual(await readAll(sources[0]), raw);
});

test('zip: subcarpeta MyData/ y patrón viejo StreamingHistory0.json', async () => {
  const a = encoder.encode('[1]');
  const b = encoder.encode('[2]');
  const zip = await buildZip([
    { name: 'MyData/Streaming_History_Audio_2024.json', bytes: a },
    { name: 'StreamingHistory0.json', bytes: b }
  ]);
  const sources = await zipSources(new Blob([zip]));
  assert.equal(sources.length, 2);
  assert.deepEqual(await readAll(sources[0]), a);
  assert.deepEqual(await readAll(sources[1]), b);
});

test('zip: sin entradas que matcheen → error con diagnóstico', async () => {
  const zip = await buildZip([{ name: 'Userdata.json', bytes: encoder.encode('{}') }]);
  await assert.rejects(() => zipSources(new Blob([zip])), (err) => {
    assert.equal(err.code, 'E_ZIP_NO_MATCH');
    assert.match(err.message, /Userdata\.json/);
    return true;
  });
});

test('zip: no es un zip → E_ZIP_FORMAT', async () => {
  await assert.rejects(() => zipSources(new Blob([incompressible(128)])), (err) => {
    assert.equal(err.code, 'E_ZIP_FORMAT');
    return true;
  });
});

test('zip: entrada encriptada → E_ZIP_ENCRYPTED', async () => {
  const zip = craftZip({ flags: 1 });
  await assert.rejects(() => zipSources(new Blob([zip])), (err) => {
    assert.equal(err.code, 'E_ZIP_ENCRYPTED');
    return true;
  });
});

test('zip: método no soportado → E_ZIP_METHOD', async () => {
  const zip = craftZip({ method: 12 });
  await assert.rejects(() => zipSources(new Blob([zip])), (err) => {
    assert.equal(err.code, 'E_ZIP_METHOD');
    return true;
  });
});

test('zip: marcador Zip64 → E_ZIP64', async () => {
  const zip = craftZip({});
  // EOCD con count 0xFFFF: el writer declaró Zip64 y no lo soportamos.
  const tail = [
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(0xFFFF), ...u16(0xFFFF),
    ...u32(0), ...u32(0), ...u16(0)
  ];
  const truncated = zip.slice(0, zip.length - 22);
  const patched = new Uint8Array([...truncated, ...tail]);
  await assert.rejects(() => zipSources(new Blob([patched])), (err) => {
    assert.equal(err.code, 'E_ZIP64');
    return true;
  });
});

test('zip: CRC corrupto en entrada store → E_ZIP_CRC', async () => {
  const raw = incompressible(2048);
  const zip = craftZip({ payload: raw });
  const corrupted = new Uint8Array(zip);
  corrupted[30 + 'Streaming_History_Audio_0.json'.length + 7] ^= 0xFF;
  const sources = await zipSources(new Blob([corrupted]));
  await assert.rejects(() => readAll(sources[0]), (err) => {
    assert.equal(err.code, 'E_ZIP_CRC');
    return true;
  });
});

test('e2e: analyze sobre el zip produce el mismo modelo que el JSON directo', async () => {
  const json = syntheticJSON(120, 7);
  const zip = await buildZip([{ name: 'MyData/Streaming_History_Audio_2024.json', bytes: encoder.encode(json) }]);
  const sources = await zipSources(new Blob([zip]));
  const fromZip = await analyze(sources, { tz: UTC, now: 1704067200 });
  const direct = await analyze([memoryBytes('direct.json', json)], { tz: UTC, now: 1704067200 });
  assert.equal(fromZip.meta.records, direct.meta.records);
  assert.equal(fromZip.totals.ms, direct.totals.ms);
  assert.equal(fromZip.meta.sources[0], 'MyData/Streaming_History_Audio_2024.json');
});

test('ZIP export falls back to store when deflate-raw is unsupported', async (t) => {
  t.mock.method(globalThis, 'CompressionStream', class {
    constructor() { throw new TypeError('unsupported format'); }
  });
  const payload = encoder.encode('repeated '.repeat(200));
  const zip = await buildZip([{ name: 'Streaming_History_Audio_0.json', bytes: payload }]);
  assert.equal(new DataView(zip.buffer).getUint16(8, true), 0);
  const [source] = await zipSources(new Blob([zip]));
  assert.deepEqual(await readAll(source), payload);
});

test('ZIP import explains the JSON alternative when deflate-raw is unsupported', async (t) => {
  const zip = await buildZip([{ name: 'Streaming_History_Audio_0.json', bytes: encoder.encode('repeated '.repeat(200)) }]);
  t.mock.method(globalThis, 'DecompressionStream', class {
    constructor() { throw new TypeError('unsupported format'); }
  });
  await assert.rejects(zipSources(new Blob([zip])), (err) => err.code === 'E_ZIP_UNSUPPORTED' && /JSON/.test(err.message));
});
