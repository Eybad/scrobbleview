// impl/behavior.js — razones start/end + pares + binge (max_run)
//
// Port del v2: starts/ends/pairs (Counter de reason_*), max_run keyed por
// track_key compuesto (como el v2 keyea por tid). Binge: racha consecutiva
// de la misma canción en el orden cronológico UTC.

import { trackKey } from './groups.js';

export function createBehaviorAcc() {
  const starts = new Map(); // rs -> count
  const ends = new Map(); // re -> count
  const pairs = new Map(); // rs*256+re -> count
  const maxRun = new Map(); // tk -> racha máxima consecutiva
  let prevTk = 0;
  let run = 0;

  return {
    onEvent(ev) {
      if (ev.rs) starts.set(ev.rs, (starts.get(ev.rs) || 0) + 1);
      if (ev.re) ends.set(ev.re, (ends.get(ev.re) || 0) + 1);
      if (ev.rs || ev.re) {
        const key = ev.rs * 256 + ev.re;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }

      const tk = trackKey(ev.tr, ev.ar);
      if (tk === prevTk) {
        run++;
      } else {
        run = 1;
        prevTk = tk;
      }
      const cur = maxRun.get(tk) || 0;
      if (run > cur) maxRun.set(tk, run);
    },

    finalize() {
      return { starts, ends, pairs, maxRun };
    }
  };
}
