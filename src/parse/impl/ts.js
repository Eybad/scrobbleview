// ts.js — parseo de timestamps ISO 8601 a epoch segundos, sin Date (aritmética entera)
//
// Formato Spotify: "YYYY-MM-DDTHH:MM:SSZ" (puede traer offset "+HH:MM"/"-HH:MM"
// o fracción de segundo ".mmm"). Granularidad de segundo: exacto.

// Días desde 1970-01-01 (algoritmo de Howard Hinnant, rango gregoriano).
function daysFromEpoch(y, m, d) {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const mp = m + (m > 2 ? -3 : 9);
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// Como el parseo numérico clásico, pero devuelve -1 si algún byte no es un
// (0x30-0x39). Sin esto, un byte no numérico produce un valor basura que
// puede pasar los chequeos de rango, y un byte fuera del buffer (undefined)
// produce NaN, que sortea la acotación `epoch > MAX_EPOCH_I32` (toda
// comparación con NaN es false) y corrompe la columna t.
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

// La columna t es Int32Array (columns.js) y almacena segundos RELATIVOS a
// meta.tsMin. tsMin es el mínimo y puede ser 0, así que el epoch absoluto tiene
// que caber en Int32: 0x7FFFFFFF = 2038-01-19T03:14:07Z. Un epoch mayor desborda
// en silencio al storear y derive.js reconstruye una fecha equivocada sin aviso.
// El tope es el del tipo, no un año redondo: el epoch de 2100 ya lo excede.
const MAX_EPOCH_I32 = 0x7fffffff;

// bytes: Uint8Array con el string ISO. Devuelve epoch en segundos, o null si inválido.
// Nunca devuelve NaN: todo camino de fallo retorna null.
// Formatos aceptados: "YYYY-MM-DDTHH:MM:SS" + ["Z" | "+HH:MM" | "-HH:MM"],
// con fracción de segundo opcional (".mmm", se ignora) y ' ' como alternativa
// a 'T'. El offset truncado o fuera de rango invalida el timestamp completo.
export function parseISOToEpoch(bytes, start = 0, end = bytes.length) {
  if (end - start < 19) return null;
  if (bytes[start + 4] !== 0x2d || bytes[start + 7] !== 0x2d) return null; // '-'
  const tsep = bytes[start + 10];
  if (tsep !== 0x54 && tsep !== 0x20) return null; // 'T' o ' '
  if (bytes[start + 13] !== 0x3a || bytes[start + 16] !== 0x3a) return null; // ':'
  const y = digits(bytes, start, start + 4);
  const mo = digits(bytes, start + 5, start + 7);
  const d = digits(bytes, start + 8, start + 10);
  const h = digits(bytes, start + 11, start + 13);
  const mi = digits(bytes, start + 14, start + 16);
  const s = digits(bytes, start + 17, start + 19);
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > maxDay(y, mo)) return null;
  if (h > 23 || mi > 59 || s > 60) return null;

  let epoch = daysFromEpoch(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;

  // byte 19: fin, 'Z' (UTC), '+'/'-' (offset), '.' (fracción, se ignora).
  let p = start + 19;
  if (p >= end) return epoch > MAX_EPOCH_I32 ? null : epoch;
  const c = bytes[p];
  if (c === 0x2e) { // '.'
    p++;
    const fstart = p;
    while (p < end && bytes[p] >= 0x30 && bytes[p] <= 0x39) p++;
    if (p === fstart) return null; // '.' sin dígitos
    if (p >= end) return epoch > MAX_EPOCH_I32 ? null : epoch;
  }
  const z = bytes[p];
  if (z === 0x5a) return epoch > MAX_EPOCH_I32 ? null : epoch; // 'Z'
  if (z === 0x2b || z === 0x2d) { // '+' | '-'
    // Offset completo "+HH:MM": 6 bytes; exige ':' separador y rangos válidos.
    if (end - p < 6 || bytes[p + 3] !== 0x3a) return null;
    const oh = digits(bytes, p + 1, p + 3);
    const om = digits(bytes, p + 4, p + 6);
    if (oh < 0 || oh > 23 || om < 0 || om > 59) return null;
    const off = oh * 3600 + om * 60;
    epoch -= z === 0x2b ? off : -off;
  } else {
    return null;
  }
  // El offset se aplica antes de acotar: un offset negativo puede llevar el
  // instante por encima del tope aunque la fecha local esté justo debajo.
  if (!Number.isFinite(epoch)) return null;
  return epoch > MAX_EPOCH_I32 ? null : epoch;
}
