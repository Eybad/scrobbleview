// Read in small slices to avoid materializing large Blob chunks in Android Chrome.

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
