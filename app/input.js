// File selection and local loading status. Analysis runs through the worker client.

import { fmtNum } from '../src/charts.js';

export function assertDistinctFiles(files) {
  const seen = new Set();
  for (const file of files) {
    const key = JSON.stringify([file.name, file.size, file.lastModified]);
    if (seen.has(key)) throw new Error(`Posible archivo repetido: ${file.name}. Seleccionalo una sola vez; si son archivos distintos, cambiales el nombre.`);
    seen.add(key);
  }
}

export function formatCacheMeta(summary) {
  if (!summary || typeof summary !== 'object' || !Number.isFinite(summary.count)) {
    return 'Sesión guardada en este dispositivo';
  }
  const plays = `${fmtNum(summary.count)} ${summary.count === 1 ? 'reproducción' : 'reproducciones'}`;
  if (Number.isFinite(summary.fromYear) && Number.isFinite(summary.toYear)) {
    const years = summary.fromYear === summary.toYear
      ? `${summary.fromYear}`
      : `${summary.fromYear}–${summary.toYear}`;
    return `Última carga: ${plays} · ${years}`;
  }
  return `Última carga: ${plays}`;
}

export function setupInput({ analyze, onReady, onError, onLoadCached, onClearCached }) {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');
  const btnDemo = document.getElementById('btn-demo');
  const btnUploadAlt = document.getElementById('btn-upload-alt');
  const cacheCard = document.getElementById('cache-card');
  const cacheMeta = document.getElementById('cache-meta');
  const btnCached = document.getElementById('btn-cached');
  const btnCachedClear = document.getElementById('btn-cached-clear');
  const actions = document.querySelector('#view-home .actions');
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

  async function run(inputData) {
    if (busy) return;
    busy = true;
    zone.classList.add('busy');
    setStatus('Procesando…');
    try {
      const result = await analyze(inputData, {
        onProgress(p, label) {
          const name = label ? ` (${label})` : '';
          setStatus(`Procesando${name}… ${Math.round(p * 100)}%`);
        }
      });
      showApp(result);
    } catch (err) {
      setStatus(err.code === 'E_ABORT' ? err.message : `Error: ${err.message}`, err.code === 'E_ABORT' ? '' : 'error');
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
      setStatus(err.code === 'E_ABORT' ? err.message : `Error: ${err.message}`, err.code === 'E_ABORT' ? '' : 'error');
      onError?.(err);
    } finally {
      busy = false;
      zone.classList.remove('busy');
    }
  }

  function pickFiles(list) {
    const files = [...list].filter((f) => /\.json$/i.test(f.name) || /\.zip$/i.test(f.name));
    if (files.length === 0) {
      setStatus('No se encontraron archivos .json o .zip', 'error');
      return;
    }
    try {
      assertDistinctFiles(files);
      run({ files: files.map((file) => ({ name: file.name, size: file.size, lastModified: file.lastModified, blob: file })) });
    } catch (error) { setStatus(error.message, 'error'); }
  }

  viewHome.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dragover');
  });
  viewHome.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  viewHome.addEventListener('drop', (e) => {
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

  btnDemo.addEventListener('click', () => run({ demo: true }));
  if (btnUploadAlt) btnUploadAlt.addEventListener('click', () => input.click());
  if (btnCached) btnCached.addEventListener('click', runCached);
  if (btnCachedClear && onClearCached) {
    // Confirmación en dos pasos: el primer toque arma el botón de papelera
    // como píldora roja "Confirmar" (4 s); el segundo borra.
    const deleteLabel = btnCachedClear.querySelector('.cache-delete-label');
    let armed = false;
    let disarmTimer = 0;
    const disarm = () => {
      armed = false;
      btnCachedClear.classList.remove('is-armed');
      btnCachedClear.setAttribute('aria-label', 'Borrar datos guardados');
      btnCachedClear.title = 'Borrar datos guardados';
      if (deleteLabel) deleteLabel.hidden = true;
    };
    btnCachedClear.addEventListener('click', async () => {
      if (!armed) {
        armed = true;
        btnCachedClear.classList.add('is-armed');
        btnCachedClear.setAttribute('aria-label', 'Confirmar borrado de datos guardados');
        btnCachedClear.title = 'Confirmar borrado de datos guardados';
        if (deleteLabel) deleteLabel.hidden = false;
        disarmTimer = setTimeout(disarm, 4000);
        return;
      }
      clearTimeout(disarmTimer);
      disarm();
      btnCachedClear.disabled = true;
      try {
        const cleared = await onClearCached();
        setStatus(cleared ? 'Datos guardados borrados.' : 'No se pudieron borrar los datos guardados. Volvé a intentarlo.', cleared ? '' : 'error');
      } catch (error) {
        setStatus(`No se pudieron borrar los datos guardados: ${error.message}`, 'error');
      } finally {
        btnCachedClear.disabled = false;
      }
    });
  }

  return {
    setStatus,
    reset(message) {
      viewApp.hidden = true; viewHome.hidden = false; setStatus(message);
      (zone.hidden ? btnCached : zone)?.focus();
    },
    showCachedButtons(cacheInfo) {
      const active = Boolean(cacheInfo);
      if (cacheCard) cacheCard.hidden = !active;
      if (cacheMeta && active) cacheMeta.textContent = formatCacheMeta(cacheInfo);
      zone.hidden = active;
      if (btnUploadAlt) btnUploadAlt.hidden = !active;
      actions?.classList.toggle('has-cache', active);
    }
  };
}
