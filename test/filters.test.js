// filters.test.js — applyFilters/filterDataset contra un escaneo manual ingenuo
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse/parse.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { derive } from '../src/aggregate/impl/derive.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { offsetTable } from '../src/aggregate/adapters/offset-table.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { syntheticJSON } from '../src/synthetic.js';
import { applyFilters, filterDataset, emptyFilterState } from '../src/filters.js';
import { buildDataset } from './fakes/dataset.js';

const UTC = fixedTz('utc', 0);

test('filters select both occurrences of a local range during DST fall-back', () => {
  const tz = offsetTable('ny', [[0, -240], [1730613600, -300]]);
  const ds = buildDataset([
    { t: 1730613000, m: 180000, track: 'A', artist: 'X' }, // 01:50 EDT
    { t: 1730614200, m: 60000, track: 'B', artist: 'Y' }, // 01:10 EST
    { t: 1730616600, m: 120000, track: 'C', artist: 'X' }, // 01:50 EST
    { t: 1730617800, m: 60000, track: 'D', artist: 'Y' } // 02:10 EST
  ]);
  const state = {
    ...emptyFilterState(),
    range: {
      from: Date.parse('2024-11-03T01:45:00Z') / 1000,
      to: Date.parse('2024-11-03T01:55:00Z') / 1000
    }
  };
  for (const derived of [null, derive(ds, tz)]) {
    const selected = applyFilters(ds, state, tz, derived);
    assert.deepEqual([...selected.indices], [0, 2]);
    assert.equal(selected.counts.ms, 300000);
    const crossed = applyFilters(ds, { ...state, hours: new Set([1]), artistId: 1 }, tz, derived);
    assert.deepEqual([...crossed.indices], [0, 2]);
    const filtered = aggregate(filterDataset(ds, selected.indices), { tz });
    assert.deepEqual([...filtered.cols.t], [1730613000, 1730616600]);
  }
});

async function makeDs() {
  return parse(memoryBytes('demo.json', syntheticJSON(800, 9)), {});
}

// Escaneo manual: mismo contrato que applyFilters, sin búsqueda binaria.
function manualFilter(ds, derived, pred) {
  const { loc, hour, dow, ymd, day, order } = derived;
  const out = [];
  let ms = 0;
  let skipped = 0;
  let shuffle = 0;
  let offline = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    if (!pred(i, k)) continue;
    out.push(i);
    ms += ds.m[i];
    if (ds.flags[i] & 2) skipped++;
    if (ds.flags[i] & 1) shuffle++;
    if (ds.flags[i] & 4) offline++;
  }
  return { indices: out, counts: { records: out.length, ms, skipped, shuffle, offline } };
}

function compare(a, b, label) {
  assert.deepEqual([...a.indices], b.indices, `${label}: índices`);
  assert.deepEqual(a.counts, b.counts, `${label}: counts`);
}

test('filters: sin filtros devuelve todo el dataset', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const { indices, counts } = applyFilters(ds, emptyFilterState(), UTC);
  assert.equal(indices.length, ds.meta.count);
  assert.equal(counts.records, ds.meta.count);
  const expected = manualFilter(ds, derived, () => true);
  compare({ indices, counts }, expected, 'todo');
});

// La derivación base se puede precalcular una vez (main.js la conserva junto
// al dataset) y reusar en cada cambio de filtro: mismo resultado que derivar
// adentro, sin re-ejecutar order.sort(). El derived pertenece a esa tz: si se
// pasa, manda sobre el parámetro tz.
test('filters: derived precalculado tiene precedencia sobre tz', async () => {
  const ds = await makeDs();
  const tzB = fixedTz('b', -300);
  const derivedA = derive(ds, UTC);
  const crossed = emptyFilterState();
  crossed.hours = new Set([20, 21, 22]);
  const a = applyFilters(ds, crossed, UTC); // deriva interno con UTC
  const b = applyFilters(ds, crossed, tzB, derivedA); // el derived manda, no tzB
  compare(b, { indices: [...a.indices], counts: a.counts }, 'derived precede a tz');
  // Y con la misma tz, 3 args ≡ 4 args (caracterización).
  const c = applyFilters(ds, crossed, UTC, derivedA);
  compare(c, { indices: [...a.indices], counts: a.counts }, 'misma tz');
});

