// Six-hour sampling and bisection find offset changes to the exact second.
// Midpoint checks catch even transition counts that endpoint-only bisection misses.
// Assumes at most one transition per three-hour half-window; offsets fit Int32.
// Requires Intl.DateTimeFormat with IANA time zone data.

import { offsetTable } from './offset-table.js';

const DEFAULT_START = Date.UTC(2020, 0, 1) / 1000;
const DEFAULT_END = Date.UTC(2030, 0, 1) / 1000;
const STEP = 21600;
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
        // Check the midpoint for A→B→A transitions hidden by equal endpoints.
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

  // Keep the table nonempty for zones without DST.
  const transitions = [[startSec, offsetAt(startSec)], ...buildTransitions(startSec, endSec)];
  const dedup = [];
  for (const [t, off] of transitions) {
    if (dedup.length === 0 || dedup[dedup.length - 1][0] !== t) dedup.push([t, off]);
  }
  return offsetTable(ianaId, dedup);
}
