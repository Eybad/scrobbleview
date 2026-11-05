const frame = document.getElementById('app');
const runButton = document.getElementById('run');
const results = document.getElementById('results');
let auxiliaryTab = null;

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

function waitInWindow(targetWindow, predicate, label) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10000;
    const check = () => {
      if (targetWindow.closed) {
        reject(new Error(`Se cerró la ventana durante: ${label}`));
        return;
      }
      try {
        if (predicate(targetWindow.document, targetWindow)) {
          resolve();
          return;
        }
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'SecurityError') {
          reject(error);
          return;
        }
      }
      if (Date.now() >= deadline) {
        const status = targetWindow.document.getElementById('status')?.textContent;
        const deleteButton = targetWindow.document.getElementById('btn-cached-clear');
        const details = [status && `estado=${status}`, deleteButton && `botón=${deleteButton.getAttribute('aria-label')}`]
          .filter(Boolean)
          .join('; ');
        reject(new Error(`Tiempo agotado: ${label}${details ? ` (${details})` : ''}`));
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function readIndexedDbCache(targetWindow) {
  return new Promise((resolve, reject) => {
    const request = targetWindow.indexedDB.open('scrobbleview');
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('columns')) request.result.createObjectStore('columns');
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('columns', 'readonly');
      const store = transaction.objectStore('columns');
      const keysRequest = store.getAllKeys();
      const metaRequest = store.get('meta');
      const schemaRequest = store.get('schemaVersion');
      const timeRequest = store.get('col:t');
      transaction.oncomplete = () => {
        db.close();
        resolve({
          keyCount: keysRequest.result.length,
          eventCount: metaRequest.result ? JSON.parse(metaRequest.result).count : null,
          schemaVersion: schemaRequest.result,
          timestampCount: timeRequest.result ? new Int32Array(timeRequest.result).length : 0
        });
      };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

function upgradeIndexedDb(targetWindow, version) {
  return new Promise((resolve, reject) => {
    const request = targetWindow.indexedDB.open('scrobbleview', version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('columns')) request.result.createObjectStore('columns');
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('La actualización de IndexedDB quedó bloqueada'));
    request.onsuccess = () => {
      const db = request.result;
      resolve(db.version);
      db.close();
    };
  });
}

function deleteIndexedDb(targetWindow) {
  return new Promise((resolve, reject) => {
    const request = targetWindow.indexedDB.deleteDatabase('scrobbleview');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('El borrado de IndexedDB quedó bloqueado'));
  });
}

function kpiValue(name, appDocument = frame.contentDocument) {
  const label = [...appDocument.querySelectorAll('#view-root .kpis dt')]
    .find(node => node.textContent === name);
  assert(label, `Falta el KPI ${name}`);
  return label.nextElementSibling.firstChild.textContent.trim();
}

function viewHeading(appDocument = frame.contentDocument) {
  return [...appDocument.querySelector('#view-root h1').childNodes]
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

function trackLinkFor(artist, title) {
  const link = [...frame.contentDocument.querySelectorAll('#explore-card a[href^="#/v1/track/"]')]
    .find(candidate => decodeURIComponent(candidate.getAttribute('href')).includes(`/v1/track/${artist}/${title}`));
  assert(link, `Falta la ficha de ${title} — ${artist}`);
  return link;
}

function nextFrame() {
  return new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(finish, 250);
    function finish() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    }
    frame.contentWindow.requestAnimationFrame(finish);
  });
}

function waitForWindowScroll(targetWindow, targetY) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 5000;
    function check() {
      if (Math.abs(targetWindow.scrollY - targetY) < 1) {
        resolve();
      } else if (Date.now() >= deadline) {
        reject(new Error(`El scroll no llegó a ${targetY}px`));
      } else {
        targetWindow.requestAnimationFrame(check);
      }
    }
    check();
  });
}

async function submitExportAndWaitForDownload(targetWindow, label) {
  const anchorPrototype = targetWindow.HTMLAnchorElement.prototype;
  const originalClick = anchorPrototype.click;
  let downloads = 0;
  anchorPrototype.click = function () {
    if (this.download) downloads++;
    return originalClick.call(this);
  };
  try {
    element('#btn-confirm-export').click();
    await waitFor(() => downloads > 0, label);
    await waitFor(() => element('#processing').hidden, `${label}: finalizar procesamiento`);
  } finally {
    anchorPrototype.click = originalClick;
  }
  return downloads;
}

function accessibleName(node) {
  return node.getAttribute('aria-label')
    || node.getAttribute('title')
    || node.labels?.[0]?.textContent.trim()
    || node.textContent.trim()
    || node.value?.trim()
    || '';
}

function collectCssRules(rules) {
  return [...rules].flatMap(rule => rule.cssRules?.length ? collectCssRules(rule.cssRules) : [rule]);
}

