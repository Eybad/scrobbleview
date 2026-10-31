// Prefix formula-like user strings to prevent CSV injection in spreadsheets.
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
