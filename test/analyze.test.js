// analyze.test.js — e2e de la fachada con fixtures sintéticos
//
// La demo reusa estos fixtures (mismo tipo de datos que el parser consume).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { syntheticJSON } from '../src/synthetic.js';

const UTC = fixedTz('utc', 0);

test('e2e: analyze sobre un archivo sintético produce un modelo consistente', async () => {
  const src = memoryBytes('sintetico.json', syntheticJSON(500, 1));
  const m = await analyze(src, { tz: UTC });
  assert.equal(m.meta.records, 500);
  assert.equal(m.totals.records, 500);
  assert.ok(m.totals.ms > 0);
  assert.ok(m.artists.byId.size > 0);
  assert.ok(m.tracks.byId.size > 0);
  assert.ok(m.albums.byId.size > 0);
  assert.equal(m.sessionsStats.count, m.sessions.length);
  assert.ok(m.tables.artists.byPlays.length > 0);
  assert.deepEqual(m.meta.sources, ['sintetico.json']);
  // Consistencia: la suma de ms por canción = total.
  let sum = 0;
  for (const t of m.tracks.byId.values()) sum += t.ms;
  assert.equal(sum, m.totals.ms);
});

test('e2e: múltiples fuentes comparten dicts (misma canción → una entrada)', async () => {
  const row = (ts, ms) => ({
    ts, ms_played: ms,
    master_metadata_track_name: 'A',
    master_metadata_album_artist_name: 'X',
    master_metadata_album_album_name: 'AL',
    spotify_track_uri: 'spotify:track:1',
    reason_start: 'clickrow', reason_end: 'trackdone',
    shuffle: false, skipped: false, offline: false
  });
  const m = await analyze([
    memoryBytes('a.json', JSON.stringify([row('2024-01-01T00:00:00Z', 60000)])),
    memoryBytes('b.json', JSON.stringify([row('2024-01-02T00:00:00Z', 120000)]))
  ], { tz: UTC });
  assert.equal(m.meta.records, 2);
  assert.equal(m.tracks.byId.size, 1);
  const t = [...m.tracks.byId.values()][0];
  assert.equal(t.plays, 2);
  assert.equal(t.ms, 180000);
  assert.deepEqual(m.meta.sources, ['a.json', 'b.json']);
});

test('progreso: onProgress reporta avance en [0,1] y termina en 1', async () => {
  const src = memoryBytes('s.json', syntheticJSON(200, 2));
  const calls = [];
  await analyze(src, { tz: UTC, onProgress: (p, label) => calls.push([p, label]) });
  assert.ok(calls.length > 0);
  assert.ok(calls.every(([p]) => p >= 0 && p <= 1));
  assert.equal(calls[calls.length - 1][0], 1);
});

test('minMs override: playsSignificant cuenta todo con minMs=0', async () => {
  const src = memoryBytes('s.json', syntheticJSON(100, 3));
  const m = await analyze(src, { tz: UTC, minMs: 0 });
  assert.equal(m.totals.playsSignificant, 100);
});

test('determinismo: analyze dos veces → mismo modelo', async () => {
  const src = () => memoryBytes('s.json', syntheticJSON(300, 4));
  // now fijo: sin él, generatedAt usa Date.now() y dos llamadas pueden cruzar
  // el límite de segundo bajo carga (test flaky).
  const a = await analyze(src(), { tz: UTC, now: 1704067200 });
  const b = await analyze(src(), { tz: UTC, now: 1704067200 });
  assert.deepStrictEqual(a, b);
});

test('sin tz → TypeError', async () => {
  const src = memoryBytes('s.json', syntheticJSON(10, 5));
  await assert.rejects(() => analyze(src, {}), /tz/);
});