// Composition root shared by the browser worker and its Node integration tests.
import { analyze } from '../src/analyze.js';
import { parse } from '../src/parse/parse.js';
import { derive } from '../src/aggregate/impl/derive.js';
import { intlTz } from '../src/aggregate/adapters/intl-tz.js';
import { applyFilters, countFiltered, emptyFilterState } from '../src/filters.js';
import { fileBytes } from '../src/parse/adapters/file-bytes.js';
import { zipSources } from '../src/parse/adapters/zip-bytes.js';
import { modelToTables, exportFilename } from '../src/export.js';
import { toCSV } from '../src/export/csv.js';
import { buildZip } from '../src/export/zip.js';
import { save, load } from './storage.js';
import { assertDistinctFiles } from './input.js';
import { isFilterActive, previousRange } from './filter-ui.js';
import { demoSource } from './demo.js';

function timeZoneForDataset(ds, id) {
  let first = Infinity, last = -Infinity;
  for (const value of ds.t) { first = Math.min(first, value); last = Math.max(last, value); }
  return intlTz(id, {
    startSec: Math.max(-2147483648, ds.meta.tsMin + first - 86400),
    endSec: Math.min(2147483647, ds.meta.tsMin + last + 86400)
  });
}

export function createAnalysisEngine() {
  let ds = null, derived = null, tz = null, history = null, generatedAt = null;

  async function aggregateSelection(state, extra = {}) {
    const indices = isFilterActive(state) ? applyFilters(ds, state, tz, derived).indices : undefined;
    return analyze(ds, { tz, derived, indices, history, now: generatedAt, compact: true, albumDetails: null, ...extra });
  }

  async function initialize(dataset, timeZone, report) {
    report(0, 'Preparando zona horaria');
    const nextTz = timeZoneForDataset(dataset, timeZone);
    const nextDerived = derive(dataset, nextTz);
    const now = Math.floor(Date.now() / 1000);
    const model = await analyze(dataset, { tz: nextTz, derived: nextDerived, now, compact: true, albumDetails: null, onProgress: report });
    ds = dataset; tz = nextTz; derived = nextDerived; generatedAt = now;
    const firstAppearances = (entities) => new Map([...entities].map(([key, entity]) => [key, { firstUtc: entity.firstUtc }]));
    history = { tracks: firstAppearances(model.tracks.byId), artists: firstAppearances(model.artists.byId) };
    delete model.cols;
    return { model };
  }

  return {
    async handle(type, payload = {}, report = () => {}) {
      const timeZone = payload.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
      if (type === 'load') {
        let sources;
        if (payload.demo) sources = [demoSource()];
        else {
          assertDistinctFiles(payload.files);
          sources = [];
          for (const file of payload.files) {
            if (/\.zip$/i.test(file.name)) sources.push(...await zipSources(file.blob));
            else sources.push(fileBytes({ name: file.name, size: file.blob.size, slice: (...args) => file.blob.slice(...args) }));
          }
        }
        const dataset = await parse(sources, { onProgress: report });
        return initialize(dataset, timeZone, report);
      }
      if (type === 'cached') {
        const dataset = await load();
        return dataset ? initialize(dataset, timeZone, report) : null;
      }
      if (!ds) throw new Error('Cargá un historial antes de calcular estadísticas.');
      if (type === 'save') return save(ds);
      if (type === 'filter') {
        const state = payload.state ?? emptyFilterState();
        const model = isFilterActive(state) ? await aggregateSelection(state, { onProgress: report }) : null;
        const prev = state.range ? countFiltered(ds, { ...state, range: previousRange(state.range) }, tz, derived) : null;
        if (model) delete model.cols;
        return { model, prev };
      }
      if (type === 'album') {
        const id = Number(payload.id);
        const state = payload.state ?? emptyFilterState();
        if (!Number.isSafeInteger(id) || id <= 0 || (state.albumId != null && state.albumId !== id)) return null;
        const model = await aggregateSelection({ ...state, albumId: id }, { albumDetails: id, onProgress: report });
        return model.albums.byId.get(id) ?? null;
      }
      if (type === 'export') {
        const model = await aggregateSelection(emptyFilterState(), { albumDetails: undefined, onProgress: report });
        report(0, 'Exportando tablas');
        const encoder = new TextEncoder();
        const entries = modelToTables(model).map(({ name, headers, rows }) => ({
          name: `${name}.csv`, bytes: encoder.encode(`\uFEFF${toCSV(headers, rows)}`)
        }));
        const bytes = await buildZip(entries);
        report(1, 'Exportación lista');
        return { bytes, filename: exportFilename(Math.floor(Date.now() / 1000)).replace(/\.json$/, '.zip') };
      }
      throw new TypeError('Operación de análisis desconocida.');
    }
  };
}
