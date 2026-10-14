// intern.js — interning de strings por bytes (hash FNV-1a), materializa solo en miss.
//
// V8 no internaliza strings de runtime: un Map<string,id> no deduplica memoria.
// Este internador compara bytes UTF-8 contra las claves ya guardadas y solo
// materializa el string cuando es una clave nueva. Claves en un Uint8Array grande
// + offsets; id 0 = string vacío (artista/álbum/reason ausentes).

const INITIAL_KEYS = 4096;

function fnv1a(bytes, start, end) {
  let h = 0x811c9dc5;
  for (let i = start; i < end; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function bytesEqual(a, aStart, aLen, b, bStart, bEnd) {
  if (aLen !== bEnd - bStart) return false;
  for (let i = 0; i < aLen; i++) {
    if (a[aStart + i] !== b[bStart + i]) return false;
  }
  return true;
}

export class Interner {
  constructor() {
    this.keys = new Uint8Array(INITIAL_KEYS);
    this.offsets = new Uint32Array(64);
    this.lengths = new Uint32Array(64);
    this.count = 0;
    this.table = new Map(); // hash → array de ids
    this.strings = []; // strings materializados (uno por clave única)
    this.insert(''); // id 0 = string vacío
  }

  get size() {
    return this.count;
  }

  get(id) {
    return this.strings[id];
  }

  // bytes: Uint8Array con el string (puede tener escapes JSON). Devuelve el id.
  add(bytes, start = 0, end = bytes.length) {
    const h = fnv1a(bytes, start, end);
    const ids = this.table.get(h);
    if (ids) {
      for (let k = 0; k < ids.length; k++) {
        const id = ids[k];
        if (bytesEqual(this.keys, this.offsets[id], this.lengths[id], bytes, start, end)) return id;
      }
    }
    const s = decodeJSONString(bytes, start, end);
    // Si había escapes, los bytes crudos difieren de los UTF-8 finales: re-buscar
    // por los bytes del string decodificado antes de insertar (evita duplicados).
    const ub = utf8Encode(s);
    const h2 = fnv1a(ub, 0, ub.length);
    const ids2 = this.table.get(h2);
    if (ids2) {
      for (let k = 0; k < ids2.length; k++) {
        const id = ids2[k];
        if (bytesEqual(this.keys, this.offsets[id], this.lengths[id], ub, 0, ub.length)) return id;
      }
    }
    return this.insert(s);
  }

  insert(s) {
    const id = this.count;
    this.count++;
    const b = utf8Encode(s);
    this.appendKey(b, id);
    const h = fnv1a(b, 0, b.length);
    const ids = this.table.get(h);
    if (ids) ids.push(id);
    else this.table.set(h, [id]);
    this.strings.push(s);
    return id;
  }

  appendKey(b, id) {
    if (id >= this.offsets.length) {
      const no = new Uint32Array(this.offsets.length * 2);
      no.set(this.offsets);
      this.offsets = no;
      const nl = new Uint32Array(this.lengths.length * 2);
      nl.set(this.lengths);
      this.lengths = nl;
    }
    const off = id === 0 ? 0 : this.offsets[id - 1] + this.lengths[id - 1];
    const need = off + b.length;
    if (need > this.keys.length) {
      let cap = this.keys.length;
      while (cap < need) cap *= 2;
      const nk = new Uint8Array(cap);
      nk.set(this.keys);
      this.keys = nk;
    }
    this.keys.set(b, off);
    this.offsets[id] = off;
    this.lengths[id] = b.length;
  }

  // Rehidrata un Interner desde partes serializadas (caché IndexedDB).
  // keys/offsets/lengths pueden tener capacidad mayor que el uso real: count
  // define las claves válidas. Reconstruye table (hash → ids) y strings.
  // count se acota contra la longitud real de los arrays y los rangos de bytes
  // se validan: un count fabricado o un rango corrupto (caché manipulada) lanzan
  // en vez de recortar en silencio, que produciría entidades truncadas.
  // El llamador (storage.js) convierte la excepción en un miss de caché.
  static fromParts({ keys, offsets, lengths, count }) {
    const it = new Interner();
    it.keys = keys;
    it.offsets = offsets;
    it.lengths = lengths;
    const n = Number.isInteger(count) && count >= 0 ? count : 0;
    it.count = Math.min(n, offsets.length, lengths.length);
    it.table = new Map();
    it.strings = [];
    const dec = new TextDecoder();
    for (let id = 0; id < it.count; id++) {
      const start = offsets[id];
      const end = start + lengths[id];
      if (end > keys.length) {
        throw new RangeError(`caché corrupta: clave ${id} fuera de keys (${start}+${lengths[id]} > ${keys.length})`);
      }
      it.strings.push(dec.decode(keys.subarray(start, end)));
      const h = fnv1a(keys, start, end);
      const ids = it.table.get(h);
      if (ids) ids.push(id);
      else it.table.set(h, [id]);
    }
    return it;
  }
}

import { decodeJSONString, utf8Encode } from '../text.js';