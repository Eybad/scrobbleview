import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheSummary, clear, hasCache, save, load } from '../app/storage.js';
import { buildDataset } from './fakes/dataset.js';

function fakeIndexedDB(t, outcome) {
  const state = { outcome, data: new Map() };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'indexedDB', descriptor) : delete globalThis.indexedDB);
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open() {
      const request = {};
      queueMicrotask(() => {
        if (state.outcome === 'openError') { request.error = new Error('unavailable'); request.onerror(); return; }
        request.result = {
          close() {},
          transaction() {
            const transaction = {
              objectStore: () => ({
                clear() { state.data.clear(); },
                put(value, key) { state.data.set(key, value); },
                getAllKeys() {
                  const operation = {};
                  queueMicrotask(() => {
                    operation.result = [...state.data.keys()];
                    operation.onsuccess?.();
                  });
                  return operation;
                },
                get(key) {
                  const operation = {};
                  queueMicrotask(() => {
                    operation.result = state.data.get(key);
                    operation.onsuccess?.();
                  });
                  return operation;
                }
              })
            };
            queueMicrotask(() => {
              if (state.outcome === 'abort') { transaction.error = new Error('quota'); transaction.onabort(); }
              else transaction.oncomplete();
            });
            return transaction;
          }
        };
        request.onsuccess();
      });
      return request;
    }
  } });
  return state;
}

test('cache clearing reports failed and committed transactions accurately', async (t) => {
  const state = fakeIndexedDB(t, 'abort');
  assert.equal(await clear(), false);
  state.outcome = 'success';
  assert.equal(await clear(), true);
});

test('cache failures leave analysis available without claiming persistence', async (t) => {
  fakeIndexedDB(t, 'openError');
  const ds = buildDataset([{ t: 1704067200, m: 1000, track: 'Synthetic' }]);
  assert.equal(await save(ds), false);
  assert.equal(await load(), null);
  assert.equal(await clear(), false);
});

test('consented cache saves, reloads, summarizes, and clears a dataset', async (t) => {
  fakeIndexedDB(t, 'success');
  const ds = buildDataset([
    { t: 1704067200, m: 60000, track: 'Synthetic A', artist: 'Synthetic' },
    { t: 1735689600, m: 120000, track: 'Synthetic B', artist: 'Synthetic' }
  ]);

  assert.equal(await save(ds), true);
  assert.equal(await hasCache(), true);
  const restored = await load();
  assert.equal(restored.meta.count, 2);
  assert.deepEqual([...restored.m], [60000, 120000]);
  assert.deepEqual([...restored.tr].map((id) => restored.dicts.tracks.get(id)), ['Synthetic A', 'Synthetic B']);
  assert.deepEqual(await cacheSummary(), { count: 2, fromYear: 2024, toYear: 2025, sourcesCount: 1 });
  assert.equal(await clear(), true);
  assert.equal(await hasCache(), false);
  assert.equal(await load(), null);
});

test('cache round trips preserve distinct valid JSON surrogate strings', async () => {
  const { serialize, deserialize } = await import('../app/storage.js');
  const { parse } = await import('../src/parse/parse.js');
  const { memoryBytes } = await import('../src/parse/adapters/memory-bytes.js');
  const names = ['\ufffd', '\ud800', '\ud801', '🎵'];
  const ds = await parse(memoryBytes('unicode', JSON.stringify(names.map((name) => ({
    ts: '2024-01-01T00:00:00Z', master_metadata_track_name: name
  })))));
  const restored = deserialize(serialize(ds));
  assert.deepEqual([...restored.tr].map((id) => restored.dicts.tracks.get(id)), names);
  const rows = serialize(ds);
  rows['dict:tracks:count'] = 99999;
  assert.throws(() => deserialize(rows), RangeError);
});
