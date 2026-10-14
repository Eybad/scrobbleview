// charts.js — componentes SVG puros: (data, opts) → string HTML/SVG
//
// Sin DOM, sin estado, sin dependencias. Cada gráfico lleva role="img" +
// aria-label y <title> por elemento (tooltip accesible, no solo hover).
// Escala secuencial NO cromática (un solo tono) para heatmaps (WCAG 1.4.1).
//
// CONTRATO DE ESCAPING — leer antes de tocar un generator:
//  · Todo string de dato (label, title, cellText, caption, centerLabel,
//    cellTitle) se escapa con esc() EXACTAMENTE una vez, sobre el valor CRUDO.
//    Nunca armar un string a partir de uno ya escapado y volver a pasar esc()
//    (produce doble escape visible: "&amp;lt;").
//  · `format` es la excepción: su retorno se emite crudo porque solo recibe
//    números y debe poder devolver markup numérico. Los formatters del proyecto
//    (fmtNum/fmtMs/fmtPct) pasan por toLocaleString/toFixed y no pueden emitir
//    "<". Si alguna vez se le pasa un formatter con dato de usuario, hay que
//    escapar SU retorno en el generator.
//  · `accent`, `colors` y `colorScale` se interpolan en atributos sin escapar:
//    son constantes de paleta. Tratar cualquier valor de usuario como color
//    sería un error de contrato, no de sanitización.

export const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DOW_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const DOW_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const PALETTE = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#9b5de5', '#fb8500', '#8ecae6', '#e63946', '#2a9d8f', '#e9c46a'];

// Acento del design system (css/style.css --accent) + escala secuencial de
// heatmaps (css --heat-0…--heat-5). Los charts no leen variables CSS (son
// strings SVG puros), así que la paleta se duplica acá como constantes.
export const ACCENT = '#1db954';
export const HEAT = ['#1a1e26', '#123524', '#14532d', '#15803d', '#22c55e', '#4ade80'];

export function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function fmtNum(n) {
  return Math.round(n).toLocaleString('es-ES');
}

export function fmtMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

export function fmtPct(x) {
  return `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
}

// Escala discreta cuantizada de 6 niveles sobre la paleta del design system.
// Nivel 0 reservado para v <= 0 (sin actividad); v > 0 usa raíz cuadrada para
// dar resolución a los valores chicos. Por encima del máximo satura.
export function makeScale(max, palette = HEAT) {
  const top = palette.length - 1;
  return (v) => {
    if (max <= 0 || v <= 0) return palette[0];
    const t = Math.min(1, v / max);
    return palette[1 + Math.min(top - 1, Math.floor(Math.sqrt(t) * top))];
  };
}

// ---------- barChart ----------

export function barChart({ data, width = 640, height = 220, format = fmtNum, accent = ACCENT, showValue = true }) {
  const n = data.length;
  if (n === 0) return '';
  const max = Math.max(...data.map((d) => d.value), 1);
  const pad = 4;
  const slot = width / n;
  const barW = Math.max(2, slot - pad * 2);
  const labelH = 18;
  const topPad = showValue ? 16 : 6;
  const plotH = height - labelH - topPad;
  const bars = data.map((d, i) => {
    const h = Math.max(1, (d.value / max) * plotH);
    const x = i * slot + pad;
    const y = topPad + plotH - h;
    // Escapar SIEMPRE el valor crudo: armar el title desde el label ya
    // escapado y volver a aplicar esc() produce doble escape ("&amp;lt;").
    const rawLabel = d.label != null ? String(d.label) : '';
    const label = esc(rawLabel);
    const title = d.title != null ? String(d.title) : `${rawLabel}: ${format(d.value)}`;
    const value = showValue
      ? `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" class="chart-value" font-size="9">${format(d.value)}</text>`
      : '';
    return `<g><title>${esc(title)}</title>
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${accent}" rx="2"/>
      ${value}
      <text x="${(x + barW / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" class="chart-label" font-size="9">${label}</text>
    </g>`;
  }).join('');
  const aria = `Gráfico de barras: ${data.map((d) => `${d.label}: ${format(d.value)}`).join(', ')}`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}" class="chart">${bars}</svg>`;
}

// ---------- lineChart ----------

