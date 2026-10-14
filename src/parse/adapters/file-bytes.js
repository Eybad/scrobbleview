// adapters/file-bytes.js — ByteSource desde un File (browser)
//
// Lee en slices de 256 KiB (evita el tope de memoria de Blob = RAM/100 en
// Android: 80 MB en 8 GB, 40 MB en 4 GB; superado, Chrome pagea a disco).

const CHUNK = 262144;

export function fileBytes(file) {
  let offset = 0;
  return {
    label: file.name,
    totalBytes: file.size,
    async next() {
      if (offset >= file.size) return { done: true };
      const end = Math.min(offset + CHUNK, file.size);
      const buf = await file.slice(offset, end).arrayBuffer();
      offset = end;
      return { done: false, value: new Uint8Array(buf) };
    },
    async close() {}
  };
}