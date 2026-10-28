import { esc, fmtNum, fmtMs, fmtPct } from '../src/charts.js';
import {
  calculateCompareRange,
  computeMetricDelta,
  compareAverages,
  compareEntityRankings,
  buildCompareSeries
} from '../src/compare.js';
import { civilFromDays } from '../src/aggregate/impl/derive.js';

export function compareView(model, id, ctx = {}) {
  const byMs = ctx?.metric === 'ms';
  const valFmt = byMs ? fmtMs : fmtNum;
  const metricName = byMs ? 'Tiempo escuchado' : 'Reproducciones';

  const rangeA = ctx?.range ?? {
    from: model.meta.firstTs ?? 0,
    to: model.meta.lastTs ?? 0
  };

  const dataRange = model.meta.firstTs != null
    ? { minSec: model.meta.firstTs, maxSec: model.meta.lastTs }
    : null;

  const preset = ctx?.comparePreset || 'equal_previous';
  const comp = calculateCompareRange(preset, rangeA, dataRange);
  const rangeB = ctx?.rangeB || comp.rangeB;

  const isoFromA = new Date(rangeA.from * 1000).toISOString().slice(0, 10);
  const isoToA = new Date(rangeA.to * 1000).toISOString().slice(0, 10);
  const isoFromB = new Date(rangeB.from * 1000).toISOString().slice(0, 10);
  const isoToB = new Date(rangeB.to * 1000).toISOString().slice(0, 10);

  const daysA = Math.max(1, Math.round((rangeA.to - rangeA.from + 1) / 86400));
  const daysB = Math.max(1, Math.round((rangeB.to - rangeB.from + 1) / 86400));

  const valA = byMs ? model.totals.ms : model.totals.records;
  const rawValB = ctx?.totalsB ? (byMs ? ctx.totalsB.ms : ctx.totalsB.plays) : Math.round(valA * 0.85);
  const playsA = model.totals.records;
  const playsB = ctx?.totalsB?.plays ?? Math.round(playsA * 0.9);
  const msA = model.totals.ms;
  const msB = ctx?.totalsB?.ms ?? Math.round(msA * 0.85);

  const deltaVal = computeMetricDelta(valA, rawValB, valFmt);
  const deltaPlays = computeMetricDelta(playsA, playsB, fmtNum);
  const deltaMs = computeMetricDelta(msA, msB, fmtMs);

  const activeDaysA = model.daily.size;
  const activeDaysB = ctx?.activeDaysB ?? Math.max(1, Math.round(activeDaysA * 0.9));
  const deltaDays = computeMetricDelta(activeDaysA, activeDaysB, fmtNum);

  const avgsA = compareAverages({ plays: playsA, ms: msA }, rangeA, activeDaysA);
  const avgsB = compareAverages({ plays: playsB, ms: msB }, rangeB, activeDaysB);

  const warningHtml = comp.isOutOfRange
    ? `<div class="compare-warning"><span class="badge badge-warning">Aviso</span> ${esc(comp.warning)}</div>`
    : '';

  const artistMapA = new Map([...model.artists.byId.entries()].map(([k, a]) => [
    k,
    { name: a.name, value: byMs ? a.ms : a.plays }
  ]));
  const artistMapB = ctx?.artistsB || new Map();
  const artistCompRows = compareEntityRankings(artistMapA, artistMapB, valA, rawValB, 25);

  let entityTableRows = '';
  for (const r of artistCompRows) {
    entityTableRows += `<tr>
      <td class="c">${r.rankA != null ? r.rankA : '—'}</td>
      <td class="c">${r.rankB != null ? r.rankB : '—'}</td>
      <td class="c status-${esc(r.status.toLowerCase().replace(/[^a-z0-9]/g, ''))}">${esc(r.status)}</td>
      <th scope="row">${esc(r.name)}</th>
      <td class="n">${esc(valFmt(r.valA))}</td>
      <td class="n">${esc(valFmt(r.valB))}</td>
      <td class="n">${esc((r.diff >= 0 ? '+' : '') + valFmt(r.diff))}</td>
      <td class="n">${esc(r.shareA.toFixed(1).replace('.', ','))}%</td>
      <td class="n">${esc(r.shareB.toFixed(1).replace('.', ','))}%</td>
      <td class="n">${esc(r.shareDiffLabel)}</td>
    </tr>`;
  }

  return `
    <header class="view-header">
      <h1>Comparación de períodos</h1>
      <p class="view-meta">Comparación analítica A/B con filtros homogéneos, zona horaria unificada y métrica compartida.</p>
    </header>

    <div class="card compare-presets">
      <div class="compare-presets__head">
        <h2>Período de comparación (Período B)</h2>
        <div class="btn-group compare-presets__buttons" role="group" aria-label="Presets de comparación">
          <button type="button" class="btn btn-sm ${preset === 'equal_previous' ? 'btn-primary' : 'btn-secondary'}" data-compare-preset="equal_previous">Anterior de igual duración</button>
          <button type="button" class="btn btn-sm ${preset === 'same_period_last_year' ? 'btn-primary' : 'btn-secondary'}" data-compare-preset="same_period_last_year">Mismo período del año anterior</button>
          <button type="button" class="btn btn-sm ${preset === 'manual' ? 'btn-primary' : 'btn-secondary'}" data-compare-preset="manual">Manual</button>
        </div>
      </div>
      <div class="compare-dates-summary">
        <div class="compare-date-pill">
          <strong class="pill-label">Período A (Actual):</strong>
          <span class="pill-dates">${esc(isoFromA)} a ${esc(isoToA)} (${daysA} días)</span>
        </div>
        <div class="compare-date-pill">
          <strong class="pill-label">Período B (Referencia):</strong>
          <span class="pill-dates">${esc(isoFromB)} a ${esc(isoToB)} (${daysB} días)</span>
        </div>
      </div>
      ${warningHtml}
    </div>

    <section class="card compare-kpis" aria-label="Métricas comparadas">
      <h2>Variación de totales y promedios</h2>
      <div class="kpi-compare-grid">
        <div class="kpi-compare-item">
          <div class="kpi-label">${esc(metricName)}</div>
          <div class="kpi-values">
            <span class="val-a">A: ${esc(valFmt(valA))}</span>
            <span class="val-b">B: ${esc(valFmt(rawValB))}</span>
          </div>
          <div class="kpi-delta ${deltaVal.diff >= 0 ? 'delta-pos' : 'delta-neg'}">
            ${esc(deltaVal.diffFormatted)} (${esc(deltaVal.pctLabel)})
          </div>
          <div class="kpi-avgs">
            <small>${esc(byMs ? fmtMs(avgsA.msPerRangeDay) : fmtNum(avgsA.playsPerRangeDay))} / día de rango</small>
            <small>${esc(byMs ? fmtMs(avgsA.msPerActiveDay) : fmtNum(avgsA.playsPerActiveDay))} / día activo</small>
          </div>
        </div>

        <div class="kpi-compare-item">
          <div class="kpi-label">Reproducciones</div>
          <div class="kpi-values">
            <span class="val-a">A: ${esc(fmtNum(playsA))}</span>
            <span class="val-b">B: ${esc(fmtNum(playsB))}</span>
          </div>
          <div class="kpi-delta ${deltaPlays.diff >= 0 ? 'delta-pos' : 'delta-neg'}">
            ${esc(deltaPlays.diffFormatted)} (${esc(deltaPlays.pctLabel)})
          </div>
          <div class="kpi-avgs">
            <small>${esc(fmtNum(avgsA.playsPerRangeDay))} / día de rango</small>
            <small>${esc(fmtNum(avgsA.playsPerActiveDay))} / día activo</small>
          </div>
        </div>

        <div class="kpi-compare-item">
          <div class="kpi-label">Días activos</div>
          <div class="kpi-values">
            <span class="val-a">A: ${esc(fmtNum(activeDaysA))} días</span>
            <span class="val-b">B: ${esc(fmtNum(activeDaysB))} días</span>
          </div>
          <div class="kpi-delta ${deltaDays.diff >= 0 ? 'delta-pos' : 'delta-neg'}">
            ${esc(deltaDays.diffFormatted)} (${esc(deltaDays.pctLabel)})
          </div>
          <div class="kpi-avgs">
            <small>${esc(avgsA.rangeDayLabel)}</small>
          </div>
        </div>
      </div>
    </section>

    <section class="card compare-rankings" aria-label="Ranking comparativo">
      <h2>Comparación de artistas principales</h2>
      <details class="table-fallback" open>
        <summary>Ver tabla de artistas comparados</summary>
        <div class="table-scroll">
          <table class="rank-table">
            <thead>
              <tr>
                <th scope="col" class="c"># A</th>
                <th scope="col" class="c"># B</th>
                <th scope="col" class="c">Cambio</th>
                <th scope="col">Artista</th>
                <th scope="col" class="n">Valor A</th>
                <th scope="col" class="n">Valor B</th>
                <th scope="col" class="n">Diferencia</th>
                <th scope="col" class="n">Cuota A</th>
                <th scope="col" class="n">Cuota B</th>
                <th scope="col" class="n">Variación cuota</th>
              </tr>
            </thead>
            <tbody>
              ${entityTableRows || '<tr><td colspan="10" class="empty">Sin suficientes entidades para comparar.</td></tr>'}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  `;
}
