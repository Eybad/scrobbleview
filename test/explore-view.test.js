import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exploreView, renderView, rankCardHTML } from '../app/views.js';

function createMockModel() {
  const artistsMap = new Map();
  const tracksMap = new Map();
  const albumsMap = new Map();

  for (let i = 1; i <= 30; i++) {
    artistsMap.set(i, {
      id: i,
      name: `Artist ${String(i).padStart(2, '0')}`,
      plays: 100 - i,
      ms: (100 - i) * 60000,
      days: new Set([1, 2, 3]),
      months: new Set([202401, 202402]),
      years: new Set([2024]),
      skips: i % 4,
      skipKnown: 25,
      firstTs: 1000,
      lastTs: 2000
    });
  }

  for (let i = 1; i <= 30; i++) {
    tracksMap.set(i, {
      id: i,
      tk: i,
      name: `Track ${String(i).padStart(2, '0')}`,
      artist: `Artist ${String(i % 5 + 1).padStart(2, '0')}`,
      plays: 100 - i,
      ms: (100 - i) * 60000,
      days: new Set([1, 2]),
      months: new Set([202401]),
      years: new Set([2024]),
      skips: 2,
      skipKnown: 20,
      firstTs: 1000,
      lastTs: 2000
    });
  }

  return {
    totals: { records: 300, ms: 18000000, plays: 300, durationUnknown: 0, skippedKnown: 300, shuffleKnown: 300, offlineKnown: 300 },
    artists: {
      byId: artistsMap,
      top: { byPlays: [...artistsMap.values()], byMs: [...artistsMap.values()] }
    },
    tracks: {
      byId: tracksMap,
      top: { byPlays: [...tracksMap.values()], byMs: [...tracksMap.values()] }
    },
    albums: {
      byId: albumsMap,
      top: { byPlays: [], byMs: [] }
    },
    monthly: new Map([[202401, { plays: 100, ms: 6000000 }]]),
    meta: { sources: ['test.json'], firstTs: 1000, lastTs: 2000 }
  };
}

test('exploreView: renders tabs and catalog table for artists', () => {
  const model = createMockModel();
  const ctx = {
    metric: 'ms',
    query: 'tab=artists&page=1&pageSize=25',
    exploreState: { tab: 'artists', page: 1, pageSize: 25, sortBy: 'ms', sortDir: 'desc' }
  };

  const html = exploreView(model, ctx);
  assert.ok(html.includes('role="tablist"'));
  assert.ok(html.includes('data-explore-tab="artists"'));
  assert.ok(html.includes('data-explore-tab="tracks"'));
  assert.ok(html.includes('data-explore-tab="albums"'));
  assert.ok(html.includes('data-explore-search'));
  assert.ok(html.includes('catalog-table'));
  assert.ok(html.includes('Artist 01'));
});

test('renderView: dispatches explore view correctly', () => {
  const model = createMockModel();
  const ctx = { metric: 'plays', query: '' };
  const html = renderView('explore', model, null, ctx);
  assert.ok(html.includes('data-explore-tab="artists"'));
});

test('explore view uses all records as the play share denominator', () => {
  const model = createMockModel();
  model.totals = { records: 4, ms: 240000 };
  const artist = model.artists.byId.get(1);
  artist.plays = 3;
  model.artists.byId = new Map([[1, artist]]);
  const html = exploreView(model, { metric: 'plays', exploreState: { query: 'Artist 01' } });
  assert.ok(html.includes('75%'));
});

test('rankCardHTML: includes contextual access link to explore view', () => {
  const model = createMockModel();
  const html = rankCardHTML(model, { tab: 'artists', metric: 'ms' });
  assert.ok(html.includes('#/v1/explore?tab=artists'));
  assert.ok(html.includes('Explorar'));
});
