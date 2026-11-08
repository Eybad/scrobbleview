import { analyze } from '../src/analyze.js';
import { parse } from '../src/parse/parse.js';
import { derive, selectDerived } from '../src/aggregate/impl/derive.js';
import { originalSessionMembership } from '../src/aggregate/impl/sessions.js';
import { getEventDetail, getTrackDetail } from './analysis-detail.js';
import { intlTz } from '../src/aggregate/adapters/intl-tz.js';
import { applyFilters, countFiltered, emptyFilterState } from '../src/filters.js';
import { fileBytes } from '../src/parse/adapters/file-bytes.js';
import { zipSources } from '../src/parse/adapters/zip-bytes.js';
import { modelToTables, exportExploreTableCSV, exportFilename } from '../src/export.js';
import { toCSV } from '../src/export/csv.js';
import { buildZip } from '../src/export/zip.js';
import { describeCatalogQuery } from './catalog-query.js';
import { save, load } from './storage.js';
import { assertDistinctFiles } from './input.js';
import { isFilterActive, previousRange } from './filter-ui.js';
import { demoSource } from './demo.js';
import { calculateCompareRange } from '../src/compare.js';
import { computeComebacks, computeMonthlyLongitudinal } from '../src/longitudinal.js';
import { trackKey } from '../src/aggregate/impl/groups.js';

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

function metadataFilterRows(filterState, model) {
  const rows = [];
  const filters = filterState ?? emptyFilterState();
  const setValue = (value) => value == null ? 'all' : [...value].sort((a, b) => a - b).join(';');
  const flagValue = (value) => value == null ? 'all' : String(value);
  const entityValue = (kind, id) => {
    if (id == null) return ['all', ''];
    const entity = model[kind].byId.get(id);
    const label = kind === 'tracks' || kind === 'albums' ? `${entity?.name ?? ''} — ${entity?.artist ?? ''}` : entity?.name ?? '';
    return [String(id), label];
  };

  rows.push(['filter.range.from', filters.range?.from ?? 'all']);
  rows.push(['filter.range.to', filters.range?.to ?? 'all']);
  rows.push(['filter.range.unit', 'local epoch seconds']);
  rows.push(['filter.years', setValue(filters.years)]);
  rows.push(['filter.months', setValue(filters.months)]);
  rows.push(['filter.months.unit', 'YYYYMM']);
  rows.push(['filter.dows', setValue(filters.dows)]);
  rows.push(['filter.dows.unit', 'Monday is 0']);
  rows.push(['filter.hours', setValue(filters.hours)]);
  rows.push(['filter.hours.unit', 'local hour']);
  rows.push(['filter.skip', flagValue(filters.skip)]);
  rows.push(['filter.shuffle', flagValue(filters.shuffle)]);
  rows.push(['filter.offline', flagValue(filters.offline)]);

  for (const [field, kind, id] of [
    ['artistId', 'artists', filters.artistId],
    ['trackId', 'tracks', filters.trackId],
    ['albumId', 'albums', filters.albumId]
  ]) {
    const [value, label] = entityValue(kind, id);
    rows.push([`filter.${field}`, value]);
    if (id != null) rows.push([`filter.${field}.name`, label]);
  }
  return rows;
}

