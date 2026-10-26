import { createAnalysisEngine } from './analysis-engine.js';

const engine = createAnalysisEngine();
let send, listen;
if (typeof self !== 'undefined') {
  send = (message, transfer) => self.postMessage(message, transfer);
  listen = (callback) => self.addEventListener('message', (event) => callback(event.data));
} else {
  const { parentPort } = await import('node:worker_threads');
  send = (message, transfer) => parentPort.postMessage(message, transfer);
  listen = (callback) => parentPort.on('message', callback);
}

let queue = Promise.resolve();
listen(({ id, type, payload }) => {
  queue = queue.then(async () => {
    let lastProgress = 0, lastLabel = '';
    const report = (fraction, label) => {
      const now = Date.now();
      if (now - lastProgress < 100 && label === lastLabel && fraction !== 1) return;
      lastProgress = now; lastLabel = label;
      send({ id, progress: { fraction, label } });
    };
    try {
      const result = await engine.handle(type, payload, report);
      send({ id, result }, result?.bytes ? [result.bytes.buffer] : []);
    } catch (error) {
      send({ id, error: { message: error.message, name: error.name, code: error.code,
        byteOffset: error.byteOffset, field: error.field } });
    }
  });
});
