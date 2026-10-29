import test from 'node:test';
import assert from 'node:assert/strict';
import { resetPresentationPreferences } from '../app/presentation-preferences.js';
import { METRIC_STORAGE_KEY } from '../app/state-metric.js';

test('presentation preference reset clears saved layout and ranking settings without changing filters', () => {
  const stored = new Map([
    [METRIC_STORAGE_KEY, 'plays'],
    ['scrobbleview:tableLimits', '{}'],
    ['scrobbleview:favorites', '[]'],
    ['scrobbleview:density', 'compact'],
    ['scrobbleview:cols:artists', '[]'],
    ['scrobbleview:cols:tracks', '[]'],
    ['scrobbleview:cols:albums', '[]']
  ]);
  const storage = { removeItem: (key) => stored.delete(key) };
  const favorites = new Set(['explore', 'wrapped']);
  const tableLimits = new Map([['artists', 100]]);
  const rankUI = { metric: 'plays', topN: 100 };
  const filters = { range: { from: 1, to: 2 }, artistId: 7 };

  const metric = resetPresentationPreferences(storage, { favorites, tableLimits, rankUI });

  assert.equal(metric, 'ms');
  assert.equal(rankUI.metric, 'ms');
  assert.equal(rankUI.topN, 10);
  assert.equal(favorites.size, 0);
  assert.equal(tableLimits.size, 0);
  assert.equal(stored.size, 0);
  assert.deepEqual(filters, { range: { from: 1, to: 2 }, artistId: 7 });
});

test('presentation preference reset propagates storage failure before changing in-memory preferences', () => {
  const favorites = new Set(['explore']);
  const tableLimits = new Map([['artists', 50]]);
  const rankUI = { metric: 'plays', topN: 50 };
  const storage = { removeItem() { throw new Error('storage unavailable'); } };

  assert.throws(() => resetPresentationPreferences(storage, { favorites, tableLimits, rankUI }), /storage unavailable/);
  assert.deepEqual([...favorites], ['explore']);
  assert.deepEqual([...tableLimits], [['artists', 50]]);
  assert.deepEqual(rankUI, { metric: 'plays', topN: 50 });
});
