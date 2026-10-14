// tz.test.js — puerto TimeZone: intl-tz (bisección), offset-table (lookup), fixed-tz
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intlTz } from '../src/aggregate/adapters/intl-tz.js';
import { offsetTable } from '../src/aggregate/adapters/offset-table.js';
import { fixedTz } from '../src/aggregate/adapters/fixed-tz.js';

// Transiciones verificadas con `date` (TZ=America/New_York):
// spring-forward 2024-03-10T07:00:00Z = 1710054000 (02:00 EST → 03:00 EDT)
// fall-back      2024-11-03T06:00:00Z = 1730613600 (02:00 EDT → 01:00 EST)
const SPRING = 1710054000;
const FALL = 1730613600;

function intlOffset(ianaId, t) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaId, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return Math.round((asUTC - t * 1000) / 60000);
}

test('tz: spring-forward NY 2024-03-10 (02:00 EST → 03:00 EDT)', () => {
  const tz = intlTz('America/New_York', { startSec: SPRING - 86400, endSec: SPRING + 86400 });
  assert.equal(tz.offsetMinutes(SPRING - 3600), -300, 'antes: EST');
  assert.equal(tz.offsetMinutes(SPRING + 3600), -240, 'después: EDT');
  // Ancla el segundo EXACTO de la transición (un refine con off-by-one fallaría).
  assert.equal(tz.offsetMinutes(SPRING - 1), -300, 'un segundo antes: EST');
  assert.equal(tz.offsetMinutes(SPRING), -240, 'en el segundo exacto: EDT');
});

test('tz: fall-back NY 2024-11-03 (02:00 EDT → 01:00 EST)', () => {
  const tz = intlTz('America/New_York', { startSec: FALL - 86400, endSec: FALL + 86400 });
  assert.equal(tz.offsetMinutes(FALL - 3600), -240, 'antes: EDT');
  assert.equal(tz.offsetMinutes(FALL + 3600), -300, 'después: EST');
});

test('tz: zona sin DST (Tokyo +540, UTC 0)', () => {
  const tokyo = intlTz('Asia/Tokyo', { startSec: 1704067200, endSec: 1735689600 });
  for (const t of [1704067200, 1710054000, 1730613600, 1735689600]) {
    assert.equal(tokyo.offsetMinutes(t), 540, `Tokyo ${t}`);
  }
  const utc = intlTz('UTC', { startSec: 1704067200, endSec: 1735689600 });
  for (const t of [1704067200, 1735689600]) {
    assert.equal(utc.offsetMinutes(t), 0, `UTC ${t}`);
  }
});

test('tz: rango con par de transiciones (offset neto cero) detecta ambas', () => {
  // El caso que rompía la bisección pura: un rango que empieza y termina en
  // EST (spring + fall se cancelan) debe detectar las DOS transiciones.
  const tz = intlTz('America/New_York', { startSec: SPRING - 30 * 86400, endSec: FALL + 30 * 86400 });
  assert.equal(tz.offsetMinutes(SPRING - 3600), -300, 'antes de spring: EST');
  assert.equal(tz.offsetMinutes(SPRING + 3600), -240, 'después de spring: EDT');
  assert.equal(tz.offsetMinutes(FALL - 3600), -240, 'antes de fall: EDT');
  assert.equal(tz.offsetMinutes(FALL + 3600), -300, 'después de fall: EST');
});

test('tz: intl-tz determinista vs Intl directo (muestreo denso)', () => {
  const tz = intlTz('America/New_York', { startSec: SPRING - 30 * 86400, endSec: FALL + 30 * 86400 });
  // Paso 1h desfasado 30 min de las transiciones (SPRING/FALL son múltiplos de
  // 3600): un error de colocación sub-horaria no puede esconderse.
  const samples = [];
  for (let t = SPRING - 7 * 86400 + 1800; t <= SPRING + 7 * 86400; t += 3600) samples.push(t);
  for (let t = FALL - 7 * 86400 + 1800; t <= FALL + 7 * 86400; t += 3600) samples.push(t);
  samples.push(SPRING - 30 * 86400, FALL + 30 * 86400);
  for (const t of samples) {
    assert.equal(tz.offsetMinutes(t), intlOffset('America/New_York', t), `t=${t}`);
  }
});

