import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryCatalog } from '../src/query.js';
import { catalogTableHTML } from '../app/catalog-table.js';

test('A07: dataset with >150 entities and >100 matches is fully traversable with pagination', () => {
  const items = [];
  for (let i = 1; i <= 200; i++) {
    items.push({
      id: i,
      tk: i,
      name: i <= 120 ? `Rock Anthem ${String(i).padStart(3, '0')}` : `Jazz Ballad ${String(i).padStart(3, '0')}`,
      artist: `Band ${i % 10}`,
      plays: 1000 - i,
      ms: (1000 - i) * 60000,
      days: new Set([1, 2, 3]),
      months: new Set([202401]),
      years: new Set([2024]),
      skips: 0,
      skipKnown: 10,
      firstTs: 1000 + i,
      lastTs: 5000 + i
    });
  }

  const totalMs = items.reduce((s, it) => s + it.ms, 0);

  const seenIds = new Set();
  let page = 1;
  const pageSize = 25;
  let hasMore = true;
  let totalMatchesReported = 0;

  while (hasMore) {
    const res = queryCatalog(items, {
      metric: 'ms',
      totalMetric: totalMs,
      query: 'rock',
      page,
      pageSize,
      searchFields: ['name', 'artist']
    });

    totalMatchesReported = res.totalMatches;
    assert.equal(res.totalMatches, 120);
    assert.equal(res.totalItems, 200);

    for (const row of res.rows) {
      assert.ok(!seenIds.has(row.item.id), `Duplicate item id ${row.item.id} found across pages`);
      seenIds.add(row.item.id);
    }

    if (page >= res.totalPages) {
      hasMore = false;
    } else {
      page++;
    }
  }

  assert.equal(page, 5);
  assert.equal(seenIds.size, 120);
  assert.equal(totalMatchesReported, 120);
});

test('A08: global sort is stable before paginating and share is independent of page', () => {
  const items = [];
  for (let i = 1; i <= 150; i++) {
    items.push({
      id: i,
      tk: i,
      name: `Song ${String(i).padStart(3, '0')}`,
      artist: 'Artist Collective',
      plays: i,
      ms: i * 10000,
      days: new Set([1]),
      months: new Set([202401]),
      years: new Set([2024]),
      skips: 0,
      skipKnown: i,
      firstTs: 1000,
      lastTs: 2000
    });
  }

  const totalPlays = items.reduce((s, it) => s + it.plays, 0);

  const page1 = queryCatalog(items, {
    metric: 'plays',
    totalMetric: totalPlays,
    page: 1,
    pageSize: 25,
    sortBy: 'plays',
    sortDir: 'desc'
  });

  const page2 = queryCatalog(items, {
    metric: 'plays',
    totalMetric: totalPlays,
    page: 2,
    pageSize: 25,
    sortBy: 'plays',
    sortDir: 'desc'
  });

  const lastRowPage1 = page1.rows[page1.rows.length - 1];
  const firstRowPage2 = page2.rows[0];

  assert.ok(lastRowPage1.item.plays >= firstRowPage2.item.plays);
  assert.equal(lastRowPage1.metricRank, 25);
  assert.equal(firstRowPage2.metricRank, 26);

  assert.equal(lastRowPage1.share, lastRowPage1.item.plays / totalPlays);
  assert.equal(firstRowPage2.share, firstRowPage2.item.plays / totalPlays);
});

test('A09: homonym tracks by different artists are distinguished with distinct semantic links', () => {
  const items = [
    {
      id: 1,
      tk: 1,
      name: 'Hold On',
      artist: 'Alabama Shakes',
      plays: 80,
      ms: 24000000
    },
    {
      id: 2,
      tk: 2,
      name: 'Hold On',
      artist: 'Tom Waits',
      plays: 75,
      ms: 22000000
    }
  ];

  const res = queryCatalog(items, {
    metric: 'plays',
    totalMetric: 155,
    page: 1,
    pageSize: 25
  });

  const html = catalogTableHTML(res, {
    tab: 'tracks',
    metric: 'plays',
    sortBy: 'plays',
    sortDir: 'desc'
  });

  assert.ok(html.includes('Alabama Shakes'));
  assert.ok(html.includes('Tom Waits'));
  assert.ok(html.includes('#/v1/track/Alabama%20Shakes/Hold%20On'));
  assert.ok(html.includes('#/v1/track/Tom%20Waits/Hold%20On'));
});
