import { esc, fmtNum } from './charts.js';

export function createChartContract({
  id = '',
  title = '',
  unit = '',
  base = '',
  range = '',
  data = [],
  format = fmtNum,
  showShare = true,
  chartType = 'line',
  pageSize = 25,
  seriesLabels = null,
  fallbackTable = '',
  emptyNotice = 'Sin datos disponibles para esta visualización.'
} = {}) {
  const points = data.map((d, i) => {
    const rawVal = d.value === null || d.y === null ? null : (d.value ?? d.y ?? 0);
    const val = rawVal === null || !Number.isFinite(rawVal) ? null : rawVal;
    const label = d.label != null ? String(d.label) : String(i + 1);
    const date = d.date != null ? String(d.date) : null;
    return {
      index: i,
      label,
      value: val,
      date,
      values: Array.isArray(d.values) ? d.values.map((value) => value == null || !Number.isFinite(value) ? null : value) : null,
      extra: d.extra ?? null
    };
  });

  const knownValues = points.map((point) => point.value).filter(Number.isFinite);
  const total = knownValues.reduce((acc, value) => acc + value, 0);
  const max = knownValues.length ? Math.max(...knownValues) : 0;
  const min = knownValues.length ? Math.min(...knownValues) : 0;
  const isEmpty = points.length === 0;

  return {
    id: id || `chart-${Math.random().toString(36).slice(2, 9)}`,
    title,
    unit,
    base,
    range,
    showShare,
    chartType,
    pageSize,
    seriesLabels,
    fallbackTable,
    points,
    total,
    max,
    min,
    format,
    isEmpty,
    emptyNotice
  };
}

export function chartDataTableHTML(contract) {
  const { title, unit, points, format, total, showShare, pageSize } = contract;
  if (contract.fallbackTable) return contract.fallbackTable;
  if (!points || points.length === 0) return '';

  const hasDates = points.some((p) => p.date != null);
  const caption = `${title}${unit ? ` (${unit})` : ''}`;

  let rowsHtml = '';
  if (contract.seriesLabels?.length) {
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      rowsHtml += `<tr data-chart-row="${i}"${i >= pageSize ? ' hidden' : ''}>
        <th scope="row">${esc(point.label)}</th>
        ${contract.seriesLabels.map((_, index) => `<td class="n">${point.values?.[index] == null ? 'Sin base' : esc(format(point.values[index]))}</td>`).join('')}
        <td class="n">${point.value == null ? 'Sin base' : esc(format(point.value))}</td>
      </tr>`;
    }
    const pagination = points.length > pageSize
      ? `<div class="chart-table-controls" data-chart-table="${esc(contract.id)}" data-page-size="${pageSize}" data-page="0">
          <button type="button" class="btn btn-secondary" data-chart-page="${esc(contract.id)}" data-dir="-1" disabled>Anterior</button>
          <span class="chart-table-status" aria-live="polite">Mostrando 1–${pageSize} de ${points.length}</span>
          <button type="button" class="btn btn-secondary" data-chart-page="${esc(contract.id)}" data-dir="1">Siguiente</button>
        </div>`
      : '';
    return `<details class="table-fallback">
      <summary>Ver como tabla</summary>
      <div class="table-scroll"><table>
        <caption>${esc(`${title}${unit ? ` (${unit})` : ''}`)}</caption>
        <thead><tr><th scope="col">Etiqueta</th>${contract.seriesLabels.map((label) => `<th scope="col" class="n">${esc(label)}</th>`).join('')}<th scope="col" class="n">Total${unit ? ` (${esc(unit)})` : ''}</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table></div>
      ${pagination}
    </details>`;
  }

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const pct = p.value == null ? '—' : total > 0 ? ((p.value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
    const dateCell = hasDates ? `<td>${esc(p.date || '—')}</td>` : '';
    rowsHtml += `<tr data-chart-row="${i}"${i >= pageSize ? ' hidden' : ''}>
      <th scope="row">${esc(p.label)}</th>
      ${dateCell}
      <td class="n">${p.value == null ? 'Sin base' : esc(format(p.value))}</td>
      ${showShare ? `<td class="n">${pct}%</td>` : ''}
    </tr>`;
  }

  const dateHeader = hasDates ? '<th scope="col">Fecha</th>' : '';
  const shareHeader = showShare ? '<th scope="col" class="n">Cuota</th>' : '';
  const pagination = points.length > pageSize
    ? `<div class="chart-table-controls" data-chart-table="${esc(contract.id)}" data-page-size="${pageSize}" data-page="0">
        <button type="button" class="btn btn-secondary" data-chart-page="${esc(contract.id)}" data-dir="-1" disabled>Anterior</button>
        <span class="chart-table-status" aria-live="polite">Mostrando 1–${pageSize} de ${points.length}</span>
        <button type="button" class="btn btn-secondary" data-chart-page="${esc(contract.id)}" data-dir="1">Siguiente</button>
      </div>`
    : '';

  return `<details class="table-fallback">
    <summary>Ver como tabla</summary>
    <div class="table-scroll">
      <table>
        <caption>${esc(caption)}</caption>
        <thead>
          <tr>
            <th scope="col">Etiqueta</th>
            ${dateHeader}
            <th scope="col" class="n">Valor${unit ? ` (${esc(unit)})` : ''}</th>
            ${shareHeader}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    ${pagination}
  </details>`;
}

