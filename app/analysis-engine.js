// Composition root shared by the browser worker and its Node integration tests.
import { analyze } from '../src/analyze.js';
import { parse } from '../src/parse/parse.js';
import { derive, selectDerived } from '../src/aggregate/impl/derive.js';
import { originalSessionMembership } from '../src/aggregate/impl/sessions.js';
import { getEventDetail, getTrackDetail } from './analysis-detail.js';
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
import { calculateCompareRange } from '../src/compare.js';

function timeZoneForDataset(ds, id) {
  let first = Infinity, last = -Infinity;
  for (const value of ds.t) { first = Math.min(first, value); last = Math.max(last, value); }
  return intlTz(id, {
    startSec: Math.max(-2147483648, ds.meta.tsMin + first - 86400),
    endSec: Math.min(2147483647, ds.meta.tsMin + last + 86400)
  });
}

function compareEntityMap(entities, kind) {
  return new Map([...entities].map(([key, entity]) => {
    const name = kind === 'track' ? `${entity.name} — ${entity.artist}`
      : kind === 'album' ? `${entity.name} — ${entity.artist}`
        : entity.name;
    return [key, {
      name,
      title: entity.name,
      artist: entity.artist ?? null,
      plays: entity.plays,
      ms: entity.ms,
      durationKnown: entity.durationKnown ?? null
    }];
  }));
}

function compareProjection(model) {
  const entities = {
    artists: compareEntityMap(model.artists.byId, 'artist'),
    tracks: compareEntityMap(model.tracks.byId, 'track'),
    albums: compareEntityMap(model.albums.byId, 'album')
  };
  const entityTotals = Object.fromEntries(Object.entries(entities).map(([kind, entries]) => [kind, {
    plays: [...entries.values()].reduce((sum, entity) => sum + entity.plays, 0),
    ms: [...entries.values()].reduce((sum, entity) => sum + entity.ms, 0)
  }]));
  return {
    totals: {
      plays: model.totals.records,
      ms: model.totals.ms,
      durationKnown: model.totals.durationKnown,
      durationUnknown: model.totals.durationUnknown,
      artists: entities.artists.size,
      tracks: entities.tracks.size,
      albums: entities.albums.size,
      activeDays: model.daily.size
    },
    entityTotals,
    entities,
    daily: new Map([...model.daily].map(([day, totals]) => [day, { plays: totals.plays, ms: totals.ms }]))
  };
}

export function createAnalysisEngine() {
  let ds = null, derived = null, tz = null, history = null, generatedAt = null, originalSessions = null, dataRange = null;

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
    dataRange = model.meta.firstTs == null ? null : { minSec: model.meta.firstTs, maxSec: model.meta.lastTs };
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
      if (type === 'dayDetail' || type === 'sessionDetail' || type === 'trackDetail') {
        const state = payload.state ?? emptyFilterState();
        const indices = isFilterActive(state) ? applyFilters(ds, state, tz, derived).indices : null;
        const selection = indices ? selectDerived(derived, indices) : derived;
        if (type === 'trackDetail') {
          const detail = getTrackDetail(ds, selection, payload.id, history.tracks.get(Number(payload.id))?.firstUtc, payload.page, payload.pageSize, payload.originId);
          if (detail) detail.firstLocal = detail.firstUtc + tz.offsetMinutes(detail.firstUtc) * 60;
          return detail;
        }
        return getEventDetail(ds, selection, tz, type === 'dayDetail' ? 'day' : 'session', payload.id, payload.page, payload.pageSize);
      }
      if (type === 'filter') {
        const state = payload.state ?? emptyFilterState();
        const model = isFilterActive(state) ? await aggregateSelection(state, { onProgress: report }) : null;
        const prev = state.range ? countFiltered(ds, { ...state, range: previousRange(state.range) }, tz, derived) : null;
        if (model) delete model.cols;
        return { model, prev };
      }
      if (type === 'compare') {
        const state = payload.state ?? emptyFilterState();
        const rangeA = payload.rangeA;
        const calculated = calculateCompareRange(payload.preset, rangeA, dataRange, payload.rangeB);
        const rangeB = calculated.rangeB;
        const sharedFilters = { ...state, range: null, years: null, months: null, dows: null, hours: null };
        const periodReport = (start, end) => (fraction, label) => report(start + (end - start) * fraction, label);
        let temporaryModel = await aggregateSelection({ ...sharedFilters, range: rangeA }, {
          albumDetails: null,
          onProgress: periodReport(0, 0.5)
        });
        const periodA = compareProjection(temporaryModel);
        temporaryModel = null;
        report(0.5, 'Período A listo');
        temporaryModel = await aggregateSelection({ ...sharedFilters, range: rangeB }, {
          albumDetails: null,
          onProgress: periodReport(0.5, 1)
        });
        const periodB = compareProjection(temporaryModel);
        temporaryModel = null;
        report(1, 'Comparación lista');
        return {
          preset: calculated.preset,
          rangeA: calculated.rangeA,
          rangeB,
          isOutOfRange: calculated.isOutOfRange,
          warning: calculated.warning,
          dataRange,
          timeZone: tz.id,
          periodA,
          periodB
        };
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
