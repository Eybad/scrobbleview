import { buildCompareSeries, compareAverages, compareEntityRankings, computeMetricDelta } from '../src/compare.js';
import { esc, fmtMs, fmtNum } from '../src/charts.js';
import { compareDateAt, compareEntityKey, normalizeCompareEntities } from './compare-state.js';

const CATEGORY_NAMES = { artists: 'Artistas', tracks: 'Canciones', albums: 'Álbumes' };
const ENTITY_KINDS = { artists: 'artist', tracks: 'track', albums: 'album' };

function dateRangeLabel(range) {
  const from = compareDateAt(range, 'from');
  const to = compareDateAt(range, 'to');
  return from && to ? `${from} → ${to}` : 'Período inválido';
}

function comparisonForm(ctx) {
  const manual = ctx.comparePreset === 'manual';
  const rangeA = ctx.compareRangeA;
  const rangeB = ctx.compareRangeB;
  return `<form class="card compare-form" id="compare-form">
    <div class="compare-form__intro">
      <h2>Períodos y resolución</h2>
      <p>Ambos períodos se calculan sobre el historial completo. Se aplican los mismos filtros de entidades y banderas; estas fechas reemplazan los filtros temporales. Si el año anterior no fue bisiesto, el 29 de febrero se compara con el 28.</p>
    </div>
    <div class="compare-form__fields">
      <label class="field"><span>Período de referencia B</span>
        <select name="preset" data-compare-field="preset">
          <option value="equal_previous"${ctx.comparePreset === 'equal_previous' ? ' selected' : ''}>Anterior, de igual duración</option>
          <option value="same_period_last_year"${ctx.comparePreset === 'same_period_last_year' ? ' selected' : ''}>Mismo período del año anterior</option>
          <option value="manual"${manual ? ' selected' : ''}>Fechas manuales</option>
        </select>
      </label>
      <label class="field"><span>Granularidad</span>
        <select name="granularity" data-compare-field="granularity">
          <option value="daily"${ctx.compareGranularity === 'daily' ? ' selected' : ''}>Diaria</option>
          <option value="weekly"${ctx.compareGranularity === 'weekly' ? ' selected' : ''}>Semanal (lunes a domingo)</option>
          <option value="monthly"${ctx.compareGranularity === 'monthly' ? ' selected' : ''}>Mensual</option>
        </select>
      </label>
    </div>
    <div class="compare-form__ranges">
      <fieldset class="compare-range">
        <legend>Período A</legend>
        <label class="field"><span>Desde</span><input type="date" name="fromA" data-compare-field="fromA" value="${esc(ctx.compareFrom ?? '')}" required></label>
        <label class="field"><span>Hasta</span><input type="date" name="toA" data-compare-field="toA" value="${esc(ctx.compareTo ?? '')}" required></label>
      </fieldset>
      <fieldset class="compare-range">
        <legend>Período B</legend>
        <label class="field"><span>Desde</span><input type="date" name="fromB" data-compare-field="fromB" value="${esc(compareDateAt(rangeB, 'from') ?? ctx.compareRefFrom ?? '')}"${manual ? ' required' : ' disabled'}></label>
        <label class="field"><span>Hasta</span><input type="date" name="toB" data-compare-field="toB" value="${esc(compareDateAt(rangeB, 'to') ?? ctx.compareRefTo ?? '')}"${manual ? ' required' : ' disabled'}></label>
      </fieldset>
    </div>
    <button type="submit" class="btn btn-primary">Calcular comparación</button>
    <p class="compare-form__status" data-compare-status role="status" aria-live="polite"></p>
  </form>`;
}

function metricRow(label, valueA, valueB, format) {
  const hasBase = Number.isFinite(valueA) && Number.isFinite(valueB);
  const delta = hasBase ? computeMetricDelta(valueA, valueB, format) : null;
  return `<tr><th scope="row">${esc(label)}</th><td class="n">${esc(Number.isFinite(valueA) ? format(valueA) : '—')}</td><td class="n">${esc(Number.isFinite(valueB) ? format(valueB) : '—')}</td><td class="n">${esc(delta?.diffFormatted ?? '—')}</td><td class="n">${esc(delta?.pctLabel ?? 'sin base')}</td></tr>`;
}

function formatAveragePlays(value) {
  return value.toLocaleString('es-ES', { maximumFractionDigits: 1 });
}