test('filters: rango por búsqueda binaria coincide con escaneo lineal', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const loc = derived.loc;
  const from = loc[Math.floor(loc.length / 4)];
  const to = loc[Math.floor((3 * loc.length) / 4)];
  const state = emptyFilterState();
  state.range = { from, to };
  const { indices, counts } = applyFilters(ds, state, UTC);
  const expected = manualFilter(ds, derived, (_i, k) => loc[k] >= from && loc[k] <= to);
  compare({ indices, counts }, expected, 'rango');
  assert.ok(indices.length > 0 && indices.length < ds.meta.count, 'rango no trivial');
});

test('filters: rango con extremos fuera del dataset', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const loc = derived.loc;
  const state = emptyFilterState();
  state.range = { from: loc[0] - 86400, to: loc[loc.length - 1] + 86400 };
  const { indices, counts } = applyFilters(ds, state, UTC);
  assert.equal(indices.length, ds.meta.count, 'rango amplio = todo');
  assert.equal(counts.ms, manualFilter(ds, derived, () => true).counts.ms);
});

test('filters: predicados cruzados (año, mes, hora, dow) coinciden con manual', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const { ymd, hour, dow } = derived;

  const byYear = emptyFilterState();
  byYear.years = new Set([2024]);
  compare(applyFilters(ds, byYear, UTC), manualFilter(ds, derived, (_i, k) => Math.floor(ymd[k] / 10000) === 2024), 'año');

  const byMonth = emptyFilterState();
  byMonth.months = new Set([202401, 202403]);
  compare(applyFilters(ds, byMonth, UTC), manualFilter(ds, derived, (_i, k) => [202401, 202403].includes(Math.floor(ymd[k] / 100))), 'meses');

  const byHour = emptyFilterState();
  byHour.hours = new Set([20, 21, 22]);
  compare(applyFilters(ds, byHour, UTC), manualFilter(ds, derived, (_i, k) => hour[k] >= 20 && hour[k] <= 22), 'horas');

  const byDow = emptyFilterState();
  byDow.dows = new Set([0, 6]); // lunes y domingo
  compare(applyFilters(ds, byDow, UTC), manualFilter(ds, derived, (_i, k) => dow[k] === 0 || dow[k] === 6), 'dows');
});

test('filters: claves compuestas (artistId, trackId tk, albumId ak)', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);

  const ar = ds.ar[0];
  const byArtist = emptyFilterState();
  byArtist.artistId = ar;
  compare(applyFilters(ds, byArtist, UTC), manualFilter(ds, derived, (i) => ds.ar[i] === ar), 'artistId');

  const tk = ds.tr[0] * 4294967296 + ds.ar[0];
  const byTrack = emptyFilterState();
  byTrack.trackId = tk;
  compare(applyFilters(ds, byTrack, UTC), manualFilter(ds, derived, (i) => ds.tr[i] * 4294967296 + ds.ar[i] === tk), 'trackId');

  const ak = ds.ar[0] * 4294967296 + ds.al[0];
  const byAlbum = emptyFilterState();
  byAlbum.albumId = ak;
  compare(applyFilters(ds, byAlbum, UTC), manualFilter(ds, derived, (i) => ds.ar[i] * 4294967296 + ds.al[i] === ak), 'albumId');
});

test('filters: toggles skip/shuffle/offline', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);

  const bySkip = emptyFilterState();
  bySkip.skip = true;
  compare(applyFilters(ds, bySkip, UTC), manualFilter(ds, derived, (i) => (ds.flags[i] & 2) !== 0), 'skip=true');

  const byShuffle = emptyFilterState();
  byShuffle.shuffle = false;
  compare(applyFilters(ds, byShuffle, UTC), manualFilter(ds, derived, (i) => (ds.flags[i] & 1) === 0), 'shuffle=false');

  const byOffline = emptyFilterState();
  byOffline.offline = true;
  compare(applyFilters(ds, byOffline, UTC), manualFilter(ds, derived, (i) => (ds.flags[i] & 4) !== 0), 'offline=true');
});

test('filters: rango + predicados combinados', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const { loc, ymd } = derived;
  const from = loc[Math.floor(loc.length / 3)];
  const to = loc[Math.floor((2 * loc.length) / 3)];
  const state = emptyFilterState();
  state.range = { from, to };
  state.years = new Set([2024]);
  state.skip = true;
  const expected = manualFilter(ds, derived, (i, k) =>
    loc[k] >= from && loc[k] <= to &&
    Math.floor(ymd[k] / 10000) === 2024 &&
    (ds.flags[i] & 2) !== 0
  );
  compare(applyFilters(ds, state, UTC), expected, 'combinado');
});

