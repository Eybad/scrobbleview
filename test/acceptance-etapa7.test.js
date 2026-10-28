import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/aggregate/aggregate.js';
import { analyze } from '../src/analyze.js';
import { createAnalysisEngine } from '../app/analysis-engine.js';
import { buildDataset } from './fakes/dataset.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { trackKey } from '../src/aggregate/impl/groups.js';
import {
  computeComebacks,
  computeRetention,
  computeMonthlyLongitudinal
} from '../src/longitudinal.js';

test('historical results follow UTC order and selected return events', () => {
  const start = 1704067200;
  const events = [0, 5, 100].map(day => ({
    t: start + day * 86400, m: 60000, track: 'Track', artist: 'Artist'
  }));
  for (const input of [events, [...events].reverse()]) {
    const ds = buildDataset(input);
    const model = aggregate(ds, { tz: fixedTz('UTC', 0) });
    assert.equal(model.comebacks.tracks.length, 1);
    assert.equal(model.comebacks.tracks[0].gapDays, 95);
    assert.equal(model.retention.r30.rate, 1);
    const returnIndex = input.findIndex(event => event.t === events[2].t);
    const selected = aggregate(ds, { tz: fixedTz('UTC', 0), indices: [returnIndex] });
    assert.equal(selected.comebacks.tracks.length, 1);
    const firstIndex = input.findIndex(event => event.t === events[0].t);
    const withoutReturn = aggregate(ds, { tz: fixedTz('UTC', 0), indices: [firstIndex] });
    assert.equal(withoutReturn.comebacks.tracks.length, 0);
  }
});

test('retention cohort contains selected historical first appearances', () => {
  const start = 1704067200;
  const ds = buildDataset([
    { t: start, track: 'A', artist: 'Artist' },
    { t: start, track: 'B', artist: 'Artist' },
    { t: start + 5 * 86400, track: 'A', artist: 'Artist' },
    { t: start + 100 * 86400, track: 'C', artist: 'Artist' }
  ]);
  const model = aggregate(ds, { tz: fixedTz('UTC', 0), indices: [0] });
  assert.deepEqual(model.retention.r30, {
    total: 1, eligible: 1, insufficient: 0, returned: 1, rate: 1, days: 30
  });
  const later = aggregate(ds, { tz: fixedTz('UTC', 0), indices: [2] });
  assert.equal(later.retention.r30.total, 0);
});

