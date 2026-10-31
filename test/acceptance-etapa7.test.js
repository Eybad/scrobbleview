import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate } from '../src/aggregate/aggregate.js';
import { analyze } from '../src/analyze.js';
import { createAnalysisEngine } from '../app/analysis-engine.js';
import { emptyFilterState } from '../src/filters.js';
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
    assert.equal(result.model.retention.r30.rate, 1);
    const longitudinal = await engine.handle('longitudinal', {
      state: emptyFilterState(), thresholdDays: 30, pageSize: 25
    });
    assert.equal(longitudinal.comebacks.tracks.rows[0].gapDays, 95);
    const ds = buildDataset(input.map(event => ({
      t: Date.parse(event.ts) / 1000, m: event.ms_played, track: 'Track', artist: 'Artist', album: 'Album'
    })));
    const direct = await analyze(ds, { tz: fixedTz('UTC', 0) });
    assert.equal(direct.comebacks.tracks[0].gapDays, 95);
  }
});

test('equal timestamps are not returns and filters do not hide later observations', async () => {
  const start = 1704067200;
  const entries = [
    { day: 0, track: 'A', shuffle: true },
    { day: 0, track: 'A', shuffle: false },
    { day: 5, track: 'B', shuffle: true },
    { day: 10, track: 'B', shuffle: false },
    { day: 100, track: 'C', shuffle: false }
  ].map(({ day, track, shuffle }) => ({
    ts: new Date((start + day * 86400) * 1000).toISOString(),
    ms_played: 60000,
    master_metadata_track_name: track,
    master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album',
    shuffle
  }));
  const engine = createAnalysisEngine();
  await engine.handle('load', { timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(entries)]) }] });
  const { model } = await engine.handle('filter', { state: { ...emptyFilterState(), shuffle: true } });
  assert.deepEqual(model.retention.r30, {
    total: 2, eligible: 2, insufficient: 0, returned: 1, rate: 0.5, days: 30
  });
  assert.deepEqual(model.retention.r90, {
    total: 2, eligible: 2, insufficient: 0, returned: 1, rate: 0.5, days: 90
  });
});
test('A23: historical first appearances and comebacks computed on original timeline survive filtering', () => {
  const D0 = 1704067200;
  const DAY = 86400;

  const events = [
    { t: D0, m: 60000, track: 'Song 1', artist: 'Artist A' },
    { t: D0 + 10 * DAY, m: 60000, track: 'Song 1', artist: 'Artist A' },
    { t: D0 + 20 * DAY, m: 60000, track: 'Song 2', artist: 'Artist B' },
    { t: D0 + 100 * DAY, m: 60000, track: 'Song 1', artist: 'Artist A' },
    { t: D0 + 120 * DAY, m: 60000, track: 'Song 2', artist: 'Artist B' }
  ];
  const ds = buildDataset(events);

  const fullComebacks = computeComebacks(ds, { thresholdDays: 30 });
  assert.equal(fullComebacks.tracks.length, 2);
  assert.equal(fullComebacks.tracks[0].name, 'Song 2');
  assert.equal(fullComebacks.tracks[0].gapDays, 100);
  assert.equal(fullComebacks.tracks[1].name, 'Song 1');
  assert.equal(fullComebacks.tracks[1].gapDays, 90);
  assert.equal(fullComebacks.tracks[1].returnUtc, D0 + 100 * DAY);
  assert.equal(fullComebacks.tracks[1].lastSeenUtc, D0 + 10 * DAY);

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

  const ret30 = computeRetention(ds, { days: 30 });
  assert.equal(ret30.total, 4);
  assert.equal(ret30.eligible, 3);
  assert.equal(ret30.insufficient, 1);
  assert.equal(ret30.returned, 1);
  assert.equal(ret30.rate, 1 / 3);

  const ret90 = computeRetention(ds, { days: 90 });
  assert.equal(ret90.total, 4);
  assert.equal(ret90.eligible, 2);
  assert.equal(ret90.insufficient, 2);
  assert.equal(ret90.returned, 2);
  assert.equal(ret90.rate, 1);

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
  const D0 = 1704067200;
  const DAY = 86400;

  const events = [
    { t: D0, m: 60000, track: 'A', artist: 'X', flags: 2 },
    { t: D0 + DAY, m: 60000, track: 'B', artist: 'X', flags: 1 },
    { t: D0 + 35 * DAY, m: 60000, track: 'C', artist: 'Y', flags: 0 },
    { t: D0 + 36 * DAY, m: 60000, track: 'D', artist: 'Y', flags: 32 }
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
  assert.equal(jan.hhi, 1);

  const feb = monthly.get(202402);
  assert.equal(feb.plays, 2);
  assert.equal(feb.skipKnown, 1);
  assert.equal(feb.skips, 0);
  assert.equal(feb.skipRate, 0);
});

test('Worker longitudinal query keeps historical returns and pages filtered discoveries', async () => {
  const start = 1704067200;
  const day = 86400;
  const event = (offset, track, artist, extra = {}) => ({
    ts: new Date((start + offset * day) * 1000).toISOString(),
    master_metadata_track_name: track,
    master_metadata_album_artist_name: artist,
    ms_played: 60000,
    skipped: false,
    shuffle: false,
    offline: false,
    ...extra
  });
  const entries = [
    event(0, 'A', 'Artist A', { skipped: true }),
    event(0, 'B', 'Artist B'),
    event(10, 'A', 'Artist A', { ms_played: undefined, skipped: null, shuffle: null, offline: null }),
    event(10, 'Unknown', 'Unknown artist', { ms_played: undefined, skipped: null, shuffle: null, offline: null }),
    event(20, 'A', 'Artist A', { shuffle: true }),
    event(40, 'A', 'Artist A', { offline: true }),
    event(40, 'B', 'Artist B'),
    ...Array.from({ length: 30 }, (_, index) => event(40, `New ${index}`, 'Artist C'))
  ];
  const engine = createAnalysisEngine();
  const { model } = await engine.handle('load', {
    timeZone: 'UTC',
    files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(entries)]) }]
  });

  const complete = await engine.handle('longitudinal', {
    state: emptyFilterState(),
    thresholdDays: 30,
    pages: { comebackTracks: 1, comebackArtists: 1, firstTracks: 1, firstArtists: 1 },
    pageSize: 25
  });
  const jan = complete.monthly.get(202401);
  assert.equal(jan.plays, 5);
  assert.equal(jan.skipKnown, 3);
  assert.equal(jan.skipUnknown, 2);
  assert.equal(jan.skips, 1);
  assert.equal(jan.skipRate, 1 / 3);
  assert.equal(jan.concentration.artists.knownEntities, 2);
  assert.equal(jan.concentration.artists.unknownEntities, 1);
  assert.equal(jan.concentration.artists.knownMs, 180000);
  assert.equal(jan.concentration.artists.hhi, 5 / 9);
  assert.equal(complete.comebacks.tracks.total, 1);
  assert.equal(complete.comebacks.tracks.rows[0].name, 'B');
  assert.equal(complete.comebacks.tracks.rows[0].gapDays, 40);
  assert.equal(complete.firstAppearances.tracks.total, 33);
  assert.equal(complete.firstAppearances.tracks.rows.length, 25);
  const { renderView } = await import('../app/views.js');
  const discoveryHtml = renderView('discovery', model, null, {
    longitudinal: complete,
    comebackThresholdDays: 30,
    longitudinalPageSize: 25,
    longitudinalPages: { comebackTracks: 1, comebackArtists: 1, firstTracks: 1, firstArtists: 1 }
  });
  const habitsHtml = renderView('habits', model, null, { longitudinal: complete });
  assert.ok(discoveryHtml.includes('data-comeback-threshold'));
  assert.ok(discoveryHtml.includes('data-longitudinal-page="firstTracks"'));
  assert.ok(discoveryHtml.includes('Con tiempo conocido'));
  assert.ok(habitsHtml.includes('Tasas mensuales con base conocida'));
  assert.ok(habitsHtml.includes('Bandera desconocida'));

  const selected = await engine.handle('longitudinal', {
    state: { ...emptyFilterState(), range: { from: start + 40 * day, to: start + 40 * day + 86399 } },
    thresholdDays: 30,
    pages: { comebackTracks: 1, comebackArtists: 1, firstTracks: 2, firstArtists: 1 },
    pageSize: 25
  });
  assert.deepEqual(selected.comebacks.tracks.rows.map((row) => row.name), ['B']);
  assert.equal(selected.comebacks.artists.rows[0].name, 'Artist B');
  assert.equal(selected.firstAppearances.tracks.total, 30);
  assert.equal(selected.firstAppearances.tracks.page, 2);
  assert.equal(selected.firstAppearances.tracks.rows.length, 5);
  assert.ok(selected.firstAppearances.tracks.rows.every((row) => row.name.startsWith('New ')));
  assert.deepEqual(selected.firstAppearances.artists.rows.map((row) => row.name), ['Artist C']);

  const longerThreshold = await engine.handle('longitudinal', {
    state: { ...emptyFilterState(), range: { from: start + 40 * day, to: start + 40 * day + 86399 } },
    thresholdDays: 90,
    pages: { comebackTracks: 1, comebackArtists: 1 },
    pageSize: 25
  });
  assert.equal(longerThreshold.comebacks.tracks.total, 0);
  assert.equal(longerThreshold.comebacks.artists.total, 0);
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

  assert.ok(html.includes('Regresos de canciones tras pausas de 30 días o más'));
  assert.ok(html.includes('Retorno a 30 días'));
  assert.ok(html.includes('Retorno a 90 días'));
  assert.ok(html.includes('Primera aparición histórica'));
});
