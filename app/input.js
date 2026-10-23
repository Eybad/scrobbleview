// app/input.js — carga de archivos: drop zone + file input + botón demo
//
// Controla la vista de inicio. Recibe `analyze` (async (sources, {onProgress})
// → { ds, model, tz }) desde main.js y reporta progreso/errores en la UI.
// Al terminar: onReady({ ds, model, tz }). Opcional: onLoadCached (cargar el
// dataset guardado en IndexedDB sin re-parsear) y onClearCached (borrarlo).

import { fileBytes } from '../src/parse/adapters/file-bytes.js';
import { demoSource } from './demo.js';

export function setupInput({ analyze, onReady, onError, onLoadCached, onClearCached }) {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');
  const btnDemo = document.getElementById('btn-demo');
  const btnCached = document.getElementById('btn-cached');
  const btnCachedClear = document.getElementById('btn-cached-clear');
  const status = document.getElementById('status');
  const viewHome = document.getElementById('view-home');
  const viewApp = document.getElementById('view-app');

  let busy = false;

  // En táctil no existe el gesto de arrastrar: el texto lo dice sin rodeos.
  if (window.matchMedia('(pointer: coarse)').matches) {
    zone.querySelector('.drop-zone-title').textContent = 'Tocá para seleccionar tus archivos';
    zone.querySelector('.drop-zone-hint').hidden = true;
    zone.setAttribute('aria-label', 'Cargar archivos de historial de Spotify. Tocá para elegirlos.');
  }

  function setStatus(msg, kind = '') {
    status.textContent = msg;
    status.className = `status ${kind}`.trim();
    // Los errores son asertivos (role=alert, se anuncian al insertarse); el
    // resto queda como status (cortés). Cambiar el role dinámicamente es lo
    // que el patrón pide: el elemento vive en el HTML estático.
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  }

  function showApp(result) {
    viewHome.hidden = true;
    viewApp.hidden = false;
    onReady(result);
  }

  async function run(sources) {
    if (busy) return;
    busy = true;
    zone.classList.add('busy');
    setStatus('Procesando…');
    try {
      const result = await analyze(sources, {
        onProgress(p, label) {
          const name = label ? ` (${label})` : '';
          setStatus(`Procesando${name}… ${Math.round(p * 100)}%`);
        }
      });
      showApp(result);
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      onError?.(err);
    } finally {
      busy = false;
      zone.classList.remove('busy');
    }
  }

  async function runCached() {
    if (busy || !onLoadCached) return;
    busy = true;
    zone.classList.add('busy');
    setStatus('Cargando datos guardados…');
    try {
      const result = await onLoadCached();
      if (!result) {
        setStatus('No hay datos guardados.', 'error');
        return;
      }
      showApp(result);
    } catch (err) {
      setStatus(`Error: ${err.message}`, 'error');
      onError?.(err);
    } finally {
      busy = false;
      zone.classList.remove('busy');
    }
  }

  function pickFiles(list) {
    const files = [...list].filter((f) => f.name.toLowerCase().endsWith('.json'));
    if (files.length === 0) {
      setStatus('No se encontraron archivos .json', 'error');
      return;
    }
    run(files.map((f) => fileBytes(f)));
  }

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragover');
    pickFiles(e.dataTransfer.files);
  });

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener('change', () => {
    pickFiles(input.files);
    input.value = ''; // permite re-cargar el mismo archivo
  });

  btnDemo.addEventListener('click', () => run([demoSource()]));
  if (btnCached) btnCached.addEventListener('click', runCached);
  if (btnCachedClear && onClearCached) {
    // Confirmación en dos pasos: el primer toque arma el botón (4 s para
    // confirmar); el segundo borra. Un borrado destructivo a un toque era
    // demasiado fácil de activar sin querer en táctil.
    let armed = false;
    let disarmTimer = 0;
    btnCachedClear.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btnCachedClear.textContent = 'Confirmar borrado';
        disarmTimer = setTimeout(() => {
          armed = false;
          btnCachedClear.textContent = 'Borrar datos guardados';
        }, 4000);
        return;
      }
      clearTimeout(disarmTimer);
      armed = false;
      btnCachedClear.textContent = 'Borrar datos guardados';
      await onClearCached();
      setStatus('Datos guardados borrados.');
    });
  }

  return {
    setStatus,
    showCachedButtons(hasCache) {
      zone.classList.toggle('is-secondary', hasCache);
      if (btnCached) {
        btnCached.hidden = !hasCache;
        // Con caché, continuar es el camino más probable: el sólido se lo
        // lleva esa acción y la drop zone pasa a secundaria.
        btnCached.classList.toggle('btn-primary', hasCache);
        btnCached.classList.toggle('btn-secondary', !hasCache);
      }
      if (btnCachedClear) btnCachedClear.hidden = !hasCache;
    }
  };
}