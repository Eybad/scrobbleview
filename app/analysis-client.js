import { AbortError } from '../src/parse/errors.js';

export function createAnalysisClient({ createWorker = () => new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' }) } = {}) {
  let worker = null, nextId = 0;
  const pending = new Map();

  function stop(error) {
    worker?.terminate();
    worker = null;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
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
      if (data.error) request.reject(Object.assign(new Error(data.error.message), data.error));
      else request.resolve(data.result);
    });
    port.addEventListener('error', () => stop(new Error('No se pudo ejecutar el cálculo local. Serví la aplicación por HTTP y volvé a cargar los archivos.')));
    port.addEventListener('messageerror', () => stop(new Error('No se pudieron recibir las estadísticas. Volvé a cargar los archivos.')));
  }

  return {
    request(type, payload = {}, { onProgress } = {}) {
      return new Promise((resolve, reject) => {
        try { ensureWorker(); }
        catch (error) { reject(new Error('Este navegador no permite iniciar el cálculo local. Usá un navegador con Workers y serví la aplicación por HTTP.', { cause: error })); return; }
        const id = ++nextId;
        pending.set(id, { resolve, reject, onProgress });
        try { worker.postMessage({ id, type, payload }); }
        catch (error) { pending.delete(id); reject(error); }
      });
    },
    cancel() { stop(new AbortError('Procesamiento cancelado.')); }
  };
}