export function renderChartWithContract(contract, chartSvg, { headingLevel = 3 } = {}) {
  const { id, title, unit, base, range, isEmpty, emptyNotice, points, format, total, showShare, chartType } = contract;
  const headingTag = headingLevel === 2 ? 'h2' : 'h3';

  if (isEmpty) {
    return `<div class="chart-card" data-chart-id="${esc(id)}">
      <div class="chart-card__header">
        <${headingTag} class="chart-card__title">${esc(title)}</${headingTag}>
      </div>
      <p class="empty">${esc(emptyNotice)}</p>
    </div>`;
  }

  const metaItems = [];
  if (unit) metaItems.push(`Unidad: ${esc(unit)}`);
  if (base) metaItems.push(`Base: ${esc(base)}`);
  if (range) metaItems.push(`Rango: ${esc(range)}`);
  const metaHtml = metaItems.length
    ? `<div class="chart-card__meta">${metaItems.map((m) => `<span class="chart-card__meta-item">${m}</span>`).join(' · ')}</div>`
    : '';

  const tableHtml = chartDataTableHTML(contract);
  const pointData = JSON.stringify(points.map((point) => ({
    label: point.label,
    date: point.date,
    value: point.value,
    values: point.values,
    extra: point.extra,
    valueText: point.value == null ? 'Sin base' : format(point.value),
    shareText: showShare && point.value == null ? 'sin base'
      : showShare && total > 0 ? `${((point.value / total) * 100).toFixed(1).replace('.', ',')}%` : ''
  })));

  return `<div class="chart-card" data-chart-id="${esc(id)}" data-chart-type="${esc(chartType)}" data-chart-unit="${esc(unit)}" data-chart-points="${esc(pointData)}">
    <div class="chart-card__header">
      <${headingTag} class="chart-card__title">${esc(title)}</${headingTag}>
      ${metaHtml}
    </div>
    <div class="chart-card__body">
      <div class="chart-interactive-wrap" data-chart-target="${esc(id)}">
        ${chartSvg}
        <div class="chart-inspector" id="inspector-${esc(id)}" aria-live="polite" data-chart-id="${esc(id)}">
          <div class="chart-inspector__content">
            <strong class="chart-inspector__label">Elegí un punto</strong>
            <span class="chart-inspector__value"></span>
            <span class="chart-inspector__pct"></span>
          </div>
          <button type="button" class="btn-step btn-step--close" data-action="close-inspector" aria-label="Cerrar inspector" disabled>✕</button>
        </div>
      </div>
      <div class="chart-nav" role="toolbar" aria-label="Navegación de puntos de ${esc(title)}">
        <button type="button" class="btn-step btn-step--prev" data-chart-step="${esc(id)}" data-dir="-1" aria-label="Punto anterior" disabled>‹</button>
        <span class="chart-nav__status" id="nav-status-${esc(id)}">${points.length} puntos</span>
        <button type="button" class="btn-step btn-step--next" data-chart-step="${esc(id)}" data-dir="1" aria-label="Punto siguiente">›</button>
      </div>
    </div>
    ${tableHtml}
  </div>`;
}