test('analysis engine preserves historical results when input order is reversed', async () => {
  const days = [0, 5, 100];
  const entries = days.map(day => ({
    ts: new Date((1704067200 + day * 86400) * 1000).toISOString(),
    ms_played: 60000,
    master_metadata_track_name: 'Track',
    master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album'
  }));
  for (const input of [entries, [...entries].reverse()]) {
    const engine = createAnalysisEngine();
    const result = await engine.handle('load', {
      timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(input)]) }]
    });
    assert.equal(result.model.comebacks.tracks[0].gapDays, 95);
    assert.equal(result.model.retention.r30.rate, 1);
    const ds = buildDataset(input.map(event => ({
      t: Date.parse(event.ts) / 1000, m: event.ms_played, track: 'Track', artist: 'Artist', album: 'Album'
    })));
    const direct = await analyze(ds, { tz: fixedTz('UTC', 0) });
    assert.equal(direct.comebacks.tracks[0].gapDays, 95);
  }
});
test('A23: historical first appearances and comebacks computed on original timeline survive filtering', () => {
  const D0 = 1704067200; // 2024-01-01 00:00:00 UTC
  const DAY = 86400;

  // History for Song 1:
  // - Event 0: D0 (Day 0) - First appearance
  // - Event 1: D0 + 10*DAY (Day 10) - gap = 10d (< 30d threshold, not a comeback)
  // - Event 2: D0 + 100*DAY (Day 100) - gap = 90d (>= 30d threshold, comeback from Day 10)
  // Song 2:
  // - Event 3: D0 + 20*DAY (Day 20) - First appearance
  // - Event 4: D0 + 120*DAY (Day 120) - gap = 100d (comeback from Day 20)
  const events = [
    { t: D0, m: 60000, track: 'Song 1', artist: 'Artist A' },
    { t: D0 + 10 * DAY, m: 60000, track: 'Song 1', artist: 'Artist A' },
    { t: D0 + 20 * DAY, m: 60000, track: 'Song 2', artist: 'Artist B' },
    { t: D0 + 100 * DAY, m: 60000, track: 'Song 1', artist: 'Artist A' },
    { t: D0 + 120 * DAY, m: 60000, track: 'Song 2', artist: 'Artist B' }
  ];
  const ds = buildDataset(events);

  // Unfiltered comebacks (threshold 30 days)
  const fullComebacks = computeComebacks(ds, { thresholdDays: 30 });
  assert.equal(fullComebacks.tracks.length, 2);
  assert.equal(fullComebacks.tracks[0].name, 'Song 2');
  assert.equal(fullComebacks.tracks[0].gapDays, 100);
  assert.equal(fullComebacks.tracks[1].name, 'Song 1');
  assert.equal(fullComebacks.tracks[1].gapDays, 90);
  assert.equal(fullComebacks.tracks[1].returnUtc, D0 + 100 * DAY);
  assert.equal(fullComebacks.tracks[1].lastSeenUtc, D0 + 10 * DAY);

  // Filter range: [Day 5, Day 110] (D0 + 5*DAY to D0 + 110*DAY)
  // - Song 1 played at Day 10 is NOT a comeback (gap was 10 days in original sequence, not invented pause)
  // - Song 1 played at Day 100 IS a comeback (gap 90 days from Day 10)
  // - Song 2 played at Day 120 is outside the range
  const filteredComebacks = computeComebacks(ds, {
    thresholdDays: 30,
    range: { startUtc: D0 + 5 * DAY, endUtc: D0 + 110 * DAY }
  });

  assert.equal(filteredComebacks.tracks.length, 1);
  assert.equal(filteredComebacks.tracks[0].name, 'Song 1');
  assert.equal(filteredComebacks.tracks[0].gapDays, 90);
  assert.equal(filteredComebacks.tracks[0].lastSeenUtc, D0 + 10 * DAY);
});

test('A24: 30/90 day retention accounts for insufficient follow-up without division by zero', () => {
  const D0 = 1704067200;
  const DAY = 86400;

  // Total dataset duration: 100 days (D0 to D0 + 100*DAY)
  // Track 1: First at Day 0. Dataset has 100 days follow-up (>= 30d, >= 90d: eligible for both).
  //          Played again at Day 15 (returned in 30d and 90d).
  // Track 2: First at Day 0. Played again at Day 45 (returned in 90d, NOT in 30d).
  // Track 3: First at Day 80. Dataset ends at Day 100, so only 20 days follow-up (< 30d, < 90d).
  //          Must be classified as insufficient follow-up in both 30d and 90d.
  // Track 4: First at Day 50. Follow-up is 50 days (>= 30d: eligible; < 90d: insufficient for 90d).
  //          No second play.
  const events = [
    { t: D0, m: 60000, track: 'Track 1', artist: 'Artist 1' },
    { t: D0 + 1, m: 60000, track: 'Track 2', artist: 'Artist 2' },
    { t: D0 + 15 * DAY, m: 60000, track: 'Track 1', artist: 'Artist 1' },
    { t: D0 + 45 * DAY, m: 60000, track: 'Track 2', artist: 'Artist 2' },
    { t: D0 + 50 * DAY, m: 60000, track: 'Track 4', artist: 'Artist 4' },
    { t: D0 + 80 * DAY, m: 60000, track: 'Track 3', artist: 'Artist 3' },
    { t: D0 + 100 * DAY, m: 60000, track: 'Track 1', artist: 'Artist 1' }
  ];
  const ds = buildDataset(events);

  // 30 days retention:
  // Eligible: Track 1 (100d >= 30d), Track 2 (100d >= 30d), Track 4 (50d >= 30d). Total eligible = 3.
  // Insufficient: Track 3 (20d < 30d). Total insufficient = 1.
  // Returned: Track 1 (returned at Day 15). Track 2 returned at Day 45 (> 30d, no). Track 4: no. Total returned = 1.
  const ret30 = computeRetention(ds, { days: 30 });
  assert.equal(ret30.total, 4);
  assert.equal(ret30.eligible, 3);
  assert.equal(ret30.insufficient, 1);
  assert.equal(ret30.returned, 1);
  assert.equal(ret30.rate, 1 / 3);

  // 90 days retention:
  // Eligible: Track 1 (100d >= 90d), Track 2 (100d >= 90d). Total eligible = 2.
  // Insufficient: Track 4 (50d < 90d), Track 3 (20d < 90d). Total insufficient = 2.
  // Returned: Track 1 (returned at 15d), Track 2 (returned at 45d). Total returned = 2.
  const ret90 = computeRetention(ds, { days: 90 });
  assert.equal(ret90.total, 4);
  assert.equal(ret90.eligible, 2);
  assert.equal(ret90.insufficient, 2);
  assert.equal(ret90.returned, 2);
  assert.equal(ret90.rate, 1);

  // Edge case: Dataset with only 5 days span (no track eligible for 30d retention)
  const shortEvents = [
    { t: D0, m: 60000, track: 'Solo', artist: 'Artist Solo' },
    { t: D0 + 5 * DAY, m: 60000, track: 'Solo', artist: 'Artist Solo' }
  ];
  const shortDs = buildDataset(shortEvents);
  const shortRet30 = computeRetention(shortDs, { days: 30 });
  assert.equal(shortRet30.eligible, 0);
  assert.equal(shortRet30.insufficient, 1);
  assert.equal(shortRet30.returned, 0);
  assert.equal(shortRet30.rate, null);
});

