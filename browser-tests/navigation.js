// Run against the real app DOM and browser history, without external tooling.
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
  assert(kpiValue('Reproducciones') === '2', 'El rango de 4 semanas debe mostrar 2 reproducciones');
  const filteredHash = appWindow.location.hash;
  element('.skip-link').click();
  assert(appWindow.location.hash === filteredHash, 'Saltar al contenido debe conservar la ruta y los filtros');
  assert(frame.contentDocument.activeElement === element('#main-content'), 'Saltar al contenido debe mover el foco');
  assert(kpiValue('Reproducciones') === '2', 'Saltar al contenido debe conservar las cifras');
  element('.app-nav a[href="#/sessions"]').click();
  await waitFor(() => element('#view-root h1').textContent === 'Sesiones de escucha', 'abrir Sesiones');
  element('[data-preset="all"]').click();
  const allHash = appWindow.location.hash;

  appWindow.history.back();
  await waitFor(() => appWindow.location.hash === filteredHash && element('#view-root h1').textContent === 'Resumen', 'Atrás');
  assert(element('[data-preset="4w"]').getAttribute('aria-pressed') === 'true', 'Atrás debe restaurar el filtro');
  assert(kpiValue('Reproducciones') === '2', 'Atrás debe restaurar las cifras filtradas');
  const comparison = [...frame.contentDocument.querySelectorAll('.kpi-sub')].map(node => node.textContent).join(' ');
  assert(comparison.includes('+100'), 'La comparación debe usar el período filtrado');

  appWindow.history.forward();
  await waitFor(() => appWindow.location.hash === allHash && element('#view-root h1').textContent === 'Sesiones de escucha', 'Adelante');
  assert(element('[data-preset="all"]').getAttribute('aria-pressed') === 'true', 'Adelante debe restaurar Todo');
  assert(kpiValue('Sesiones') === '3', 'Adelante debe restaurar el modelo completo');

  appWindow.location.hash = filteredHash;
  await waitFor(() => element('#view-root h1').textContent === 'Resumen', 'hash filtrado');
  assert(kpiValue('Reproducciones') === '2', 'Un cambio manual del hash debe filtrar las cifras');
  appWindow.location.hash = '#/dashboard';
  await waitFor(() => element('[data-preset="all"]').getAttribute('aria-pressed') === 'true', 'hash sin filtros');
  assert(kpiValue('Reproducciones') === '3', 'Un hash sin filtros debe restaurar las 3 reproducciones');
  results.textContent = 'APROBADO: carga, filtros, Atrás, Adelante, comparación y cambios manuales del hash.';
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
