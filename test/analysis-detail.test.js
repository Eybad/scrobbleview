import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisEngine } from '../app/analysis-engine.js';
import { emptyFilterState } from '../src/filters.js';

test('engine pages exact day and session members without expanding the overview', async () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({
    ts: new Date((1704067200 + index * 60) * 1000).toISOString(),
    ms_played: 30000,
    master_metadata_track_name: `Track ${index}`,
    master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album'
  }));
  const engine = createAnalysisEngine();
  const loaded = await engine.handle('load', {
    timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(entries)]) }]
  });
  assert.equal('cols' in loaded.model, false);
  const day = await engine.handle('dayDetail', { id: '2024-01-01', page: 1, pageSize: 25 });
  const session = await engine.handle('sessionDetail', { id: 0, page: 2, pageSize: 25 });
  assert.equal(day.total, 30);
  assert.equal(day.rows.length, 25);
  assert.equal(day.rows[0].track, 'Track 0');
  assert.equal(day.ms, 900000);
  assert.equal(session.total, 30);
  assert.equal(session.rows.length, 5);
  assert.equal(session.rows[0].track, 'Track 25');
  assert.equal(session.summary.plays, 30);
  await assert.rejects(engine.handle('dayDetail', { id: '2024-01-01', pageSize: 500 }), RangeError);
  await assert.rejects(engine.handle('sessionDetail', { id: 0, page: 3 }), RangeError);
});

test('session detail uses selected session membership after interval merging', async () => {
  const entries = [
    { offset: 0, ms: 60000, shuffle: true },
    { offset: 7200, ms: 60000, shuffle: true },
    { offset: 10800, ms: 10800000, shuffle: false }
  ].map(({ offset, ms, shuffle }, index) => ({
    ts: new Date((1704067200 + offset) * 1000).toISOString(), ms_played: ms, shuffle,
    master_metadata_track_name: `Track ${index}`, master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album'
  }));
  const engine = createAnalysisEngine();
  await engine.handle('load', { timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(entries)]) }] });
  const full = await engine.handle('sessionDetail', { id: 0 });
  assert.deepEqual(full.rows.map(row => row.track), ['Track 0', 'Track 1', 'Track 2']);
  const state = { ...emptyFilterState(), shuffle: true };
  const selected = await engine.handle('sessionDetail', { id: 0, state });
  assert.deepEqual(selected.rows.map(row => row.track), ['Track 0']);
  assert.equal(selected.summary.plays, 1);
});
