export function createTransitionsAcc() {

  function createSubAcc() {
    const pairs = new Map();
    return {
      record(fromAr, toAr) {
        const key = fromAr * 4294967296 + toAr;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      },
      finalize() {
        const top = [];
        let auto = 0;
        const baseCounts = new Map();

        for (const [key, count] of pairs) {
          const from = Math.floor(key / 4294967296);
          baseCounts.set(from, (baseCounts.get(from) || 0) + count);
        }

        for (const [key, count] of pairs) {
          const from = Math.floor(key / 4294967296);
          const to = key % 4294967296;
          const isRepeat = from === to;
          if (isRepeat) auto += count;
          if (count >= 5) {
            const baseCount = baseCounts.get(from) || count;
            top.push({
              from,
              to,
              count,
              baseCount,
              prob: count / baseCount,
              isRepeat
            });
          }
        }
        top.sort((a, b) => b.count - a.count);
        return { pairs, top, auto, baseCounts };
      }
    };
  }

  const selection = createSubAcc();
  const originalConsecutive = createSubAcc();
  const originalSession = createSubAcc();

  let prevEv = null;

  return {
    onEvent(ev) {
      if (prevEv) {
        selection.record(prevEv.ar, ev.ar);

        const isOrigConsecutive = ev.pos != null && prevEv.pos != null && ev.pos === prevEv.pos + 1;
        if (isOrigConsecutive) {
          originalConsecutive.record(prevEv.ar, ev.ar);

          if (ev.originalSession === prevEv.originalSession) {
            originalSession.record(prevEv.ar, ev.ar);
          }
        }
      }
      prevEv = { ar: ev.ar, pos: ev.pos, originalSession: ev.originalSession };
    },

    finalize() {
      const selRes = selection.finalize();
      const origRes = originalConsecutive.finalize();
      const sessRes = originalSession.finalize();

      return {
        selection: selRes,
        originalConsecutive: origRes,
        originalSession: sessRes,
        pairs: selRes.pairs,
        top: selRes.top,
        auto: selRes.auto,
        baseCounts: selRes.baseCounts
      };
    }
  };
}
