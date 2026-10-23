// src/export/zip.js — contenedor ZIP mínimo (store + deflate-raw), sin deps.
//
// Solo lo que Files by Google / Excel necesitan: local headers, central
// directory y EOCD con tamaños correctos. Sin Zip64 (límite 4 GB por
// entrada, sobrado para este export) ni data descriptors: los tamaños se
// conocen tras comprimir cada entrada. El CRC es siempre del dato SIN
// comprimir (spec ZIP), en el header local y en el central.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  return (crc32Update(0xFFFFFFFF, bytes) ^ 0xFFFFFFFF) >>> 0;
}

// Variante incremental para streams: el lector de zip acumula el CRC por
// chunk sin materializar la entrada completa.
export function crc32Update(crc, bytes) {
  let c = crc;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return c >>> 0;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(chunks) {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function buildZip(entries) {
  const canCompress = typeof CompressionStream === 'function';
  const nameBytesOf = new TextEncoder().encode.bind(new TextEncoder());
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, bytes } of entries) {
    const nameBytes = nameBytesOf(name);
    const crc = crc32(bytes);
    let payload = bytes;
    let method = 0;
    if (canCompress && bytes.length > 0) {
      const deflated = await deflateRaw(bytes);
      // Store si deflate no achica (ya comprimido o vacío): el zip no crece.
      if (deflated.length < bytes.length) {
        payload = deflated;
        method = 8;
      }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, payload);
    central.push({ nameBytes, crc, compSize: payload.length, size: bytes.length, method, offset });
    offset += 30 + nameBytes.length + payload.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const e of central) {
    const dv = new DataView(new ArrayBuffer(46));
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true); // version made by
    dv.setUint16(6, 20, true); // version needed
    dv.setUint16(10, e.method, true);
    dv.setUint32(16, e.crc, true);
    dv.setUint32(20, e.compSize, true);
    dv.setUint32(24, e.size, true);
    dv.setUint16(28, e.nameBytes.length, true);
    dv.setUint32(42, e.offset, true);
    chunks.push(new Uint8Array(dv.buffer), e.nameBytes);
    centralSize += 46 + e.nameBytes.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(eocd.buffer));

  return concat(chunks);
}
