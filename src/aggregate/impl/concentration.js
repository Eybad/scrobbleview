// HHI = Σ p_i² ∈ [1/N, 1].
// Gini = (2·Σ(i+1)·x_i)/(N·Σx_i) − (N+1)/N; equal values yield 0.
// Entropy = −Σ p_i·ln(p_i); normalized by ln(N), with N=1 defined as 1.
// Effective count = exp(H) ∈ [1, N].

function stats(values) {
  const n = values.length;
  if (n === 0) return { hhi: 0, gini: 0, entropy: 0, effective: 0 };
  let total = 0;
  for (const v of values) total += v;
  if (total <= 0) return { hhi: 0, gini: 0, entropy: 0, effective: 0 };

  let hhi = 0;
  let h = 0;
  for (const v of values) {
    const p = v / total;
    hhi += p * p;
    if (p > 0) h -= p * Math.log(p);
  }

  const sorted = [...values].sort((a, b) => a - b);
  let cum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    cum += sorted[i];
    weighted += (i + 1) * sorted[i];
  }
  const gini = n > 1 ? (2 * weighted) / (n * cum) - (n + 1) / n : 0;

  return {
    hhi,
    gini,
    entropy: n > 1 ? h / Math.log(n) : 1,
    effective: Math.exp(h)
  };
}

export function computeConcentration(groups) {
  function forEntities(entities) {
    const values = [];
    let unknownEntities = 0;
    for (const entity of entities.values()) {
      if (entity.durationKnown > 0) values.push(entity.ms);
      else unknownEntities++;
    }
    return { ...stats(values), knownEntities: values.length, unknownEntities };
  }
  return {
    artists: forEntities(groups.artists),
    tracks: forEntities(groups.tracks),
    albums: forEntities(groups.albums)
  };
}
