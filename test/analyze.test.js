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
test('unknown durations and flags stay separate from zero and false', async () => {
  const { parse } = await import('../src/parse/parse.js');
  const { aggregate } = await import('../src/aggregate/aggregate.js');
  const { applyFilters, emptyFilterState } = await import('../src/filters.js');
  const { peek } = await import('../src/parse/dataset.js');
  const { filterParams, paramsToFilterState, filterBarHTML } = await import('../app/filter-ui.js');
  const rows = [
    { ms_played: null, offline: null, skipped: null, shuffle: null },
    { ms_played: 0, offline: false, skipped: false, shuffle: false },
    { ms_played: 60000, offline: true, skipped: true, shuffle: true },
    { ms_played: -1 }
  ].map((fields, i) => ({ ts: `2024-01-0${i + 1}T10:00:00Z`, master_metadata_track_name: 'T',
    master_metadata_album_artist_name: 'A', ...fields }));
  const ds = await parse(memoryBytes('unknown', JSON.stringify(rows)));
  const model = aggregate(ds, { tz: UTC, minMs: 0 });
  const { serialize, deserialize } = await import('../app/storage.js');
  assert.equal(peek(deserialize(serialize(ds)), 0).offline, null);
  assert.throws(() => deserialize({}), /Caché incompatible/);
  assert.equal(peek(ds, 0).offline, null);
  assert.equal(peek(ds, 1).offline, false);
  assert.equal(model.totals.durationKnown, 2);
  assert.equal(model.totals.durationUnknown, 2);
  assert.equal(model.totals.avgMs, 30000);
  assert.equal(model.totals.medianMs, 30000);
  assert.equal(model.totals.msDist.reduce((n, b) => n + b.count, 0), 2);
  assert.equal(model.totals.playsSkipped, 1);
  assert.equal(model.totals.playsSignificant, 2);
  assert.equal(model.totals.offlineKnown, 2);
  const track = [...model.tracks.byId.values()][0];
  assert.equal(track.skipKnown, 2);
  assert.equal(track.durationKnown, 2);
  const { trackView } = await import('../app/views.js');
  assert.match(trackView(model, track.tk), /<dt>Duración media<\/dt>\s*<dd>30\.0s/);
  assert.match(trackView(model, track.tk), /2 duraciones desconocidas/);
  for (const field of ['skip', 'shuffle', 'offline']) {
    assert.deepEqual([...applyFilters(ds, { ...emptyFilterState(), [field]: false }, UTC).indices], [1]);
    assert.deepEqual([...applyFilters(ds, { ...emptyFilterState(), [field]: true }, UTC).indices], [2]);
    const state = { ...emptyFilterState(), [field]: 'unknown' };
    assert.deepEqual([...applyFilters(ds, state, UTC).indices], [0, 3]);
    assert.equal(paramsToFilterState(filterParams(state))[field], 'unknown');
    assert.match(filterBarHTML(model, state), /value="unknown" selected>Desconocido/);
  }
});

test('facade and aggregation share defaults and session options for parsed datasets', async () => {
  const { parse } = await import('../src/parse/parse.js');
  const ds = await parse(memoryBytes('options', JSON.stringify([
    { ts: '2024-01-01T10:00:00Z', ms_played: 2000, master_metadata_track_name: 'T' },
    { ts: '2024-01-01T10:05:00Z', ms_played: 2000, master_metadata_track_name: 'T' }
  ])));
  const defaults = await analyze(ds, { tz: UTC });
  assert.equal(defaults.sessionsStats.count, 1);
  assert.equal(defaults.totals.playsSignificant, 0);
  const custom = await analyze(ds, { tz: UTC, sessionGapMinutes: 1, minMs: 1000, skipThresholdMs: 1000 });
  assert.equal(custom.sessionsStats.count, 2);
  assert.equal(custom.sessionsStats.gapMinutes, 1);
  assert.equal(custom.totals.playsSignificant, 2);
  assert.equal(custom.totals.playsSkipped, 0);
  await assert.rejects(analyze(memoryBytes('invalid', '[]'), { tz: UTC, chunkBytes: 0 }), /chunkBytes/);
});

test('repeated file selections are rejected and overlapping exports remain explicit', async () => {
  const { assertDistinctFiles } = await import('../app/input.js');
  assert.throws(() => assertDistinctFiles([
    { name: 'history.json', size: 100, lastModified: 1 },
    { name: 'history.json', size: 100, lastModified: 1 }
  ]), /repetido/);
  assert.doesNotThrow(() => assertDistinctFiles([
    { name: 'history.json', size: 100, lastModified: 1 },
    { name: 'other.json', size: 100, lastModified: 1 }
  ]));
  const json = JSON.stringify([{ ts: '2024-01-01T00:00:00Z', master_metadata_track_name: 'T' }]);
  const model = await analyze([memoryBytes('one', json), memoryBytes('two', json)], { tz: UTC });
  const { footerMetaText } = await import('../app/views.js');
  assert.equal(model.totals.records, 2);
  assert.match(footerMetaText(model), /períodos solapados/);
  assert.doesNotMatch(footerMetaText(model), /ignorados/);
});