export function lineChart({ points, width = 640, height = 200, format = fmtNum, accent = ACCENT, area = true }) {
  const n = points.length;
  if (n === 0) return '';
  const pad = { l: 8, r: 8, t: 10, b: 18 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const xs = points.map((_, i) => (n === 1 ? pad.l + plotW / 2 : pad.l + (i / (n - 1)) * plotW));
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const ys = points.map((p) => pad.t + plotH - (p.y / maxY) * plotH);
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  const areaPath = `${line} L${xs[n - 1].toFixed(1)},${(pad.t + plotH).toFixed(1)} L${xs[0].toFixed(1)},${(pad.t + plotH).toFixed(1)} Z`;
  const dots = points.map((p, i) => {
    const raw = p.label != null ? String(p.label) : '';
    const title = raw ? `${raw}: ${format(p.y)}` : format(p.y);
    return `<circle cx="${xs[i].toFixed(1)}" cy="${ys[i].toFixed(1)}" r="2.5" fill="${accent}"><title>${esc(title)}</title></circle>`;
  }).join('');
  const labels = points.map((p, i) => {
    // Diezmado del eje X: con muchas etiquetas se superponen. Se muestra
    // 1 de cada `step` más la última (los extremos siempre visibles).
    if (p.label == null) return '';
    const step = Math.max(1, Math.ceil(n / 8));
    if (i % step !== 0 && i !== n - 1) return '';
    return `<text x="${xs[i].toFixed(1)}" y="${height - 4}" text-anchor="middle" class="chart-label" font-size="10">${esc(String(p.label))}</text>`;
  }).join('');
  const aria = `Gráfico de líneas: ${points.map((p, i) => `${p.label ?? i}: ${format(p.y)}`).join(', ')}`;
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(aria)}" class="chart">
    ${area ? `<path d="${areaPath}" fill="${accent}" opacity="0.15"/>` : ''}
    <path d="${line}" fill="none" stroke="${accent}" stroke-width="2"/>
    ${dots}${labels}
  </svg>`;
}

// ---------- heatmap (día × hora, etc.) ----------

export function heatmap({ cells, width = 640, height = 200, colorScale, xLabels = [], yLabels = [], cellTitle = (c) => `${c.x},${c.y}: ${c.value}`, cellSize = 14, gap = 2, ariaLabel = 'Mapa de calor' }) {
  if (cells.length === 0) return '';
  const labelW = yLabels.length ? 34 : 0;
  const labelH = xLabels.length ? 16 : 0;
  const plotW = width - labelW;
  const plotH = height - labelH;
  const cols = xLabels.length || Math.max(...cells.map((c) => c.x)) + 1;
  const rows = yLabels.length || Math.max(...cells.map((c) => c.y)) + 1;
  const cw = Math.min(cellSize, (plotW - gap * (cols - 1)) / cols);
  const ch = Math.min(cellSize, (plotH - gap * (rows - 1)) / rows);
  const rects = cells.map((c) => {
    const x = labelW + c.x * (cw + gap);
    const y = c.y * (ch + gap);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="${colorScale(c.value)}" rx="1.5"><title>${esc(cellTitle(c))}</title></rect>`;
  }).join('');
  const xl = xLabels.map((l, i) => `<text x="${(labelW + i * (cw + gap) + cw / 2).toFixed(1)}" y="${height - 3}" text-anchor="middle" class="chart-label" font-size="8">${esc(String(l))}</text>`).join('');
  const yl = yLabels.map((l, i) => `<text x="${labelW - 4}" y="${(i * (ch + gap) + ch / 2 + 3).toFixed(1)}" text-anchor="end" class="chart-label" font-size="8">${esc(String(l))}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}" class="chart">${rects}${xl}${yl}</svg>`;
}

