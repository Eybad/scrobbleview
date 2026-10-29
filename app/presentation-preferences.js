import { METRIC_STORAGE_KEY } from './state-metric.js';

const PREFERENCE_KEYS = [
  METRIC_STORAGE_KEY,
  'scrobbleview:tableLimits',
  'scrobbleview:favorites',
  'scrobbleview:density',
  ...['artists', 'tracks', 'albums'].map((tab) => `scrobbleview:cols:${tab}`)
];

export function resetPresentationPreferences(storage, { favorites, tableLimits, rankUI }) {
  for (const key of PREFERENCE_KEYS) storage.removeItem(key);
  favorites.clear();
  tableLimits.clear();
  rankUI.metric = 'ms';
  rankUI.topN = 10;
  return rankUI.metric;
}
