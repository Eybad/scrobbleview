import { performance } from 'node:perf_hooks';
import { aggregate } from '../src/aggregate/aggregate.js';
import { derive } from '../src/aggregate/impl/derive.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';
import { parse } from '../src/parse/parse.js';
import { queryCatalog } from '../src/query.js';
import { exportExploreTableCSV } from '../src/export.js';
import { toCSV } from '../src/export/csv.js';
import { buildZip } from '../src/export/zip.js';
import { renderView } from '../app/views.js';

const eventCount = Number(process.argv[2] ?? 100000);
const repetitions = Number(process.argv[3] ?? 5);
if (eventCount !== 100000 || repetitions !== 5) throw new RangeError('Use 100000 events and 5 repetitions');

const distinctTracks = Math.floor(eventCount / 10);
const artists = 500;
const albums = 500;
const epoch = Date.UTC(2020, 0, 1) / 1000;
const fixture = Array.from({ length: eventCount }, (_, index) => {
  const timestamp = epoch + Math.floor(index / 100) * 40800 + (index % 100) * 120;
  return {
    ts: new Date(timestamp * 1000).toISOString(),
    ms_played: 120000,
    master_metadata_track_name: `Track ${index % distinctTracks}`,
    master_metadata_album_artist_name: `Artist ${index % artists}`,
    master_metadata_album_album_name: `Album ${index % albums}`,
    spotify_track_uri: `spotify:track:${index % distinctTracks}`
  };
});
const input = JSON.stringify(fixture);
const inputBytes = new TextEncoder().encode(input);
const timezone = fixedTz('UTC', 0);
const sampleResults = {};

function collect() {
  global.gc?.();
}

async function measure(name, action) {
  const samples = [];
  for (let index = 0; index < repetitions; index++) {
    collect();
    const start = performance.now();
    await action();
    samples.push(Number((performance.now() - start).toFixed(2)));
  }
  collect();
  const ordered = [...samples].sort((first, second) => first - second);
  sampleResults[name] = {
    samplesMs: samples,
    medianMs: ordered[Math.floor(ordered.length / 2)],
    worstMs: ordered.at(-1)
  };
}

await measure('parse', async () => {
  const dataset = await parse(memoryBytes('synthetic-100k.json', inputBytes));
  if (dataset.t.length !== eventCount) throw new Error('Parser did not preserve the fixture event count');
});

const dataset = await parse(memoryBytes('synthetic-100k.json', inputBytes));
let model;
await measure('derive-and-aggregate', () => {
  const derived = derive(dataset, timezone);
  const result = aggregate(dataset, { tz: timezone, now: epoch, derived, compact: true, albumDetails: null });
  if (result.totals.records !== eventCount) throw new Error('Aggregate did not preserve the fixture event count');
});
const derived = derive(dataset, timezone);
model = aggregate(dataset, { tz: timezone, now: epoch, derived, compact: true, albumDetails: null });
const tracks = [...model.tracks.byId.values()];
const queryOptions = {
  metric: 'ms',
  totalMetric: model.totals.ms,
  query: '',
  searchFields: ['name', 'artist'],
  sortBy: 'metric',
  page: 1,
  pageSize: 25
};
const transferPayload = structuredClone(model);
delete transferPayload.cols;

await measure('worker-message-clone', () => {
  const projection = structuredClone(transferPayload);
  if (projection.totals.records !== eventCount) throw new Error('Transferred projection changed totals');
});

await measure('catalog-query', () => {
  const result = queryCatalog(tracks, queryOptions);
  if (result.rows.length !== 25 || result.totalMatches !== tracks.length) throw new Error('Catalog query changed its result set');
});

await measure('catalog-render', () => {
  const html = renderView('explore', model, null, {
    metric: 'ms',
    exploreState: { tab: 'tracks', sortBy: 'metric', page: 1, pageSize: 25 }
  });
  if (!html.includes('catalog-table')) throw new Error('Explore view did not render the catalog table');
});

await measure('catalog-export-csv-zip', async () => {
  const result = exportExploreTableCSV(tracks, queryOptions, 'tracks');
  const metadata = new TextEncoder().encode(toCSV(['key', 'value'], [
    ['scope', 'table'],
    ['catalog.table', 'tracks'],
    ['catalog.match_count', result.totalMatches],
    ['catalog.share_denominator', model.totals.ms]
  ]));
  const csv = new TextEncoder().encode(result.csv);
  const archive = await buildZip([
    { name: 'metadata.csv', bytes: metadata },
    { name: 'tracks.csv', bytes: csv }
  ]);
  if (result.totalMatches !== tracks.length || archive.length === 0) throw new Error('Table export did not include the full catalog');
});

console.log(JSON.stringify({
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    deviceClass: 'Android / Termux / aarch64'
  },
  fixture: {
    events: eventCount,
    tracks: distinctTracks,
    artists,
    albums,
    rangeUtc: `${fixture[0].ts}..${fixture.at(-1).ts}`,
    jsonBytes: inputBytes.length
  },
  repetitions,
  rssPeakMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
  measurements: sampleResults
}));
