const frame = document.getElementById('app');
const runButton = document.getElementById('run');
const results = document.getElementById('results');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function element(selector) {
  const found = frame.contentDocument.querySelector(selector);
  assert(found, `Falta el elemento ${selector}`);
  return found;
}

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(check);
    let lastError = null;
    const timer = setTimeout(() => finish(new Error(`Tiempo agotado: ${label}${lastError ? ` (${lastError.message})` : ''}`)), 10000);
    function finish(error) {
      clearTimeout(timer);
      observer.disconnect();
      frame.contentWindow.removeEventListener('hashchange', check);
      if (error) reject(error);
      else resolve();
    }
    function check() {
      try {
        if (predicate()) finish();
      } catch (error) {
        lastError = error;
      }
    }
    observer.observe(frame.contentDocument.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    frame.contentWindow.addEventListener('hashchange', check);
    check();
  });
}

function kpiValue(name) {
  const label = [...frame.contentDocument.querySelectorAll('#view-root .kpis dt')]
    .find(node => node.textContent === name);
  assert(label, `Falta el KPI ${name}`);
  return label.nextElementSibling.firstChild.textContent.trim();
}

function viewHeading() {
  return [...element('#view-root h1').childNodes]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim())
    .join('');
}

function navLink(label) {
  const link = [...frame.contentDocument.querySelectorAll('.app-nav a')]
    .find(candidate => candidate.textContent.trim() === label);
  assert(link, `Falta el destino de navegación ${label}`);
  return link;
}

function nextFrame() {
  return new Promise(resolve => frame.contentWindow.requestAnimationFrame(() => resolve()));
}

function accessibleName(node) {
  return node.getAttribute('aria-label')
    || node.getAttribute('title')
    || node.labels?.[0]?.textContent.trim()
    || node.textContent.trim()
    || node.value?.trim()
    || '';
}

