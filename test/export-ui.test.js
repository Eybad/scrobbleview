import test from 'node:test';
import assert from 'node:assert/strict';
import { createExportUI } from '../app/export-ui.js';
import { emptyFilterState } from '../src/filters.js';

function createHarness({ modal = true, request } = {}) {
  const listeners = new Map();
  const radios = Object.fromEntries(['all', 'selection', 'table'].map(scope => [scope, { disabled: false, checked: false }]));
  const descriptions = Object.fromEntries(['all', 'selection', 'table'].map(scope => [`export-${scope}-desc`, { textContent: '' }]));
  const dialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector() { return null; }
  };
  const form = {
    scope: 'all',
    addEventListener(type, listener) { listeners.set(type, listener); },
    querySelector(selector) { return radios[selector.match(/value="([^"]+)"/)[1]]; }
  };
  const option = (scope) => ({
    hidden: false,
    classList: { toggle() {} },
    querySelector() { return radios[scope]; }
  });
  const elements = {
    ...descriptions,
    'export-opt-selection': option('selection'),
    'export-opt-table': option('table'),
    'dialog-export': modal ? dialog : null,
    'export-form': modal ? form : null
  };
  const tableButton = { dataset: { totalMatches: '17', sortDirection: 'asc' } };
  const downloads = [], revoked = [], announcements = [], errors = [], requests = [], jobs = [];
  const document = {
    getElementById: id => elements[id] ?? null,
    querySelector: () => tableButton,
    body: { appendChild() {} },
    createElement() {
      return { click() { downloads.push({ filename: this.download, url: this.href }); }, remove() {} };
    },
    defaultView: {
      Blob,
      URL: {
        createObjectURL: () => 'blob:synthetic-export',
        revokeObjectURL: url => revoked.push(url)
      },
      FormData: class {
        constructor(target) { this.form = target; }
        get() { return this.form.scope; }
      }
    }
  };
  const model = {
    totals: { records: 8, ms: 480000 },
    artists: { byId: new Map([[1, { id: 1, name: 'Artist A', plays: 8, ms: 480000 }]]) },
    tracks: { byId: new Map() },
    albums: { byId: new Map() }
  };
  const context = {
    model,
    confirmedModel: { ...model, totals: { records: 4, ms: 240000 } },
    filterState: { ...emptyFilterState(), range: { from: 1704067200, to: 1704153599 }, years: new Set([2024]) },
    metric: 'plays',
    exploreState: { tab: 'artists', query: 'Artist', sortBy: 'name', sortDir: 'asc', page: 1, pageSize: 25, minPlays: null, minMonths: null },
    compareRanges: { rangeA: { from: 1, to: 2 }, rangeB: { from: 3, to: 4 } },
    viewName: 'explore',
    filterBusy: false
  };
  const ui = createExportUI({
    document,
    getContext: () => context,
    client: {
      async request(type, payload, options) {
        requests.push({ type, payload, options });
        return request ? request(type, payload, options) : { bytes: new Uint8Array([1, 2, 3]), filename: 'synthetic.zip', totalMatches: 17 };
      }
    },
    beginProcessing(label, type) {
      const job = { label, type, finished: false, progress() {}, finish() { this.finished = true; } };
      jobs.push(job);
      return job;
    },
    announce: message => announcements.push(message),
    reportError: error => errors.push(error)
  });
  return {
    ui, context, dialog, radios, descriptions, tableButton, elements, requests, jobs, downloads, revoked, announcements, errors,
    submit(scope) {
      form.scope = scope;
      return listeners.get('submit')({ preventDefault() {} });
    }
  };
}

test('export dialog uses confirmed selection totals and the rendered table count without requesting analysis', async () => {
  const harness = createHarness();
  await harness.ui.start({ scope: 'table' });

  assert.equal(harness.dialog.open, true);
  assert.equal(harness.radios.table.checked, true);
  assert.match(harness.descriptions['export-all-desc'].textContent, /^8 reproducciones/);
  assert.match(harness.descriptions['export-selection-desc'].textContent, /^4 reproducciones/);
  assert.match(harness.descriptions['export-table-desc'].textContent, /^17 artistas/);
  assert.match(harness.descriptions['export-table-desc'].textContent, /nombre, ascendente/);
  assert.equal(harness.requests.length, 0);
});

