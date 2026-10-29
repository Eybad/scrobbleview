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
    const timer = setTimeout(() => finish(new Error(`Tiempo agotado: ${label}`)), 10000);
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
        finish(error);
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

async function run() {
  results.textContent = 'Ejecutando…';
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No cargó la aplicación')), 10000);
    frame.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
    frame.src = '../index.html#/dashboard';
  });
  const appWindow = frame.contentWindow;
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
  const filteredHash = appWindow.location.hash;
  element('.skip-link').click();
  assert(appWindow.location.hash === filteredHash, 'Saltar al contenido debe conservar la ruta y los filtros');
  assert(frame.contentDocument.activeElement === element('#main-content'), 'Saltar al contenido debe mover el foco');
  assert(kpiValue('Reproducciones') === '2', 'Saltar al contenido debe conservar las cifras');
  const sessionsLink = [...frame.contentDocument.querySelectorAll('.app-nav a')]
    .find(link => link.getAttribute('href').split('?')[0] === '#/sessions');
  assert(sessionsLink, 'Falta el enlace a Sesiones');
  sessionsLink.click();
  await waitFor(() => element('#view-root h1').textContent === 'Sesiones de escucha', 'abrir Sesiones');
  element('[data-preset="all"]').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Sesiones') === '3', 'Todo en Sesiones');
  const allHash = appWindow.location.hash;

  appWindow.history.back();
  await waitFor(() => appWindow.location.hash === filteredHash && !element('#view-root').hidden && element('#view-root h1').textContent === 'Resumen', 'Atrás');
  assert(element('[data-preset="4w"]').getAttribute('aria-pressed') === 'true', 'Atrás debe restaurar el filtro');
  assert(kpiValue('Reproducciones') === '2', 'Atrás debe restaurar las cifras filtradas');
  const comparison = [...frame.contentDocument.querySelectorAll('.kpi-sub')].map(node => node.textContent).join(' ');
  assert(comparison.includes('100%') && comparison.includes('▲'), 'La comparación debe usar el período filtrado');

  appWindow.history.forward();
  await waitFor(() => appWindow.location.hash === allHash && !element('#view-root').hidden && element('#view-root h1').textContent === 'Sesiones de escucha', 'Adelante');
  assert(element('[data-preset="all"]').getAttribute('aria-pressed') === 'true', 'Adelante debe restaurar Todo');
  assert(kpiValue('Sesiones') === '3', 'Adelante debe restaurar el modelo completo');

  appWindow.location.hash = filteredHash;
  await waitFor(() => !element('#view-root').hidden && element('#view-root h1').textContent === 'Resumen' && kpiValue('Reproducciones') === '2', 'hash filtrado');
  assert(kpiValue('Reproducciones') === '2', 'Un cambio manual del hash debe filtrar las cifras');
  appWindow.location.hash = '#/dashboard';
  await waitFor(() => !element('#view-root').hidden && element('[data-preset="all"]').getAttribute('aria-pressed') === 'true' && kpiValue('Reproducciones') === '3', 'hash sin filtros');
  assert(kpiValue('Reproducciones') === '3', 'Un hash sin filtros debe restaurar las 3 reproducciones');
  element('[data-preset="4w"]').click();
  element('#cancel-processing').click();
  await waitFor(() => !element('#view-root').hidden && kpiValue('Reproducciones') === '3', 'cancelación del filtro');
  assert(!element('#view-app').hidden, 'Cancelar el filtro debe conservar el análisis');
  assert(element('#view-home').hidden, 'Cancelar el filtro no debe volver al inicio');
  const exploreLink = [...frame.contentDocument.querySelectorAll('.app-nav a')]
    .find(link => link.getAttribute('href').split('?')[0] === '#/explore');
  assert(exploreLink, 'Falta el enlace a Explorar');
  exploreLink.click();
  await waitFor(() => Boolean(frame.contentDocument.querySelector('[data-explore-search]')), 'abrir Explorar');
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
  results.textContent = 'APROBADO: carga, filtros, historial, cancelación y búsqueda en Explorar.';
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