test('filters: filterDataset conserva orden local y dicts compartidos', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const loc = derived.loc;
  const state = emptyFilterState();
  state.range = { from: loc[Math.floor(loc.length / 4)], to: loc[Math.floor((3 * loc.length) / 4)] };
  const { indices } = applyFilters(ds, state, UTC);
  const subset = filterDataset(ds, indices);

  assert.equal(subset.meta.count, indices.length);
  assert.equal(subset.dicts, ds.dicts, 'dicts compartidos por referencia');
  assert.equal(subset.meta.tsMin, ds.meta.tsMin);
  assert.equal(subset.meta.sources, ds.meta.sources);

  // El subconjunto de un dataset ordenado por local conserva el orden.
  const subDerived = derive(subset, UTC);
  for (let k = 1; k < subDerived.loc.length; k++) {
    assert.ok(subDerived.loc[k] >= subDerived.loc[k - 1], `loc no decreciente en ${k}`);
  }
  // Y las columnas del subconjunto coinciden con las del original en los índices elegidos.
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];
    assert.equal(subset.t[k], ds.t[i], `t[${k}]`);
    assert.equal(subset.m[k], ds.m[i], `m[${k}]`);
    assert.equal(subset.tr[k], ds.tr[i], `tr[${k}]`);
  }
});

test('filters: re-agregado del subconjunto == counts de applyFilters', async () => {
  const ds = await makeDs();
  const derived = derive(ds, UTC);
  const loc = derived.loc;
  const state = emptyFilterState();
  state.range = { from: loc[Math.floor(loc.length / 4)], to: loc[Math.floor((3 * loc.length) / 4)] };
  state.skip = true;
  const { indices, counts } = applyFilters(ds, state, UTC);
  const subset = filterDataset(ds, indices);
  const m = aggregate(subset, { tz: UTC, now: 1704067200 });
  assert.equal(m.totals.records, counts.records);
  assert.equal(m.totals.ms, counts.ms);
  assert.equal(m.totals.skipped, counts.skipped);
  assert.equal(m.totals.shuffle, counts.shuffle);
  assert.equal(m.totals.offline, counts.offline);
});

test('filters: convención dow = lunes=0 (2024-01-01 lunes, 2024-01-07 domingo)', async () => {
  // Ancla la convención del proyecto: si derive.js volviera a domingo=0, este
  // test falla (los otros tests de dow comparan derive contra derive y no lo
  // detectarían).
  const json = JSON.stringify([
    {
      ts: '2024-01-01T12:00:00Z', ms_played: 30000,
      master_metadata_track_name: 't', master_metadata_album_artist_name: 'a',
      master_metadata_album_album_name: 'al', spotify_track_uri: 'spotify:track:000000000001',
      reason_start: 'trackdone', reason_end: 'trackdone',
      shuffle: false, skipped: false, offline: false
    },
    {
      ts: '2024-01-07T12:00:00Z', ms_played: 30000,
      master_metadata_track_name: 't', master_metadata_album_artist_name: 'a',
      master_metadata_album_album_name: 'al', spotify_track_uri: 'spotify:track:000000000002',
      reason_start: 'trackdone', reason_end: 'trackdone',
      shuffle: false, skipped: false, offline: false
    }
  ]);
  const ds = await parse(memoryBytes('dow.json', json), {});
  const derived = derive(ds, UTC);
  assert.equal(derived.dow[0], 0, '2024-01-01 (lunes) → dow 0');
  assert.equal(derived.dow[1], 6, '2024-01-07 (domingo) → dow 6');
});

test('cached derivation and selected aggregation preserve filtered statistics', async () => {
  const { derive } = await import('../src/aggregate/impl/derive.js');
  const ds = buildDataset([
    { t: 1704067200, m: 60000, track: 'A', artist: 'X' },
    { t: 1704153600, m: 120000, track: 'B', artist: 'Y' },
    { t: 1704240000, m: 5000, track: 'A', artist: 'X', flags: 2 }
  ]);
  const derived = derive(ds, UTC);
  const selected = applyFilters(ds, { ...emptyFilterState(), range: { from: 1704153600, to: 1704240000 } }, UTC, derived);
  const expected = aggregate(filterDataset(ds, selected.indices), { tz: UTC, now: 1 });
  const actual = aggregate(ds, { tz: UTC, now: 1, derived, indices: selected.indices });
  assert.deepEqual(actual, expected);
  const { countFiltered } = await import('../src/filters.js');
  assert.equal(countFiltered(ds, { ...emptyFilterState(), skip: false }, UTC, derived).ms, 180000);
});
