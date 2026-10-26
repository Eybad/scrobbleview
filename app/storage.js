// app/storage.js — caché descartable en IndexedDB (opcional, con consentimiento)
//
// Guarda el Dataset parseado (columnas + dicts como ArrayBuffer, una fila por
// columna) para rehidratar sin re-parsear. NUNCA escribe sin consentimiento
// explícito de la UI; clear() borra todo. El parseo funciona igual sin caché:
// storage es best-effort — cuota, eviction de Safari (7 días sin uso) o
// QuotaExceededError degradan a parse normal, nunca rompen la app.
//
// serialize/deserialize son puras (testeables en Node); la capa IndexedDB solo
// existe en navegador (isAvailable() la detecta).

import { FIELDS, assertDataset } from '../src/parse/dataset.js';
import { Interner } from '../src/parse/impl/intern.js';

const DB_NAME = 'scrobbleview';
const DB_VERSION = 1;
const STORE = 'columns';
const DICT_NAMES = ['tracks', 'artists', 'albums', 'reasons'];

export function serialize(ds) {
  const rows = {};
  for (const f of FIELDS) rows[`col:${f}`] = ds[f].buffer;
  for (const name of DICT_NAMES) {
    const d = ds.dicts[name];
    // Recortar a lo usado: keys/offsets/lengths crecen por potencias de dos y
    // el buffer sobrante no aporta nada (cuota escasa en Android).
    const used = d.count > 0 ? d.offsets[d.count - 1] + d.lengths[d.count - 1] : 0;
    rows[`dict:${name}:keys`] = d.keys.slice(0, used).buffer;
    rows[`dict:${name}:offsets`] = d.offsets.slice(0, d.count).buffer;
    rows[`dict:${name}:lengths`] = d.lengths.slice(0, d.count).buffer;
    rows[`dict:${name}:count`] = d.count;
    const surrogates = [];
    for (let id = 0; id < d.count; id++) {
      const value = d.get(id);
      if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)) surrogates.push([id, value]);
    }
    rows[`dict:${name}:surrogates`] = surrogates;
  }
  rows.schemaVersion = 2;
  rows.meta = JSON.stringify(ds.meta);
  return rows;
}

export function deserialize(rows) {
  if (rows.schemaVersion !== 2) throw new Error('Caché incompatible: volvé a cargar los archivos');
  const ds = {};
  for (const f of FIELDS) {
    const buf = rows[`col:${f}`];
    ds[f] = f === 't' ? new Int32Array(buf)
      : f === 'm' || f === 'tr' || f === 'ar' || f === 'al' ? new Uint32Array(buf)
      : new Uint8Array(buf);
  }
  ds.dicts = {};
  for (const name of DICT_NAMES) {
    ds.dicts[name] = Interner.fromParts({
      keys: new Uint8Array(rows[`dict:${name}:keys`]),
      offsets: new Uint32Array(rows[`dict:${name}:offsets`]),
      lengths: new Uint32Array(rows[`dict:${name}:lengths`]),
      count: rows[`dict:${name}:count`],
      surrogates: rows[`dict:${name}:surrogates`] ?? []
    });
  }
  ds.meta = JSON.parse(rows.meta);
  assertDataset(ds);
  return ds;
}

export function isAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error) => { settled = true; clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => fail(new Error('IndexedDB no responde')), 5000);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      if (settled) { db.close(); return; }
      settled = true;
      // Otra pestaña del mismo origen pide una versión nueva: cerrar para no
      // bloquear el upgrade (sin esto, open() de la otra pestaña queda en blocked).
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => fail(req.error);
    req.onblocked = () => fail(new Error('IndexedDB bloqueado por otra pestaña'));
  });
}

function run(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    let t, out;
    try {
      t = db.transaction(STORE, mode);
      out = fn(t.objectStore(STORE));
    } catch (err) {
      db.close();
      reject(err);
      return;
    }
    t.oncomplete = () => { db.close(); resolve(out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

// Guarda el dataset. Best-effort: cualquier fallo (cuota, eviction) resuelve
// con false, nunca lanza hacia la UI.
export async function save(ds) {
  if (!isAvailable()) return false;
  const rows = serialize(ds);
  try {
    await run('readwrite', (store) => {
      for (const [k, v] of Object.entries(rows)) store.put(v, k);
    });
    return true;
  } catch {
    return false;
  }
}

// Rehidrata el dataset guardado, o null si no hay caché / está corrupta.
export async function load() {
  if (!isAvailable()) return null;
  try {
    const rows = await run('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => {
        const ks = req.result;
        const out = {};
        let pending = ks.length;
        if (pending === 0) { resolve(out); return; }
        for (const k of ks) {
          const r = store.get(k);
          r.onsuccess = () => {
            out[k] = r.result;
            if (--pending === 0) resolve(out);
          };
          r.onerror = () => reject(r.error);
        }
      };
      req.onerror = () => reject(req.error);
    }));
    if (Object.keys(rows).length === 0) return null;
    return deserialize(rows);
  } catch {
    return null;
  }
}

// ¿Existe caché? Chequeo liviano (solo claves, no deserializa).
export async function hasCache() {
  if (!isAvailable()) return false;
  try {
    const keys = await run('readonly', (store) => new Promise((resolve, reject) => {
      const req = store.getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    return keys.length > 0;
  } catch {
    return false;
  }
}

export function summaryFromMetaAndT(meta, tCol) {
  if (!meta || typeof meta.count !== 'number' || meta.count <= 0) return null;
  let fromYear = null;
  let toYear = null;
  if (tCol && tCol.length > 0 && Number.isFinite(meta.tsMin)) {
    const len = Math.min(tCol.length, meta.count);
    let lo = tCol[0];
    let hi = tCol[0];
    for (let i = 1; i < len; i++) {
      if (tCol[i] < lo) lo = tCol[i];
      if (tCol[i] > hi) hi = tCol[i];
    }
    fromYear = new Date((meta.tsMin + lo) * 1000).getUTCFullYear();
    toYear = new Date((meta.tsMin + hi) * 1000).getUTCFullYear();
  }
  return {
    count: meta.count,
    fromYear,
    toYear,
    sourcesCount: Array.isArray(meta.sources) ? meta.sources.length : 0
  };
}

// Lee solo meta y col:t para mostrar el resumen de la sesión guardada en el
// inicio sin deserializar los diccionarios ni el resto de las columnas.
export async function cacheSummary() {
  if (!isAvailable()) return null;
  try {
    const pair = await run('readonly', (store) => new Promise((resolve, reject) => {
      const out = {};
      let pending = 2;
      for (const k of ['meta', 'col:t']) {
        const r = store.get(k);
        r.onsuccess = () => {
          out[k] = r.result;
          if (--pending === 0) resolve(out);
        };
        r.onerror = () => reject(r.error);
      }
    }));
    if (!pair.meta) return null;
    const meta = JSON.parse(pair.meta);
    const tCol = pair['col:t'] ? new Int32Array(pair['col:t']) : null;
    return summaryFromMetaAndT(meta, tCol);
  } catch {
    return null;
  }
}

// Borra toda la caché. Devuelve true si había algo que borrar.
export async function clear() {
  if (!isAvailable()) return false;
  try {
    await run('readwrite', (store) => store.clear());
    return true;
  } catch {
    return false;
  }
}

// Estimación de cuota (best-effort, puede no existir en todos los navegadores).
export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

// Pide persistencia (best-effort; Safari evicta a los 7 días sin uso salvo PWA).
export async function persist() {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
