// defaults.js — único lugar con los defaults del seam
//
// La tz del navegador NO vive aquí: se construye en main.js (composition root)
// con intl-tz sobre el rango del dataset. Aquí solo constantes numéricas.

export const DEFAULT_MIN_MS = 30000; // reproducción "significativa" (>= 30s)
export const DEFAULT_SKIP_THRESHOLD_MS = 10000; // "saltada por duración" (< 10s)
export const DEFAULT_CHUNK_BYTES = 262144; // re-chunkeo del scanner
export const SESSION_GAP_MINUTES = 30;