import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clear, save, load } from '../app/storage.js';
import { buildDataset } from './fakes/dataset.js';

function fakeIndexedDB(t, outcome) {
  const state = { outcome };
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
            const transaction = { objectStore: () => ({ clear() {}, put() {} }) };
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