test('tz: rango multi-año con 4 transiciones (regresión del scan incompleto)', () => {
  // El escaneo recursivo devolvía tabla vacía para NY 2023-01-01 → 2025-01-01
  // (mid = 2024-01-01, los tres puntos a -300): las 4 transiciones se perdían
  // en silencio. El muestreo periódico debe detectarlas todas.
  const tz = intlTz('America/New_York', { startSec: 1672531200, endSec: 1735689600 });
  const checks = [
    [1672531200, -300], // 2023-01-01 EST
    [1678604400 + 3600, -240], // 2023-03-12 spring → EDT
    [1699164000 + 3600, -300], // 2023-11-05 fall → EST
    [1710054000 + 3600, -240], // 2024-03-10 spring → EDT
    [1730613600 + 3600, -300], // 2024-11-03 fall → EST
    [1735689600, -300] // 2025-01-01 EST
  ];
  for (const [t, off] of checks) {
    assert.equal(tz.offsetMinutes(t), off, `t=${t}`);
  }
});

test('tz: endSec < startSec lanza RangeError (fail-fast)', () => {
  assert.throws(() => intlTz('America/New_York', { startSec: 1704067200, endSec: 1704067200 - 86400 }), RangeError);
});

test('tz: rango fuera de Int32 lanza RangeError (protege offset-table)', () => {
  assert.throws(() => intlTz('America/New_York', { startSec: 0, endSec: 2147483648 }), RangeError);
  assert.throws(() => intlTz('America/New_York', { startSec: -2147483649, endSec: 0 }), RangeError);
  assert.throws(() => intlTz('America/New_York', { startSec: NaN, endSec: 0 }), RangeError);
});

test('tz: transición en el borde final del rango (cola b > prevT)', () => {
  // startSec alineado a la rejilla de 6h y endSec 30 min después de spring: la
  // última muestra del loop cae ANTES de la transición, así que la única forma
  // de detectarla es la cola final (intl-tz.js, bloque b > prevT).
  //   startSec % 21600 === 0  →  última muestra = SPRING - 3600
  //   endSec = SPRING + 1800 →  offsetAt(endSec) = -240 ≠ prevOff
  const end = SPRING + 1800;
  const start = SPRING - 25200;
  assert.equal(start % 21600, 0, 'precondición: start alineado a la rejilla de 6h');
  const tz = intlTz('America/New_York', { startSec: start, endSec: end });
  assert.equal(tz.offsetMinutes(SPRING - 3600), -300, 'antes de spring: EST');
  assert.equal(tz.offsetMinutes(SPRING - 1), -300, 'el segundo previo: EST');
  assert.equal(tz.offsetMinutes(SPRING), -240, 'el segundo exacto de la transición: EDT');
  assert.equal(tz.offsetMinutes(end), -240, 'cola del rango: EDT');
});

test('tz: offset-table lookup binario (antes/entre/después)', () => {
  const table = offsetTable('ny', [
    [SPRING - 86400, -300],
    [SPRING, -240],
    [FALL, -300]
  ]);
  assert.equal(table.offsetMinutes(SPRING - 86400), -300, 'en la primera transición');
  assert.equal(table.offsetMinutes(SPRING - 1), -300, 'justo antes de spring');
  assert.equal(table.offsetMinutes(SPRING), -240, 'en spring');
  assert.equal(table.offsetMinutes(FALL - 1), -240, 'justo antes de fall');
  assert.equal(table.offsetMinutes(FALL), -300, 'en fall');
  assert.equal(table.offsetMinutes(FALL + 999999), -300, 'después de la última');
});

test('tz: intl-tz con zona inválida lanza RangeError', () => {
  assert.throws(() => intlTz('No/Existe', { startSec: 0, endSec: 86400 }), RangeError);
});

test('tz: fixed-tz offset constante', () => {
  const tz = fixedTz('utc-4', -240);
  assert.equal(tz.id, 'utc-4');
  for (const t of [0, 1710054000, 1730613600]) {
    assert.equal(tz.offsetMinutes(t), -240);
  }
});