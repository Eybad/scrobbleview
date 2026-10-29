import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisEngine } from '../app/analysis-engine.js';
import { describeCatalogQuery } from '../app/catalog-query.js';
import { renderView } from '../app/views.js';
import { exportExploreTableCSV } from '../src/export.js';
import { queryCatalog } from '../src/query.js';
import { emptyFilterState } from '../src/filters.js';
import { buildDataset } from './fakes/dataset.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';

test('B04: artist quota stays at 75% across search, pages, view and CSV', () => {
  const start = 1704067200;
  const events = [
    ...Array.from({ length: 3 }, (_, index) => ({
      t: start + index * 60,
      m: 60000,
      track: `Track ${index}`,
      artist: 'Artist A'
    })),
    { t: start + 180, m: 60000, track: 'Track B', artist: 'Artist B' }
  ];
  const model = aggregate(buildDataset(events), { tz: fixedTz('UTC', 0) });
  const exploreState = { tab: 'artists', query: '', sortBy: 'plays', page: 1, pageSize: 25 };
  const { pool, options, tab } = describeCatalogQuery(model, { metric: 'plays', exploreState });
  const visible = queryCatalog(pool, { ...options, pageSize: 1 });
  const nextPage = queryCatalog(pool, { ...options, page: 2, pageSize: 1 });
  const searchedState = { ...exploreState, query: 'Artist A' };
  const searched = describeCatalogQuery(model, { metric: 'plays', exploreState: searchedState });
  const searchedResult = queryCatalog(searched.pool, searched.options);
  const exported = exportExploreTableCSV(searched.pool, searched.options, searched.tab);
  const exportedRow = exported.csv.replace(/^\uFEFF/, '').trim().split('\r\n')[1];
  const html = renderView('explore', model, null, { metric: 'plays', exploreState: searchedState });

  assert.equal(visible.rows[0].share, 0.75);
  assert.equal(nextPage.rows[0].share, 0.25);
  assert.equal(searchedResult.rows[0].share, 0.75);
  assert.equal(exported.totalMatches, 1);
  assert.equal(exportedRow.split(',')[5], '75.00');
  assert.match(html, /75%/);
});

test('B19: monthly concentration uses known time and exposes unknown behavior bases', async () => {
  const start = Date.parse('2024-01-01T12:00:00Z') / 1000;
  const events = [
    ...Array.from({ length: 3 }, (_, index) => ({
      ts: new Date((start + index * 60) * 1000).toISOString(),
      ms_played: 60000,
      skipped: false,
      shuffle: false,
      offline: false,
      master_metadata_track_name: `Known A ${index}`,
      master_metadata_album_artist_name: 'Artist A'
    })),
    {
      ts: new Date((start + 180) * 1000).toISOString(),
      ms_played: 60000,
      skipped: true,
      shuffle: false,
      offline: false,
      master_metadata_track_name: 'Known B',
      master_metadata_album_artist_name: 'Artist B'
    },
    {
      ts: new Date((start + 240) * 1000).toISOString(),
      skipped: null,
      shuffle: null,
      offline: null,
      master_metadata_track_name: 'Unknown duration',
      master_metadata_album_artist_name: 'Artist C'
    }
  ];
  const engine = createAnalysisEngine();
  const loaded = await engine.handle('load', {
    timeZone: 'UTC',
    files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(events)]) }]
  });
  const longitudinal = await engine.handle('longitudinal', {
    state: emptyFilterState(),
    thresholdDays: 30,
    pageSize: 25
  });
  const january = longitudinal.monthly.get(202401);
  const artistConcentration = january.concentration.artists;
  const expectedEffective = Math.exp(-(0.75 * Math.log(0.75) + 0.25 * Math.log(0.25)));
  const html = renderView('habits', loaded.model, null, { longitudinal });

  assert.equal(january.ms, 240000);
  assert.equal(artistConcentration.knownEntities, 2);
  assert.equal(artistConcentration.unknownEntities, 1);
  assert.equal(artistConcentration.hhi, 0.625);
  assert.ok(Math.abs(artistConcentration.effective - expectedEffective) < 1e-12);
  assert.notEqual(artistConcentration.effective, 1 / artistConcentration.hhi);
  assert.equal(january.skipKnown, 4);
  assert.equal(january.skipUnknown, 1);
  assert.equal(january.skipRate, 0.25);
  assert.match(html, /Efectivos exp\(H\)/);
  assert.match(html, /62,5\s*%/);
  assert.match(html, /Tasas mensuales con base conocida/);
  assert.match(html, /Salto desconocido/);
  assert.match(html, /25\s*%/);
});
