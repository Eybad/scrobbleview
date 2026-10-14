// adapters/offset-table.js — mecanismo principal: búsqueda binaria sobre la tabla
//
// La tabla es [[epochSec, offsetMin], ...] ordenada por tiempo. El lookup es
// O(log n) sobre ~21 entradas: sin Intl, sin Date, por evento.

export function offsetTable(id, transitions) {
  const times = new Int32Array(transitions.length);
  const offsets = new Int32Array(transitions.length);
  for (let i = 0; i < transitions.length; i++) {
    times[i] = transitions[i][0];
    offsets[i] = transitions[i][1];
  }
  return {
    id,
    offsetMinutes(t) {
      // último tiempo <= t
      let lo = 0;
      let hi = times.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return offsets[lo];
    }
  };
}