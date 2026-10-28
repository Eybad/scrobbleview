import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, resolveRoute, formatSemanticRoute } from '../app/routes.js';

test('parseRoute: recognizes versioned semantic routes and legacy routes', () => {
  const r1 = parseRoute('#/v1/artist/Radiohead?m=ms');
  assert.equal(r1.version, 'v1');
  assert.equal(r1.view, 'artist');
  assert.equal(r1.params.artist, 'Radiohead');
  assert.equal(r1.query, 'm=ms');
  assert.equal(r1.isLegacy, false);

  const r2 = parseRoute('#/v1/track/Daft%20Punk/One%20More%20Time');
  assert.equal(r2.version, 'v1');
  assert.equal(r2.view, 'track');
  assert.equal(r2.params.artist, 'Daft Punk');
  assert.equal(r2.params.title, 'One More Time');

  const r3 = parseRoute('#/v1/album/AC%2FDC/Back%20in%20Black');
  assert.equal(r3.version, 'v1');
  assert.equal(r3.view, 'album');
  assert.equal(r3.params.artist, 'AC/DC');
  assert.equal(r3.params.title, 'Back in Black');

  const r4 = parseRoute('#/artist/42');
  assert.equal(r4.isLegacy, true);
  assert.equal(r4.view, 'artist');
  assert.equal(r4.params.legacyId, '42');

  const r5 = parseRoute('#main-content');
  assert.equal(r5.view, 'dashboard');
});

test('A12: semantic routes resolve the same entity regardless of file order / internal IDs', () => {
  const modelOrder1 = {
    artists: {
      byId: new Map([
        [1, { id: 1, name: 'Radiohead' }],
        [2, { id: 2, name: 'Daft Punk' }]
      ])
    },
    tracks: {
      byId: new Map([
        [101, { tk: 101, artist: 'Radiohead', name: 'Creep' }],
        [202, { tk: 202, artist: 'Daft Punk', name: 'One More Time' }]
      ])
    },
    albums: {
      byId: new Map([
        [501, { id: 501, artist: 'Radiohead', name: 'Pablo Honey' }]
      ])
    }
  };

  const modelOrder2 = {
    artists: {
      byId: new Map([
        [1, { id: 1, name: 'Daft Punk' }],
        [2, { id: 2, name: 'Radiohead' }]
      ])
    },
    tracks: {
      byId: new Map([
        [101, { tk: 101, artist: 'Daft Punk', name: 'One More Time' }],
        [202, { tk: 202, artist: 'Radiohead', name: 'Creep' }]
      ])
    },
    albums: {
      byId: new Map([
        [501, { id: 501, artist: 'Radiohead', name: 'Pablo Honey' }]
      ])
    }
  };

  const semanticArtistRoute = parseRoute('#/v1/artist/Radiohead');
  const resolvedInOrder1 = resolveRoute(semanticArtistRoute, modelOrder1);
  const resolvedInOrder2 = resolveRoute(semanticArtistRoute, modelOrder2);

  assert.equal(resolvedInOrder1.entity.name, 'Radiohead');
  assert.equal(resolvedInOrder2.entity.name, 'Radiohead');
  assert.equal(resolvedInOrder1.id, 1);
  assert.equal(resolvedInOrder2.id, 2);

  const semanticTrackRoute = parseRoute('#/v1/track/Radiohead/Creep');
  assert.equal(resolveRoute(semanticTrackRoute, modelOrder1).entity.name, 'Creep');
  assert.equal(resolveRoute(semanticTrackRoute, modelOrder2).entity.name, 'Creep');

  const legacyRoute = parseRoute('#/artist/1');
  assert.equal(resolveRoute(legacyRoute, modelOrder1).entity.name, 'Radiohead');
  assert.equal(resolveRoute(legacyRoute, modelOrder2).entity.name, 'Daft Punk');
});

test('resolveRoute: reports notFound for nonexistent semantic or legacy entities', () => {
  const model = {
    artists: { byId: new Map([[1, { id: 1, name: 'Radiohead' }]]) },
    tracks: { byId: new Map() },
    albums: { byId: new Map() }
  };

  const missingSemantic = resolveRoute(parseRoute('#/v1/artist/UnknownBand'), model);
  assert.equal(missingSemantic.notFound, true);
  assert.equal(missingSemantic.searchedName, 'UnknownBand');

  const missingLegacy = resolveRoute(parseRoute('#/artist/999'), model);
  assert.equal(missingLegacy.notFound, true);
  assert.equal(missingLegacy.searchedName, 'ID 999');
});

test('formatSemanticRoute: correctly formats semantic URLs with encoding and query preservation', () => {
  assert.equal(
    formatSemanticRoute('artist', { name: 'AC/DC' }, 'm=ms'),
    '#/v1/artist/AC%2FDC?m=ms'
  );
  assert.equal(
    formatSemanticRoute('track', { artist: 'Daft Punk', name: 'One More Time' }, '?m=plays&range=2024'),
    '#/v1/track/Daft%20Punk/One%20More%20Time?m=plays&range=2024'
  );
  assert.equal(
    formatSemanticRoute('dashboard', null, 'm=ms'),
    '#/v1/dashboard?m=ms'
  );
});

test('semantic routes preserve isolated surrogates without colliding with literal escape text', () => {
  const names = ['A\ud800B', 'A%uD800B', 'A\udc00B', 'A😀B', 'A/B?C'];
  const routes = names.map(name => formatSemanticRoute('artist', name));
  assert.equal(new Set(routes).size, names.length);
  assert.deepEqual(routes.map(route => parseRoute(route).params.artist), names);
});
