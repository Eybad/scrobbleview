// text.js — decodificación de strings JSON (UTF-8 + escapes), sin alocar en el caso común

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

export function utf8Encode(s) {
  return textEncoder.encode(s);
}

export function hasEscape(bytes, start = 0, end = bytes.length) {
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0x5c) return true; // '\'
  }
  return false;
}

// Decodifica un string JSON: UTF-8 + escapes (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX).
// Caso común (sin escapes): un solo TextDecoder.decode.
export function decodeJSONString(bytes, start = 0, end = bytes.length) {
  const s = textDecoder.decode(bytes.subarray(start, end));
  if (s.indexOf('\\') === -1) return s;
  return s.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (m, p1) => {
    if (p1[0] === 'u') return String.fromCharCode(parseInt(p1.slice(1), 16));
    switch (p1) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default: return m;
    }
  });
}