import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFilterState } from '../src/filters.js';
import { portableFilterParams, resolvePortableFilters } from '../app/filter-ui.js';

test('entity filters resolve by identity after internal ids change', () => {
  const makeModel = (artistId, trackId, albumId) => ({
    artists: { byId: new Map([[artistId, { id: artistId, name: 'A/\ud800' }]]) },
    tracks: { byId: new Map([[trackId, { tk: trackId, name: 'Song?', artist: 'A/\ud800' }]]) },
    albums: { byId: new Map([[albumId, { id: albumId, name: 'Album', artist: 'A/\ud800' }]]) }
  });
  const first = makeModel(1, 4294967297, 4294967297);
  const second = makeModel(2, 8589934594, 8589934594);
  const state = { ...emptyFilterState(), artistId: 1, trackId: 4294967297, albumId: 4294967297 };
  const query = portableFilterParams(state, first);
  const restored = resolvePortableFilters(query, second);
  assert.equal(restored.unresolved, false);
  assert.equal(restored.state.artistId, 2);
  assert.equal(restored.state.trackId, 8589934594);
  assert.equal(restored.state.albumId, 8589934594);
});

test('legacy numeric entity filters do not select an unrelated entity', () => {
  const model = { artists: { byId: new Map([[1, { id: 1, name: 'Other' }]]) }, tracks: { byId: new Map() }, albums: { byId: new Map() } };
  const restored = resolvePortableFilters('?ar=1', model);
  assert.equal(restored.unresolved, true);
  assert.equal(restored.state.artistId, null);
});
