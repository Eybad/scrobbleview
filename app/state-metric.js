// app/state-metric.js — unificación del estado de métrica analítica
//
// Métrica por defecto: 'ms' (Tiempo escuchado) según sección 3.3.
// Prevalencia: URL (query param 'm' o 'metric') > preferencia persistida > default ('ms').

export const VALID_METRICS = new Set(['ms', 'plays']);
export const DEFAULT_METRIC = 'ms';
export const METRIC_STORAGE_KEY = 'scrobbleview_metric';

export function resolveMetric(queryMetric, storedMetric) {
  if (queryMetric && VALID_METRICS.has(queryMetric)) return queryMetric;
  if (storedMetric && VALID_METRICS.has(storedMetric)) return storedMetric;
  return DEFAULT_METRIC;
}

export function parseQueryParams(query) {
  const result = { metric: null };
  if (!query) return result;
  const clean = query.replace(/^\?/, '');
  const params = new URLSearchParams(clean);
  const m = params.get('m') || params.get('metric');
  if (m && VALID_METRICS.has(m)) result.metric = m;
  return result;
}

export function serializeMetricParam(metric) {
  const m = VALID_METRICS.has(metric) ? metric : DEFAULT_METRIC;
  return `m=${m}`;
}
