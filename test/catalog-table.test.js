import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogTableHTML, paginationControlsHTML } from '../app/catalog-table.js';

test('catalogTableHTML: renders table with sortable headers and aria-sort', () => {
  const queryResult = {
    rows: [
      {
        item: { id: 1, name: 'Daft Punk', plays: 150, ms: 36000000, days: { size: 40 }, months: { size: 10 } },
        metricRank: 1,
        share: 0.25,
        resultRow: 1
      }
    ],
    totalItems: 100,
    totalMatches: 1,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    startRow: 1,
    endRow: 1
  };

  const html = catalogTableHTML(queryResult, {
    tab: 'artists',
    metric: 'ms',
    sortBy: 'ms',
    sortDir: 'desc'
  });

  assert.ok(html.includes('table class="catalog-table'));
  assert.ok(html.includes('<caption class="visually-hidden">Artistas: 1 coincidencia</caption>'));
  assert.ok(html.includes('aria-sort="descending"'));
  assert.ok(html.includes('Daft Punk'));
  assert.ok(html.includes('25%'));
  assert.match(html, /<td class="c col-rank" data-label="#">1<\/td>/);
  assert.ok(!html.includes('rank-badge'));
  assert.ok(html.includes('aria-label="Artistas del catálogo"'));
  assert.ok(html.includes('Deslizá para ver más columnas'));
});

test('catalogTableHTML: disambiguates homonym tracks by artist and provides distinct links', () => {
  const queryResult = {
    rows: [
      {
        item: { id: 101, tk: 101, name: 'Stay', artist: 'Rihanna', plays: 50, ms: 12000000 },
        metricRank: 5,
        share: 0.05,
        resultRow: 1
      },
      {
        item: { id: 202, tk: 202, name: 'Stay', artist: 'The Kid LAROI', plays: 40, ms: 8000000 },
        metricRank: 8,
        share: 0.04,
        resultRow: 2
      }
    ],
    totalItems: 50,
    totalMatches: 2,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    startRow: 1,
    endRow: 2
  };

  const html = catalogTableHTML(queryResult, {
    tab: 'tracks',
    metric: 'plays',
    sortBy: 'plays',
    sortDir: 'desc'
  });

  assert.ok(html.includes('Rihanna'));
  assert.ok(html.includes('The Kid LAROI'));
  assert.ok(html.includes('#/v1/track/Rihanna/Stay'));
  assert.ok(html.includes('#/v1/track/The%20Kid%20LAROI/Stay'));
  assert.match(html, /<td class="c col-rank" data-label="#">5<\/td>/);
  assert.match(html, /<td class="c col-rank" data-label="#">8<\/td>/);
});

test('paginationControlsHTML: renders accessible pagination with current page and counts', () => {
  const queryResult = {
    rows: [],
    totalItems: 120,
    totalMatches: 85,
    page: 2,
    pageSize: 25,
    totalPages: 4,
    startRow: 26,
    endRow: 50
  };

  const html = paginationControlsHTML(queryResult);
  assert.ok(html.includes('aria-label="Paginación'));
  assert.ok(html.includes('Mostrando 26–50 de 85 resultados'));
  assert.ok(html.includes('data-page="1"'));
  assert.ok(html.includes('data-page="3"'));
  assert.ok(html.includes('data-page-size'));
  assert.ok(html.includes('value="25" selected'));
});

test('catalogTableHTML: renders informative empty state on zero search results', () => {
  const queryResult = {
    rows: [],
    totalItems: 50,
    totalMatches: 0,
    page: 1,
    pageSize: 25,
    totalPages: 1,
    startRow: 0,
    endRow: 0
  };

  const html = catalogTableHTML(queryResult, {
    tab: 'artists',
    query: 'nonexistent'
  });

  assert.ok(html.includes('empty-state'));
  assert.ok(html.includes('Sin coincidencias para “nonexistent”'));
  assert.ok(html.includes('data-clear-search'));
});

test('metric ordering marks only one table column as sorted', () => {
  const result = {
    rows: [{ item: { id: 1, name: 'Artist', plays: 2, ms: 1000 }, metricRank: 1, share: 1, resultRow: 1 }],
    totalItems: 1, totalMatches: 1, page: 1, pageSize: 25, totalPages: 1, startRow: 1, endRow: 1
  };
  const html = catalogTableHTML(result, { tab: 'artists', metric: 'plays', sortBy: 'metric', sortDir: 'asc' });
  assert.equal((html.match(/aria-sort="ascending"/g) ?? []).length, 1);
  assert.match(html, /<th[^>]*class="n col-plays" aria-sort="ascending"/);
  assert.match(html, /<th[^>]*class="n col-time" aria-sort="none"/);
});
