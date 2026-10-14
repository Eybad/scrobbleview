// impl/derive.js — cols derivadas en orden cronológico local
//
// Un pase sobre el dataset: ordena los eventos por timestamp LOCAL (como el v2:
// el orden por UTC puede diferir en la transición de DST), y produce las
// columnas que usan todas las métricas y los filtros. Aritmética entera, cero Date.

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
  const local = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const abs = ds.t[i] + ds.meta.tsMin;
    local[i] = abs + tz.offsetMinutes(abs) * 60;
  }
  const order = new Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => local[a] - local[b]);

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
    const l = local[i];
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
  return { t, loc, hour, dow, ymd, day, isSkipped, ms, order };
}