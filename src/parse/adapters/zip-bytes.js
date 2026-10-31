// Stream audio-history ZIP entries with CRC validation; reject Zip64 and encryption.
// Central-directory sizes remain authoritative when local headers use data descriptors.

import { resolveOptions } from '../../defaults.js';
import { FileError, AbortError } from '../errors.js';
import { crc32Update } from '../../export/zip.js';

// Match current and legacy Spotify history names in any archive directory.
const AUDIO_NAME = /^(?:Streaming_History_Audio|StreamingHistory\d*)[^/]*\.json$/i;
const TAIL_MAX = 65557; // EOCD record plus its maximum comment.
const textDecoder = new TextDecoder();

function basenameOf(name) {
  const i = name.lastIndexOf('/');
  return i < 0 ? name : name.slice(i + 1);
}

async function sliceBytes(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function findEOCD(tail, blobSize) {
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) !== 0x06054b50) continue;
    const count = dv.getUint16(i + 10, true);
    const centralSize = dv.getUint32(i + 12, true);
    const centralOffset = dv.getUint32(i + 16, true);
    if (count === 0xFFFF || centralOffset === 0xFFFFFFFF || centralSize === 0xFFFFFFFF) {
      throw new FileError('El zip usa formato Zip64 (más de 4 GB o 65535 entradas), no soportado.', { code: 'E_ZIP64' });
    }
    // Ignore signatures embedded in compressed data unless the directory fits.
    if (centralOffset + centralSize > blobSize) continue;
    return { count, centralSize, centralOffset };
  }
  throw new FileError('El archivo no es un zip válido (¿descarga truncada?).', { code: 'E_ZIP_FORMAT' });
}

function readCentral(bytes, count) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let o = 0;
  for (let n = 0; n < count; n++) {
    if (o + 46 > bytes.length || dv.getUint32(o, true) !== 0x02014b50) {
      throw new FileError('El zip está corrupto (directorio central inválido).', { code: 'E_ZIP_FORMAT' });
    }
    const nameLen = dv.getUint16(o + 28, true);
    const end = o + 46 + nameLen + dv.getUint16(o + 30, true) + dv.getUint16(o + 32, true);
    if (end > bytes.length) throw new FileError('El directorio ZIP está truncado.', { code: 'E_ZIP_FORMAT' });
    entries.push({
      name: textDecoder.decode(bytes.subarray(o + 46, o + 46 + nameLen)),
      flags: dv.getUint16(o + 8, true),
      method: dv.getUint16(o + 10, true),
      crc: dv.getUint32(o + 16, true),
      compSize: dv.getUint32(o + 20, true),
      size: dv.getUint32(o + 24, true),
      localOffset: dv.getUint32(o + 42, true)
    });
    o = end;
  }
  return entries;
}

// CRC validation runs on decompressed bytes, as required by the ZIP format.
function entrySource(blob, entry, dataStart, budget, signal) {
  function openReader() {
    let stream = blob.slice(dataStart, dataStart + entry.compSize).stream();
    if (entry.method === 8) {
      let decompressor;
      try {
        if (typeof DecompressionStream !== 'function') throw new TypeError('unsupported format');
        decompressor = new DecompressionStream('deflate-raw');
      } catch (cause) {
        if (!(cause instanceof TypeError)) throw cause;
        throw new FileError('Este entorno no admite ZIP comprimido. Extraé el ZIP y cargá sus archivos JSON.', { code: 'E_ZIP_UNSUPPORTED', cause });
      }
      stream = stream.pipeThrough(decompressor);
    }
    return stream.getReader();
  }
  let reader = null;
  let size = 0;
  let crc = 0xFFFFFFFF;
  return {
    label: entry.name,
    totalBytes: entry.size,
    async next() {
      if (signal?.aborted) throw new AbortError();
      reader ??= openReader();
      const { done, value } = await reader.read();
      if (done) {
        if (size !== entry.size) throw new FileError('El ZIP declara un tamaño de entrada incorrecto.', { code: 'E_ZIP_SIZE' });
        // Normalize the signed JS result before comparing the unsigned ZIP CRC.
        if (((crc ^ 0xFFFFFFFF) >>> 0) !== entry.crc) {
          throw new FileError(`El zip está corrupto: CRC inválido en "${entry.name}" (¿descarga truncada?).`, { code: 'E_ZIP_CRC' });
        }
        return { done: true };
      }
      size += value.length;
      budget.used += value.length;
      if (budget.used > budget.max) throw new FileError('El ZIP excede el límite de bytes descomprimidos.', { code: 'E_LIMIT_BYTES' });
      if (size > entry.size) throw new FileError('El ZIP excede el tamaño declarado de una entrada.', { code: 'E_ZIP_SIZE' });
      crc = crc32Update(crc, value);
      return { done: false, value };
    },
    async close() {
      // Cancel streams when parsing stops before the entry is exhausted.
      if (reader) await reader.cancel();
    }
  };
}

export async function zipSources(blob, options = {}) {
  const opts = resolveOptions(options);
  if (opts.signal?.aborted) throw new AbortError();
  const budget = { used: 0, max: opts.maxBytes };
  const tailStart = Math.max(0, blob.size - TAIL_MAX);
  const tail = await sliceBytes(blob, tailStart, blob.size);
  const { count, centralSize, centralOffset } = findEOCD(tail, blob.size);
  if (count > opts.maxZipEntries || centralSize > opts.maxCentralBytes) throw new FileError('El directorio ZIP excede los límites de entradas o bytes.', { code: 'E_LIMIT_ZIP' });
  const central = await sliceBytes(blob, centralOffset, centralOffset + centralSize);
  const entries = readCentral(central, count);
  const matched = entries.filter((e) => AUDIO_NAME.test(basenameOf(e.name)));
  if (matched.length === 0) {
    const shown = entries.slice(0, 10).map((e) => e.name).join(', ') + (entries.length > 10 ? ` (+${entries.length - 10} más)` : '');
    throw new FileError(`El zip no contiene historiales de audio (Streaming_History_Audio_*.json). Entradas: ${shown}`, { code: 'E_ZIP_NO_MATCH' });
  }
  if (matched.reduce((sum, entry) => sum + entry.size, 0) > opts.maxBytes) throw new FileError('El ZIP excede el límite de bytes descomprimidos.', { code: 'E_LIMIT_BYTES' });
  const sources = [];
  for (const entry of matched) {
    if (opts.signal?.aborted) throw new AbortError();
    if (entry.flags & 1) {
      throw new FileError(`El zip está encriptado ("${entry.name}"): descargalo sin contraseña.`, { code: 'E_ZIP_ENCRYPTED' });
    }
    if (entry.method !== 0 && entry.method !== 8) {
      throw new FileError(`El zip usa un método de compresión no soportado (${entry.method}) en "${entry.name}".`, { code: 'E_ZIP_METHOD' });
    }
    const local = await sliceBytes(blob, entry.localOffset, entry.localOffset + 30);
    const ldv = new DataView(local.buffer, local.byteOffset, local.byteLength);
    if (local.length < 30 || ldv.getUint32(0, true) !== 0x04034b50) {
      throw new FileError('El zip está corrupto (header local inválido).', { code: 'E_ZIP_FORMAT' });
    }
    const dataStart = entry.localOffset + 30 + ldv.getUint16(26, true) + ldv.getUint16(28, true);
    if (dataStart + entry.compSize > blob.size) {
      throw new FileError(`El zip está corrupto o truncado ("${entry.name}").`, { code: 'E_ZIP_FORMAT' });
    }
    sources.push(entrySource(blob, entry, dataStart, budget, opts.signal));
  }
  return sources;
}
