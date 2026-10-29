const PRESETS = new Set(['equal_previous', 'same_period_last_year', 'manual']);
const GRANULARITIES = new Set(['daily', 'weekly', 'monthly']);
const ENTITY_KINDS = new Set(['artist', 'track', 'album']);
const ENTITY_MODES = new Set(['absolute', 'share']);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

function normalizeCompareEntity(value) {
  if (!value || typeof value !== 'object' || !ENTITY_KINDS.has(value.kind)) return null;
  if (value.kind === 'artist') {
    return typeof value.name === 'string' && value.name.length <= 2048
      ? { kind: 'artist', name: value.name }
      : null;
  }
  return typeof value.artist === 'string' && value.artist.length <= 2048 &&
    typeof value.title === 'string' && value.title.length <= 2048
    ? { kind: value.kind, artist: value.artist, title: value.title }
    : null;
}

export function normalizeCompareEntities(values) {
  if (!Array.isArray(values)) return [];
  const selected = [];
  const seen = new Set();
  for (const value of values) {
    const entity = normalizeCompareEntity(value);
    if (!entity) continue;
    const key = JSON.stringify(entity);
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(entity);
    if (selected.length === 3) break;
  }
  return selected;
}

export function compareEntityKey(value) {
  const entity = normalizeCompareEntity(value);
  return entity ? JSON.stringify(entity) : null;
}

export function parseCompareState(query) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  const preset = params.get('cp');
  const granularity = params.get('cg');
  const mode = params.get('cem');
  let selectedEntities = [];
  try { selectedEntities = normalizeCompareEntities(JSON.parse(params.get('ce') ?? '[]')); } catch {}
  return {
    comparePreset: PRESETS.has(preset) ? preset : 'equal_previous',
    compareGranularity: GRANULARITIES.has(granularity) ? granularity : 'weekly',
    compareFrom: validDate(params.get('af')),
    compareTo: validDate(params.get('at')),
    compareRefFrom: validDate(params.get('bf')),
    compareRefTo: validDate(params.get('bt')),
    compareEntities: selectedEntities,
    compareEntityMode: ENTITY_MODES.has(mode) ? mode : 'absolute'
  };
}

export function compareQuery(query, state) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  params.set('cp', PRESETS.has(state.comparePreset) ? state.comparePreset : 'equal_previous');
  params.set('cg', GRANULARITIES.has(state.compareGranularity) ? state.compareGranularity : 'weekly');
  for (const [key, value] of [
    ['af', state.compareFrom],
    ['at', state.compareTo],
    ['bf', state.compareRefFrom],
    ['bt', state.compareRefTo]
  ]) {
    const date = validDate(value);
    if (date) params.set(key, date);
    else params.delete(key);
  }
  const entities = normalizeCompareEntities(state.compareEntities);
  if (entities.length) params.set('ce', JSON.stringify(entities));
  else params.delete('ce');
  params.set('cem', ENTITY_MODES.has(state.compareEntityMode) ? state.compareEntityMode : 'absolute');
  return params.toString();
}

export function compareDateRange(from, to) {
  const first = validDate(from);
  const last = validDate(to);
  if (!first || !last || first > last) return null;
  const fromDay = Math.floor(Date.parse(`${first}T00:00:00Z`) / 86400000);
  const toDay = Math.floor(Date.parse(`${last}T00:00:00Z`) / 86400000);
  return { from: fromDay * 86400, to: toDay * 86400 + 86399 };
}

export function compareDateAt(range, endpoint) {
  if (!range || !Number.isSafeInteger(range[endpoint])) return null;
  const day = Math.floor(range[endpoint] / 86400);
  return new Date(day * 86400000).toISOString().slice(0, 10);
}