test('export submission keeps the filters, query and metric captured when the dialog opened', async () => {
  const harness = createHarness();
  const originalFilters = structuredClone(harness.context.filterState);
  const originalExplore = structuredClone(harness.context.exploreState);
  await harness.ui.start({ scope: 'table' });
  harness.context.filterState.range.from = 0;
  harness.context.filterState.years.add(2025);
  harness.context.exploreState.query = 'Changed';
  harness.context.metric = 'ms';
  await harness.submit('table');

  assert.equal(harness.dialog.open, false);
  assert.equal(harness.requests.length, 1);
  const { type, payload, options } = harness.requests[0];
  assert.equal(type, 'export');
  assert.equal(payload.scope, 'table');
  assert.equal(payload.metric, 'plays');
  assert.deepEqual(payload.filterState, originalFilters);
  assert.deepEqual(payload.exploreState, originalExplore);
  assert.deepEqual(payload.compareRanges, harness.context.compareRanges);
  assert.equal(options.onProgress, harness.jobs[0].progress);
  assert.equal(harness.jobs[0].finished, true);
  assert.deepEqual(harness.downloads, [{ filename: 'synthetic.zip', url: 'blob:synthetic-export' }]);
  assert.match(harness.announcements[0], /17 filas/);
});

test('export dialog disables unconfirmed table exports and falls back to the full history', async () => {
  const harness = createHarness();
  delete harness.tableButton.dataset.totalMatches;
  await harness.ui.start({ scope: 'table' });

  assert.equal(harness.radios.table.disabled, true);
  assert.equal(harness.radios.all.checked, true);
  assert.match(harness.descriptions['export-table-desc'].textContent, /No se pudo confirmar/);
  assert.equal(harness.requests.length, 0);
});

test('export waits for pending analytical filters and disables selection without active filters', async () => {
  const harness = createHarness();
  harness.context.filterBusy = true;
  await harness.ui.start();
  assert.equal(harness.dialog.open, false);
  assert.equal(harness.requests.length, 0);
  assert.match(harness.announcements[0], /actualización de filtros/);

  harness.context.filterBusy = false;
  harness.context.filterState = emptyFilterState();
  await harness.ui.start({ scope: 'selection' });
  assert.equal(harness.radios.selection.disabled, true);
  assert.equal(harness.radios.all.checked, true);
});

test('export falls back to a direct download without modal support and omits full-history filters', async () => {
  const response = Promise.withResolvers();
  const harness = createHarness({ modal: false, request: () => response.promise });
  const trigger = { disabled: false };
  const exporting = harness.ui.start({ trigger });
  assert.equal(trigger.disabled, true);
  assert.equal(harness.requests[0].payload.filterState, undefined);
  assert.equal(harness.requests[0].payload.exploreState, undefined);
  response.resolve({ bytes: new Uint8Array([1]), filename: 'all.zip' });
  await exporting;

  assert.equal(trigger.disabled, false);
  assert.equal(harness.jobs[0].finished, true);
  assert.equal(harness.downloads[0].filename, 'all.zip');
});

test('export failure finishes progress and restores its trigger while cancellation produces no download or error', async () => {
  for (const code of ['E_EXPORT', 'E_ABORT']) {
    const error = Object.assign(new Error('Synthetic export failure'), { code });
    const harness = createHarness({ modal: false, request: () => Promise.reject(error) });
    const trigger = { disabled: false };
    await harness.ui.start({ trigger });

    assert.equal(trigger.disabled, false);
    assert.equal(harness.jobs[0].finished, true);
    assert.equal(harness.downloads.length, 0);
    assert.deepEqual(harness.errors, code === 'E_ABORT' ? [] : [error]);
  }
});

test('export does not submit after its in-memory dataset was discarded', async () => {
  const harness = createHarness();
  await harness.ui.start();
  harness.context.model = null;
  await harness.submit('selection');

  assert.equal(harness.dialog.open, false);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.downloads.length, 0);
});