async function run() {
  results.textContent = 'Ejecutando…';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No cargó la aplicación')), 10000);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    frame.src = `../index.html?browser-test=${Date.now()}#/dashboard`;
  });
  const appWindow = frame.contentWindow;
  const appDocument = frame.contentDocument;
  const json = JSON.stringify(['2024-01-10', '2024-02-10', '2024-02-11'].map(date => ({
    ts: `${date}T12:00:00Z`, ms_played: 180000,
    master_metadata_track_name: 'Synthetic track',
    master_metadata_album_artist_name: 'Synthetic artist',
    master_metadata_album_album_name: 'Synthetic album',
    spotify_track_uri: 'spotify:track:synthetic'
  })));
  const transfer = new appWindow.DataTransfer();
  transfer.items.add(new appWindow.File([json], 'Streaming_History_Audio_synthetic.json', { type: 'application/json' }));
  const input = element('#file-input');
  input.files = transfer.files;
  input.dispatchEvent(new appWindow.Event('change', { bubbles: true }));
  await waitFor(() => !element('#view-app').hidden, 'carga sintética');
  assert(kpiValue('Reproducciones') === '3', 'La carga debe mostrar 3 reproducciones');

  element('[data-preset="4w"]').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Reproducciones') === '2', 'filtro de 4 semanas');
  assert(kpiValue('Reproducciones') === '2', 'El rango de 4 semanas debe mostrar 2 reproducciones');
  assert(element('#status[aria-live="polite"]'), 'El estado de carga debe estar anunciado');
  const filteredHash = appWindow.location.hash;
  element('.skip-link').click();
  assert(appWindow.location.hash === filteredHash, 'Saltar al contenido debe conservar la ruta y los filtros');
  assert(frame.contentDocument.activeElement === element('#main-content'), 'Saltar al contenido debe mover el foco');
  assert(kpiValue('Reproducciones') === '2', 'Saltar al contenido debe conservar las cifras');
  navLink('Sesiones').click();
  await waitFor(() => viewHeading() === 'Sesiones de escucha', 'abrir Sesiones');
  element('[data-preset="all"]').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Sesiones') === '3', 'Todo en Sesiones');
  const allHash = appWindow.location.hash;

  appWindow.history.back();
  await waitFor(() => appWindow.location.hash === filteredHash && !element('#view-root').hidden && viewHeading() === 'Resumen', 'Atrás');
  assert(element('[data-preset="4w"]').getAttribute('aria-pressed') === 'true', 'Atrás debe restaurar el filtro');
  assert(kpiValue('Reproducciones') === '2', 'Atrás debe restaurar las cifras filtradas');
  const comparison = [...frame.contentDocument.querySelectorAll('.kpi-sub')].map(node => node.textContent).join(' ');
  assert(comparison.includes('100%') && comparison.includes('▲'), 'La comparación debe usar el período filtrado');

  appWindow.history.forward();
  await waitFor(() => appWindow.location.hash === allHash && !element('#view-root').hidden && viewHeading() === 'Sesiones de escucha', 'Adelante');
  assert(element('[data-preset="all"]').getAttribute('aria-pressed') === 'true', 'Adelante debe restaurar Todo');
  assert(kpiValue('Sesiones') === '3', 'Adelante debe restaurar el modelo completo');

  appWindow.location.hash = filteredHash;
  await waitFor(() => !element('#view-root').hidden && viewHeading() === 'Resumen' && kpiValue('Reproducciones') === '2', 'hash filtrado');
  assert(kpiValue('Reproducciones') === '2', 'Un cambio manual del hash debe filtrar las cifras');
  appWindow.location.hash = '#/dashboard';
  await waitFor(() => !element('#view-root').hidden && element('[data-preset="all"]').getAttribute('aria-pressed') === 'true' && kpiValue('Reproducciones') === '3', 'hash sin filtros');
  assert(kpiValue('Reproducciones') === '3', 'Un hash sin filtros debe restaurar las 3 reproducciones');

  element('[data-preset="4w"]').click();
  element('#cancel-processing').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Reproducciones') === '3', 'cancelación del filtro');
  assert(!element('#view-app').hidden, 'Cancelar el filtro debe conservar el análisis');
  assert(element('#view-home').hidden, 'Cancelar el filtro no debe volver al inicio');

  navLink('Explorar').click();
  await waitFor(() => Boolean(frame.contentDocument.querySelector('[data-explore-search]')), 'abrir Explorar');
  element('[data-explore-tab="artists"]').click();
  await waitFor(() => element('[data-explore-tab="artists"]').getAttribute('aria-selected') === 'true', 'catálogo de artistas');
  const search = element('[data-explore-search]');
  search.focus();
  search.value = 'Synthetic artist';
  search.setSelectionRange(4, 4);
  search.dispatchEvent(new appWindow.Event('input', { bubbles: true }));
  await waitFor(() => frame.contentDocument.querySelector('[data-explore-search]') !== search, 'buscar en Explorar');
  const updatedSearch = element('[data-explore-search]');
  assert(frame.contentDocument.activeElement === updatedSearch, 'La búsqueda debe conservar el foco');
  assert(updatedSearch.selectionStart === 4 && updatedSearch.selectionEnd === 4, 'La búsqueda debe conservar la posición del cursor');
  element('[data-sort="name"]').click();
  assert(frame.contentDocument.activeElement === element('[data-sort="name"]'), 'Ordenar debe conservar el foco');
  assert(element('[data-sort="name"]').closest('th').getAttribute('aria-sort'), 'El orden de tabla debe anunciar aria-sort');
  const unnamedControls = [...appDocument.querySelectorAll('#view-app button, #view-app input:not([type="hidden"]), #view-app select, #view-app textarea, #view-app a[href]')]
    .filter(node => node.getClientRects().length && !accessibleName(node));
  assert(unnamedControls.length === 0, `Hay controles visibles sin nombre accesible: ${unnamedControls.slice(0, 3).map(node => node.outerHTML)}`);
  const unnamedTables = [...appDocument.querySelectorAll('#view-app table')]
    .filter(table => !table.getAttribute('aria-label') && !table.querySelector('caption'));
  assert(unnamedTables.length === 0, `Hay tablas visibles sin nombre: ${unnamedTables.length}`);

  const artistLink = element('#explore-card a[href^="#/v1/artist/"]');
  assert(artistLink.href.includes('Synthetic'), 'La ficha de artista debe usar una ruta semántica');
  const artistQuery = new URLSearchParams(artistLink.getAttribute('href').split('?').slice(1).join('?'));
  assert(artistQuery.get('q') === 'Synthetic artist', 'El enlace semántico debe transportar la consulta para copiarlo o abrirlo en otra pestaña');
  artistLink.click();
  await waitFor(() => viewHeading() === 'Synthetic artist', 'ficha de artista');
  assert(kpiValue('Reproducciones') === '3', 'La ficha de artista debe reconciliar sus reproducciones');

  navLink('Explorar').click();
  await waitFor(() => Boolean(element('#explore-card')), 'volver al catálogo');
  element('[data-explore-tab="tracks"]').click();
  await waitFor(() => element('[data-explore-tab="tracks"]').getAttribute('aria-selected') === 'true', 'catálogo de canciones');
  const trackLink = element('#explore-card a[href^="#/v1/track/"]');
  trackLink.click();
  await waitFor(() => viewHeading() === 'Synthetic track', 'ficha de canción');
  assert(kpiValue('Reproducciones') === '3', 'La ficha de canción debe reconciliar sus reproducciones');

  navLink('Explorar').click();
  await waitFor(() => Boolean(element('#explore-card')), 'volver al catálogo de canciones');
  element('[data-explore-tab="albums"]').click();
  await waitFor(() => element('[data-explore-tab="albums"]').getAttribute('aria-selected') === 'true', 'catálogo de álbumes');
  element('#explore-card a[href^="#/v1/album/"]').click();
  await waitFor(() => viewHeading() === 'Synthetic album', 'ficha de álbum');
  assert(kpiValue('Reproducciones') === '3', 'La ficha de álbum debe reconciliar sus reproducciones');

  navLink('Calendario').click();
  await waitFor(() => viewHeading().startsWith('Calendario'), 'abrir calendario');
  appWindow.location.hash = '#/v1/calendar?cm=2024-02';
  await waitFor(() => element('.calendar-month__title').textContent === 'Febrero 2024', 'seleccionar febrero de 2024');
  await waitFor(() => Boolean(element('[data-date="2024-02-10"]')), 'abrir calendario');
  element('[data-date="2024-02-10"]').click();
  await waitFor(() => !element('#cal-day-detail').hidden, 'seleccionar día en el inspector');
  assert(element('#cal-inspector-selection[aria-live="polite"]'), 'La selección del calendario debe anunciar el día');
  element('#cal-day-detail').click();
  await waitFor(() => viewHeading().includes('2024-02-10'), 'detalle del día');
  assert(element('#view-root .view-meta').textContent.includes('1 reproducciones'), 'El día debe mostrar una reproducción');

  navLink('Sesiones').click();
  await waitFor(() => Boolean(element('a[href^="#/session/"]')), 'abrir sesiones para el detalle');
  element('a[href^="#/session/"]').click();
  await waitFor(() => viewHeading().startsWith('Sesión #'), 'detalle de sesión');
  assert(element('#view-root .view-meta').textContent.includes('1 reproducciones'), 'El detalle de sesión debe mostrar su evento exacto');

  navLink('Comparar').click();
  await waitFor(() => Boolean(element('#compare-form')), 'abrir comparación');
  const preset = element('[data-compare-field="preset"]');
  preset.value = 'manual';
  preset.dispatchEvent(new appWindow.Event('change', { bubbles: true }));
  await waitFor(() => !element('[data-compare-field="fromB"]').disabled, 'habilitar rango manual');
  for (const [field, value] of Object.entries({
    fromA: '2024-01-10', toA: '2024-02-11', fromB: '2023-01-01', toB: '2023-01-02'
  })) element(`[data-compare-field="${field}"]`).value = value;
  element('#compare-form').requestSubmit();
  await waitFor(() => Boolean(element('.compare-results-table')), 'resultados de comparación');
  const playsRow = [...element('.compare-results-table tbody').rows].find(row => row.cells[0].textContent.includes('Reproducciones'));
  assert(playsRow?.cells[2].textContent.trim() === '0', 'El período vacío debe conservar su base cero');
  assert(playsRow?.cells[4].textContent.trim() === 'nuevo', 'La comparación con base cero debe identificarse sin fabricar porcentaje');

  navLink('Resumen').click();
  await waitFor(() => viewHeading() === 'Resumen', 'volver al resumen para exportar la selección');
  element('[data-preset="4w"]').click();
  await waitFor(() => kpiValue('Reproducciones') === '2', 'confirmar selección exportable');
  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir exportación de selección');
  const selectionScope = element('[name="export-scope"][value="selection"]');
  assert(!selectionScope.disabled && element('#export-selection-desc').textContent.includes('2 reproducciones'), 'La exportación debe conservar la selección analítica confirmada');
  selectionScope.click();
  element('#btn-confirm-export').click();
  await waitFor(() => !element('#processing').hidden, 'iniciar ZIP de selección');
  await waitFor(() => element('#processing').hidden, 'finalizar ZIP de selección');
  await new Promise(resolve => setTimeout(resolve, 1100));

  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir exportación completa');
  assert(element('[name="export-scope"][value="all"]').checked, 'La exportación completa debe ser el alcance predeterminado');
  element('#btn-confirm-export').click();
  await waitFor(() => !element('#processing').hidden, 'iniciar ZIP completo');
  await waitFor(() => element('#processing').hidden, 'finalizar ZIP completo');

  navLink('Explorar').click();
  await waitFor(() => Boolean(element('#explore-card')), 'abrir catálogo para exportar');
  element('[data-explore-tab="tracks"]').click();
  await waitFor(() => element('[data-explore-tab="tracks"]').getAttribute('aria-selected') === 'true', 'preparar tabla de canciones');
  const trackSearch = element('[data-explore-search]');
  trackSearch.value = 'Synthetic track';
  trackSearch.dispatchEvent(new appWindow.Event('input', { bubbles: true }));
  await waitFor(() => element('[data-explore-search]').value === 'Synthetic track' && element('[data-action="export-table"]').dataset.totalMatches === '1', 'confirmar consulta de exportación');
  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir opciones de exportación');
  assert(!element('[name="export-scope"][value="table"]').disabled, 'La tabla confirmada debe poder exportarse');
  assert(element('#export-table-desc').textContent.includes('1 canciones'), 'El diálogo debe mostrar el total de la consulta confirmada');
  element('[data-action="close-export"]').click();
  assert(!element('#dialog-export').open, 'Cancelar debe cerrar el diálogo sin exportar');
  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'reabrir opciones de exportación');
  element('[name="export-scope"][value="table"]').click();
  element('#btn-confirm-export').click();
  await waitFor(() => !element('#dialog-export').open && element('#live-status').textContent.includes('Descargadas 1 filas'), 'descargar tabla completa con metadata');

  appWindow.localStorage.setItem('scrobbleview_metric', 'plays');
  appWindow.localStorage.setItem('scrobbleview:tableLimits', '{"sessions-plays":25}');
  appWindow.localStorage.setItem('scrobbleview:favorites', '["dashboard"]');
  appWindow.localStorage.setItem('scrobbleview:density', 'compact');
  navLink('Resumen').click();
  await waitFor(() => viewHeading() === 'Resumen', 'volver al resumen antes de preferencias');
  element('[data-action="reset-preferences"]').click();
  await waitFor(() => appWindow.localStorage.getItem('scrobbleview_metric') === null, 'restablecer preferencias');
  assert(kpiValue('Reproducciones') === '2', 'Restablecer preferencias debe conservar el análisis y sus filtros');
  assert(element('[data-preset="4w"]').getAttribute('aria-pressed') === 'true', 'Restablecer preferencias no debe borrar filtros analíticos');
  assert(element('#live-status').textContent.includes('Preferencias restablecidas'), 'El resultado de preferencias debe anunciarse');
  element('[data-preset="all"]').click();
  await waitFor(() => kpiValue('Reproducciones') === '3', 'limpiar selección antes de los ciclos');

  let actionEffects = 0;
  let routeEffects = 0;
  const beforeCyclesMemory = appWindow.performance.memory?.usedJSHeapSize ?? null;
  if (document.documentElement.dataset.memoryCheck === 'true') {
    window.__r10Report = { phase: 'memory-checkpoint', beforeCyclesMemory };
    await new Promise(resolve => { window.__r10Report.releaseCycles = resolve; });
  }
  const cycleMemory = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    let previousHash = appWindow.location.hash;
    navLink('Explorar').click();
    await waitFor(() => appWindow.location.hash !== previousHash && viewHeading() === 'Explorar catálogo completo', `ciclo ${cycle + 1}: Explorar`);
    assert(appWindow.location.hash !== previousHash, `Ciclo ${cycle + 1}: Explorar no produjo un cambio de ruta`);
    actionEffects++;
    routeEffects++;

    element('[data-explore-tab="tracks"]').click();
    await waitFor(() => element('[data-explore-tab="tracks"]').getAttribute('aria-selected') === 'true', `ciclo ${cycle + 1}: canciones`);
    actionEffects++;

    previousHash = appWindow.location.hash;
    element('#explore-card a[href^="#/v1/track/"]').click();
    await waitFor(() => appWindow.location.hash !== previousHash && viewHeading() === 'Synthetic track', `ciclo ${cycle + 1}: detalle de canción`);
    assert(appWindow.location.hash !== previousHash, `Ciclo ${cycle + 1}: el detalle no produjo un cambio de ruta`);
    actionEffects++;
    routeEffects++;

    previousHash = appWindow.location.hash;
    navLink('Resumen').click();
    await waitFor(() => appWindow.location.hash !== previousHash && viewHeading() === 'Resumen', `ciclo ${cycle + 1}: regreso al resumen`);
    assert(appWindow.location.hash !== previousHash, `Ciclo ${cycle + 1}: el regreso no produjo un cambio de ruta`);
    actionEffects++;
    routeEffects++;

    element('[data-preset="4w"]').click();
    await waitFor(() => kpiValue('Reproducciones') === '2', `ciclo ${cycle + 1}: filtro 4 semanas`);
    actionEffects++;
    element('[data-preset="all"]').click();
    await waitFor(() => kpiValue('Reproducciones') === '3', `ciclo ${cycle + 1}: restablecer filtro`);
    actionEffects++;
    cycleMemory.push(appWindow.performance.memory?.usedJSHeapSize ?? null);
  }
  assert(routeEffects === 60, 'Los veinte ciclos deben ejecutar 60 acciones de ruta');
  const afterCyclesMemory = appWindow.performance.memory?.usedJSHeapSize ?? null;
  window.__r10Report = { phase: 'cycles-complete', beforeCyclesMemory, afterCyclesMemory, cycleMemory, actionEffects, routeEffects };

  navLink('Explorar').click();
  await waitFor(() => Boolean(element('#explore-card')), 'abrir catálogo responsive');
  const viewportWidths = [320, 360, 393, 412, 640];
  const viewportChecks = [];
  for (const width of viewportWidths) {
    frame.style.width = `${width}px`;
    await nextFrame();
    viewportChecks.push({ width, scrollWidth: appDocument.documentElement.scrollWidth, viewport: appWindow.innerWidth });
    assert(appDocument.documentElement.scrollWidth <= appWindow.innerWidth, `Desbordamiento horizontal a ${width}px`);
  }
  appDocument.documentElement.style.fontSize = '125%';
  await nextFrame();
  const enlargedFont = Number.parseFloat(appWindow.getComputedStyle(appDocument.documentElement).fontSize);
  assert(enlargedFont >= 20, 'El texto ampliado debe reflejarse en estilos calculados');
  assert(appDocument.documentElement.scrollWidth <= appWindow.innerWidth, 'El texto ampliado no debe desbordar el ancho de página');
  appDocument.documentElement.style.fontSize = '';
  frame.style.width = '640px';
  Object.assign(window.__r10Report, { phase: 'complete', viewportChecks, enlargedFont });

  appWindow.location.hash = '#/v1/calendar?cm=2024-12';
  await waitFor(() => frame.contentDocument.querySelector('.calendar-month__title')?.textContent === 'Diciembre 2024', 'calendario de diciembre');
  element('[data-cal-nav="next-month"]').click();
  await waitFor(() => frame.contentDocument.querySelector('.calendar-month__title')?.textContent === 'Enero 2025', 'cruce a enero');
  assert(appWindow.location.hash.includes('cm=2025-01'), 'El mes y el año deben quedar en la URL');
  appWindow.history.back();
  await waitFor(() => frame.contentDocument.querySelector('.calendar-month__title')?.textContent === 'Diciembre 2024', 'volver a diciembre');
  results.textContent = 'APROBADO: carga, filtros, historial, búsqueda, cinco fichas, comparación, exportación, preferencias, responsive y 20 ciclos reales de navegación, detalles y filtros.';
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  try {
    await run();
  } catch (error) {
    results.textContent = `FALLÓ: ${error.message}`;
  } finally {
    runButton.disabled = false;
  }
});
