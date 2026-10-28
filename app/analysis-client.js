import { AbortError } from '../src/parse/errors.js';

export function createAnalysisClient({ createWorker = () => new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker = null, nextId = 0;
  const pending = new Map();
  let inFlightFilter = null;
  let pendingFilter = null;
  let activeExport = null;
  let dispatchedFilterCount = 0;

  function stop(error) {
    worker?.terminate();
    worker = null;
    inFlightFilter = null;
    pendingFilter = null;
    activeExport = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }

  function dispatchFilter(req) {
    inFlightFilter = req;
    dispatchedFilterCount++;
    pending.set(req.id, req);
    try {
      worker.postMessage({ id: req.id, type: 'filter', payload: req.payload });
    } catch (error) {
      pending.delete(req.id);
      inFlightFilter = null;
      req.reject(error);
    }
  }

  function ensureWorker() {
    if (worker) return;
    const port = createWorker();
    worker = port;
    port.addEventListener('message', ({ data }) => {
      if (worker !== port) return;
      const request = pending.get(data.id);
      if (!request) return;
      if (data.progress) { request.onProgress?.(data.progress.fraction, data.progress.label); return; }
      pending.delete(data.id);

      const isFilter = inFlightFilter && inFlightFilter.id === data.id;
      const isExport = activeExport && activeExport.id === data.id;

      if (isExport) {
        const exp = activeExport;
        activeExport = null;
        if (exp.cancelled) {
          exp.reject(new AbortError('Exportación cancelada.'));
          return;
        }
      }

      if (isFilter) {
        const currentFilter = inFlightFilter;
        inFlightFilter = null;
        if (currentFilter.cancelled) {
          currentFilter.reject(new AbortError('Actualización cancelada.'));
        } else if (data.error) {
          currentFilter.reject(Object.assign(new Error(data.error.message), data.error));
        } else {
          currentFilter.resolve(data.result);
        }
        if (pendingFilter) {
          const next = pendingFilter;
          pendingFilter = null;
          if (!next.cancelled) {
            dispatchFilter(next);
          }
        }
        return;
      }

      if (data.error) request.reject(Object.assign(new Error(data.error.message), data.error));
      else request.resolve(data.result);
    });
    port.addEventListener('error', () => { if (worker === port) stop(new Error('No se pudo ejecutar el cálculo local. Serví la aplicación por HTTP y volvé a cargar los archivos.')); });
    port.addEventListener('messageerror', () => { if (worker === port) stop(new Error('No se pudieron recibir las estadísticas. Volvé a cargar los archivos.')); });
  }

  return {
    get dispatchedFilterCount() {
      return dispatchedFilterCount;
    },
    request(type, payload = {}, { onProgress } = {}) {
      if (type === 'filter') {
        return new Promise((resolve, reject) => {
          try { ensureWorker(); }
          catch (error) { reject(new Error('Este navegador no permite iniciar el cálculo local. Usá un navegador con Workers y serví la aplicación por HTTP.', { cause: error })); return; }
          const req = {
            id: ++nextId,
            type: 'filter',
            payload,
            onProgress,
            resolve,
            reject,
            cancelled: false
          };
          if (!inFlightFilter) {
            dispatchFilter(req);
          } else {
            if (pendingFilter) {
              pendingFilter.cancelled = true;
              pendingFilter.resolve(null);
            }
            pendingFilter = req;
          }
        });
      }

      return new Promise((resolve, reject) => {
        try { ensureWorker(); }
        catch (error) { reject(new Error('Este navegador no permite iniciar el cálculo local. Usá un navegador con Workers y serví la aplicación por HTTP.', { cause: error })); return; }
        const id = ++nextId;
        const req = { id, resolve, reject, onProgress, cancelled: false };
        if (type === 'export') {
          activeExport = req;
        }
        pending.set(id, req);
        try { worker.postMessage({ id, type, payload }); }
        catch (error) {
          if (activeExport === req) activeExport = null;
          pending.delete(id);
          reject(error);
        }
      });
    },
    cancelUpdate() {
      if (pendingFilter) {
        pendingFilter.cancelled = true;
        pendingFilter.resolve(null);
        pendingFilter = null;
      }
      if (inFlightFilter) {
        inFlightFilter.cancelled = true;
      }
    },
    cancelExport() {
      if (activeExport) {
        activeExport.cancelled = true;
        activeExport.reject(new AbortError('Exportación cancelada.'));
        pending.delete(activeExport.id);
        activeExport = null;
      }
    },
    cancel() { stop(new AbortError('Procesamiento cancelado.')); },
    cancelImport() { stop(new AbortError('Procesamiento cancelado.')); }
  };
}
