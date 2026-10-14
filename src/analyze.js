// analyze.js — fachada: analyze(sources, opts) → StatsModel
//
// Caso común: arrastrar archivos → dashboard. Orquesta parse + aggregate sobre
// el mismo seam que los tests. sources: ByteSource | ByteSource[].

import { parse } from './parse/parse.js';
import { aggregate } from './aggregate/aggregate.js';
import { DEFAULT_MIN_MS, DEFAULT_SKIP_THRESHOLD_MS, DEFAULT_CHUNK_BYTES } from './defaults.js';

export async function analyze(sources, opts = {}) {
  const tz = opts.tz;
  if (!tz || typeof tz.offsetMinutes !== 'function') {
    throw new TypeError('analyze: se requiere tz (puerto offsetMinutes(t))');
  }
  const ds = await parse(sources, {
    chunkBytes: opts.chunkBytes ?? DEFAULT_CHUNK_BYTES,
    onProgress: opts.onProgress ?? null
  });
  return aggregate(ds, {
    tz,
    now: opts.now,
    minMs: opts.minMs ?? DEFAULT_MIN_MS,
    skipThresholdMs: opts.skipThresholdMs ?? DEFAULT_SKIP_THRESHOLD_MS
  });
}