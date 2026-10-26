// Derived columns follow UTC chronology. localOrder indexes these columns by
// wall-clock time for range searches, which need a separate order during DST.

// Días desde epoch → fecha civil (inverso del algoritmo de Hinnant).
export function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: m <= 2 ? y + 1 : y, m, d };
}

// cols: t (epoch s UTC), loc (epoch s local), hour (0-23), dow (0-6, lunes=0),
// ymd (y*10000+m*100+d), day (días desde epoch local), isSkipped (0/1), ms.
// order: permutación posición-sorteada → índice original (para leer ds.* en orden).
export function derive(ds, tz) {
  const n = ds.meta.count;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => ds.t[a] - ds.t[b]);

  const t = new Int32Array(n);
  const loc = new Int32Array(n);
  const hour = new Uint8Array(n);
  const dow = new Uint8Array(n);
  const ymd = new Int32Array(n);
  const day = new Int32Array(n);
  const isSkipped = new Uint8Array(n);
  const ms = new Uint32Array(n);

  for (let k = 0; k < n; k++) {
    const i = order[k];
    const abs = ds.t[i] + ds.meta.tsMin;
    const l = abs + tz.offsetMinutes(abs) * 60;
    t[k] = abs;
    loc[k] = l;
    hour[k] = ((Math.floor(l / 3600) % 24) + 24) % 24; // doble módulo: el local puede ser < 0 (pre-1970) y el % simple da negativo → 254 en Uint8Array
    const d = Math.floor(l / 86400);
    dow[k] = ((d + 3) % 7 + 7) % 7; // lunes=0 (1970-01-01, jueves → 3)
    day[k] = d;
    const c = civilFromDays(d);
    ymd[k] = c.y * 10000 + c.m * 100 + c.d;
    isSkipped[k] = (ds.flags[i] & 2) !== 0 ? 1 : 0;
    ms[k] = ds.m[i];
  }
  const positions = new Uint32Array(n);
  for (let k = 0; k < n; k++) positions[order[k]] = k;
  const localOrder = new Uint32Array(n);
  for (let k = 0; k < n; k++) localOrder[k] = k;
  localOrder.sort((a, b) => loc[a] - loc[b]);
  return { t, loc, hour, dow, ymd, day, isSkipped, ms, order, localOrder, positions };
}

// Select already-derived rows without another time-zone lookup or UTC sort.
export function selectDerived(derived, indices) {
  const positions = Uint32Array.from(indices, (index) => derived.positions[index]);
  positions.sort();
  const selected = {};
  for (const field of ['t', 'loc', 'hour', 'dow', 'ymd', 'day', 'isSkipped', 'ms']) {
    const source = derived[field];
    selected[field] = source.constructor.from(positions, (position) => source[position]);
  }
  selected.order = Uint32Array.from(positions, (position) => derived.order[position]);
  selected.localOrder = Uint32Array.from(positions, (_, index) => index);
  selected.localOrder.sort((a, b) => selected.loc[a] - selected.loc[b]);
  return selected;
}
