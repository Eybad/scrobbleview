const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function utf8Encode(s) {
  return textEncoder.encode(s);
}

export function hasEscape(bytes, start = 0, end = bytes.length) {
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0x5c) return true; // Backslash introduces an escape.
  }
  return false;
}

export function decodeJSONString(bytes, start = 0, end = bytes.length) {
  const s = textDecoder.decode(bytes.subarray(start, end));
  if (s.indexOf('\\') === -1) return s;
  return JSON.parse(`"${s}"`);
}
