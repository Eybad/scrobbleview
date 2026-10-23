// test/charts.test.js — comportamiento visual (no escaping: ver xss.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScale, lineChart, stackedBar, HEAT, fmtNum, fmtBytes, hbarChart, heatLegend, calendarGrid, NO_DATA, sparkline } from '../src/charts.js';

test('sparkline: trazo fino uniforme y bajo (los picos no dominan la fila)', () => {
  const svg = sparkline({ points: [1, 5, 2, 8, 3] });
  assert.ok(svg.includes('preserveAspectRatio="none"'), 'se estira al alto del CSS sin letterbox (sin espacio muerto)');
  assert.ok(svg.includes('vector-effect="non-scaling-stroke"'), 'trazo uniforme en pantalla: el estirado no lo engorda');
  assert.ok(svg.includes('stroke-width="1.5"'), '1.5px de pantalla: fino y visible');
  assert.ok(svg.includes('stroke-linejoin="round"'), 'picos redondeados: sin puntas miter que se recortan en el borde');
  assert.ok(svg.includes('stroke-linecap="round"'), 'extremos redondeados');
});

test('lineChart: 3 guías horizontales y el máximo rotulado', () => {
  const svg = lineChart({ points: [{ label: 'ene', y: 100 }, { label: 'feb', y: 50 }] });
  assert.equal((svg.match(/<line /g) || []).length, 3, '3 guías de referencia');
  assert.ok(svg.includes('>100<'), 'el valor máximo va rotulado arriba');
});

test('hbarChart: barras horizontales proporcionales con porcentaje', () => {
  const html = hbarChart({ rows: [{ label: '30s-1m', value: 75 }, { label: '1-3m', value: 25 }] });
  assert.ok(html.includes('width:100.0%'), 'el máximo llena la pista');
  assert.ok(html.includes('width:33.3%'), 'proporcional al máximo, no al total');
  assert.ok(html.includes('75%') && html.includes('25%'), 'porcentaje del total visible');
});

test('fmtBytes: unidad alineada a la escala (KB para ~10^6, MB para ~10^9)', () => {
  assert.equal(fmtBytes(500), '500 B');
  assert.equal(fmtBytes(1024), '1 KB');
  assert.equal(fmtBytes(1015150), '991,4 KB');
  assert.equal(fmtBytes(73197279), '69,8 MB');
  assert.equal(fmtBytes(1073741824), '1 GB');
});

test('fmtNum: agrupa los miles también en 4 cifras (es-ES las omite)', () => {
  assert.equal(fmtNum(2538), '2.538');
  assert.equal(fmtNum(95608), '95.608');
  assert.equal(fmtNum(999), '999');
  assert.equal(fmtNum(1000), '1.000');
  assert.equal(fmtNum(0), '0');
  assert.equal(fmtNum(-2538), '-2.538');
});

test('makeScale: discreta de 6 niveles, nivel 0 solo para v<=0', () => {
  const scale = makeScale(100);
  assert.equal(HEAT.length, 6);
  assert.equal(scale(0), HEAT[0]);
  assert.equal(scale(-5), HEAT[0]); // v<=0 → nivel 0
  assert.equal(scale(100), HEAT[5]); // máximo → último nivel
  assert.equal(scale(1000), HEAT[5]); // saturación por encima del máximo
  assert.notEqual(scale(50), HEAT[0]); // v>0 nunca cae al nivel 0
  assert.equal(scale(10), scale(11)); // cuantizada: cercanos comparten color
});

test('makeScale: unificada con el design system (verdes, acento default)', () => {
  const scale = makeScale(100);
  assert.notEqual(scale(100), '#4cc9f0'); // ya no celeste
  assert.ok(HEAT.includes(scale(50)), 'todo valor cae en la paleta del design system');
  assert.ok(HEAT.includes(scale(1)), 'valores chicos también usan la paleta');
});

test('lineChart: diezmado de etiquetas del eje X', () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ label: `m${i}`, y: i }));
  const html = lineChart({ points });
  const labels = html.match(/class="chart-label"/g) || [];
  assert.ok(labels.length < 30, `${labels.length} etiquetas (sin diezmado serían 30)`);
  assert.ok(html.includes('>m0<'), 'primera visible');
  assert.ok(html.includes('>m29<'), 'última visible');
  const few = lineChart({ points: points.slice(0, 5) });
  const fewLabels = few.match(/class="chart-label"/g) || [];
  assert.equal(fewLabels.length, 5, 'con pocas etiquetas no se diezma');
});

