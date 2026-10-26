// parse.js — parse(src, opts) → Dataset
//
// async, I/O. Consume uno o más ByteSource (src | src[]), corre el scanner
// incremental con re-chunkeo (el parse.js controla el tamaño de chunk que ve el
// scanner, independiente de cómo el adapter entrega los bytes), y construye el
// Dataset columnar. Los Interners y columnas se COMPARTEN entre archivos: los
// ids de dict son consistentes y las columnas concatenan naturalmente.
//
// Fail-fast, todo o nada: nunca modelo parcial. Descartes esperados (episodios,
// eventos sin ts/track) → warnings en meta, nunca silenciosos.

import { createScanner } from './impl/scan.js';
import { Interner } from './impl/intern.js';
import { createColumns } from './impl/columns.js';
import { parseISOToEpoch } from './impl/ts.js';
import { decodeJSONString, hasEscape, utf8Encode } from './text.js';
import { EmptyFileError, SchemaError, FileError, AbortError } from './errors.js';
import { assertDataset } from './dataset.js';

import { resolveOptions } from '../defaults.js';

export async function parse(src, opts = {}) {
  const sources = Array.isArray(src) ? src : [src];
  if (sources.length === 0) throw new TypeError('parse: al menos un ByteSource');
  opts = resolveOptions(opts);
  const chunkBytes = opts.chunkBytes;
  const onProgress = opts.onProgress ?? null;

  const tracks = new Interner();
  const artists = new Interner();
  const albums = new Interner();
  const reasons = new Interner();
  const cols = createColumns();
  const warnings = [];
  let count = 0;
  let bytesRead = 0;
  let tsMin = Infinity;
  const totalBytes = sources.reduce((a, s) => a + (s.totalBytes || 0), 0);
  let readSoFar = 0;
  let sourceMin = Infinity, sourceMax = -Infinity;
  const sourceRanges = [];

  function onEvent(ev) {
    count++;
    if (count > opts.maxEvents) throw new FileError('El historial excede el límite de eventos. Cargá menos archivos.', { code: 'E_LIMIT_EVENTS' });
    if (!ev.ts) { warnings.push({ code: 'NO_TS', index: count }); return; }
    const t = parseISOToEpoch(hasEscape(ev.ts) ? utf8Encode(decodeJSONString(ev.ts)) : ev.ts);
    if (t === null) { warnings.push({ code: 'BAD_TS', index: count }); return; }

    if (ev.uri) {
      const uri = decodeJSONString(ev.uri);
      if (uri.startsWith('spotify:episode:')) { warnings.push({ code: 'EPISODE', index: count }); return; }
    }
    // v2 is_music: bool(uri or track). Sin uri Y sin track → no es música.
    if (!ev.uri && !ev.track) { warnings.push({ code: 'EPISODE', index: count }); return; }
    if (!ev.track) { warnings.push({ code: 'NO_TRACK', index: count }); return; }

    const tr = tracks.add(ev.track);
    const ar = ev.artist ? artists.add(ev.artist) : 0;
    const al = ev.album ? albums.add(ev.album) : 0;
    const rs = ev.reasonStart ? reasons.add(ev.reasonStart) : 0;
    const re = ev.reasonEnd ? reasons.add(ev.reasonEnd) : 0;
    if (rs > 255 || re > 255) {
      throw new SchemaError('Demasiados reason_* distintos (máx 255)');
    }

    // ms_played negativo, NaN o imposible (> 24 h): un valor así se storeaba
    // tal cual en Uint32Array (-1 → 4294967295, ~49,7 días en una pista).
    // Se acota a 0 con warning BAD_MS y el evento se conserva.
    let m = ev.ms ?? 0;
    if (ev.ms != null && (!(ev.ms >= 0) || ev.ms > 86400000 || !Number.isInteger(ev.ms))) {
      warnings.push({ code: 'BAD_MS', index: count });
      m = 0;
    }
    let flags = 0;
    if (ev.shuffle) flags |= 1;
    if (ev.skipped) flags |= 2;
    if (ev.offline) flags |= 4;
    if (ev.ms == null || m !== ev.ms) flags |= 8;
    if (ev.shuffle == null) flags |= 16;
    if (ev.skipped == null) flags |= 32;
    if (ev.offline == null) flags |= 64;

    sourceMin = Math.min(sourceMin, t);
    sourceMax = Math.max(sourceMax, t);
    cols.push(t, m, tr, ar, al, rs, re, flags);
    if (t < tsMin) tsMin = t;
  }

  // Loop de archivos: scanner fresco por archivo (cada uno es un array JSON
  // completo), estado compartido (interners/columns/warnings).
  for (const s of sources) {
    sourceMin = Infinity; sourceMax = -Infinity;
    const scanner = createScanner({ onEvent, maxDepth: opts.maxDepth, maxTokenBytes: opts.maxTokenBytes });
    let carry = null;
    try {
      if (totalBytes > opts.maxBytes) throw new FileError('Los archivos exceden el límite de bytes. Cargá menos archivos.', { code: 'E_LIMIT_BYTES' });
      for (;;) {
        if (opts.signal?.aborted) throw new AbortError();
        const r = await s.next();
        if (r.done) break;
        if (opts.signal?.aborted) throw new AbortError();
        bytesRead += r.value.length;
        if (bytesRead > opts.maxBytes) throw new FileError('La entrada excede el límite de bytes. Cargá menos archivos.', { code: 'E_LIMIT_BYTES' });
        readSoFar += r.value.length;
        if (carry) {
          const merged = new Uint8Array(carry.length + r.value.length);
          merged.set(carry, 0);
          merged.set(r.value, carry.length);
          carry = merged;
        } else {
          carry = r.value;
        }
        while (carry.length >= chunkBytes) {
          scanner.push(carry.subarray(0, chunkBytes));
          carry = carry.subarray(chunkBytes);
        }
        if (onProgress && totalBytes) {
          onProgress(Math.min(1, readSoFar / totalBytes), s.label);
        }
      }
      if (opts.signal?.aborted) throw new AbortError();
      if (carry && carry.length > 0) scanner.push(carry);
      scanner.end();
      if (sourceMin !== Infinity) {
        if (sourceRanges.some((range) => sourceMin <= range.to && sourceMax >= range.from)) warnings.push({ code: 'OVERLAPPING_SOURCES', source: s.label });
        sourceRanges.push({ from: sourceMin, to: sourceMax });
      }
    } catch (err) {
      // Con varias fuentes, el error debe decir QUÉ archivo falló (código y
      // byteOffset intactos: solo se antepone el label al mensaje).
      if (err && (err.code === 'E_PARSE' || err.code === 'E_SCHEMA') && s.label) {
        err.message = `[${s.label}] ${err.message}`;
      }
      throw err;
    } finally {
      await s.close();
    }
  }

  if (cols.length === 0) {
    throw new EmptyFileError('No se encontraron eventos musicales');
  }

  const ds = cols.finish(tsMin, {
    tracks,
    artists,
    albums,
    reasons,
    warnings,
    sources: sources.map((s) => s.label),
    bytesRead
  });
  assertDataset(ds);
  return ds;
}
