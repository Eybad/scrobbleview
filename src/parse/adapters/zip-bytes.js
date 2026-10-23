// adapters/zip-bytes.js — ByteSources desde un zip (browser)
//
// Expande el zip de Spotify (my_spotify_data.zip, con los JSON dentro de una
// carpeta) a una fuente por historial. Acceso aleatorio con Blob.slice: cola
// → EOCD → central directory → entrada por entrada; cada entrada descomprime
// en streaming (DecompressionStream('deflate-raw'), el mismo piso que el
// export) y el CRC se acumula por chunk y se verifica al terminar: un dato
// corrupto aborta el analyze completo, nunca modelo parcial.
//
// Sin Zip64 (4 GB / 65535 entradas: los exports de Spotify están muy lejos)
// ni zips encriptados: fail-fast con código. Los tamaños salen del central
// directory (confiables aunque el local header use data descriptor).

import { FileError } from '../errors.js';
import { crc32Update } from '../../export/zip.js';

// Historial extendido (Streaming_History_Audio_*.json) y viejo
// (StreamingHistory0.json), en cualquier carpeta del zip.
const AUDIO_NAME = /^(?:Streaming_History_Audio|StreamingHistory\d*)[^/]*\.json$/i;
const TAIL_MAX = 65557; // EOCD (22) + comentario (65535) + margen
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
    // Una firma dentro de datos comprimidos no sirve: el directorio debe caber.
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
    entries.push({
      name: textDecoder.decode(bytes.subarray(o + 46, o + 46 + nameLen)),
      flags: dv.getUint16(o + 8, true),
      method: dv.getUint16(o + 10, true),
      crc: dv.getUint32(o + 16, true),
      compSize: dv.getUint32(o + 20, true),
      size: dv.getUint32(o + 24, true),
      localOffset: dv.getUint32(o + 42, true)
    });
    o += 46 + nameLen + dv.getUint16(o + 30, true) + dv.getUint16(o + 32, true);
  }
  return entries;
}

// Fuente por entrada: stream del slice (store) o del slice descomprimido
// (deflate). El CRC corre sobre el dato DESCOMPRIMIDO (spec ZIP).
function entrySource(blob, entry, dataStart) {
  let stream = blob.slice(dataStart, dataStart + entry.compSize).stream();
  if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  let crc = 0xFFFFFFFF;
  return {
    label: entry.name,
    totalBytes: entry.size,
    async next() {
      const { done, value } = await reader.read();
      if (done) {
        // >>> 0: el xor en JS es signed 32-bit; sin él un CRC con high bit
        // set compararía negativo contra el unsigned del directorio.
        if (((crc ^ 0xFFFFFFFF) >>> 0) !== entry.crc) {
          throw new FileError(`El zip está corrupto: CRC inválido en "${entry.name}" (¿descarga truncada?).`, { code: 'E_ZIP_CRC' });
        }
        return { done: true };
      }
      crc = crc32Update(crc, value);
      return { done: false, value };
    },
    async close() {
      // Cancela el stream si el parseo abortó a mitad de entrada; en un
      // stream ya terminado es un no-op.
      await reader.cancel();
    }
  };
}

export async function zipSources(blob) {
  const tailStart = Math.max(0, blob.size - TAIL_MAX);
  const tail = await sliceBytes(blob, tailStart, blob.size);
  const { count, centralSize, centralOffset } = findEOCD(tail, blob.size);
  const central = await sliceBytes(blob, centralOffset, centralOffset + centralSize);
  const entries = readCentral(central, count);
  const matched = entries.filter((e) => AUDIO_NAME.test(basenameOf(e.name)));
  if (matched.length === 0) {
    // Diagnóstico con lo que sí había: el usuario necesita saber si el zip
    // es de otro tipo de datos o de otra región del export.
    const shown = entries.slice(0, 10).map((e) => e.name).join(', ') + (entries.length > 10 ? ` (+${entries.length - 10} más)` : '');
    throw new FileError(`El zip no contiene historiales de audio (Streaming_History_Audio_*.json). Entradas: ${shown}`, { code: 'E_ZIP_NO_MATCH' });
  }
  const sources = [];
  for (const entry of matched) {
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
    sources.push(entrySource(blob, entry, dataStart));
  }
  return sources;
}