test('lineChart: cadencia regular sin colisiones (poda del penúltimo)', () => {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const points = Array.from({ length: 60 }, (_, i) => ({
    label: `${months[i % 12]} ${2021 + Math.floor(i / 12)}`,
    y: (i * 37) % 100
  }));
  const html = lineChart({ points });
  const shown = [...html.matchAll(/<text x="([\d.]+)"[^>]*class="chart-label"[^>]*>([^<]+)<\/text>/g)]
    .map((m) => ({ x: Number(m[1]), label: m[2] }));
  assert.ok(shown.length > 2 && shown.length < 60, `${shown.length} etiquetas`);
  assert.equal(shown[0].label, points[0].label, 'primera visible');
  assert.equal(shown[shown.length - 1].label, points[59].label, 'última visible');
  const w = (s) => s.length * 0.6 * 12;
  for (let k = 1; k < shown.length; k++) {
    const gap = shown[k].x - shown[k - 1].x - (w(shown[k - 1].label) + w(shown[k].label)) / 2;
    assert.ok(gap >= 10, `etiquetas ${k - 1}/${k} separadas (${gap.toFixed(1)}px)`);
  }
});

test('stackedBar: segmentLabels en titles + leyenda', () => {
  const html = stackedBar({
    series: [{ label: '2024', values: [2, 1], total: 3 }],
    segmentLabels: ['Madrugada', 'Mañana']
  });
  assert.ok(html.includes('Madrugada'), 'segmento en title/leyenda');
  assert.ok(html.includes('Ma\u00f1ana'), 'segmento con tilde intacto');
  assert.ok(html.includes('<ul class="legend">'), 'leyenda debajo');
  // Sin segmentLabels sigue funcionando como antes.
  const plain = stackedBar({ series: [{ label: '2024', values: [2, 1], total: 3 }] });
  assert.ok(!plain.includes('<ul class="legend">'), 'sin labels no hay leyenda');
});

test('stackedBar: aria-label resume los totales por serie (no genérico)', () => {
  const html = stackedBar({
    series: [{ label: '2023', values: [2, 1], total: 3 }, { label: '2024', values: [5, 0], total: 5 }]
  });
  const aria = html.match(/aria-label="([^"]*)"/)[1];
  assert.ok(aria.includes('2023: 3'), 'total de 2023 en el resumen');
  assert.ok(aria.includes('2024: 5'), 'total de 2024 en el resumen');
  const summed = stackedBar({ series: [{ label: '2024', values: [2, 1] }] });
  assert.ok(summed.match(/aria-label="([^"]*)"/)[1].includes('2024: 3'), 'sin total explícito suma los valores');
});

test('sparkline: decorativa (sin role redundante, oculta a lectores)', () => {
  const svg = sparkline({ points: [1, 2, 3] });
  assert.ok(!svg.includes('role="img"'), 'aria-hidden la saca: el role sería contradictorio');
  assert.ok(svg.includes('aria-hidden="true"'), 'oculta a tecnologías asistivas');
});

test('heatLegend: swatch de nivel cero + rampa 1..5 con extremos rotulados', () => {
  const html = heatLegend({});
  assert.ok(html.includes(HEAT[0]), 'nivel cero presente');
  for (const c of HEAT.slice(1)) assert.ok(html.includes(c), `nivel ${c} presente`);
  assert.ok(html.includes('sin actividad'), 'etiqueta del nivel cero');
  assert.ok(html.includes('menos') && html.includes('más'), 'extremos de la rampa');
});

test('lineChart: aria resumido (rango, máximo y último, sin enumerar puntos)', () => {
  const points = Array.from({ length: 30 }, (_, i) => ({ label: `m${i}`, y: i }));
  const html = lineChart({ points });
  const aria = html.match(/aria-label="([^"]*)"/)[1];
  assert.ok(aria.includes('m0'), 'primera etiqueta en el resumen');
  assert.ok(aria.includes('m29'), 'última etiqueta en el resumen');
  assert.ok(aria.includes('máximo'), 'máximo identificado');
  assert.ok(!aria.includes('m5:'), 'no enumera los puntos intermedios');
});

test('calendarGrid: días fuera del rango de datos se distinguen de cero', () => {
  // 2024-06-15 = día 19889; el rango cubre el 15 y el 16. El 15 tiene datos
  // (satura la escala), el 16 está dentro del rango sin datos (nivel 0) y el
  // resto del año está fuera del rango (sin datos, color propio).
  const days = [{ date: '2024-06-15', value: 5000 }];
  const html = calendarGrid({
    days, year: 2024,
    colorScale: makeScale(5000),
    dataRange: { from: 19889, to: 19890 }
  });
  assert.ok(html.includes(NO_DATA), 'color de sin datos presente');
  assert.ok(html.includes('sin datos'), 'title de sin datos');
  assert.ok(html.includes(`fill="${HEAT[0]}"`), 'cero dentro del rango usa el nivel 0');
  assert.ok(html.includes(`fill="${HEAT[5]}"`), 'el día con datos satura la escala');
});

test('calendarGrid: modo interactivo marca los días con data-day', () => {
  const days = [{ date: '2024-06-15', value: 5000 }];
  const html = calendarGrid({ days, year: 2024, colorScale: makeScale(5000), interactive: true });
  assert.ok(html.includes('data-day="19889"'), 'cada celda lleva su día epoch');
  const plain = calendarGrid({ days, year: 2024, colorScale: makeScale(5000) });
  assert.ok(!plain.includes('data-day'), 'sin interactive el calendario es solo lectura');
});