function averagesRows(periodA, periodB, rangeA, rangeB) {
  const averagesA = compareAverages(periodA.totals, rangeA, periodA.totals.activeDays);
  const averagesB = compareAverages(periodB.totals, rangeB, periodB.totals.activeDays);
  const rows = [
    [`Reproducciones por día del rango (${averagesA.totalDays} días A; ${averagesB.totalDays} días B)`, averagesA.playsPerRangeDay, averagesB.playsPerRangeDay, formatAveragePlays],
    [`Tiempo por día del rango (${averagesA.totalDays} días A; ${averagesB.totalDays} días B)`, averagesA.msPerRangeDay, averagesB.msPerRangeDay, fmtMs],
    [`Reproducciones por día activo (${averagesA.activeDays} días A; ${averagesB.activeDays} días B)`, averagesA.activeDays ? averagesA.playsPerActiveDay : null, averagesB.activeDays ? averagesB.playsPerActiveDay : null, formatAveragePlays],
    [`Tiempo por día activo (${averagesA.activeDays} días A; ${averagesB.activeDays} días B)`, averagesA.activeDays ? averagesA.msPerActiveDay : null, averagesB.activeDays ? averagesB.msPerActiveDay : null, fmtMs]
  ];
  return rows.map(([label, valueA, valueB, format]) => metricRow(label, valueA, valueB, format)).join('');
}

function totalsTable(periodA, periodB, rangeA, rangeB) {
  return `<div class="table-scroll"><table class="compare-results-table">
    <caption>Resultados de A frente a B</caption>
    <thead><tr><th scope="col">Indicador</th><th scope="col" class="n">A</th><th scope="col" class="n">B</th><th scope="col" class="n">Diferencia</th><th scope="col" class="n">Variación</th></tr></thead>
    <tbody>
      ${metricRow('Tiempo escuchado', periodA.totals.ms, periodB.totals.ms, fmtMs)}
      ${metricRow('Reproducciones', periodA.totals.plays, periodB.totals.plays, fmtNum)}
      ${metricRow('Reproducciones con duración conocida', periodA.totals.durationKnown, periodB.totals.durationKnown, fmtNum)}
      ${metricRow('Reproducciones con duración desconocida', periodA.totals.durationUnknown, periodB.totals.durationUnknown, fmtNum)}
      ${metricRow('Artistas', periodA.totals.artists, periodB.totals.artists, fmtNum)}
      ${metricRow('Canciones', periodA.totals.tracks, periodB.totals.tracks, fmtNum)}
      ${metricRow('Álbumes', periodA.totals.albums, periodB.totals.albums, fmtNum)}
      ${metricRow('Días activos', periodA.totals.activeDays, periodB.totals.activeDays, fmtNum)}
      ${averagesRows(periodA, periodB, rangeA, rangeB)}
    </tbody>
  </table></div>`;
}

function seriesRows(periodA, periodB, rangeA, rangeB, granularity, metric) {
  const byMs = metric === 'ms';
  const seriesA = buildCompareSeries(periodA.daily, rangeA, granularity, byMs);
  const seriesB = buildCompareSeries(periodB.daily, rangeB, granularity, byMs);
  const rows = [];
  const format = byMs ? fmtMs : fmtNum;
  const count = Math.max(seriesA.length, seriesB.length);
  for (let index = 0; index < count; index++) {
    const a = seriesA[index];
    const b = seriesB[index];
    rows.push(`<tr data-compare-series-row="${index}"${index >= 25 ? ' hidden' : ''}>
      <th scope="row">${esc(a ? `${a.label}${a.isPartial ? ' (parcial)' : ''}` : '—')}</th>
      <td class="n">${esc(a ? format(a.value) : '—')}</td>
      <th scope="row">${esc(b ? `${b.label}${b.isPartial ? ' (parcial)' : ''}` : '—')}</th>
      <td class="n">${esc(b ? format(b.value) : '—')}</td>
    </tr>`);
  }
  if (!rows.length) return '<p class="empty">No hay períodos para mostrar.</p>';
  const controls = rows.length > 25 ? `<div class="compare-series-controls" data-compare-series-controls data-page="0" data-page-size="25">
      <button type="button" class="btn btn-secondary" data-compare-series-page="-1" disabled>Anterior</button>
      <span aria-live="polite">Mostrando 1–${Math.min(25, rows.length)} de ${rows.length}</span>
      <button type="button" class="btn btn-secondary" data-compare-series-page="1">Siguiente</button>
    </div>` : '';
  return `<div class="table-scroll"><table class="compare-series-table">
    <caption>Series ${granularity === 'daily' ? 'diarias' : granularity === 'weekly' ? 'semanales' : 'mensuales'} (${byMs ? 'tiempo escuchado' : 'reproducciones'})</caption>
    <thead><tr><th scope="col">Período A</th><th scope="col" class="n">Valor A</th><th scope="col">Período B</th><th scope="col" class="n">Valor B</th></tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>${controls}`;
}

