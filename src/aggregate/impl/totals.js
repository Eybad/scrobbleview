// impl/totals.js — totales globales (un pase sobre ds, sin ordenar)
//
// Port del v2 (totals + ms_dist + completed + median_ms) + métricas nuevas:
// playsSignificant (ms >= minMs) y playsSkipped (ms < skipThresholdMs).
// episodes se deriva de los warnings del parser (EPISODE): el parser descarta
// episodios, así que el dataset nunca los contiene.

const MS_BUCKETS = [
  [0, 10000, '<10 s'],
  [10000, 30000, '10–30 s'],
  [30000, 60000, '30–60 s'],
  [60000, 180000, '1–3 min'],
  [180000, 300000, '3–5 min'],
  [300000, Infinity, '>5 min']
];

const COMPLETED_REASONS = new Set(['trackdone', 'endplay']);

export function computeTotals(ds, minMs, skipThresholdMs) {
  const n = ds.meta.count;
  let ms = 0;
  let skipped = 0;
  let shuffle = 0;
  let offline = 0;
  let completed = 0;
  let playsSignificant = 0;
  let playsSkipped = 0;
  const msDist = new Array(MS_BUCKETS.length).fill(0);
  const allMs = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    const m = ds.m[i];
    ms += m;
    allMs[i] = m;
    if (ds.flags[i] & 2) skipped++;
    if (ds.flags[i] & 1) shuffle++;
    if (ds.flags[i] & 4) offline++;
    if (m >= minMs) playsSignificant++;
    if (m < skipThresholdMs) playsSkipped++;
    const re = ds.re[i];
    if (re && COMPLETED_REASONS.has(ds.dicts.reasons.get(re))) completed++;
    const b = m < 10000 ? 0 : m < 30000 ? 1 : m < 60000 ? 2 : m < 180000 ? 3 : m < 300000 ? 4 : 5;
    msDist[b]++;
  }

  // TypedArray.sort ordena numéricamente (a diferencia de Array.sort).
  allMs.sort();
  const medianMs = n === 0 ? 0
    : n % 2 === 1 ? allMs[(n - 1) >> 1]
    : (allMs[n >> 1] + allMs[(n >> 1) - 1]) / 2;

  let episodes = 0;
  for (const w of ds.meta.warnings) if (w.code === 'EPISODE') episodes++;

  return {
    records: n,
    ms,
    skipped,
    shuffle,
    offline,
    episodes,
    completed,
    interrupted: n - completed,
    medianMs,
    avgMs: n ? ms / n : 0,
    msDist: MS_BUCKETS.map(([, , label], i) => ({ label, count: msDist[i] })),
    playsSignificant,
    playsSkipped
  };
}