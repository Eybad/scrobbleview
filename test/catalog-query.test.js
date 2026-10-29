import test from 'node:test';
import assert from 'node:assert/strict';
import { describeCatalogQuery } from '../app/catalog-query.js';
import { queryCatalog } from '../src/query.js';
import { exportExploreTableCSV } from '../src/export.js';
import { exploreView } from '../app/views.js';

test('screen, count and export share skip eligibility and the full denominator', () => {
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
  assert.doesNotMatch(exported.csv, /Unknown/);
  const html = exploreView(model, { metric: 'plays', exploreState: { tab: 'artists', sortBy: 'skipRate' } });
  assert.match(html, /Eligible/);
  assert.doesNotMatch(html, /Unknown/);
  assert.match(html, /Exportar CSV \(1\)/);
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
