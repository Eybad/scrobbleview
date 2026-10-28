// Composition root shared by the browser worker and its Node integration tests.
import { analyze } from '../src/analyze.js';
import { parse } from '../src/parse/parse.js';
import { derive, selectDerived } from '../src/aggregate/impl/derive.js';
import { originalSessionMembership } from '../src/aggregate/impl/sessions.js';
import { getEventDetail } from './analysis-detail.js';
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
  let ds = null, derived = null, tz = null, history = null, generatedAt = null, originalSessions = null;

  async function aggregateSelection(state, extra = {}) {
    const indices = isFilterActive(state) ? applyFilters(ds, state, tz, derived).indices : undefined;
    return analyze(ds, { tz, derived, indices, history, originalSessions, now: generatedAt, compact: true, albumDetails: null, ...extra });
  }

  async function initialize(dataset, timeZone, report) {
    report(0, 'Preparando zona horaria');
    const nextTz = timeZoneForDataset(dataset, timeZone);
    const nextDerived = derive(dataset, nextTz);
    const nextOriginalSessions = originalSessionMembership(dataset, nextDerived, nextTz);
    const now = Math.floor(Date.now() / 1000);
    const model = await analyze(dataset, { tz: nextTz, derived: nextDerived, originalSessions: nextOriginalSessions, now, compact: true, albumDetails: null, onProgress: report });
    ds = dataset; tz = nextTz; derived = nextDerived; generatedAt = now; originalSessions = nextOriginalSessions;
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
      if (type === 'dayDetail' || type === 'sessionDetail') {
        const state = payload.state ?? emptyFilterState();
        const indices = isFilterActive(state) ? applyFilters(ds, state, tz, derived).indices : null;
        const selection = indices ? selectDerived(derived, indices) : derived;
        return getEventDetail(ds, selection, tz, type === 'dayDetail' ? 'day' : 'session', payload.id, payload.page, payload.pageSize);
      }
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
        const scope = payload.scope === 'selection' ? 'selection' : 'all';
        const filterState = scope === 'selection' && payload.filterState ? payload.filterState : emptyFilterState();
        const model = await aggregateSelection(filterState, { albumDetails: undefined, onProgress: report });
        report(0, 'Exportando tablas');
        const encoder = new TextEncoder();
        const tables = modelToTables(model);

        const metaRows = [
          ['format', 'scrobbleview-aggregated-export'],
          ['export_version', 1],
          ['schema_version', 2],
          ['exported_at_utc', new Date().toISOString()],
          ['timezone', tz?.id ?? timeZone],
          ['scope', scope],
          ['total_records', model.totals.records],
          ['total_ms', model.totals.ms],
          ['first_event_local', model.meta?.firstEventLocal ?? ''],
          ['last_event_local', model.meta?.lastEventLocal ?? ''],
          ['is_filtered', scope === 'selection' && payload.filterState && isFilterActive(payload.filterState) ? 'true' : 'false'],
          ['note', 'Agregados para analisis estadistico. No reimportar como historial original de Spotify.']
        ];
        if (payload.filterState && scope === 'selection') {
          if (payload.filterState.range) metaRows.push(['filter_range', `${payload.filterState.range.start}..${payload.filterState.range.end}`]);
          if (payload.filterState.years?.size) metaRows.push(['filter_years', [...payload.filterState.years].join(';')]);
          if (payload.filterState.dow?.size) metaRows.push(['filter_dow', [...payload.filterState.dow].join(';')]);
          if (payload.filterState.hours?.size) metaRows.push(['filter_hours', [...payload.filterState.hours].join(';')]);
        }
        tables.unshift({
          name: 'metadata',
          headers: ['key', 'value'],
          rows: metaRows
        });

        const entries = tables.map(({ name, headers, rows }) => ({
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
