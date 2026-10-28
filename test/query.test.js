import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchText,
  matchesQuery,
  queryCatalog,
  rankEntities
} from '../src/query.js';

test('normalizeSearchText: strips diacritics, trims and lowercases without altering source', () => {
  assert.equal(normalizeSearchText('  Canción Épica / DÉJÀ VU  '), 'cancion epica / deja vu');
  assert.equal(normalizeSearchText(''), '');
  assert.equal(normalizeSearchText(null), '');
});

test('matchesQuery: matches normalized text in item fields', () => {
  const track = { name: 'Ámbar', artist: 'Babasónicos' };
  assert.equal(matchesQuery(track, 'ambar', ['name', 'artist']), true);
  assert.equal(matchesQuery(track, 'babasonicos', ['name', 'artist']), true);
  assert.equal(matchesQuery(track, 'soni', ['name', 'artist']), true);
  assert.equal(matchesQuery(track, 'rock', ['name', 'artist']), false);
});

test('rankEntities: assigns deterministic global metric rank and calculates share', () => {
  const items = [
    { id: 1, name: 'Artist C', plays: 10, ms: 50000 },
    { id: 2, name: 'Artist A', plays: 20, ms: 100000 },
    { id: 3, name: 'Artist B', plays: 20, ms: 80000 },
    { id: 4, name: 'Artist D', plays: 5, ms: 50000 }
  ];

  // By plays (desc)
  const rankedByPlays = rankEntities(items, { metric: 'plays', totalMetric: 55 });
  assert.equal(rankedByPlays.length, 4);
  assert.equal(rankedByPlays[0].item.id, 2); // 20 plays, 100000 ms
  assert.equal(rankedByPlays[0].metricRank, 1);
  assert.equal(rankedByPlays[1].item.id, 3); // 20 plays, 80000 ms (tie broken by ms)
  assert.equal(rankedByPlays[1].metricRank, 2);
  assert.equal(rankedByPlays[2].item.id, 1); // 10 plays, 50000 ms
  assert.equal(rankedByPlays[2].metricRank, 3);
  assert.equal(rankedByPlays[3].item.id, 4); // 5 plays, 50000 ms
  assert.equal(rankedByPlays[3].metricRank, 4);

  // Shares based on totalMetric (55)
  assert.equal(rankedByPlays[0].share, 20 / 55);
  assert.equal(rankedByPlays[1].share, 20 / 55);
  assert.equal(rankedByPlays[2].share, 10 / 55);
  assert.equal(rankedByPlays[3].share, 5 / 55);

  // By ms (desc)
  const rankedByMs = rankEntities(items, { metric: 'ms', totalMetric: 280000 });
  assert.equal(rankedByMs[0].item.id, 2); // 100000 ms
  assert.equal(rankedByMs[0].metricRank, 1);
  assert.equal(rankedByMs[1].item.id, 3); // 80000 ms
  assert.equal(rankedByMs[1].metricRank, 2);
  assert.equal(rankedByMs[2].item.id, 1); // 50000 ms, 10 plays (tie broken by plays)
  assert.equal(rankedByMs[2].metricRank, 3);
  assert.equal(rankedByMs[3].item.id, 4); // 50000 ms, 5 plays
  assert.equal(rankedByMs[3].metricRank, 4);
});

