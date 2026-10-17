// test/xss.test.js — guardia de escaping del camino que renderiza datos del
// usuario. El sink final es appRoot.innerHTML = renderView(...) en app/main.js;
// los componentes de src/charts.js y las vistas de app/views.js devuelven
// strings que se inyectan ahí. Estos tests son la red que detectaría una
// regresión de escaping antes de que llegue a producción.
import test from 'node:test';
import assert from 'node:assert/strict';

import { esc, barChart, lineChart, donut, sparkline, calendarGrid, heatmap, heatmapTable, listeningClock, stackedBar, hbarChart } from '../src/charts.js';

// Payloads que rompen HTML si llegan sin escapar.
const XSS = '<img src=x onerror=alert(1)>';
const XSS_ATTR = '" onmouseover="alert(2)';
const XSS_SQ = "' onfocus='alert(3)";

test('xss: esc() neutraliza los 5 caracteres peligrosos y el ampersand primero', () => {
  assert.equal(esc(XSS), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(XSS_ATTR), '&quot; onmouseover=&quot;alert(2)');
  assert.equal(esc(XSS_SQ), '&#39; onfocus=&#39;alert(3)');
  // El ampersand debe ir PRIMERO: si se reemplazara después, "&lt;" se
  // convertiría en "&amp;lt;" y el escapado sería doble.
  assert.equal(esc('&lt;'), '&amp;lt;');
  assert.equal(esc('a & b < c'), 'a &amp; b &lt; c');
  assert.equal(esc(42), '42', 'no-string se castea, no lanza');
  assert.equal(esc(null), 'null');
});

test('xss: donut escapa el texto de sus segmentos', () => {
  const d = donut({
    segments: [{ label: XSS, value: 1 }],
    centerLabel: XSS_SQ,
  });
  assert.ok(!d.includes('<img'), 'donut: sin tag inyectado');
  assert.ok(!d.includes("onfocus='"), 'donut: sin atributo inyectado');
  assert.ok(d.includes('&lt;img'));
  assert.ok(d.includes('&#39;'), 'donut: centerLabel escapado');
});

test('xss: hbarChart escapa los rótulos', () => {
  const html = hbarChart({ rows: [{ label: XSS, value: 1 }] });
  assert.ok(!html.includes('<img'), 'hbar: sin tag inyectado');
  assert.ok(html.includes('&lt;img'), 'hbar: rótulo escapado');
});

test('xss: los rótulos de un chart con payload no inyectan HTML ejecutable', () => {
  const html = barChart({
    data: [{ label: XSS, value: 10 }, { label: 'ok', value: 5 }],
  });
  // El payload escapado conserva el substring "onerror=alert" como TEXTO
  // inerte; lo que no puede aparecer es el '<' que lo convertiría en tag real.
  assert.ok(!html.includes('<img'), 'el payload no debe aparecer como tag');
  assert.ok(html.includes('&lt;img'), 'el payload debe aparecer escapado');
});

test('xss: los rótulos se escapan UNA sola vez (sin doble escape en el tooltip)', () => {
  // El payload contiene un '&': si el título se arma desde el label YA escapado
  // y después se escapa otra vez, el usuario ve "&amp;lt;img" en el tooltip.
  const html = barChart({ data: [{ label: 'A & <b>', value: 3 }] });
  assert.ok(html.includes('A &amp; &lt;b&gt;'), 'rótulo escapado una vez');
  assert.ok(!html.includes('&amp;amp;'), 'sin doble escape en el texto');
  assert.ok(!html.includes('&amp;lt;'), 'sin doble escape en el <text>');
  const title = html.slice(html.indexOf('<title>'), html.indexOf('</title>'));
  assert.ok(!title.includes('&amp;lt;'), `tooltip con doble escape: ${title}`);

  // lineChart repite el patrón (title armado desde el label escapado + esc()).
  const lc = lineChart({ points: [{ x: 0, y: 1, label: 'A & <b>' }] });
  assert.ok(!lc.includes('&amp;lt;'), 'lineChart: sin doble escape');
  assert.ok(!lc.includes('&amp;amp;'), 'lineChart: sin doble escape del ampersand');
});

