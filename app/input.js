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
  const zoneContent = document.getElementById('drop-zone-content');
  const input = document.getElementById('file-input');
  const btnUpload = document.getElementById('btn-upload');
  const btnDemo = document.getElementById('btn-demo');
  const btnUploadAlt = document.getElementById('btn-upload-alt');
  const cacheChoice = document.getElementById('cache-choice');
  const cacheCard = document.getElementById('cache-card');
  const cacheMeta = document.getElementById('cache-meta');
  const btnCached = document.getElementById('btn-cached');
  const btnCachedClear = document.getElementById('btn-cached-clear');
  const status = document.getElementById('status');
  const viewHome = document.getElementById('view-home');
  const viewApp = document.getElementById('view-app');

  let busy = false;
  let cachedInfo = null;

  function syncCacheChoice() {
    const active = Boolean(cachedInfo);
    if (cacheChoice) cacheChoice.hidden = !active;
    if (cacheCard) cacheCard.hidden = !active;
    if (cacheMeta && active) cacheMeta.textContent = formatCacheMeta(cachedInfo);
    zone.hidden = active;
    if (btnUploadAlt) btnUploadAlt.hidden = !active;
  }

  function setImportBusy(active) {
    if (active) {
      if (cacheChoice) cacheChoice.hidden = true;
      zone.hidden = false;
      zoneContent.classList.add('is-suspended');
      if (zoneContent.contains(document.activeElement)) document.activeElement.blur();
      zoneContent.toggleAttribute('inert', true);
      zoneContent.setAttribute('aria-hidden', 'true');
      zone.classList.add('busy');
      return;
    }
    zoneContent.classList.remove('is-suspended');
    zoneContent.toggleAttribute('inert', false);
    zoneContent.removeAttribute('aria-hidden');
    zone.classList.remove('busy');
    syncCacheChoice();
  }

  function setStatus(msg, kind = '') {
    status.textContent = msg;
    status.className = `status ${kind}`.trim();
    // Keep the live region polite except when reporting an error.
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
    setImportBusy(true);
    setStatus('');
    try {
      const result = await analyze(inputData);
      showApp(result);
    } catch (err) {
      setStatus(err.code === 'E_ABORT' ? err.message : `Error: ${err.message}`, err.code === 'E_ABORT' ? '' : 'error');
      onError?.(err);
    } finally {
      busy = false;
      setImportBusy(false);
    }
  }

  async function runCached() {
    if (busy || !onLoadCached) return;
    busy = true;
    setImportBusy(true);
    setStatus('');
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
      setImportBusy(false);
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

  viewHome.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-action="choose-files"]')) input.click();
  });
  input.addEventListener('change', () => {
    pickFiles(input.files);
    input.value = ''; // Allow selecting the same file again.
  });

  btnDemo.addEventListener('click', () => run({ demo: true }));
  if (btnCached) btnCached.addEventListener('click', runCached);
  if (btnCachedClear && onClearCached) {
    // Require a second action before deleting the saved history.
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
      setImportBusy(false);
      viewApp.hidden = true; viewHome.hidden = false; setStatus(message);
      (zone.hidden ? btnCached : btnUpload)?.focus();
    },
    showCachedButtons(cacheInfo) {
      cachedInfo = cacheInfo || null;
      if (!busy) syncCacheChoice();
    }
  };
}