// Tabla fallback cell-navegable para heatmaps (SC 2.5.8 / no solo hover).
export function heatmapTable({ cells, xLabels, yLabels, cellText = (c) => String(c.value), caption }) {
  const rows = yLabels.length || Math.max(...cells.map((c) => c.y)) + 1;
  const cols = xLabels.length || Math.max(...cells.map((c) => c.x)) + 1;
  const grid = new Map(cells.map((c) => [`${c.x}-${c.y}`, c]));
  let html = `<details class="table-fallback"><summary>Ver como tabla</summary><table>`;
  if (caption) html += `<caption>${esc(caption)}</caption>`;
  html += '<thead><tr><th></th>';
  for (let x = 0; x < cols; x++) html += `<th scope="col">${xLabels[x] != null ? esc(String(xLabels[x])) : x}</th>`;
  html += '</tr></thead><tbody>';
  for (let y = 0; y < rows; y++) {
    html += `<tr><th scope="row">${yLabels[y] != null ? esc(String(yLabels[y])) : y}</th>`;
    for (let x = 0; x < cols; x++) {
      const c = grid.get(`${x}-${y}`);
      html += `<td>${c ? esc(cellText(c)) : ''}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></details>';
  return html;
}

// ---------- donut ----------

export function donut({ segments, size = 180, format = fmtNum, centerLabel = '', colors = PALETTE }) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return '';
  const r = size / 2;
  const ir = r * 0.62;
  const cx = r;
  const cy = r;
  let a0 = -Math.PI / 2;
  const arcs = segments.map((s, i) => {
    const frac = s.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = frac > 0.5 ? 1 : 0;
    const color = colors[i % colors.length];
    const path = frac >= 1
      ? `<circle cx="${cx}" cy="${cy}" r="${(r + ir) / 2}" fill="none" stroke="${color}" stroke-width="${r - ir}"><title>${esc(s.label)}: ${format(s.value)}</title></circle>`
      : `<path d="M${(cx + r * Math.cos(a0)).toFixed(2)},${(cy + r * Math.sin(a0)).toFixed(2)} A${r},${r} 0 ${large} 1 ${(cx + r * Math.cos(a1)).toFixed(2)},${(cy + r * Math.sin(a1)).toFixed(2)} L${(cx + ir * Math.cos(a1)).toFixed(2)},${(cy + ir * Math.sin(a1)).toFixed(2)} A${ir},${ir} 0 ${large} 0 ${(cx + ir * Math.cos(a0)).toFixed(2)},${(cy + ir * Math.sin(a0)).toFixed(2)} Z" fill="${color}"><title>${esc(s.label)}: ${format(s.value)} (${fmtPct(frac)})</title></path>`;
    a0 = a1;
    return path;
  }).join('');
  const legend = segments.map((s, i) => {
    const color = colors[i % colors.length];
    return `<li class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${esc(s.label)} <span class="legend-value">${format(s.value)}</span></li>`;
  }).join('');
  return `<div class="donut-wrap">
    <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Donut: ${esc(segments.map((s) => `${s.label}: ${format(s.value)}`).join(', '))}" class="chart donut">${arcs}
      ${centerLabel ? `<text x="${cx}" y="${cy}" text-anchor="middle" class="donut-center">${esc(centerLabel)}</text>` : ''}
    </svg>
    <ul class="legend">${legend}</ul>
  </div>`;
}

// ---------- sparkline ----------

export function sparkline({ points, width = 120, height = 32, accent = ACCENT }) {
  const n = points.length;
  if (n === 0) return '';
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const xs = points.map((_, i) => (n === 1 ? width / 2 : (i / (n - 1)) * width));
  const ys = points.map((v) => height - 2 - ((v - min) / span) * (height - 4));
  const line = points.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" class="sparkline" aria-hidden="true"><path d="${line}" fill="none" stroke="${accent}" stroke-width="1.5"/></svg>`;
}

// ---------- calendarGrid (año × día, estilo GitHub) ----------

export function calendarGrid({ days, year, colorScale, cellTitle = (d) => `${d.date}: ${d.value}`, cellSize = 11, gap = 2 }) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const startDow = (new Date(Date.UTC(year, 0, 1)).getUTCDay() + 6) % 7; // lunes=0
  const daysInYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
  const weeks = Math.ceil((startDow + daysInYear) / 7);
  const width = weeks * (cellSize + gap) + 34;
  const height = 7 * (cellSize + gap) + 20;
  const monthLabels = [];
  for (let m = 0; m < 12; m++) {
    const dayOfYear = Math.floor((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86400000);
    const col = Math.floor((dayOfYear + startDow) / 7);
    monthLabels.push(`<text x="${34 + col * (cellSize + gap)}" y="10" class="chart-label" font-size="8">${MONTHS_SHORT[m]}</text>`);
  }
  const cells = [];
  for (let doy = 0; doy < daysInYear; doy++) {
    const date = new Date(Date.UTC(year, 0, 1 + doy));
    const iso = date.toISOString().slice(0, 10);
    const dow = (date.getUTCDay() + 6) % 7;
    const col = Math.floor((doy + startDow) / 7);
    const x = 34 + col * (cellSize + gap);
    const y = 14 + dow * (cellSize + gap);
    const v = byDate.get(iso)?.value ?? 0;
    cells.push(`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${colorScale(v)}" rx="2"><title>${esc(cellTitle({ date: iso, value: v }))}</title></rect>`);
  }
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Calendario de actividad ${esc(String(year))}" class="chart calendar">${monthLabels.join('')}${cells.join('')}</svg>`;
}

// ---------- listeningClock (hora × día) ----------

export function listeningClock({ cells, colorScale, cellTitle = (c) => `${DOW_LONG[c.dow]} ${c.hour}:00 — ${c.value}`, cellSize = 14, gap = 2 }) {
  const width = 24 * (cellSize + gap) + 30;
  const height = 7 * (cellSize + gap) + 18;
  const byKey = new Map(cells.map((c) => [`${c.hour}-${c.dow}`, c]));
  const rects = [];
  for (let h = 0; h < 24; h++) {
    for (let d = 0; d < 7; d++) {
      const c = byKey.get(`${h}-${d}`);
      const v = c ? c.value : 0;
      const x = 30 + h * (cellSize + gap);
      const y = 14 + d * (cellSize + gap);
      rects.push(`<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="${colorScale(v)}" rx="2"><title>${esc(cellTitle({ hour: h, dow: d, value: v }))}</title></rect>`);
    }
  }
  const hourLabels = [];
  for (let h = 0; h < 24; h += 3) {
    hourLabels.push(`<text x="${(30 + h * (cellSize + gap) + cellSize / 2).toFixed(1)}" y="${height - 3}" text-anchor="middle" class="chart-label" font-size="8">${h}</text>`);
  }
  const dowLabels = DOW_SHORT.map((l, d) => `<text x="26" y="${(14 + d * (cellSize + gap) + cellSize / 2 + 3).toFixed(1)}" text-anchor="end" class="chart-label" font-size="8">${l}</text>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Reloj de escucha: hora del día por día de semana" class="chart clock">${rects}${hourLabels}${dowLabels}</svg>`;
}

// ---------- stackedBar ----------

export function stackedBar({ series, width = 640, height = 200, colors = PALETTE, format = fmtNum, segmentLabels = null }) {
  const n = series.length;
  if (n === 0) return '';
  const rowH = Math.min(28, (height - 20) / n);
  const labelW = 90;
  const plotW = width - labelW;
  const rows = series.map((s, i) => {
    const total = s.total ?? s.values.reduce((a, b) => a + b, 0);
    if (total <= 0) return '';
    const y = i * rowH;
    let x = labelW;
    const segs = s.values.map((v, j) => {
      if (v <= 0) return '';
      const w = (v / total) * plotW;
      const segLabel = segmentLabels != null && segmentLabels[j] != null ? String(segmentLabels[j]) : '';
      const title = segLabel ? `${s.label} — ${segLabel}: ${format(v)}` : `${s.label}: ${format(v)}`;
      const seg = `<rect x="${x.toFixed(1)}" y="${(y + 1).toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${(rowH - 2).toFixed(1)}" fill="${colors[j % colors.length]}"><title>${esc(title)}</title></rect>`;
      x += w;
      return seg;
    }).join('');
    return `<g><text x="${labelW - 6}" y="${(y + rowH / 2 + 3).toFixed(1)}" text-anchor="end" class="chart-label" font-size="10">${esc(s.label)}</text>${segs}</g>`;
  }).join('');
  const legend = segmentLabels != null
    ? `<ul class="legend">${segmentLabels.map((l, j) => {
        const color = colors[j % colors.length];
        return `<li class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${esc(String(l))}</li>`;
      }).join('')}</ul>`
    : '';
  return `<div class="stacked-wrap"><svg viewBox="0 0 ${width} ${height}" role="img" class="chart" aria-label="Barras apiladas">${rows}</svg>${legend}</div>`;
}