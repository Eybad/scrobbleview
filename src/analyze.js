// analyze.js — fachada: analyze(sources, opts) → StatsModel
//
// Caso común: arrastrar archivos → dashboard. Orquesta parse + aggregate sobre
// el mismo seam que los tests. sources: ByteSource | ByteSource[].

import { parse } from './parse/parse.js';
import { aggregate } from './aggregate/aggregate.js';
import { assertDataset } from './parse/dataset.js';
import { resolveOptions } from './defaults.js';

// Accepting a parsed dataset lets the composition root construct its time zone
// from the actual range before crossing the same aggregation seam.
export async function analyze(input, options = {}) {
  const opts = resolveOptions(options);
  if (!opts.tz || typeof opts.tz.offsetMinutes !== 'function') {
    throw new TypeError('analyze: se requiere tz (puerto offsetMinutes(t))');
  }
  const ds = ArrayBuffer.isView(input?.t) ? input : await parse(input, opts);
  assertDataset(ds);
  return aggregate(ds, opts);
}
