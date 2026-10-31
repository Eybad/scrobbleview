// Gregorian date conversion uses Howard Hinnant's civil calendar algorithm.
function daysFromEpoch(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m + (m > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// Reject non-ASCII digits; NaN bypasses range checks and corrupts Int32 storage.
function digits(bytes, s, e) {
  let v = 0;
  for (let i = s; i < e; i++) {
    const b = bytes[i];
    if (b < 0x30 || b > 0x39) return -1;
    v = v * 10 + (b - 0x30);
  }
  return v;
}

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function maxDay(y, mo) {
  switch (mo) {
    case 2: return isLeap(y) ? 29 : 28;
    case 4: case 6: case 9: case 11: return 30;
    default: return 31;
  }
}

// Absolute epochs must fit Int32 before values are stored relative to tsMin.
// The ceiling is 2038-01-19T03:14:07Z; later values would silently corrupt dates.
const MAX_EPOCH_I32 = 0x7fffffff;

// Accept Spotify ISO timestamps with Z or a complete ±HH:MM offset; invalid values return null.
export function parseISOToEpoch(bytes, start = 0, end = bytes.length) {
  if (end - start < 19) return null;
  if (bytes[start + 4] !== 0x2d || bytes[start + 7] !== 0x2d) return null; // '-'
  const tsep = bytes[start + 10];
  if (tsep !== 0x54 && tsep !== 0x20) return null;
  if (bytes[start + 13] !== 0x3a || bytes[start + 16] !== 0x3a) return null; // ':'
  const y = digits(bytes, start, start + 4);
  const mo = digits(bytes, start + 5, start + 7);
  const d = digits(bytes, start + 8, start + 10);
  const h = digits(bytes, start + 11, start + 13);
  const mi = digits(bytes, start + 14, start + 16);
  const s = digits(bytes, start + 17, start + 19);
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > maxDay(y, mo)) return null;
  if (h < 0 || h > 23 || mi < 0 || mi > 59 || s < 0 || s > 59) return null;

  let epoch = daysFromEpoch(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;

  let p = start + 19;
  if (p >= end) return epoch > MAX_EPOCH_I32 ? null : epoch;
  const c = bytes[p];
  if (c === 0x2e) { // '.'
    p++;
    const fstart = p;
    while (p < end && bytes[p] >= 0x30 && bytes[p] <= 0x39) p++;
    if (p === fstart) return null;
    if (p >= end) return epoch > MAX_EPOCH_I32 ? null : epoch;
  }
  const z = bytes[p];
  if (z === 0x5a) return p + 1 !== end || epoch > MAX_EPOCH_I32 ? null : epoch; // 'Z'
  if (z === 0x2b || z === 0x2d) { // '+' | '-'
    if (end - p !== 6 || bytes[p + 3] !== 0x3a) return null;
    const oh = digits(bytes, p + 1, p + 3);
    const om = digits(bytes, p + 4, p + 6);
    if (oh < 0 || oh > 23 || om < 0 || om > 59) return null;
    const off = oh * 3600 + om * 60;
    epoch -= z === 0x2b ? off : -off;
  } else {
    return null;
  }
  // Apply the offset before checking the Int32 ceiling.
  if (!Number.isFinite(epoch)) return null;
  return epoch > MAX_EPOCH_I32 ? null : epoch;
}