test('queryCatalog: pagination, search and stable ordering', () => {
  const items = [];
  for (let i = 1; i <= 60; i++) {
    items.push({
      id: i,
      name: `Track ${String(i).padStart(2, '0')}`,
      artist: i % 2 === 0 ? 'Artist Even' : 'Artist Odd',
      plays: 100 - i,
      ms: (100 - i) * 60000,
      days: { size: Math.max(1, Math.floor(i / 2)) },
      months: { size: 2 },
      firstTs: 1000 + i,
      lastTs: 5000 + i,
      skips: i % 5,
      skipKnown: 10
    });
  }

  // Total metric: sum of plays
  const totalPlays = items.reduce((s, x) => s + x.plays, 0);

  // Page 1 with pageSize 25
  const resPage1 = queryCatalog(items, {
    metric: 'plays',
    totalMetric: totalPlays,
    page: 1,
    pageSize: 25,
    searchFields: ['name', 'artist']
  });

  assert.equal(resPage1.totalItems, 60);
  assert.equal(resPage1.totalMatches, 60);
  assert.equal(resPage1.totalPages, 3);
  assert.equal(resPage1.page, 1);
  assert.equal(resPage1.pageSize, 25);
  assert.equal(resPage1.rows.length, 25);
  assert.equal(resPage1.startRow, 1);
  assert.equal(resPage1.endRow, 25);
  // Highest plays is i=1 (plays 99)
  assert.equal(resPage1.rows[0].item.id, 1);
  assert.equal(resPage1.rows[0].resultRow, 1);
  assert.equal(resPage1.rows[0].metricRank, 1);
  assert.equal(resPage1.rows[0].share, 99 / totalPlays);

  // Page 2
  const resPage2 = queryCatalog(items, {
    metric: 'plays',
    totalMetric: totalPlays,
    page: 2,
    pageSize: 25,
    searchFields: ['name', 'artist']
  });
  assert.equal(resPage2.rows.length, 25);
  assert.equal(resPage2.startRow, 26);
  assert.equal(resPage2.endRow, 50);
  assert.equal(resPage2.rows[0].resultRow, 26);
  assert.equal(resPage2.rows[0].metricRank, 26);
  assert.equal(resPage2.rows[0].item.id, 26);

  // Search filter: query 'Artist Even' (30 items)
  const resSearch = queryCatalog(items, {
    metric: 'plays',
    totalMetric: totalPlays,
    query: 'even',
    page: 1,
    pageSize: 25,
    searchFields: ['name', 'artist']
  });

  assert.equal(resSearch.totalItems, 60);
  assert.equal(resSearch.totalMatches, 30);
  assert.equal(resSearch.totalPages, 2);
  assert.equal(resSearch.rows.length, 25);
  // First match is i=2 (plays 98, global rank #2)
  assert.equal(resSearch.rows[0].item.id, 2);
  assert.equal(resSearch.rows[0].resultRow, 1); // 1st result row
  assert.equal(resSearch.rows[0].metricRank, 2); // Global rank is still 2!
  assert.equal(resSearch.rows[0].share, 98 / totalPlays); // Share against whole catalog remains unchanged!

  // Sort by name ascending
  const resSortName = queryCatalog(items, {
    metric: 'plays',
    totalMetric: totalPlays,
    sortBy: 'name',
    sortDir: 'asc',
    page: 1,
    pageSize: 10,
    searchFields: ['name', 'artist']
  });
  assert.equal(resSortName.rows[0].item.name, 'Track 01');
  assert.equal(resSortName.rows[0].resultRow, 1);
  assert.equal(resSortName.rows[0].metricRank, 1);
  assert.equal(resSortName.rows[9].item.name, 'Track 10');
  assert.equal(resSortName.rows[9].resultRow, 10);
  assert.equal(resSortName.rows[9].metricRank, 10);
});

test('queryCatalog: thresholds and eligibility', () => {
  const items = [
    { id: 1, name: 'A', plays: 10, ms: 1000, skips: 5, skipKnown: 10, days: { size: 2 }, months: { size: 1 } },
    { id: 2, name: 'B', plays: 30, ms: 3000, skips: 2, skipKnown: 30, days: { size: 5 }, months: { size: 3 } },
    { id: 3, name: 'C', plays: 5, ms: 500, skips: 1, skipKnown: 5, days: { size: 1 }, months: { size: 1 } }
  ];

  // minPlays filter (e.g. for skipRate where minPlays=20)
  const resMinPlays = queryCatalog(items, {
    metric: 'plays',
    totalMetric: 45,
    minKnownSkips: 10,
    sortBy: 'skipRate',
    sortDir: 'desc'
  });
  assert.equal(resMinPlays.totalMatches, 2);
  // A has 5/10 = 50%, B has 2/30 = 6.67%
  assert.equal(resMinPlays.rows[0].item.id, 1);
  assert.equal(resMinPlays.rows[1].item.id, 2);
});
