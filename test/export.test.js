// test/export.test.js — export del modelo procesado a JSON plano.
import test from 'node:test';
import assert from 'node:assert/strict';

import { modelToJSON, exportFilename } from '../src/export.js';
import { analyze } from '../src/analyze.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { syntheticJSON } from '../src/synthetic.js';

const UTC = fixedTz('utc', 0);

async function demoModel() {
  return analyze(memoryBytes('demo.json', syntheticJSON(800, 9)), { tz: UTC, now: 1704067200 });
}

function hasNonPlain(v, seen = new Set()) {
  if (v instanceof Map || v instanceof Set || ArrayBuffer.isView(v)) return true;
  if (v && typeof v === 'object') {
    if (seen.has(v)) return false;
    seen.add(v);
    return Object.values(v).some((x) => hasNonPlain(x, seen));
  }
  return false;
}

test('export: sobre con formato/versión y totales intactos', async () => {
  const model = await demoModel();
  const out = modelToJSON(model, { now: 1704067200 });
  assert.equal(out.format, 'scrobbleview-export');
  assert.equal(out.version, 1);
  assert.equal(out.exportedAt, 1704067200);
  assert.equal(out.model.totals.records, model.totals.records);
  assert.equal(out.model.totals.ms, model.totals.ms);
  assert.equal(Object.keys(out.model.artists.byId).length, model.artists.byId.size);
  assert.equal(Object.keys(out.model.tracks.byId).length, model.tracks.byId.size);
});

test('export: todo plano y serializable (sin Map/Set/typed arrays)', async () => {
  const model = await demoModel();
  const out = modelToJSON(model, { now: 1704067200 });
  assert.ok(!hasNonPlain(out), 'sin Map, Set ni vistas tipadas');
  const round = JSON.parse(JSON.stringify(out));
  assert.equal(round.model.totals.records, model.totals.records);
  assert.ok(round.model.cols.t.length > 0, 'columnas presentes');
});

test('export: nombre de archivo determinista', () => {
  assert.equal(exportFilename(1704067200), 'scrobbleview-20240101-000000.json');
});
