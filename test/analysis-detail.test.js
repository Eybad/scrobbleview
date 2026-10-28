import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisEngine } from '../app/analysis-engine.js';
import { emptyFilterState } from '../src/filters.js';
import { createAnalysisState } from '../app/analysis-state.js';
import { renderView } from '../app/views.js';

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

test('loaded detail reaches the rendered day through the analysis controller', async () => {
  const entry = {
    ts: '2024-01-01T01:00:00Z', ms_played: 60000,
    master_metadata_track_name: '<Track>', master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album'
  };
  const engine = createAnalysisEngine();
  const loaded = await engine.handle('load', { timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify([entry])]) }] });
  const state = createAnalysisState({ request: (type, payload) => engine.handle(type, payload) });
  state.initialize(loaded.model);
  const result = await state.update(emptyFilterState(), { view: 'day', id: '2024-01-01' });
  const html = renderView('day', result.model, '2024-01-01', { detail: result.detail, detailRequested: true });
  assert.ok(html.includes('&lt;Track&gt;'));
  assert.ok(!html.includes('<Track>'));
  assert.ok(html.includes('Mostrando 1–1 de 1'));
  assert.ok(html.includes('Album'));
});

test('track detail attributes plays to albums within the selected history', async () => {
  const entries = ['First', 'Second', 'Second'].map((album, index) => ({
    ts: new Date((1704067200 + index * 60) * 1000).toISOString(), ms_played: 60000,
    master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: album
  }));
  const engine = createAnalysisEngine();
  const { model } = await engine.handle('load', { timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(entries)]) }] });
  const id = [...model.tracks.byId.keys()][0];
  const detail = await engine.handle('trackDetail', { id });
  assert.deepEqual(detail.rows.map(row => [row.name, row.plays, row.ms]), [
    ['Second', 2, 120000], ['First', 1, 60000]
  ]);
  assert.equal(detail.firstUtc, 1704067200);
});
