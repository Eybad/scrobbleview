// test/charts.test.js — comportamiento visual (no escaping: ver xss.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeScale, lineChart, stackedBar, HEAT } from '../src/charts.js';

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
