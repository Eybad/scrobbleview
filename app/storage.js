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

// ---------- serialización pura (testeable) ----------

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
  }
  rows.meta = JSON.stringify(ds.meta);
  return rows;
}

export function deserialize(rows) {
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
      count: rows[`dict:${name}:count`]
    });
  }
  ds.meta = JSON.parse(rows.meta);
  assertDataset(ds);
  return ds;
}

// ---------- capa IndexedDB (solo navegador) ----------

export function isAvailable() {
  return typeof indexedDB !== 'undefined';
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Otra pestaña del mismo origen pide una versión nueva: cerrar para no
      // bloquear el upgrade (sin esto, open() de la otra pestaña queda en blocked).
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB bloqueado por otra pestaña'));
    // Timeout de seguridad: si open() nunca resuelve, no dejar la UI colgada.
    setTimeout(() => reject(new Error('IndexedDB no responde')), 5000);
  });
}

function run(mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try {
      out = fn(store);
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