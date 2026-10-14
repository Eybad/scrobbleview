// impl/transitions.js — transiciones artista→artista (Markov primer orden)
//
// Todos los pares consecutivos en el orden cronológico local, incluyendo
// auto-transiciones (mismo artista dos veces seguidas → badge "repeat").
// top: pares con count >= 5, ordenados desc. auto: total de auto-transiciones.

export function createTransitionsAcc() {
  const pairs = new Map(); // ar*2^32+ar2 -> count
  let prevAr = -1;

  return {
    onEvent(ev) {
      if (prevAr >= 0) {
        const key = prevAr * 4294967296 + ev.ar;
        pairs.set(key, (pairs.get(key) || 0) + 1);
      }
      prevAr = ev.ar;
    },

    finalize() {
      const top = [];
      let auto = 0;
      for (const [key, count] of pairs) {
        const from = Math.floor(key / 4294967296);
        const to = key % 4294967296;
        if (from === to) auto += count;
        if (count >= 5) top.push({ from, to, count });
      }
      top.sort((a, b) => b.count - a.count);
      return { pairs, top, auto };
    }
  };
}