test('Monthly longitudinal metrics track concentration and known denominators without NaN', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200; // 2024-01-01
  const DAY = 86400;

  const events = [
    { t: D0, m: 60000, track: 'A', artist: 'X', flags: 2 }, // Jan: skipped (flag 2)
    { t: D0 + DAY, m: 60000, track: 'B', artist: 'X', flags: 1 }, // Jan: shuffle (flag 1)
    { t: D0 + 35 * DAY, m: 60000, track: 'C', artist: 'Y', flags: 0 }, // Feb: neither
    { t: D0 + 36 * DAY, m: 60000, track: 'D', artist: 'Y', flags: 32 } // Feb: skipped unknown (bit 32)
  ];
  const ds = buildDataset(events);
  const monthly = computeMonthlyLongitudinal(ds, UTC);

  assert.ok(monthly.has(202401));
  assert.ok(monthly.has(202402));

  const jan = monthly.get(202401);
  assert.equal(jan.plays, 2);
  assert.equal(jan.skipKnown, 2);
  assert.equal(jan.skips, 1);
  assert.equal(jan.skipRate, 0.5);
  assert.equal(jan.hhi, 1); // Only 1 artist (X)

  const feb = monthly.get(202402);
  assert.equal(feb.plays, 2);
  assert.equal(feb.skipKnown, 1); // Second event has bit 32 (skip unknown)
  assert.equal(feb.skips, 0);
  assert.equal(feb.skipRate, 0);
});

test('discoveryView renders comebacks, retention and first appearances', async () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;
  const DAY = 86400;

  const events = [
    { t: D0, m: 60000, track: 'Intro', artist: 'Band' },
    { t: D0 + 10 * DAY, m: 60000, track: 'Hit', artist: 'Band' },
    { t: D0 + 60 * DAY, m: 60000, track: 'Intro', artist: 'Band' }
  ];
  const ds = buildDataset(events);
  const { aggregate } = await import('../src/aggregate/aggregate.js');
  const model = aggregate(ds, { tz: UTC });

  const { renderView } = await import('../app/views.js');
  const html = renderView('discovery', model);

  assert.ok(html.includes('Regresos tras pausa'));
  assert.ok(html.includes('Retorno a 30 días'));
  assert.ok(html.includes('Retorno a 90 días'));
  assert.ok(html.includes('Primeras apariciones en el período'));
});
