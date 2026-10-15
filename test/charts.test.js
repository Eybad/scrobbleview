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

test('lineChart: etiquetas vecinas nunca colisionan (greedy por aristas)', () => {
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
  const w = (s) => s.length * 0.6 * 10;
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
