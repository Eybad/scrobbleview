import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from './fakes/dataset.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { trackKey } from '../src/aggregate/impl/groups.js';
import { createAnalysisEngine } from '../app/analysis-engine.js';
import { emptyFilterState } from '../src/filters.js';

test('original session sequences include pairs joined by a later interval', () => {
  const start = 1704067200;
  const ds = buildDataset([
    { t: start, m: 60000, track: 'A', artist: 'Artist' },
    { t: start + 7200, m: 60000, track: 'A', artist: 'Artist' },
    { t: start + 10800, m: 10800000, track: 'A', artist: 'Artist' }
  ]);
  const model = aggregate(ds, { tz: fixedTz('UTC', 0) });
  const key = trackKey(ds.tr[0], ds.ar[0]);
  assert.equal(model.sessionsStats.count, 1);
  assert.equal(model.sessions[0].plays, 3);
  assert.equal(model.transitions.originalSession.auto, 2);
  assert.equal(model.behavior.maxRun.originalSession.get(key), 3);
  const selected = aggregate(ds, { tz: fixedTz('UTC', 0), indices: [0, 1] });
  assert.equal(selected.sessionsStats.count, 2);
  assert.equal(selected.transitions.originalSession.auto, 1);
  assert.equal(selected.behavior.maxRun.originalSession.get(key), 2);
});

test('engine keeps original session membership when the bridge is filtered out', async () => {
  const start = 1704067200;
  const entries = [
    { offset: 0, ms: 60000, shuffle: true },
    { offset: 7200, ms: 60000, shuffle: true },
    { offset: 10800, ms: 10800000, shuffle: false }
  ].map(({ offset, ms, shuffle }) => ({
    ts: new Date((start + offset) * 1000).toISOString(), ms_played: ms, shuffle,
    master_metadata_track_name: 'A', master_metadata_album_artist_name: 'Artist',
    master_metadata_album_album_name: 'Album'
  }));
  const engine = createAnalysisEngine();
  await engine.handle('load', { timeZone: 'UTC', files: [{ name: 'synthetic.json', blob: new Blob([JSON.stringify(entries)]) }] });
  const { model } = await engine.handle('filter', { state: { ...emptyFilterState(), shuffle: true } });
  assert.equal(model.sessionsStats.count, 2);
  assert.equal(model.transitions.originalSession.auto, 1);
  assert.equal([...model.behavior.maxRun.originalSession.values()][0], 2);
  assert.equal('cols' in model, false);
});

test('A21: A->B->A and day pause distinguishes selection, original consecutive, and session adjacency', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;

  const eventsABA = [
    { t: D0, m: 60000, track: 'Song A', artist: 'Artist A' },
    { t: D0 + 100, m: 60000, track: 'Song B', artist: 'Artist B' },
    { t: D0 + 200, m: 60000, track: 'Song A', artist: 'Artist A' }
  ];
  const dsABA = buildDataset(eventsABA);
  const filteredIndices = [0, 2];

  const mABA = aggregate(dsABA, { tz: UTC, indices: filteredIndices });

  assert.equal(mABA.transitions.selection.auto, 1);
  assert.equal(mABA.transitions.originalConsecutive.auto, 0);
  assert.equal(mABA.transitions.originalSession.auto, 0);

  const tkA = trackKey(dsABA.tr[0], dsABA.ar[0]);
  assert.equal(mABA.behavior.maxRun.selection.get(tkA), 2);
  assert.equal(mABA.behavior.maxRun.originalConsecutive.get(tkA), 1);
  assert.equal(mABA.behavior.maxRun.originalSession.get(tkA), 1);

  const eventsPause = [
    { t: D0, m: 60000, track: 'Song A', artist: 'Artist A' },
    { t: D0 + 2 * 86400, m: 60000, track: 'Song A', artist: 'Artist A' }
  ];
  const dsPause = buildDataset(eventsPause);
  const mPause = aggregate(dsPause, { tz: UTC });

  assert.equal(mPause.transitions.selection.auto, 1);
  assert.equal(mPause.transitions.originalConsecutive.auto, 1);
  assert.equal(mPause.transitions.originalSession.auto, 0);

  const tkPause = trackKey(dsPause.tr[0], dsPause.ar[0]);
  assert.equal(mPause.behavior.maxRun.selection.get(tkPause), 2);
  assert.equal(mPause.behavior.maxRun.originalConsecutive.get(tkPause), 2);
  assert.equal(mPause.behavior.maxRun.originalSession.get(tkPause), 1);
});

test('A20: track shared across albums distinguishes global grouped totals from album attribution', async () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;

  const events = [
    { t: D0, m: 60000, track: 'Shared Song', artist: 'Artist X', album: 'Album 1' },
    { t: D0 + 300, m: 60000, track: 'Shared Song', artist: 'Artist X', album: 'Album 2' },
    { t: D0 + 600, m: 60000, track: 'Shared Song', artist: 'Artist X', album: 'Album 2' }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC });

  const tk = trackKey(ds.tr[0], ds.ar[0]);
  const tr = model.tracks.byId.get(tk);
  assert.equal(tr.plays, 3);
  assert.equal(tr.albums.size, 2);

  const ak1 = [...tr.albums][0];
  const al1 = model.albums.byId.get(ak1);
  const trInAl1 = al1.name === 'Album 1' ? al1.trackStats.get(tk) : model.albums.byId.get([...tr.albums][1]).trackStats.get(tk);
  assert.equal(trInAl1.plays, 1);

  const { renderView } = await import('../app/views.js');
  const htmlAlbumScope = renderView('track', model, tk, { albumOrigin: ak1 });
  assert.ok(htmlAlbumScope.includes('Canción agrupada') || htmlAlbumScope.includes('En este álbum'));
  assert.ok(htmlAlbumScope.includes('Album 1') && htmlAlbumScope.includes('Album 2'));
});

test('A22: sessions merged by long overlapping interval preserve exact membership and coherent totals', async () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200;

  const events = [
    { t: D0 + 600, m: 600000, track: 'Intro', artist: 'Artist 1' },
    { t: D0 + 3300, m: 2700000, track: 'Long Bridge', artist: 'Artist 2' }
  ];
  const ds = buildDataset(events);
  const model = aggregate(ds, { tz: UTC, gapMinutes: 30 });

  assert.equal(model.sessionsStats.count, 1);
  const sess = model.sessions[0];
  assert.equal(sess.plays, 2);
  assert.equal(sess.ms, 3300000);

  const { renderView } = await import('../app/views.js');
  const htmlSess = renderView('session', model, 0);
  assert.ok(htmlSess.includes('Sesión #1'));
  assert.ok(htmlSess.includes('Duración estimada') || htmlSess.includes('Tiempo'));
});
