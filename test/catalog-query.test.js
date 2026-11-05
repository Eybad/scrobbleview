import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCatalogQuery, parseExploreState, patchExploreQuery } from '../app/catalog-query.js';
import { queryCatalog } from '../src/query.js';
import { exportExploreTableCSV } from '../src/export.js';
import { exploreView } from '../app/views.js';

test('Explore query parsing validates owned fields and reads presentation preferences', () => {
  const visibleCols = ['name', 'plays'];
  const state = parseExploreState(
    '?tab=tracks&q=Echo&sort=skipRate&dir=asc&page=3&pageSize=all&minPlays=12&minMonths=5&x=keep',
    { density: 'compact', visibleCols }
  );

  assert.deepEqual(state, {
    tab: 'tracks', q: 'Echo', sort: 'skipRate', dir: 'asc', page: 3, pageSize: 'all',
    minPlays: 12, minMonths: 5, minKnownSkips: 12, density: 'compact',
    visibleCols: new Set(visibleCols)
  });
  const { options } = describeCatalogQuery({ totals: { ms: 20, records: 4 }, tracks: { byId: new Map() } }, { metric: 'plays', exploreState: state });
  assert.equal(options.query, 'Echo');
  assert.equal(options.sortBy, 'skipRate');
  assert.equal(options.sortDir, 'asc');
  assert.equal(options.minKnownSkips, 12);

  const fallback = parseExploreState('?tab=invalid&sort=invalid&dir=sideways&page=0&pageSize=10&minPlays=0&minMonths=121', {
    density: 'spacious', visibleCols: 'invalid'
  });
  assert.deepEqual(fallback, {
    tab: 'artists', q: '', sort: 'metric', dir: null, page: 1, pageSize: 25,
    minPlays: null, minMonths: null, minKnownSkips: null, density: 'comfortable', visibleCols: null
  });
});

test('Explore query patching changes only owned fields and preserves unrelated query state', () => {
  const original = 'artist=8&tab=artists&q=Old&future=a+b&sort=metric';
  const patched = patchExploreQuery(original, { q: 'New search', sort: 'name', page: 2, minMonths: null });
  const params = new URLSearchParams(patched);

  assert.equal(params.get('artist'), '8');
  assert.equal(params.get('future'), 'a b');
  assert.equal(params.get('q'), 'New search');
  assert.equal(params.get('sort'), 'name');
  assert.equal(params.get('page'), '2');
  assert.equal(params.has('minMonths'), false);
  assert.equal(original, 'artist=8&tab=artists&q=Old&future=a+b&sort=metric');

  const legacy = new URLSearchParams(patchExploreQuery('?sort=skipRate&minPlays=8', { minKnownSkips: 16 }));
  assert.equal(legacy.get('minKnownSkips'), '16');
  assert.equal(legacy.has('minPlays'), false);
});

test('B20: screen, count and export share the eligible skip-rate ranking and denominator', () => {
  const artists = [
    { id: 1, name: 'Eligible', plays: 20, ms: 1200000, skips: 10, skipKnown: 20 },
    { id: 2, name: 'Unknown', plays: 20, ms: 1200000, skips: 0, skipKnown: 0 }
  ];
  const model = { totals: { records: 40, ms: 2400000 }, artists: { byId: new Map(artists.map(item => [item.id, item])) }, monthlyArtistPlays: new Map() };
  const { pool, options, tab } = describeCatalogQuery(model, { metric: 'plays', exploreState: { tab: 'artists', sortBy: 'skipRate' } });
  const displayed = queryCatalog(pool, options);
  const exported = exportExploreTableCSV(pool, options, tab);
  assert.equal(displayed.totalMatches, 1);
  assert.equal(displayed.rows[0].share, 0.5);
  assert.equal(displayed.effectiveDir, 'desc');
  assert.equal(exported.totalMatches, 1);
  assert.match(exported.csv, /Eligible/);
  assert.match(exported.csv, /,Eligible,1200000,,20,50\.00,/);
  assert.doesNotMatch(exported.csv, /Unknown/);
  const html = exploreView(model, { metric: 'plays', exploreState: { tab: 'artists', sortBy: 'skipRate' } });
  assert.match(html, /Eligible/);
  assert.doesNotMatch(html, /Unknown/);
  assert.match(html, /Exportar tabla \(1\)/);
});

