import { trackKey } from './groups.js';

export function createBehaviorAcc() {
  const starts = new Map();
  const ends = new Map();
  const pairs = new Map();

  function createRunTracker() {
    const maxRun = new Map();
    let prevTk = 0;
    let run = 0;
    return {
      track(tk, isValidPair) {
        if (isValidPair && tk === prevTk) {
          run++;
        } else {
          run = 1;
          prevTk = tk;
        }
        const cur = maxRun.get(tk) || 0;
        if (run > cur) maxRun.set(tk, run);
      },
      maxRun
    };
  }

  const runSel = createRunTracker();
  const runOrig = createRunTracker();
  const runSess = createRunTracker();

  let prevEv = null;

  return {
    onEvent(ev) {
      if (ev.rs) starts.set(ev.rs, (starts.get(ev.rs) || 0) + 1);
      if (ev.re) ends.set(ev.re, (ends.get(ev.re) || 0) + 1);
      if (ev.rs || ev.re) {
        const key = ev.rs * 256 + ev.re;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }

      const tk = trackKey(ev.tr, ev.ar);
      const isFirst = !prevEv;
      const isOrigConsecutive = !isFirst && ev.pos != null && prevEv.pos != null && ev.pos === prevEv.pos + 1;

      const isSessionConsecutive = isOrigConsecutive && ev.originalSession === prevEv.originalSession;

      runSel.track(tk, !isFirst);
      runOrig.track(tk, isOrigConsecutive);
      runSess.track(tk, isSessionConsecutive);

      prevEv = { pos: ev.pos, originalSession: ev.originalSession };
    },

    finalize() {
      return {
        starts,
        ends,
        pairs,
        maxRun: {
          selection: runSel.maxRun,
          originalConsecutive: runOrig.maxRun,
          originalSession: runSess.maxRun
        },
        runSelection: runSel.maxRun,
        runConsecutive: runOrig.maxRun,
        runSession: runSess.maxRun
      };
    }
  };
}
