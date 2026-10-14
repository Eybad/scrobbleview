// src/export.js — modelo procesado → JSON plano (solo análisis externo)
//
// Seam puro: modelToJSON(model, { now }) → objeto sin Map/Set/typed arrays,
// listo para JSON.stringify. Exporta el modelo COMPLETO (ignora filtros).
// Las claves de Map numéricas se serializan como strings de objeto (igual
// que JSON haría de todos modos); los Set salen como arrays ordenados.

export const EXPORT_FORMAT = 'scrobbleview-export';
export const EXPORT_VERSION = 1;

function toPlain(v) {
  if (v instanceof Map) {
    const o = {};
    for (const [k, x] of v) o[String(k)] = toPlain(x);
    return o;
  }
  if (v instanceof Set) {
    const arr = [...v].map(toPlain);
    // Sets del modelo guardan números (días, meses, ids): ordenados.
    if (arr.every((x) => typeof x === 'number')) arr.sort((a, b) => a - b);
    return arr;
  }
  if (ArrayBuffer.isView(v)) return Array.from(v, (x) => toPlain(x));
  if (Array.isArray(v)) return v.map(toPlain);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'function' || x === undefined) continue;
      o[k] = toPlain(x);
    }
    return o;
  }
  return v;
}

export function modelToJSON(model, { now = Math.floor(Date.now() / 1000) } = {}) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    model: toPlain(model)
  };
}

// exportedAt (epoch s, UTC) → 'scrobbleview-YYYYMMDD-HHMMSS.json'.
export function exportFilename(exportedAt) {
  const d = new Date(exportedAt * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `scrobbleview-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.json`;
}
