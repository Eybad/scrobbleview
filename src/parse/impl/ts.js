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

function num(bytes, s, e) {
  let v = 0;
  for (let i = s; i < e; i++) v = v * 10 + (bytes[i] - 0x30);
  return v;
}

// La columna t es Int32Array (columns.js) y almacena segundos RELATIVOS a
// meta.tsMin. tsMin es el mínimo y puede ser 0, así que el epoch absoluto tiene
// que caber en Int32: 0x7FFFFFFF = 2038-01-19T03:14:07Z. Un epoch mayor desborda
// en silencio al storear y derive.js reconstruye una fecha equivocada sin aviso.
// El tope es el del tipo, no un año redondo: el epoch de 2100 ya lo excede.
const MAX_EPOCH_I32 = 0x7fffffff;

// bytes: Uint8Array con el string ISO. Devuelve epoch en segundos, o null si inválido.
export function parseISOToEpoch(bytes, start = 0, end = bytes.length) {
  if (end - start < 19) return null;
  const y = num(bytes, start, start + 4);
  const mo = num(bytes, start + 5, start + 7);
  const d = num(bytes, start + 8, start + 10);
  const h = num(bytes, start + 11, start + 13);
  const mi = num(bytes, start + 14, start + 16);
  const s = num(bytes, start + 17, start + 19);
  if (y < 1970 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return null;

  let epoch = daysFromEpoch(y, mo, d) * 86400 + h * 3600 + mi * 60 + s;

  // byte 19: 'Z' (UTC), '+'/'-' (offset), '.' (fracción, se ignora)
  const c = bytes[start + 19];
  if (c === 0x2b || c === 0x2d) { // '+' | '-'
    const oh = num(bytes, start + 20, start + 22);
    const om = num(bytes, start + 23, start + 25);
    const off = oh * 3600 + om * 60;
    epoch -= c === 0x2b ? off : -off;
  }
  // El offset se aplica antes de acotar: un offset negativo puede llevar el
  // instante por encima del tope aunque la fecha local esté justo debajo.
  return epoch > MAX_EPOCH_I32 ? null : epoch;
}