function rankingTable(kind, periodA, periodB, metric, selectedEntities) {
  const entitiesA = periodA.entities[kind];
  const entitiesB = periodB.entities[kind];
  const rankMap = (entities) => new Map([...entities].map(([key, entity]) => [key, { ...entity, value: entity[metric] ?? 0 }]));
  const totalA = periodA.entityTotals[kind][metric];
  const totalB = periodB.entityTotals[kind][metric];
  const rows = compareEntityRankings(rankMap(entitiesA), rankMap(entitiesB), totalA, totalB, 50);
  if (!rows.length) return `<p class="empty">No hay ${CATEGORY_NAMES[kind].toLowerCase()} en estos períodos.</p>`;
  const format = metric === 'ms' ? fmtMs : fmtNum;
  const selectedKeys = new Set(selectedEntities.map(compareEntityKey));
  return `<div class="table-scroll"><table class="compare-ranking-table">
    <caption>Top 50 ${CATEGORY_NAMES[kind].toLowerCase()}: posiciones y cuotas (${metric === 'ms' ? 'tiempo' : 'reproducciones'})</caption>
    <thead><tr><th scope="col">Entidad</th><th scope="col" class="n">Pos. A</th><th scope="col" class="n">Pos. B</th><th scope="col" class="n">Valor A</th><th scope="col" class="n">Valor B</th><th scope="col" class="n">Diferencia</th><th scope="col" class="n">Cuota A</th><th scope="col" class="n">Cuota B</th><th scope="col" class="n">Cambio</th><th scope="col">Movimiento</th><th scope="col">Comparar</th></tr></thead>
    <tbody>${rows.map((row) => {
      const entity = entitiesA.get(row.key) ?? entitiesB.get(row.key);
      const identity = kind === 'artists'
        ? { kind: 'artist', name: entity?.title }
        : { kind: ENTITY_KINDS[kind], artist: entity?.artist, title: entity?.title };
      const key = compareEntityKey(identity);
      const isSelected = key != null && selectedKeys.has(key);
      const canSelect = isSelected || selectedEntities.length < 3;
      const button = key == null ? '—' : `<button type="button" class="btn btn-secondary compare-select-button" data-compare-entity="${esc(JSON.stringify(identity))}" aria-pressed="${isSelected}" aria-label="${isSelected ? 'Quitar' : 'Agregar'} ${esc(row.name)} ${isSelected ? 'de' : 'a'} la comparación"${canSelect ? '' : ' disabled'}>${isSelected ? 'Quitar' : 'Agregar'}</button>`;
      return `<tr>
        <th scope="row">${esc(row.name)}</th>
        <td class="n">${row.rankA ?? '—'}</td><td class="n">${row.rankB ?? '—'}</td>
        <td class="n">${esc(format(row.valA))}</td><td class="n">${esc(format(row.valB))}</td>
        <td class="n">${esc(format(row.diff))}</td><td class="n">${row.shareA == null ? 'sin base' : `${row.shareA.toFixed(1).replace('.', ',')}%`}</td>
        <td class="n">${row.shareB == null ? 'sin base' : `${row.shareB.toFixed(1).replace('.', ',')}%`}</td><td class="n">${esc(row.shareDiffLabel)}</td><td>${esc(row.status)}</td><td>${button}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function entityLabel(entity) {
  return entity.kind === 'artist' ? entity.name : `${entity.title} — ${entity.artist}`;
}

function selectedEntityIndex(period, selections) {
  const selectedKeys = new Set(selections.map(compareEntityKey));
  const index = new Map();
  const kinds = new Set(selections.map((selection) => selection.kind));
  for (const kind of kinds) {
    const entities = period.entities[`${kind}s`];
    for (const entity of entities.values()) {
      const identity = kind === 'artist'
        ? { kind, name: entity.title }
        : { kind, artist: entity.artist, title: entity.title };
      const key = compareEntityKey(identity);
      if (selectedKeys.has(key)) index.set(key, entity);
    }
  }
  return index;
}

function selectedEntityValue(index, selection, metric) {
  const entity = index.get(compareEntityKey(selection));
  return entity?.[metric] ?? 0;
}

function selectedEntityShare(period, index, selection, metric) {
  const total = period.entityTotals[`${selection.kind}s`][metric];
  return total > 0 ? (selectedEntityValue(index, selection, metric) / total) * 100 : null;
}

function selectedEntitiesView(periodA, periodB, selections, mode, metric) {
  const format = metric === 'ms' ? fmtMs : fmtNum;
  const indexA = selectedEntityIndex(periodA, selections);
  const indexB = selectedEntityIndex(periodB, selections);
  const values = selections.flatMap((selection) => mode === 'share'
    ? [selectedEntityShare(periodA, indexA, selection, metric), selectedEntityShare(periodB, indexB, selection, metric)]
    : [selectedEntityValue(indexA, selection, metric), selectedEntityValue(indexB, selection, metric)]).filter(Number.isFinite);
  const maxValue = mode === 'share' ? 100 : Math.max(0, ...values);
  const domain = maxValue || 1;
  const rows = selections.map((selection) => {
    const valueA = selectedEntityValue(indexA, selection, metric);
    const valueB = selectedEntityValue(indexB, selection, metric);
    const shownA = mode === 'share' ? selectedEntityShare(periodA, indexA, selection, metric) : valueA;
    const shownB = mode === 'share' ? selectedEntityShare(periodB, indexB, selection, metric) : valueB;
    const shown = (value) => value == null ? 'sin base' : mode === 'share' ? `${value.toFixed(1).replace('.', ',')}%` : format(value);
    const delta = mode === 'share'
      ? shownA == null || shownB == null ? 'sin base' : `${shownA - shownB >= 0 ? '+' : ''}${(shownA - shownB).toFixed(1).replace('.', ',')} pp`
      : computeMetricDelta(valueA, valueB, format).diffFormatted;
    const widthA = shownA == null ? 0 : Math.max(0, Math.min(100, shownA / domain * 100));
    const widthB = shownB == null ? 0 : Math.max(0, Math.min(100, shownB / domain * 100));
    return `<article class="compare-entity-card">
      <div class="compare-entity-card__heading"><h3>${esc(entityLabel(selection))}</h3><button type="button" class="btn btn-secondary compare-select-button" data-compare-entity="${esc(JSON.stringify(selection))}" aria-pressed="true" aria-label="Quitar ${esc(entityLabel(selection))} de la comparación">Quitar</button></div>
      <div class="compare-entity-bars" role="img" aria-label="${esc(`${entityLabel(selection)}: A ${shown(shownA)}, B ${shown(shownB)}`)}">
        <div class="compare-entity-bar-row"><span>A</span><span class="compare-entity-bar"><span style="--bar-width:${widthA}%"></span></span><strong>${esc(shown(shownA))}</strong></div>
        <div class="compare-entity-bar-row"><span>B</span><span class="compare-entity-bar"><span style="--bar-width:${widthB}%"></span></span><strong>${esc(shown(shownB))}</strong></div>
      </div>
      <p class="compare-entity-delta">Diferencia: ${esc(delta)}</p>
    </article>`;
  });
  const announcement = selections.length === 3 ? 'Límite de tres entidades alcanzado.' : `Podés agregar ${3 - selections.length} ${3 - selections.length === 1 ? 'entidad más' : 'entidades más'}.`;
  const empty = '<p class="empty">Agregá artistas, canciones o álbumes desde los rankings para compararlos.</p>';
  const tableRows = selections.map((selection) => {
    const valueA = selectedEntityValue(indexA, selection, metric);
    const valueB = selectedEntityValue(indexB, selection, metric);
    const shownA = mode === 'share' ? selectedEntityShare(periodA, indexA, selection, metric) : valueA;
    const shownB = mode === 'share' ? selectedEntityShare(periodB, indexB, selection, metric) : valueB;
    const shown = (value) => value == null ? 'sin base' : mode === 'share' ? `${value.toFixed(1).replace('.', ',')}%` : format(value);
    const delta = mode === 'share'
      ? shownA == null || shownB == null ? 'sin base' : `${shownA - shownB >= 0 ? '+' : ''}${(shownA - shownB).toFixed(1).replace('.', ',')} pp`
      : computeMetricDelta(valueA, valueB, format).diffFormatted;
    return `<tr><th scope="row">${esc(entityLabel(selection))}</th><td class="n">${esc(shown(shownA))}</td><td class="n">${esc(shown(shownB))}</td><td class="n">${esc(delta)}</td></tr>`;
  });
  return `<section class="compare-selected card" aria-labelledby="compare-selected-title">
    <div class="compare-selected__heading"><div><h2 id="compare-selected-title" tabindex="-1">Entidades seleccionadas (${selections.length} de 3)</h2><p>Escala común para A y B${mode === 'share' ? ': cuota del total de su categoría.' : ` en ${metric === 'ms' ? 'tiempo' : 'reproducciones'}.`}</p></div>
      <label class="field"><span>Comparar por</span><select id="compare-entity-mode" data-compare-entity-mode><option value="absolute"${mode === 'absolute' ? ' selected' : ''}>Valor absoluto</option><option value="share"${mode === 'share' ? ' selected' : ''}>Cuota</option></select></label></div>
    <p class="compare-selected__status" data-compare-entity-status role="status" aria-live="polite">${announcement}</p>
    ${selections.length ? `<div class="compare-entity-grid">${rows.join('')}</div><div class="table-scroll"><table class="compare-selected-table"><caption>Valores exactos de las entidades seleccionadas (${mode === 'share' ? 'cuota' : metric === 'ms' ? 'tiempo' : 'reproducciones'})</caption><thead><tr><th scope="col">Entidad</th><th scope="col" class="n">A</th><th scope="col" class="n">B</th><th scope="col" class="n">Diferencia</th></tr></thead><tbody>${tableRows.join('')}</tbody></table></div>` : empty}
  </section>`;
}

export function compareView(_model, _id, ctx = {}) {
  const rangeA = ctx.compareRangeA;
  const rangeB = ctx.compareRangeB;
  const result = ctx.compareResult;
  const byMs = ctx.metric === 'ms';
  let results = '<p class="empty">La comparación todavía no está calculada.</p>';
  if (ctx.compareStatus === 'loading') results = '<p class="status" role="status">Calculando ambos períodos sobre el historial cargado…</p>';
  else if (ctx.compareStatus === 'error') results = `<p class="status error" role="alert">${esc(ctx.compareLoadError || 'No se pudo calcular la comparación.')}</p>`;
  else if (result && rangeA && rangeB) {
    results = `<p class="view-meta">A: ${esc(dateRangeLabel(result.rangeA))} · B: ${esc(dateRangeLabel(result.rangeB))} · zona horaria ${esc(result.timeZone)}</p>
      ${result.warning ? `<p class="status status--warning" role="status">${esc(result.warning)}</p>` : ''}
      ${totalsTable(result.periodA, result.periodB, result.rangeA, result.rangeB)}
      <section class="compare-series card-subtle"><h2>Evolución por período</h2>${seriesRows(result.periodA, result.periodB, result.rangeA, result.rangeB, ctx.compareGranularity, byMs ? 'ms' : 'plays')}</section>
      ${selectedEntitiesView(result.periodA, result.periodB, normalizeCompareEntities(ctx.compareEntities), ctx.compareEntityMode === 'share' ? 'share' : 'absolute', byMs ? 'ms' : 'plays')}
      <div class="grid-2 compare-rankings">${Object.keys(CATEGORY_NAMES).map((kind) => `<section class="card"><h2>${CATEGORY_NAMES[kind]}</h2>${rankingTable(kind, result.periodA, result.periodB, byMs ? 'ms' : 'plays', normalizeCompareEntities(ctx.compareEntities))}</section>`).join('')}</div>`;
  } else if (ctx.compareError) results = `<p class="status error" role="alert">${esc(ctx.compareError)}</p>`;
  else if (ctx.compareLoading) results = '<p class="status" role="status">Preparando comparación…</p>';
  return `<header class="view-header"><h1>Comparación de períodos</h1></header>
    ${comparisonForm(ctx)}
    ${!result && ctx.compareWarning ? `<p class="status status--warning" role="status">${esc(ctx.compareWarning)}</p>` : ''}
    ${results}`;
}
