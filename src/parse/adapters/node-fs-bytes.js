// adapters/node-fs-bytes.js — ByteSource desde un archivo (Node, tests/verificación)

import { open } from 'node:fs/promises';

const CHUNK = 262144;

export function nodeFsBytes(path) {
  let fh = null;
  let offset = 0;
  let size = 0;
  return {
    label: path,
    totalBytes: null,
    async next() {
      if (!fh) {
        fh = await open(path, 'r');
        const st = await fh.stat();
        size = st.size;
        this.totalBytes = size;
      }
      if (offset >= size) return { done: true };
      const buf = Buffer.alloc(Math.min(CHUNK, size - offset));
      const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
      offset += bytesRead;
      return { done: false, value: new Uint8Array(buf.buffer, buf.byteOffset, bytesRead) };
    },
    async close() {
      if (fh) {
        await fh.close();
        fh = null;
      }
    }
  };
}