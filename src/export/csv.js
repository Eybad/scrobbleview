// src/export/csv.js — serializador CSV puro (RFC 4180: CRLF, comillas dobladas).
// Sin DOM ni I/O: (headers, rows) → string, testeable en Node.

// Los nombres de artista/canción son datos de terceros: un valor que arranca
// con =, +, -, @ o tab se evalúa como fórmula al abrir el CSV en Excel/Sheets
// (OWASP CSV injection). El apóstrofe lo neutraliza; solo aplica a strings,
// un número nunca es fórmula.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvField(v) {
  if (v == null) return '';
  const s = String(v);
  const guarded = typeof v === 'string' && FORMULA_START.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

export function toCSV(headers, rows) {
  const line = (cells) => cells.map(csvField).join(',');
  return [line(headers), ...rows.map(line)].join('\r\n');
}
