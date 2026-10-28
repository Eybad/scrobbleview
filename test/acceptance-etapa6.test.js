import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset } from './fakes/dataset.js';
import { aggregate } from '../src/aggregate/aggregate.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { trackKey } from '../src/aggregate/impl/groups.js';

test('A21: A->B->A and day pause distinguishes selection, original consecutive, and session adjacency', () => {
  const UTC = fixedTz('UTC', 0);
  const D0 = 1704067200; // 2024-01-01 00:00:00

  // Case 1: A -> B -> A. When filtered to A:
  // - Selection adjacency counts A -> A (1 pair)
  // - Original consecutive counts 0 pairs
  // - Original session counts 0 pairs
  const eventsABA = [
    { t: D0, m: 60000, track: 'Song A', artist: 'Artist A' },
    { t: D0 + 100, m: 60000, track: 'Song B', artist: 'Artist B' },
    { t: D0 + 200, m: 60000, track: 'Song A', artist: 'Artist A' }
  ];
  const dsABA = buildDataset(eventsABA);
  const filteredIndices = [0, 2]; // Filter out Artist B

  const mABA = aggregate(dsABA, { tz: UTC, indices: filteredIndices });

  assert.equal(mABA.transitions.selection.auto, 1);
  assert.equal(mABA.transitions.originalConsecutive.auto, 0);
  assert.equal(mABA.transitions.originalSession.auto, 0);

  const tkA = trackKey(dsABA.tr[0], dsABA.ar[0]);
  assert.equal(mABA.behavior.maxRun.selection.get(tkA), 2);
  assert.equal(mABA.behavior.maxRun.originalConsecutive.get(tkA), 1);
  assert.equal(mABA.behavior.maxRun.originalSession.get(tkA), 1);

  // Case 2: A -> A with 2 days pause (same artist, consecutive in original history, but different sessions):
  // - Selection adjacency counts 1
  // - Original consecutive counts 1
  // - Original session counts 0 (separated by 2 days gap > 30 min)
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

  // Track 1: 10:00 to 10:10 (600s).
  // Track 2: 10:45 to 11:30 (45 min = 2700s play, starting at 10:45 UTC, bridging the gap).
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