test('catalog table export keeps global metric ranks, full-query shares, and known-duration counts', () => {
  const artists = [
    { id: 1, name: 'Match Alpha', plays: 10, ms: 1000, durationKnown: 8 },
    { id: 2, name: 'Omit Beta', plays: 9, ms: 900, durationKnown: 7 },
    { id: 3, name: 'Match Gamma', plays: 8, ms: 800 }
  ];
  const options = {
    metric: 'plays', totalMetric: 40, query: 'Match', searchFields: ['name'],
    sortBy: 'name', sortDir: 'asc', page: 2, pageSize: 1
  };

  const visible = queryCatalog(artists, options);
  const exported = exportExploreTableCSV(artists, options, 'artists');
  const rows = exported.csv.replace(/^\uFEFF/, '').trim().split('\r\n');

  assert.equal(visible.rows[0].metricRank, 3);
  assert.equal(visible.rows[0].share, 0.2);
  assert.equal(exported.totalMatches, 2);
  assert.match(rows[0], /duration_known/);
  assert.match(rows[1], /^1,Match Alpha,1000,8,10,25\.00,/);
  assert.match(rows[2], /^3,Match Gamma,800,,8,20\.00,/);
});

test('auxiliary rankings sort the full catalog with continuity and longevity criteria', () => {
  const artists = Array.from({ length: 130 }, (_, id) => ({
    id, name: `Artist ${id}`, plays: 20, ms: 60000,
    firstTs: 1704067200, lastTs: 1717200000,
    months: new Set(Array.from({ length: id === 129 ? 6 : 5 }, (_, month) => 202401 + month)),
    years: new Set(id === 129 ? [2023, 2024] : [2024]), days: new Set([1])
  }));
  const model = { totals: { records: 2600, ms: 7800000 }, artists: { byId: new Map(artists.map(item => [item.id, item])) }, monthlyArtistMs: new Map() };
  const continuity = describeCatalogQuery(model, { exploreState: { sortBy: 'constancy', minMonths: 5, pageSize: 25 } });
  const ranked = queryCatalog(continuity.pool, continuity.options);
  assert.equal(ranked.totalMatches, 130);
  assert.equal(ranked.rows[0].item.name, 'Artist 129');
  const longevity = describeCatalogQuery(model, { exploreState: { sortBy: 'longevity', pageSize: 25 } });
  assert.equal(queryCatalog(longevity.pool, longevity.options).rows[0].item.name, 'Artist 129');
  const html = exploreView(model, { exploreState: { sortBy: 'constancy', minMonths: 5 } });
  assert.match(html, /data-label="Constancia">100%/);
  assert.match(html, /6\/6 meses/);
});

test('catalog depth, one-hit and forgotten rankings use complete entity data', () => {
  const artists = Array.from({ length: 105 }, (_, id) => ({
    id: id + 1, name: `Artist ${id}`, plays: 20, ms: 1200000, lastUtc: 1704067200 + id,
    tracks: new Set([id + 1]), albums: new Set(id === 104 ? [1, 2] : [1])
  }));
  const tracks = new Map(artists.map((artist, index) => [index + 1, { tk: index + 1, name: `Track ${index}`, plays: index === 104 ? 20 : 15, ms: 1200000 }]));
  const model = { totals: { records: 2100, ms: 126000000 }, meta: { lastLoadedUtc: 1704153600, generatedAt: 1704240000 },
    artists: { byId: new Map(artists.map(item => [item.id, item])) }, tracks: { byId: tracks }, monthlyArtistMs: new Map() };
  const oneHit = describeCatalogQuery(model, { exploreState: { sortBy: 'dominance' } });
  assert.equal(queryCatalog(oneHit.pool, oneHit.options).rows[0].item.name, 'Artist 104');
  assert.equal(queryCatalog(oneHit.pool, oneHit.options).totalMatches, 1);
  const deep = describeCatalogQuery(model, { exploreState: { sortBy: 'deepCatalog' } });
  assert.equal(queryCatalog(deep.pool, deep.options).rows[0].item.name, 'Artist 104');
  const forgotten = describeCatalogQuery(model, { exploreState: { sortBy: 'forgotten' } });
  assert.equal(queryCatalog(forgotten.pool, forgotten.options).rows[0].item.name, 'Artist 0');
  assert.equal(queryCatalog(forgotten.pool, forgotten.options).rows[0].item.daysSinceEnd, 1);
  assert.match(exploreView(model, { exploreState: { sortBy: 'dominance' } }), /Track 104 · 100%/);
  assert.match(exploreView(model, { exploreState: { sortBy: 'forgotten' } }), /1 día entre última escucha y fin del historial · 2 días desde última escucha hasta hoy/);
});
