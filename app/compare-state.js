const PRESETS = new Set(['equal_previous', 'same_period_last_year', 'manual']);
const GRANULARITIES = new Set(['daily', 'weekly', 'monthly']);

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? value : null;
}

export function parseCompareState(query) {
  const params = new URLSearchParams((query ?? '').replace(/^\?/, ''));
  const preset = params.get('cp');
  const granularity = params.get('cg');
  return {
    comparePreset: PRESETS.has(preset) ? preset : 'equal_previous',
    compareGranularity: GRANULARITIES.has(granularity) ? granularity : 'weekly',
    compareFrom: validDate(params.get('af')),
    compareTo: validDate(params.get('at')),
    compareRefFrom: validDate(params.get('bf')),
    compareRefTo: validDate(params.get('bt'))
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
