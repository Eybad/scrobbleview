// adapters/memory-bytes.js — ByteSource desde string o Uint8Array (tests + demo)

export function memoryBytes(label, data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let offset = 0;
  return {
    label,
    totalBytes: bytes.length,
    async next() {
      if (offset >= bytes.length) return { done: true };
      const chunk = bytes.subarray(offset, offset + 262144);
      offset += chunk.length;
      return { done: false, value: chunk };
    },
    async close() {}
  };
}