function localTimestamp(epochLocalSeconds) {
  return new Date(epochLocalSeconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function catalogEligibility(options) {
  const rules = [];
  if (options.minPlays != null) rules.push(`plays >= ${options.minPlays}`);
  if (options.minMonths != null) rules.push(`active months >= ${options.minMonths}`);
  if (options.minKnownSkips != null) rules.push(`known skips >= ${options.minKnownSkips}`);
  if (options.sortBy === 'constancy') rules.push('entity has first and last observed dates');
  if (options.sortBy === 'dominance') rules.push('dominant track represents at least 80% of artist plays');
  if (options.sortBy === 'forgotten') rules.push('entity has a last observed date');
  return rules.length ? rules.join('; ') : 'No additional eligibility rules.';
}

function exportMetadataRows(model, {
  scope,
  metric,
  filterState,
  compareRanges,
  catalog = null
}) {
  const totals = model.totals;
  const firstLocal = model.meta?.firstTs;
  const lastLocal = model.meta?.lastTs;
  const rows = [
    ['format', catalog ? 'scrobbleview-catalog-table' : 'scrobbleview-aggregated-export'],
    ['export_version', 1],
    ['schema_version', 2],
    ['effective_schema', catalog ? 'catalog-table-v1' : 'aggregated-csv-v2'],
    ['exported_at_utc', new Date().toISOString()],
    ['timezone', model.meta?.tzId ?? ''],
    ['scope', scope],
    ['metric', metric],
    ['metric_unit', metric === 'ms' ? 'milliseconds' : 'playback events'],
    ['records_in_scope', totals.records],
    ['total_ms', totals.ms],
    ['duration_known_records', totals.durationKnown],
    ['duration_unknown_records', totals.durationUnknown],
    ['skip_known_records', totals.skippedKnown],
    ['skip_unknown_records', totals.records - totals.skippedKnown],
    ['shuffle_known_records', totals.shuffleKnown],
    ['shuffle_unknown_records', totals.records - totals.shuffleKnown],
    ['offline_known_records', totals.offlineKnown],
    ['offline_unknown_records', totals.records - totals.offlineKnown],
    ['observed_range_first_local', firstLocal == null ? '' : localTimestamp(firstLocal)],
    ['observed_range_last_local', lastLocal == null ? '' : localTimestamp(lastLocal)],
    ['observed_range_local_epoch_s', firstLocal == null ? '' : `${firstLocal}..${lastLocal}`],
    ['definitions.total_ms', 'Sum of parsed milliseconds for events in scope; duration-unknown events remain in records.'],
    ['definitions.records', 'Count of successfully parsed playback events in scope.'],
    ['definitions.plays', 'Playback event count.'],
    ['definitions.duration_known_records', 'Events whose playback duration is known; use this as the denominator for duration means.'],
    ['definitions.duration_unknown_records', 'Events whose playback duration is unknown; they are not zero-duration observations.'],
    ['definitions.skip_known_records', 'Events with a known skipped flag; use this as the denominator for skip rates.'],
    ['definitions.skip_unknown_records', 'Events whose skipped flag is unknown.'],
    ['definitions.shuffle_known_records', 'Events with a known shuffle flag.'],
    ['definitions.shuffle_unknown_records', 'Events whose shuffle flag is unknown.'],
    ['definitions.offline_known_records', 'Events with a known offline flag.'],
    ['definitions.offline_unknown_records', 'Events whose offline flag is unknown.'],
    ['definitions.timestamp_columns', 'Local wall-clock values in timezone above; *_utc values are UTC epoch seconds.'],
    ['definitions.ms', 'Milliseconds.'],
    ['definitions.days', 'Distinct local calendar days.'],
    ['definitions.month', 'Absolute month encoded as YYYYMM.'],
    ['definitions.session_duration_s', 'Estimated session span in seconds; it is not the sum of listened milliseconds.'],
    ['grouping', catalog ? catalog.tab : 'totals; artist; track-by-artist; album-by-artist; exact album-track attribution; sessions; month'],
    ['ordering', catalog ? `catalog sort ${catalog.sortBy}, ${catalog.effectiveDir}; rows include every match and omit pagination` : 'Each table uses its documented key order.'],
    ['eligibility', catalog ? catalog.eligibility : 'All successfully parsed events in the selected scope; parser-rejected records are excluded.'],
    ['note', 'Agregados para análisis. No reimportar como historial original de Spotify.']
  ];

  rows.push(...metadataFilterRows(filterState, model));

  if (catalog) {
    rows.push(
      ['catalog.table', catalog.tab],
      ['catalog.match_count', catalog.matchCount],
      ['catalog.entity_count', catalog.entityCount],
      ['catalog.search', catalog.query],
      ['catalog.search_fields', catalog.searchFields.join(';')],
      ['catalog.sort_by', catalog.sortBy],
      ['catalog.sort_direction', catalog.effectiveDir],
      ['catalog.minimum_plays', catalog.minPlays ?? 'none'],
      ['catalog.minimum_active_months', catalog.minMonths ?? 'none'],
      ['catalog.minimum_known_skips', catalog.minKnownSkips ?? 'none'],
      ['catalog.share_denominator', catalog.totalMetric],
      ['definitions.catalog_rank', 'One-based global position by the principal metric within the analytical selection, before catalog search and eligibility filters.'],
      ['definitions.catalog_share', 'Entity principal metric divided by the full analytical-selection metric total, before catalog search and eligibility filters.'],
      ['definitions.catalog_share_precision', 'CSV share is a percentage rounded to two decimal places.'],
      ['definitions.catalog_sort_ties', 'Criterion-specific tie-breakers are applied before the final global metric rank and entity id.']
    );
  }

  if (compareRanges?.rangeA && compareRanges?.rangeB) {
    rows.push(
      ['compare.range_a.local_epoch_s', `${compareRanges.rangeA.from}..${compareRanges.rangeA.to}`],
      ['compare.range_b.local_epoch_s', `${compareRanges.rangeB.from}..${compareRanges.rangeB.to}`]
    );
  }
  return rows;
}

function csvArchiveEntries(tables) {
  const encoder = new TextEncoder();
  return tables.map(({ name, headers, rows }) => ({
    name: `${name}.csv`,
    bytes: encoder.encode(`\uFEFF${toCSV(headers, rows)}`)
  }));
}

export function createAnalysisEngine() {
  let ds = null, derived = null, tz = null, history = null, generatedAt = null, originalSessions = null, dataRange = null;
  const longitudinalCache = new Map();

  function pageRows(rows, page, pageSize) {
    const validSize = [25, 50, 100].includes(pageSize) ? pageSize : 25;
    const pageCount = Math.max(1, Math.ceil(rows.length / validSize));
    const validPage = Number.isSafeInteger(page) ? Math.max(1, Math.min(pageCount, page)) : 1;
    const start = (validPage - 1) * validSize;
    return {
      rows: rows.slice(start, start + validSize),
      total: rows.length,
      page: validPage,
      pageSize: validSize,
      pageCount,
      start: rows.length ? start + 1 : 0,
      end: Math.min(start + validSize, rows.length)
    };
  }

  async function aggregateSelection(state, extra = {}) {
    const indices = isFilterActive(state) ? applyFilters(ds, state, tz, derived).indices : undefined;
    return analyze(ds, { tz, derived, indices, history, originalSessions, now: generatedAt, compact: true, albumDetails: null, computeComebacks: false, includeFirstAppearances: false, ...extra });
  }

  async function initialize(dataset, timeZone, report) {
    report(0, 'Preparando zona horaria');
    const nextTz = timeZoneForDataset(dataset, timeZone);
    const nextDerived = derive(dataset, nextTz);
    const nextOriginalSessions = originalSessionMembership(dataset, nextDerived, nextTz);
    const now = Math.floor(Date.now() / 1000);
    const model = await analyze(dataset, { tz: nextTz, derived: nextDerived, originalSessions: nextOriginalSessions, now, compact: true, albumDetails: null, computeComebacks: false, onProgress: report });
    ds = dataset; tz = nextTz; derived = nextDerived; generatedAt = now; originalSessions = nextOriginalSessions;
    longitudinalCache.clear();
    dataRange = model.meta.firstTs == null ? null : { minSec: model.meta.firstTs, maxSec: model.meta.lastTs };
    const firstTracks = model.tables.firstAppearances.tracks.map((track) => ({
      id: track.tk,
      name: track.name,
      artist: track.artist,
      firstTs: track.firstTs,
      firstUtc: track.firstUtc,
      subsequentPlays: track.subsequentPlays,
      ms: track.ms,
      daysCount: track.daysCount
    }));
    const firstArtists = model.tables.firstAppearances.artists.map((artist) => ({
      id: artist.id,
      name: artist.name,
      firstTs: artist.firstTs,
      firstUtc: artist.firstUtc,
      subsequentPlays: artist.subsequentPlays,
      ms: artist.ms,
      daysCount: artist.daysCount
    }));
    history = {
      tracks: new Map(firstTracks.map((track) => [track.id, { firstUtc: track.firstUtc }])),
      artists: new Map(firstArtists.map((artist) => [artist.id, { firstUtc: artist.firstUtc }])),
      firstAppearances: { tracks: firstTracks, artists: firstArtists }
    };
    delete model.tables.firstAppearances;
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
      if (type === 'longitudinal') {
        const state = payload.state ?? emptyFilterState();
        const thresholdDays = [30, 90, 180].includes(payload.thresholdDays) ? payload.thresholdDays : 30;
        const cacheKey = JSON.stringify([state, thresholdDays], (key, value) =>
          value instanceof Set ? [...value].sort((a, b) => a - b) : value);
        let result = longitudinalCache.get(cacheKey);
        if (!result) {
          const selectedIndices = isFilterActive(state) ? applyFilters(ds, state, tz, derived).indices : null;
          const selected = selectedIndices ? new Set(selectedIndices) : null;
          const selectedFirstTracks = new Set();
          const selectedFirstArtists = new Set();
          if (!selectedIndices) {
            for (const track of history.firstAppearances.tracks) selectedFirstTracks.add(track.id);
            for (const artist of history.firstAppearances.artists) selectedFirstArtists.add(artist.id);
          } else {
            for (let position = 0; position < selectedIndices.length; position++) {
              if (position % 8192 === 0) report(0.2 * (selectedIndices.length ? position / selectedIndices.length : 1), 'Buscando primeras apariciones seleccionadas');
              const i = selectedIndices[position];
              const t = ds.meta.tsMin + ds.t[i];
              const trackId = trackKey(ds.tr[i], ds.ar[i]);
              const artistId = ds.ar[i];
              if (history.tracks.get(trackId)?.firstUtc === t) selectedFirstTracks.add(trackId);
              if (artistId > 0 && history.artists.get(artistId)?.firstUtc === t) selectedFirstArtists.add(artistId);
            }
          }
          const monthly = computeMonthlyLongitudinal(ds, tz, {
            indices: selectedIndices,
            onProgress: (fraction) => report(0.2 + fraction * 0.4, 'Calculando métricas mensuales')
          });
          const comeBacks = computeComebacks(ds, {
            thresholdDays,
            order: derived.order,
            selected,
            onProgress: (fraction) => report(0.6 + fraction * 0.4, 'Buscando regresos históricos')
          });
          result = {
            thresholdDays,
            monthly,
            comebacks: comeBacks,
            firstAppearances: {
              tracks: history.firstAppearances.tracks.filter((track) => selectedFirstTracks.has(track.id)),
              artists: history.firstAppearances.artists.filter((artist) => selectedFirstArtists.has(artist.id))
            }
          };
          longitudinalCache.set(cacheKey, result);
          while (longitudinalCache.size > 3) longitudinalCache.delete(longitudinalCache.keys().next().value);
        }
        const pages = payload.pages ?? {};
        const comebackPage = (rows, page) => {
          const result = pageRows(rows, page, payload.pageSize);
          return {
            ...result,
            rows: result.rows.map((entry) => ({
              ...entry,
              lastSeenLocal: entry.lastSeenUtc + tz.offsetMinutes(entry.lastSeenUtc) * 60,
              returnLocal: entry.returnUtc + tz.offsetMinutes(entry.returnUtc) * 60
            }))
          };
        };
        return {
          thresholdDays,
          monthly: result.monthly,
          comebacks: {
            tracks: comebackPage(result.comebacks.tracks, pages.comebackTracks),
            artists: comebackPage(result.comebacks.artists, pages.comebackArtists)
          },
          firstAppearances: {
            tracks: pageRows(result.firstAppearances.tracks, pages.firstTracks, payload.pageSize),
            artists: pageRows(result.firstAppearances.artists, pages.firstArtists, payload.pageSize)
          }
        };
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
        const scope = ['selection', 'table'].includes(payload.scope) ? payload.scope : 'all';
        const filterState = scope !== 'all' && payload.filterState ? payload.filterState : emptyFilterState();
        const metric = payload.metric === 'plays' ? 'plays' : 'ms';
        const model = await aggregateSelection(filterState, { albumDetails: undefined, onProgress: report });
        report(0, 'Exportando tablas');
        const timestamp = exportFilename(Math.floor(Date.now() / 1000))
          .replace(/^scrobbleview-/, '')
          .replace(/\.json$/, '.zip');

        if (scope === 'table') {
          const description = describeCatalogQuery(model, {
            metric,
            exploreState: payload.exploreState
          });
          const exported = exportExploreTableCSV(description.pool, description.options, description.tab);
          const catalog = {
            tab: description.tab,
            matchCount: exported.totalMatches,
            entityCount: exported.totalItems,
            query: description.options.query,
            searchFields: description.options.searchFields,
            sortBy: description.options.sortBy,
            effectiveDir: exported.effectiveDir,
            minPlays: description.options.minPlays,
            minMonths: description.options.minMonths,
            minKnownSkips: description.options.minKnownSkips,
            totalMetric: description.options.totalMetric,
            eligibility: catalogEligibility(description.options)
          };
          const metadataCsv = new TextEncoder().encode(`\uFEFF${toCSV(['key', 'value'], exportMetadataRows(model, {
              scope,
              metric,
              filterState,
              compareRanges: payload.compareRanges,
              catalog
            }))}`);
          const tableCsv = new TextEncoder().encode(exported.csv);
          const bytes = await buildZip([
            { name: 'metadata.csv', bytes: metadataCsv },
            { name: `${description.tab}.csv`, bytes: tableCsv }
          ]);
          report(1, 'Exportación lista');
          return { bytes, filename: `scrobbleview-${description.tab}-${timestamp}`, totalMatches: exported.totalMatches };
        }

        const tables = modelToTables(model);
        tables.unshift({
          name: 'metadata',
          headers: ['key', 'value'],
          rows: exportMetadataRows(model, {
            scope,
            metric,
            filterState,
            compareRanges: payload.compareRanges
          })
        });
        const bytes = await buildZip(csvArchiveEntries(tables));
        report(1, 'Exportación lista');
        return { bytes, filename: `scrobbleview-${timestamp}` };
      }
      throw new TypeError('Operación de análisis desconocida.');
    }
  };
}
