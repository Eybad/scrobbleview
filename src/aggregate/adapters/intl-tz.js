// adapters/intl-tz.js — constructor de tabla de transiciones
//
// Muestreo periódico + refinamiento por bisección. La bisección pura falla
// cuando el rango contiene un número PAR de transiciones (p. ej. un dataset de
// años completos: spring y fall cancelan el offset neto y offset(a) ===
// offset(b) haría asumir "constante"). El muestreo cada 6h detecta todo cambio
// (dos muestras consecutivas alrededor de cualquier transición difieren) y la
// bisección refina cada cambio al segundo exacto. El punto medio de cada
// ventana cubre el caso teórico de un par de transiciones con neto cero dentro
// de una ventana (A→B→A, inexistente en tzdb moderno). PRECONDICIÓN REAL: ≤1
// transición por ventana de 6h (las de DST están separadas por meses), lo que
// con el mid-check equivale a ≤1 por mitad de 3h; el mid-check es cinturón para
// el par A→B→A, no para ≥3 transiciones en una ventana. La cola final (b > prevT)
// cubre el hueco <6h sin mid-check. ~7.300 llamadas Intl para 5 años, una vez
// por carga; después el lookup es binario (offset-table).
//
// Fail-fast: endSec < startSec o rangos fuera de Int32 (1901-2038, el límite
// del Int32Array de offset-table) lanzan RangeError — nunca tabla corrupta.
//
// Node ≥ 18.13 trae ICU completo (full-icu): las zonas IANA funcionan.

import { offsetTable } from './offset-table.js';

const DEFAULT_START = Date.UTC(2020, 0, 1) / 1000;
const DEFAULT_END = Date.UTC(2030, 0, 1) / 1000;
const STEP = 21600; // 6h
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

export function intlTz(ianaId, { startSec = DEFAULT_START, endSec = DEFAULT_END } = {}) {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
    throw new RangeError('intlTz: rango no finito');
  }
  if (!(endSec >= startSec)) throw new RangeError('intlTz: endSec < startSec');
  if (startSec < INT32_MIN || endSec > INT32_MAX) {
    throw new RangeError('intlTz: rango fuera de Int32 (1901-2038)');
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaId,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  function offsetAt(t) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value])
    );
    const asUTC = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour % 24,
      +parts.minute,
      +parts.second
    );
    return Math.round((asUTC - t * 1000) / 60000);
  }

  // Bisección sobre [lo, hi] con offsetAt(lo) !== offsetAt(hi): encuentra el
  // primer segundo con el offset nuevo (h - l <= 1 → h es ese segundo).
  function refine(lo, hi) {
    const out = [];
    function bisect(l, h) {
      const ol = offsetAt(l);
      const oh = offsetAt(h);
      if (h - l <= 1) {
        out.push([h, oh]);
        return;
      }
      const mid = Math.floor((l + h) / 2);
      if (offsetAt(mid) === ol) bisect(mid, h);
      else bisect(l, mid);
    }
    bisect(lo, hi);
    return out;
  }

  function buildTransitions(a, b) {
    const found = [];
    let prevT = a;
    let prevOff = offsetAt(a);
    for (let t = a + STEP; t <= b; t += STEP) {
      const off = offsetAt(t);
      if (off !== prevOff) {
        found.push(...refine(prevT, t));
        prevOff = off;
      } else {
        // off === prevOff puede ocultar un PAR de transiciones con offset neto
        // cero dentro de la ventana (p. ej. A→B→A). Muestrear el punto medio:
        // si difiere, hay transiciones internas y se refinan ambas mitades.
        const mid = Math.floor((prevT + t) / 2);
        if (offsetAt(mid) !== prevOff) {
          found.push(...refine(prevT, mid));
          found.push(...refine(mid, t));
          prevOff = off;
        }
      }
      prevT = t;
    }
    if (b > prevT) {
      const off = offsetAt(b);
      if (off !== prevOff) found.push(...refine(prevT, b));
    }
    return found;
  }

  // La primera entrada garantiza tabla no vacía (zona sin DST: 0 transiciones).
  const transitions = [[startSec, offsetAt(startSec)], ...buildTransitions(startSec, endSec)];
  const dedup = [];
  for (const [t, off] of transitions) {
    if (dedup.length === 0 || dedup[dedup.length - 1][0] !== t) dedup.push([t, off]);
  }
  return offsetTable(ianaId, dedup);
}