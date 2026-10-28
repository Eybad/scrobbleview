import { esc, fmtNum } from './charts.js';

export function createChartContract({
  id = '',
  title = '',
  unit = '',
  base = '',
  range = '',
  data = [],
  format = fmtNum,
  emptyNotice = 'Sin datos disponibles para esta visualización.'
} = {}) {
  const points = data.map((d, i) => {
    const rawVal = d.value ?? d.y ?? 0;
    const val = Number.isFinite(rawVal) ? rawVal : 0;
    const label = d.label != null ? String(d.label) : String(i + 1);
    const date = d.date != null ? String(d.date) : null;
    return {
      index: i,
      label,
      value: val,
      date,
      extra: d.extra ?? null
    };
  });

  const total = points.reduce((acc, p) => acc + p.value, 0);
  const max = points.length ? Math.max(...points.map((p) => p.value), 0) : 0;
  const min = points.length ? Math.min(...points.map((p) => p.value), 0) : 0;
  const isEmpty = points.length === 0;

  return {
    id: id || `chart-${Math.random().toString(36).slice(2, 9)}`,
    title,
    unit,
    base,
    range,
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
  const { title, unit, points, format, total } = contract;
  if (!points || points.length === 0) return '';

  const hasDates = points.some((p) => p.date != null);
  const caption = `${title}${unit ? ` (${unit})` : ''}`;

  let rowsHtml = '';
  for (const p of points) {
    const pct = total > 0 ? ((p.value / total) * 100).toFixed(1).replace('.', ',') : '0,0';
    const dateCell = hasDates ? `<td>${esc(p.date || '—')}</td>` : '';
    rowsHtml += `<tr>
      <th scope="row">${esc(p.label)}</th>
      ${dateCell}
      <td class="n">${esc(format(p.value))}</td>
      <td class="n">${pct}%</td>
    </tr>`;
  }

  const dateHeader = hasDates ? '<th scope="col">Fecha</th>' : '';

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
            <th scope="col" class="n">Cuota</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  </details>`;
}

export function renderChartWithContract(contract, chartSvg) {
  const { id, title, unit, base, range, isEmpty, emptyNotice } = contract;

  if (isEmpty) {
    return `<div class="chart-card" data-chart-id="${esc(id)}">
      <div class="chart-card__header">
        <h3 class="chart-card__title">${esc(title)}</h3>
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

  return `<div class="chart-card" data-chart-id="${esc(id)}">
    <div class="chart-card__header">
      <h3 class="chart-card__title">${esc(title)}</h3>
      ${metaHtml}
    </div>
    <div class="chart-card__body">
      <div class="chart-interactive-wrap" data-chart-target="${esc(id)}">
        ${chartSvg}
        <div class="chart-inspector" id="inspector-${esc(id)}" aria-live="polite" data-chart-id="${esc(id)}" hidden>
          <div class="chart-inspector__content">
            <strong class="chart-inspector__label"></strong>:
            <span class="chart-inspector__value"></span>
            <span class="chart-inspector__pct"></span>
          </div>
          <button type="button" class="btn-step btn-step--close" data-action="close-inspector" aria-label="Cerrar inspector">✕</button>
        </div>
      </div>
      <div class="chart-nav" role="toolbar" aria-label="Navegación de puntos de ${esc(title)}">
        <button type="button" class="btn-step btn-step--prev" data-chart-step="${esc(id)}" data-dir="-1" aria-label="Punto anterior">‹</button>
        <span class="chart-nav__status" id="nav-status-${esc(id)}">Tocar o usar flechas para inspeccionar</span>
        <button type="button" class="btn-step btn-step--next" data-chart-step="${esc(id)}" data-dir="1" aria-label="Punto siguiente">›</button>
      </div>
    </div>
    ${tableHtml}
  </div>`;
}