test('xss: lineChart, heatmapTable, listeningClock y stackedBar escapan rótulos', () => {
  const lc = lineChart({ points: [{ x: 0, y: 5, label: XSS }] });
  assert.ok(!lc.includes('<img'), 'lineChart: sin tag inyectado');
  assert.ok(lc.includes('&lt;img'), 'lineChart: rótulo escapado');

  const tbl = heatmapTable({
    cells: [{ x: 0, y: 0, value: XSS }],
    xLabels: [XSS],
    yLabels: [XSS],
    caption: XSS,
    cellText: (c) => c.value,
  });
  assert.ok(!tbl.includes('<img'), 'heatmapTable: sin tag inyectado');
  assert.ok(tbl.includes('&lt;img'), 'heatmapTable: caption y cellText escapados');

  const clock = listeningClock({ cells: [{ hour: 3, dow: 1, value: 2 }], colorScale: () => '#000', cellTitle: () => XSS });
  assert.ok(!clock.includes('<img'), 'listeningClock: sin tag inyectado');
  assert.ok(clock.includes('&lt;img'), 'listeningClock: cellTitle escapado');

  const sb = stackedBar({ series: [{ label: XSS, values: [1, 2] }] });
  assert.ok(!sb.includes('<img'), 'stackedBar: sin tag inyectado');
  assert.ok(sb.includes('&lt;img'), 'stackedBar: label escapado');
});

test('xss: sparkline no expone texto de usuario (invariante estructural, falsable)', () => {
  // sparkline solo acepta números y emite paths M/L: hoy no hay string de
  // usuario que alcance su salida. En vez de asserts tautológicos
  // (!includes('<script')) que no pueden fallar, se fija la FORMA EXACTA de la
  // salida: si alguien le agrega un parámetro de texto, esta aserción falla.
  const s = sparkline({ points: [1, 2, 3], width: 100 });
  assert.match(
    s,
    /^<svg [^>]*><path d="M[0-9.,\sL]+"[^>]*\/><\/svg>$/,
    `sparkline debe emitir solo el path (obtenido: ${s})`
  );
  // Un punto con label de payload debe ser ignorado, no escapado a medias.
  const s2 = sparkline({ points: [{ v: 1, label: '<script>' }], width: 100 });
  assert.ok(!s2.includes('<script'), 'ningún texto de usuario puede entrar en la salida');
});

test('xss: calendarGrid y heatmap escapan títulos calculados', () => {
  // calendarGrid deriva el título de una ISO interna (no del input), así que un
  // `date` malicioso no llega al HTML; el `cellTitle` custom sí se escapa.
  const cal = calendarGrid({
    days: [{ date: XSS, value: 3 }],
    year: 2024,
    colorScale: () => '#000',
    cellTitle: () => XSS,
  });
  assert.ok(!cal.includes('<img'), 'calendarGrid: sin tag inyectado');
  assert.ok(cal.includes('&lt;img'), 'calendarGrid: cellTitle escapado');

  // Con el cellTitle por defecto, el `date` del input es solo clave del mapa:
  // nunca aparece crudo en el HTML.
  const cal2 = calendarGrid({
    days: [{ date: XSS, value: 3 }],
    year: 2024,
    colorScale: () => '#000',
  });
  assert.ok(!cal2.includes('<img'), 'calendarGrid: el date del input no se inyecta');
  assert.ok(!cal2.includes('img src=x'), 'calendarGrid: ni como texto');

  const hm = heatmap({
    cells: [{ x: 0, y: 0, value: 1 }],
    colorScale: () => '#000',
    cellTitle: () => XSS, // título derivado de datos del usuario
  });
  assert.ok(!hm.includes('<img'), 'heatmap: sin tag inyectado');
  assert.ok(hm.includes('&lt;img'), 'heatmap: cellTitle escapado');
});