async function run() {
  results.textContent = 'Ejecutando…';
  auxiliaryTab = window.open('about:blank', '_blank');
  assert(auxiliaryTab, 'El navegador debe permitir la pestaña de prueba');
  window.focus();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No cargó la aplicación')), 10000);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    frame.src = `../index.html?browser-test=${Date.now()}#/dashboard`;
  });
  const appWindow = frame.contentWindow;
  const appDocument = frame.contentDocument;
  const expectedStylesheets = ['tokens', 'base', 'layout', 'components', 'navigation', 'data', 'style']
    .map(name => `css/${name}.css`);
  const stylesheetPaths = [...appDocument.querySelectorAll('link[rel="stylesheet"]')]
    .map(link => new URL(link.href).pathname.slice(new URL(appWindow.location.href).pathname.lastIndexOf('/') + 1));
  assert(stylesheetPaths.join('|') === expectedStylesheets.join('|'), 'La aplicación debe cargar las siete hojas locales en orden de ownership');
  assert([...appDocument.styleSheets].length === expectedStylesheets.length, 'Las siete hojas deben estar cargadas antes del primer render');
  assert([...appDocument.styleSheets].every(sheet => sheet.cssRules.length > 0), 'Cada hoja local debe parsearse sin errores');
  const homePrivacy = element('.privacy-note');
  assert(homePrivacy.getClientRects().length > 0 && homePrivacy.textContent.includes('nunca se suben'), 'El aviso de privacidad permanece visible en el inicio');
  assert(appWindow.getComputedStyle(homePrivacy).textAlign === 'left', 'El aviso conserva su lectura alineada');
  assert(appWindow.getComputedStyle(element('.drop-zone-badge')).backgroundColor === 'rgb(26, 48, 42)', 'El badge de carga usa el fondo de acento suave');
  assert(appWindow.getComputedStyle(element('.drop-zone-icon')).color === 'rgb(120, 184, 146)', 'El icono de carga usa el acento de la paleta');
  assert(appWindow.getComputedStyle(element('.drop-zone-files')).borderTopWidth === '0px', 'La zona de carga no agrega un separador interno');
  const syntheticEvents = ['2024-01-10', '2024-02-10', '2024-02-11'].map(date => ({
    ts: `${date}T12:00:00Z`, ms_played: 180000,
    master_metadata_track_name: 'Synthetic track',
    master_metadata_album_artist_name: 'Synthetic artist',
    master_metadata_album_album_name: 'Synthetic album',
    spotify_track_uri: 'spotify:track:synthetic'
  }));
  syntheticEvents.push(
    { ts: '2024-01-11T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'Artist A', master_metadata_album_album_name: 'Album A' },
    { ts: '2024-01-12T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'Echo', master_metadata_album_artist_name: 'Artist B', master_metadata_album_album_name: 'Album B' },
    { ts: '2024-01-13T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist C', master_metadata_album_album_name: 'Album One' },
    { ts: '2024-01-14T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist C', master_metadata_album_album_name: 'Album Two' },
    { ts: '2024-01-15T12:00:00Z', ms_played: 180000, master_metadata_track_name: 'Shared', master_metadata_album_artist_name: 'Artist C', master_metadata_album_album_name: 'Album Two' }
  );
  const json = JSON.stringify(syntheticEvents);
  const transfer = new appWindow.DataTransfer();
  transfer.items.add(new appWindow.File([json], 'Streaming_History_Audio_synthetic.json', { type: 'application/json' }));
  const input = element('#file-input');
  input.files = transfer.files;
  input.dispatchEvent(new appWindow.Event('change', { bubbles: true }));
  await waitFor(() => !element('#view-app').hidden, 'carga sintética');
  assert(kpiValue('Reproducciones') === '8', 'La carga debe mostrar 8 reproducciones');
  const tabButton = element('.tabs button');
  const tabButtonStyle = appWindow.getComputedStyle(tabButton);
  assert(tabButtonStyle.flexGrow === '1' && tabButtonStyle.flexBasis === '0px' && tabButtonStyle.justifyContent === 'center', 'Las pestañas distribuyen y centran sus botones');
  const tableScroll = element('.table-scroll');
  assert(appWindow.getComputedStyle(tableScroll).paddingBottom === '12px', 'La tabla reserva espacio para su barra de desplazamiento');
  const stickyHeader = element('.table-scroll table th:first-child');
  assert(appWindow.getComputedStyle(stickyHeader).position === 'sticky' && appWindow.getComputedStyle(stickyHeader).zIndex === '1', 'La columna inicial conserva su fijación y capa');
  const rankTable = element('.table-scroll table.rank-table');
  assert(appWindow.getComputedStyle(rankTable).tableLayout === 'fixed', 'La tabla de ranking conserva el layout fijo');
  const cssRules = [...appDocument.styleSheets].flatMap(sheet => collectCssRules(sheet.cssRules));
  const finePointerHoverRules = cssRules.filter(rule => rule.parentRule?.conditionText?.includes('(hover: hover)')
    && rule.parentRule.conditionText.includes('(pointer: fine)'));
  const rowHoverRule = finePointerHoverRules.find(rule => rule.selectorText === 'tbody tr:hover td');
  const stickyHoverRule = finePointerHoverRules.find(rule => rule.selectorText === '.table-scroll table tbody tr:hover td:first-child');
  assert(rowHoverRule?.style.getPropertyValue('background-color') === 'var(--surface-2)', 'El hover de filas cambia solo el color de fondo');
  assert(stickyHoverRule?.style.getPropertyValue('background-color') === 'var(--surface-2)', 'El hover conserva el color de la primera celda fija');
  assert(finePointerHoverRules.every(rule => !rule.style.getPropertyValue('background')), 'El hover no reemplaza fondos compuestos');
  assert(typeof appWindow.matchMedia('(hover: hover) and (pointer: fine)').matches === 'boolean', 'El estado hover debe depender de las capacidades reales del puntero');
  const coarseHintRule = cssRules.find(rule => rule.selectorText === '.hint-shift' && rule.parentRule?.conditionText === '(pointer: coarse)');
  assert(coarseHintRule?.style.display === 'none', 'El hint de Shift se oculta en dispositivos táctiles');
  const viewRangeStyle = appWindow.getComputedStyle(element('.view-range'));
  const recordStyle = appWindow.getComputedStyle(element('.record-item'));
  assert(viewRangeStyle.borderLeftColor === viewRangeStyle.borderColor, 'El rango no agrega un borde lateral de acento');
  assert(recordStyle.borderLeftColor === recordStyle.borderColor, 'Los récords conservan un borde uniforme');
  const tableFixture = appDocument.createElement('div');
  tableFixture.className = 'table-scroll table-scroll--tall';
  tableFixture.innerHTML = '<table><thead><tr><th scope="col">#</th><th scope="col">Nombre</th></tr></thead><tbody><tr><td>1</td><td>Fila</td></tr></tbody></table>';
  appDocument.body.append(tableFixture);
  assert(appWindow.getComputedStyle(tableFixture.querySelector('thead th:first-child')).zIndex === '3', 'La intersección de encabezado y columna fija conserva su capa superior');
  tableFixture.remove();
  const shareFixture = appDocument.createElement('div');
  shareFixture.className = 'table-scroll';
  shareFixture.innerHTML = '<table><tbody><tr style="--bar-w: 50%"><td class="col-share">50%</td></tr></tbody></table>';
  appDocument.body.append(shareFixture);
  assert(appWindow.getComputedStyle(shareFixture.querySelector('.col-share')).backgroundImage.includes('linear-gradient'), 'La barra de cuota conserva su gradiente al aplicar el hover de fila');
  shareFixture.remove();
  navLink('Resumen del período').click();
  await waitFor(() => Boolean(element('.hero-archetype')), 'abrir el resumen del período para verificar su tarjeta');
  const heroStyle = appWindow.getComputedStyle(element('.hero-archetype'));
  assert(heroStyle.borderLeftColor === heroStyle.borderColor, 'El resumen del período conserva un borde uniforme');
  navLink('Resumen').click();
  await waitFor(() => viewHeading() === 'Resumen', 'volver al Resumen después de verificar estilos');
  const cachePrompt = element('#cache-toast [data-cache="save"]');
  assert(cachePrompt, 'La carga debe pedir consentimiento antes de escribir IndexedDB');
  cachePrompt.click();
  await waitFor(() => element('#cache-toast').textContent.includes('Datos guardados en este dispositivo.'), 'guardar el dataset con consentimiento');
  const savedCache = await readIndexedDbCache(appWindow);
  assert(savedCache.eventCount === 8 && savedCache.schemaVersion === 2 && savedCache.timestampCount === 8, 'IndexedDB real debe guardar el esquema y las ocho reproducciones');

  auxiliaryTab.location.href = new URL('../index.html#/v1/track/Artist%20A/Echo?s=unknown&m=plays', window.location.href).href;
  await waitInWindow(auxiliaryTab, (doc) => doc.readyState === 'complete' && doc.getElementById('cache-card') && !doc.getElementById('cache-card').hidden, 'mostrar la caché en una pestaña nueva');
  assert(auxiliaryTab.location.hash.includes('s=unknown') && auxiliaryTab.location.hash.includes('m=plays'), 'La pestaña nueva debe conservar el filtro y la métrica del enlace');
  assert(auxiliaryTab.document.getElementById('cache-meta').textContent.includes('8 reproducciones'), 'La pestaña nueva debe resumir las ocho reproducciones guardadas');
  auxiliaryTab.document.getElementById('btn-cached').click();
  await waitInWindow(auxiliaryTab, (doc) => !doc.getElementById('view-app').hidden && viewHeading(doc) === 'Echo', 'abrir el detalle con la caché en la pestaña nueva');
  assert(kpiValue('Reproducciones', auxiliaryTab.document) === '1', 'La nueva pestaña debe reconstruir la canción y sus filtros desde la caché');
  assert(auxiliaryTab.location.hash.includes('s=unknown') && auxiliaryTab.location.hash.includes('m=plays'), 'La carga de caché debe mantener el filtro y la métrica de la ruta');

  auxiliaryTab.location.href = new URL(`../index.html?cache-clear=${Date.now()}`, window.location.href).href;
  await waitInWindow(auxiliaryTab, (doc) => doc.readyState === 'complete' && !doc.getElementById('view-home').hidden && doc.getElementById('cache-card') && !doc.getElementById('cache-card').hidden, 'volver al inicio para borrar la caché real');
  const clearCacheButton = auxiliaryTab.document.getElementById('btn-cached-clear');
  assert(!clearCacheButton.disabled, 'El botón de borrado debe estar habilitado en el inicio');
  clearCacheButton.click();
  assert(clearCacheButton.getAttribute('aria-label') === 'Confirmar borrado de datos guardados', 'El primer toque debe pedir confirmación de borrado');
  clearCacheButton.click();
  await waitInWindow(auxiliaryTab, (doc) => /Datos guardados borrados|No se pudieron borrar/.test(doc.getElementById('status').textContent), 'terminar el borrado de IndexedDB');
  assert(auxiliaryTab.document.getElementById('status').textContent.includes('Datos guardados borrados.'), 'La UI debe confirmar el borrado real: ' + auxiliaryTab.document.getElementById('status').textContent);
  assert((await readIndexedDbCache(auxiliaryTab)).keyCount === 0, 'Borrar desde la UI debe vaciar IndexedDB real');
  const hourlyChart = appDocument.querySelector('.chart-card[data-chart-id="dashboard-day-hour"]');
  const hourlyPoints = JSON.parse(hourlyChart.dataset.chartPoints);
  assert(hourlyPoints.length === 168, 'El mapa horario debe exponer todos sus puntos');
  const nextHourlyPoint = hourlyChart.querySelector('[data-chart-step][data-dir="1"]');
  nextHourlyPoint.focus();
  nextHourlyPoint.dispatchEvent(new appWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert(hourlyChart.querySelector('.chart-inspector__label').textContent === 'Lunes 0:00', 'Las flechas deben seleccionar el primer punto de la serie');
  const hourlyValue = hourlyChart.querySelector('.chart-inspector__value').textContent;
  assert(hourlyValue === '0 ms', `El inspector debe conservar los ceros reales: ${hourlyValue}`);
  const hourlyCell = hourlyChart.querySelector('svg.chart [data-chart-index="35"]');
  const hourlyCellRect = hourlyCell.getBoundingClientRect();
  hourlyCell.dispatchEvent(new appWindow.MouseEvent('click', {
    bubbles: true,
    clientX: hourlyCellRect.left + hourlyCellRect.width / 2,
    clientY: hourlyCellRect.top + hourlyCellRect.height / 2
  }));
  assert(!hourlyChart.querySelector('.chart-inspector').hidden, 'El toque/clic de un punto debe mantener abierto el inspector');
  assert(hourlyCell.classList.contains('is-selected'), 'El punto tocado debe quedar seleccionado');
  const selectedHourlyIdentity = hourlyPoints[35].date || hourlyPoints[35].label;

  navLink('Hábitos').click();
  await waitFor(() => Boolean(element('.chart-card[data-chart-id="habits-skips-monthly"]')), 'abrir serie mensual con banderas desconocidas');
  const skipsChart = element('.chart-card[data-chart-id="habits-skips-monthly"]');
  const skipsPoints = JSON.parse(skipsChart.dataset.chartPoints);
  assert(skipsPoints.length > 0 && skipsPoints.every(point => point.value == null && point.valueText === 'Sin base'), 'Las banderas desconocidas deben conservar su estado sin convertirse en cero');
  const nextSkipsPoint = skipsChart.querySelector('[data-chart-step][data-dir="1"]');
  nextSkipsPoint.focus();
  nextSkipsPoint.dispatchEvent(new appWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert(skipsChart.querySelector('.chart-inspector__value').textContent === 'Sin base', 'El inspector debe anunciar que el mes no tiene base conocida');
  assert(skipsChart.querySelector('.table-fallback').textContent.includes('Sin base'), 'La tabla del gráfico debe conservar los puntos desconocidos');
  navLink('Resumen').click();
  await waitFor(() => viewHeading() === 'Resumen', 'volver al resumen tras inspeccionar gráficos');
  const restoredHourlyChart = element('.chart-card[data-chart-id="dashboard-day-hour"]');
  const restoredHourlyPoint = [...restoredHourlyChart.querySelectorAll('[data-chart-index]')]
    .find(point => (hourlyPoints[Number(point.dataset.chartIndex)].date || hourlyPoints[Number(point.dataset.chartIndex)].label) === selectedHourlyIdentity);
  assert(restoredHourlyPoint?.classList.contains('is-selected'), 'La selección debe restaurarse por identidad después de navegar');
  assert(!restoredHourlyChart.querySelector('.chart-inspector').hidden, 'El inspector debe reabrirse al restaurar la selección');
  restoredHourlyChart.querySelector('[data-action="close-inspector"]').click();
  assert(restoredHourlyChart.querySelector('.chart-inspector').hidden, 'Cerrar debe ocultar el inspector');
  assert(!restoredHourlyChart.querySelector('.is-selected'), 'Cerrar debe limpiar el punto seleccionado');
  assert(appDocument.getElementById('live-status').textContent === 'Inspector cerrado.', 'Cerrar debe anunciar el estado actualizado');

  element('[data-preset="4w"]').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Reproducciones') === '4', 'filtro de 4 semanas');
  assert(kpiValue('Reproducciones') === '4', 'El rango de 4 semanas debe mostrar 4 reproducciones');
  assert(element('#status[aria-live="polite"]'), 'El estado de carga debe estar anunciado');
  const filteredHash = appWindow.location.hash;
  element('.skip-link').click();
  assert(appWindow.location.hash === filteredHash, 'Saltar al contenido debe conservar la ruta y los filtros');
  assert(frame.contentDocument.activeElement === element('#main-content'), 'Saltar al contenido debe mover el foco');
  assert(kpiValue('Reproducciones') === '4', 'Saltar al contenido debe conservar las cifras');
  navLink('Sesiones').click();
  await waitFor(() => viewHeading() === 'Sesiones de escucha', 'abrir Sesiones');
  element('[data-preset="all"]').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Sesiones') === '8', 'Todo en Sesiones');
  const allHash = appWindow.location.hash;

  appWindow.history.back();
  await waitFor(() => appWindow.location.hash === filteredHash && !element('#view-root').hidden && viewHeading() === 'Resumen', 'Atrás');
  assert(element('[data-preset="4w"]').getAttribute('aria-pressed') === 'true', 'Atrás debe restaurar el filtro');
  assert(kpiValue('Reproducciones') === '4', 'Atrás debe restaurar las cifras filtradas');
  const comparison = [...frame.contentDocument.querySelectorAll('.kpi-sub')].map(node => node.textContent).join(' ');
  assert(comparison.includes('▲'), 'La comparación debe usar el período filtrado');

  appWindow.history.forward();
  await waitFor(() => appWindow.location.hash === allHash && !element('#view-root').hidden && viewHeading() === 'Sesiones de escucha', 'Adelante');
  assert(element('[data-preset="all"]').getAttribute('aria-pressed') === 'true', 'Adelante debe restaurar Todo');
  assert(kpiValue('Sesiones') === '8', 'Adelante debe restaurar el modelo completo');

  appWindow.location.hash = filteredHash;
  await waitFor(() => !element('#view-root').hidden && viewHeading() === 'Resumen' && kpiValue('Reproducciones') === '4', 'hash filtrado');
  assert(kpiValue('Reproducciones') === '4', 'Un cambio manual del hash debe filtrar las cifras');
  appWindow.location.hash = '#/dashboard';
  await waitFor(() => !element('#view-root').hidden && element('[data-preset="all"]').getAttribute('aria-pressed') === 'true' && kpiValue('Reproducciones') === '8', 'hash sin filtros');
  assert(kpiValue('Reproducciones') === '8', 'Un hash sin filtros debe restaurar las 8 reproducciones');

  element('[data-preset="4w"]').click();
  element('#cancel-processing').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Reproducciones') === '8', 'cancelación del filtro');
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
  const trackLink = trackLinkFor('Synthetic artist', 'Synthetic track');
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

  navLink('Explorar').click();
  await waitFor(() => Boolean(element('#explore-card')), 'abrir catálogo de homónimos');
  element('[data-explore-tab="tracks"]').click();
  await waitFor(() => element('[data-explore-tab="tracks"]').getAttribute('aria-selected') === 'true', 'preparar catálogo de homónimos');
  const homonymSearch = element('[data-explore-search]');
  homonymSearch.value = 'Echo';
  homonymSearch.dispatchEvent(new appWindow.Event('input', { bubbles: true }));
  await waitFor(() => element('[data-action="export-table"]').dataset.totalMatches === '2', 'buscar canciones homónimas');
  const homonymLinks = [...element('#explore-card').querySelectorAll('a[href^="#/v1/track/"]')];
  assert(homonymLinks.length === 2, 'Cada homónimo debe tener su fila propia');
  const homonymHrefs = homonymLinks.map(link => decodeURIComponent(link.getAttribute('href')));
  assert(homonymHrefs.some(href => href.includes('/Artist A/Echo')) && homonymHrefs.some(href => href.includes('/Artist B/Echo')), 'Las rutas deben separar canciones por artista');
  const returnHref = homonymLinks[0].getAttribute('href');
  const scrollStyle = appDocument.createElement('style');
  scrollStyle.textContent = '.table-scroll[aria-label="Tabla de catálogo"] table { min-width: 1200px !important; }';
  appDocument.head.append(scrollStyle);
  const scrollSpacer = appDocument.createElement('div');
  scrollSpacer.style.height = '1200px';
  appDocument.body.append(scrollSpacer);
  homonymLinks[0].focus();
  const sourceTableScroll = element('.table-scroll[aria-label="Tabla de catálogo"]');
  sourceTableScroll.scrollLeft = 180;
  const expectedTableScroll = sourceTableScroll.scrollLeft;
  assert(expectedTableScroll > 0, 'La tabla real debe desplazarse horizontalmente antes de navegar');
  appWindow.scrollTo(0, 250);
  await waitForWindowScroll(appWindow, 250);
  const expectedPageScroll = appWindow.scrollY;
  assert(expectedPageScroll === 250, 'La página del navegador debe tener una posición de scroll restaurable');
  homonymLinks[0].click();
  await waitFor(() => viewHeading() === 'Echo', 'abrir canción homónima');
  appWindow.history.back();
  await waitFor(() => viewHeading() === 'Explorar catálogo completo' && element('[data-explore-search]').value === 'Echo', 'volver a la consulta de homónimos');
  assert(frame.contentDocument.activeElement.getAttribute('href') === returnHref, 'Atrás debe restaurar el foco en el enlace de origen');
  assert(appWindow.scrollY === expectedPageScroll, 'Atrás debe restaurar el scroll real de página');
  const restoredTableScroll = element('.table-scroll[aria-label="Tabla de catálogo"]').scrollLeft;
  assert(restoredTableScroll === expectedTableScroll, `Atrás debe restaurar el scroll real de la tabla: ${restoredTableScroll}/${expectedTableScroll}; ${JSON.stringify(appWindow.history.state?.returnState?.tableScrolls)}`);
  scrollStyle.remove();
  scrollSpacer.remove();

  const sharedSearch = element('[data-explore-search]');
  sharedSearch.value = 'Shared';
  sharedSearch.dispatchEvent(new appWindow.Event('input', { bubbles: true }));
  await waitFor(() => element('[data-action="export-table"]').dataset.totalMatches === '1', 'buscar canción compartida por álbum');
  trackLinkFor('Artist C', 'Shared').click();
  await waitFor(() => viewHeading() === 'Shared', 'abrir canción compartida por álbum');
  assert(kpiValue('Reproducciones') === '3', 'La canción agrupada debe conservar sus tres reproducciones');
  assert(element('#view-root').textContent.includes('Album One') && element('#view-root').textContent.includes('Album Two'), 'La ficha agrupada debe mostrar sus dos atribuciones de álbum');

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
  await waitFor(() => kpiValue('Reproducciones') === '4', 'confirmar selección exportable');
  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir exportación de selección');
  const selectionScope = element('[name="export-scope"][value="selection"]');
  assert(!selectionScope.disabled && element('#export-selection-desc').textContent.includes('4 reproducciones'), 'La exportación debe conservar la selección analítica confirmada');
  selectionScope.click();
  assert(await submitExportAndWaitForDownload(appWindow, 'generar ZIP de selección') === 1, 'La selección debe iniciar una descarga');
  await new Promise(resolve => setTimeout(resolve, 1100));

  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir exportación completa');
  assert(element('[name="export-scope"][value="all"]').checked, 'La exportación completa debe ser el alcance predeterminado');
  assert(await submitExportAndWaitForDownload(appWindow, 'generar ZIP completo') === 1, 'El historial completo debe iniciar una descarga');

  element('[data-preset="all"]').click();
  await waitFor(() => kpiValue('Reproducciones') === '8', 'limpiar selección antes de exportar la tabla');
  navLink('Explorar').click();
  await waitFor(() => Boolean(element('#explore-card')), 'abrir catálogo para exportar');
  element('[data-explore-tab="tracks"]').click();
  await waitFor(() => element('[data-explore-tab="tracks"]').getAttribute('aria-selected') === 'true', 'preparar tabla de canciones');
  const trackSearch = element('[data-explore-search]');
  trackSearch.value = 'Echo';
  trackSearch.dispatchEvent(new appWindow.Event('input', { bubbles: true }));
  await waitFor(() => {
    const params = new URLSearchParams(appWindow.location.hash.split('?')[1] ?? '');
    const card = frame.contentDocument.querySelector('#explore-card');
    if (!card) return false;
    const rows = [...card.querySelectorAll('tbody tr')];
    const rowNames = rows.map(row => row.textContent);
    const links = rows.map(row => row.querySelector('a[href^="#/v1/track/"]')?.getAttribute('href') ?? '');
    return params.get('q') === 'Echo'
      && element('[data-explore-search]').value === 'Echo'
      && element('[data-action="export-table"]').dataset.totalMatches === '2'
      && rows.length === 2
      && rowNames.every(name => name.includes('Echo'))
      && links.some(href => decodeURIComponent(href).includes('/Artist A/Echo'))
      && links.some(href => decodeURIComponent(href).includes('/Artist B/Echo'));
  }, 'confirmar consulta de exportación');
  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir opciones de exportación');
  assert(!element('[name="export-scope"][value="table"]').disabled, 'La tabla confirmada debe poder exportarse');
  assert(element('#export-table-desc').textContent.includes('2 canciones') && element('#export-table-desc').textContent.includes('búsqueda “Echo”'), 'El diálogo debe mostrar los criterios y total de la consulta confirmada');
  element('[data-action="close-export"]').click();
  assert(!element('#dialog-export').open, 'Cancelar debe cerrar el diálogo sin exportar');

  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'abrir opciones para cancelar la exportación activa');
  element('[name="export-scope"][value="table"]').click();
  let lateDownloadAttempts = 0;
  let delayedExport = null;
  const workerPrototype = appWindow.Worker.prototype;
  const originalPostMessage = workerPrototype.postMessage;
  const originalAnchorClick = appWindow.HTMLAnchorElement.prototype.click;
  workerPrototype.postMessage = function (...args) {
    if (args[0]?.type === 'export') {
      delayedExport = { worker: this, args };
      return;
    }
    return originalPostMessage.apply(this, args);
  };
  appWindow.HTMLAnchorElement.prototype.click = function () {
    if (this.download) lateDownloadAttempts++;
    return originalAnchorClick.call(this);
  };
  try {
    element('#btn-confirm-export').click();
    await waitFor(() => delayedExport !== null, 'enviar exportación al Worker');
    await waitFor(() => !element('#processing').hidden, 'mostrar exportación activa antes de cancelarla');
    element('#cancel-processing').click();
    await waitFor(() => element('#processing').hidden, 'cancelar una exportación activa');
    assert(delayedExport, 'La exportación cancelada debe haber quedado pendiente en el Worker');
    workerPrototype.postMessage = originalPostMessage;
    delayedExport.worker.postMessage(...delayedExport.args);
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert(lateDownloadAttempts === 0, 'Una exportación cancelada no debe iniciar una descarga tardía');
  } finally {
    workerPrototype.postMessage = originalPostMessage;
    appWindow.HTMLAnchorElement.prototype.click = originalAnchorClick;
  }

  element('[data-action="export"]').click();
  await waitFor(() => element('#dialog-export').open, 'reabrir opciones de exportación');
  element('[name="export-scope"][value="table"]').click();
  element('#btn-confirm-export').click();
  await waitFor(() => !element('#dialog-export').open && element('#live-status').textContent.includes('Descargadas 2 filas'), 'descargar tabla completa con metadata');

  appWindow.localStorage.setItem('scrobbleview_metric', 'plays');
  appWindow.localStorage.setItem('scrobbleview:tableLimits', '{"sessions-plays":25}');
  appWindow.localStorage.setItem('scrobbleview:favorites', '["dashboard"]');
  appWindow.localStorage.setItem('scrobbleview:density', 'compact');
  navLink('Resumen').click();
  await waitFor(() => viewHeading() === 'Resumen', 'volver al resumen antes de preferencias');
  element('[data-preset="4w"]').click();
  await waitFor(() => kpiValue('Reproducciones') === '4', 'preparar selección para preferencias');
  element('[data-action="reset-preferences"]').click();
  await waitFor(() => appWindow.localStorage.getItem('scrobbleview_metric') === null, 'restablecer preferencias');
  assert(kpiValue('Reproducciones') === '4', 'Restablecer preferencias debe conservar el análisis y sus filtros');
  assert(element('[data-preset="4w"]').getAttribute('aria-pressed') === 'true', 'Restablecer preferencias no debe borrar filtros analíticos');
  assert(element('#live-status').textContent.includes('Preferencias restablecidas'), 'El resultado de preferencias debe anunciarse');
  element('[data-preset="all"]').click();
  await waitFor(() => kpiValue('Reproducciones') === '8', 'limpiar selección antes de los ciclos');

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
    trackLinkFor('Synthetic artist', 'Synthetic track').click();
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
    await waitFor(() => kpiValue('Reproducciones') === '4', `ciclo ${cycle + 1}: filtro 4 semanas`);
    actionEffects++;
    element('[data-preset="all"]').click();
    await waitFor(() => kpiValue('Reproducciones') === '8', `ciclo ${cycle + 1}: restablecer filtro`);
    actionEffects++;
    cycleMemory.push(appWindow.performance.memory?.usedJSHeapSize ?? null);
  }
  assert(routeEffects === 60, 'Los veinte ciclos deben ejecutar 60 acciones de ruta');
  const afterCyclesMemory = appWindow.performance.memory?.usedJSHeapSize ?? null;
  window.__r10Report = { phase: 'cycles-complete', beforeCyclesMemory, afterCyclesMemory, cycleMemory, actionEffects, routeEffects };

  navLink('Resumen').click();
  await waitFor(() => viewHeading() === 'Resumen' && Boolean(element('.kpis')), 'abrir resumen responsive');
  const viewportWidths = [320, 360, 393, 412, 640];
  const viewportChecks = [];
  for (const width of viewportWidths) {
    frame.style.width = `${width}px`;
    await nextFrame();
    const kpiColumns = appWindow.getComputedStyle(element('.kpis')).gridTemplateColumns.trim().split(/\s+/).length;
    const recordColumns = appWindow.getComputedStyle(element('.records-grid')).gridTemplateColumns.trim().split(/\s+/).length;
    const clippedText = [...appDocument.querySelectorAll('.kpis dt, .kpis dd, .records-grid .record-label, .records-grid .record-value')]
      .filter(node => node.clientWidth > 0 && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1));
    viewportChecks.push({ width, scrollWidth: appDocument.documentElement.scrollWidth, viewport: appWindow.innerWidth, kpiColumns, recordColumns, clippedText: clippedText.length });
    assert(appDocument.documentElement.scrollWidth <= appWindow.innerWidth, `Desbordamiento horizontal a ${width}px`);
    assert(kpiColumns === 2, `Los KPIs deben tener dos columnas a ${width}px`);
    assert(recordColumns === 2, `Los récords deben tener dos columnas a ${width}px`);
    assert(clippedText.length === 0, `Texto de KPIs o récords recortado a ${width}px: ${clippedText.slice(0, 3).map(node => `${node.className}:${node.textContent.trim()}:${node.scrollWidth}/${node.clientWidth},${node.scrollHeight}/${node.clientHeight}`).join('; ')}`);
  }
  appDocument.documentElement.style.fontSize = '125%';
  await nextFrame();
  const enlargedFont = Number.parseFloat(appWindow.getComputedStyle(appDocument.documentElement).fontSize);
  assert(enlargedFont >= 20, 'El texto ampliado debe reflejarse en estilos calculados');
  assert(appDocument.documentElement.scrollWidth <= appWindow.innerWidth, 'El texto ampliado no debe desbordar el ancho de página');
  const clippedEnlargedText = [...appDocument.querySelectorAll('.kpis dt, .kpis dd, .records-grid .record-label, .records-grid .record-value')]
    .filter(node => node.clientWidth > 0 && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1));
  assert(clippedEnlargedText.length === 0, `El texto ampliado no debe recortar KPIs ni récords: ${clippedEnlargedText.slice(0, 3).map(node => `${node.className}:${node.textContent.trim()}:${node.scrollWidth}/${node.clientWidth},${node.scrollHeight}/${node.clientHeight}`).join('; ')}`);
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

  assert(await upgradeIndexedDb(auxiliaryTab, 2) === 2, 'El navegador debe permitir preparar un fallo real de versión en IndexedDB');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No volvió a cargar la app para probar el fallo de IndexedDB')), 10000);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    frame.src = `../index.html?r10-cache-failure=${Date.now()}`;
  });
  const failureWindow = frame.contentWindow;
  const failureTransfer = new failureWindow.DataTransfer();
  failureTransfer.items.add(new failureWindow.File([json], 'Streaming_History_Audio_synthetic.json', { type: 'application/json' }));
  const failureInput = frame.contentDocument.querySelector('#file-input');
  failureInput.files = failureTransfer.files;
  failureInput.dispatchEvent(new failureWindow.Event('change', { bubbles: true }));
  await waitFor(() => !element('#view-app').hidden && kpiValue('Reproducciones') === '8', 'analizar datos aunque IndexedDB tenga una versión incompatible');
  await waitFor(() => Boolean(element('#cache-toast [data-cache="save"]')), 'ofrecer el guardado tras el fallo de versión');
  element('#cache-toast [data-cache="save"]').click();
  await waitFor(() => element('#cache-toast').textContent.includes('No se pudo guardar en este dispositivo'), 'mostrar el error real de IndexedDB');
  assert(kpiValue('Reproducciones') === '8', 'El fallo real de IndexedDB no debe quitar el análisis de memoria');
  const failedCache = await readIndexedDbCache(auxiliaryTab);
  assert(failedCache.keyCount === 0, 'El fallo de versión no debe dejar una caché parcial en IndexedDB');
  await deleteIndexedDb(auxiliaryTab);
  auxiliaryTab.close();
  auxiliaryTab = null;
  Object.assign(window.__r10Report, {
    browserIntegration: {
      savedEvents: savedCache.eventCount,
      loadedInNewTab: true,
      clearedKeys: 0,
      incompatibleVersionHandled: true,
      failedCacheKeys: failedCache.keyCount,
      restoredPageScroll: expectedPageScroll,
      restoredTableScroll: expectedTableScroll,
      canceledExportLateDownloads: lateDownloadAttempts
    }
  });
  results.textContent = 'APROBADO: navegación, exportación y cancelación, scroll real, responsive, caché IndexedDB real, carga desde una pestaña nueva y recuperación ante error.';
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  try {
    await run();
  } catch (error) {
    results.textContent = `FALLÓ: ${error.message}`;
  } finally {
    if (auxiliaryTab && !auxiliaryTab.closed) auxiliaryTab.close();
    auxiliaryTab = null;
    runButton.disabled = false;
  }
});
