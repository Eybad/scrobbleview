// ports.js — puerto ByteSource
//
// Contrato: secuencia de bytes opacos a los cortes de chunk. El scanner maneja
// valores que cruzan los límites de chunk, así que el adapter no necesita
// garantizar cortes "limpios".
//
// @typedef {Object} ByteSource
// @property {string} label            - Nombre legible (errores y progreso).
// @property {number|null} totalBytes  - Total de bytes si se conoce, si no null.
// @property {() => Promise<{done: boolean, value?: Uint8Array}>} next - Siguiente chunk.
// @property {() => Promise<void>} close - Libera recursos.
//
// Adapters: file-bytes (browser), node-fs-bytes (tests), memory-bytes (tests/demo).
// El worker (si el profiling lo pide) es un adapter de ~20 líneas: el puerto ya
// es "bytes que entran".