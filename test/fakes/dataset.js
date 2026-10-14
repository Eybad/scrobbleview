// fakes/dataset.js — construye un Dataset directamente (sin pasar por el parser)
//
// events: [{t, m, track, artist, album, reasonStart, reasonEnd, flags}]
// t en epoch segundos; los strings se internan con dedup (id 0 = vacío).

import { Interner } from '../../src/parse/impl/intern.js';

function intern(interner, map, value) {
  if (!value) return 0;
  let id = map.get(value);
  if (id === undefined) {
    id = interner.insert(value);
    map.set(value, id);
  }
  return id;
}

export function buildDataset(events) {
  const tracks = new Interner();
  const artists = new Interner();
  const albums = new Interner();
  const reasons = new Interner();
  const trackIds = new Map();
  const artistIds = new Map();
  const albumIds = new Map();
  const reasonIds = new Map();

  const n = events.length;
  const t = new Int32Array(n);
  const m = new Uint32Array(n);
  const tr = new Uint32Array(n);
  const ar = new Uint32Array(n);
  const al = new Uint32Array(n);
  const rs = new Uint8Array(n);
  const re = new Uint8Array(n);
  const flags = new Uint8Array(n);
  let tsMin = Infinity;

  for (let i = 0; i < n; i++) {
    const e = events[i];
    t[i] = e.t;
    m[i] = e.m ?? 0;
    tr[i] = intern(tracks, trackIds, e.track);
    ar[i] = intern(artists, artistIds, e.artist);
    al[i] = intern(albums, albumIds, e.album);
    rs[i] = intern(reasons, reasonIds, e.reasonStart);
    re[i] = intern(reasons, reasonIds, e.reasonEnd);
    flags[i] = e.flags ?? 0;
    if (e.t < tsMin) tsMin = e.t;
  }
  for (let i = 0; i < n; i++) t[i] -= tsMin;

  return {
    t, m, tr, ar, al, rs, re, flags,
    dicts: { tracks, artists, albums, reasons },
    meta: { tsMin, count: n, sources: ['fake'], warnings: [], bytesRead: 0 }
  };
}