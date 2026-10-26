// defaults.js — único lugar con los defaults del seam
//
// La tz del navegador NO vive aquí: se construye en analysis-engine.js (composition root)
// con intl-tz sobre el rango del dataset. Aquí solo constantes numéricas.

export const DEFAULT_MIN_MS = 30000; // reproducción "significativa" (>= 30s)
export const DEFAULT_SKIP_THRESHOLD_MS = 10000; // reproducción corta (< 10s)
export const DEFAULT_CHUNK_BYTES = 262144; // re-chunkeo del scanner
export const SESSION_GAP_MINUTES = 30;

export const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_MAX_EVENTS = 1000000;
export const DEFAULT_MAX_DEPTH = 64;
export const DEFAULT_MAX_TOKEN_BYTES = 1024 * 1024;
export const DEFAULT_MAX_ZIP_ENTRIES = 4096;
export const DEFAULT_MAX_CENTRAL_BYTES = 8 * 1024 * 1024;

export function resolveOptions(options = {}) {
  const resolved = { ...options,
    minMs: options.minMs ?? DEFAULT_MIN_MS,
    skipThresholdMs: options.skipThresholdMs ?? DEFAULT_SKIP_THRESHOLD_MS,
    chunkBytes: options.chunkBytes ?? DEFAULT_CHUNK_BYTES,
    sessionGapMinutes: options.sessionGapMinutes ?? SESSION_GAP_MINUTES,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
    maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxTokenBytes: options.maxTokenBytes ?? DEFAULT_MAX_TOKEN_BYTES,
    maxZipEntries: options.maxZipEntries ?? DEFAULT_MAX_ZIP_ENTRIES,
    maxCentralBytes: options.maxCentralBytes ?? DEFAULT_MAX_CENTRAL_BYTES
  };
  for (const field of ['minMs', 'skipThresholdMs', 'sessionGapMinutes']) {
    if (!Number.isFinite(resolved[field]) || resolved[field] < 0) throw new RangeError(`${field}: se requiere un número finito no negativo`);
  }
  if (!Number.isSafeInteger(resolved.chunkBytes) || resolved.chunkBytes < 1) throw new RangeError('chunkBytes: se requiere un entero positivo');
  for (const field of ['maxBytes', 'maxEvents', 'maxDepth', 'maxTokenBytes', 'maxZipEntries', 'maxCentralBytes']) {
    if (!Number.isSafeInteger(resolved[field]) || resolved[field] < 1) throw new RangeError(`${field}: se requiere un entero positivo`);
  }
  return resolved;
}
