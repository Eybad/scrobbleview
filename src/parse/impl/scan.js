// Incremental JSON grammar. Only allowlisted event fields are retained;
// unknown subtrees are validated without materializing their values.
import { ParseError, SchemaError } from '../errors.js';
import { decodeJSONString, utf8Encode } from '../text.js';

const ALLOWLIST = new Map(Object.entries({
  ts: ['string', 'ts'], ms_played: ['number', 'ms'],
  master_metadata_track_name: ['string', 'track'],
  master_metadata_album_artist_name: ['string', 'artist'],
  master_metadata_album_album_name: ['string', 'album'],
  spotify_track_uri: ['string', 'uri'], reason_start: ['string', 'reasonStart'],
  reason_end: ['string', 'reasonEnd'], shuffle: ['boolean', 'shuffle'],
  skipped: ['boolean', 'skipped'], offline: ['boolean', 'offline']
}));
const KEYS = [...ALLOWLIST].map(([key, spec]) => [utf8Encode(key), spec]);
const isWhitespace = (b) => b === 32 || b === 9 || b === 10 || b === 13;
const isDigit = (b) => b >= 48 && b <= 57;
const isHex = (b) => isDigit(b) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102);
const isDelimiter = (b) => isWhitespace(b) || b === 44 || b === 125 || b === 93;

function matchKey(bytes) {
  if (bytes.includes(92)) return ALLOWLIST.get(decodeJSONString(bytes)) ?? null;
  for (const [key, spec] of KEYS) {
    if (bytes.length === key.length && bytes.every((b, i) => b === key[i])) return spec;
  }
  return null;
}

export function createScanner({ onEvent, onError }) {
  const stack = [];
  let started = false, finished = false, events = 0, offset = 0;
  let token = null;

  function fail(message, i, schema = false) {
    const ErrorType = schema ? SchemaError : ParseError;
    const err = new ErrorType(message, { byteOffset: offset + i, field: stack.at(-1)?.spec?.[1] });
    onError?.(err);
    throw err;
  }

  function complete(type, value, i) {
    const frame = stack.at(-1);
    if (!frame) { finished = true; return; }
    if (frame.spec) {
      const [expected, name] = frame.spec;
      if (type !== 'null' && type !== expected) fail(`Campo "${name}": se esperaba ${expected}`, i, true);
      frame.event[name] = value;
      frame.spec = null;
    }
    frame.state = 'comma';
  }

  function close(i) {
    const frame = stack.pop();
    if (frame.event) { onEvent(frame.event); events++; }
    complete(frame.kind, undefined, i);
  }

  function finishToken(chunk, i) {
    let bytes;
    if (token.capture) {
      token.parts.push(chunk.subarray(token.start, i));
      bytes = new Uint8Array(token.parts.reduce((n, part) => n + part.length, 0));
      let at = 0;
      for (const part of token.parts) { bytes.set(part, at); at += part.length; }
    }
    if (token.key) {
      const frame = stack.at(-1);
      frame.spec = bytes ? matchKey(bytes) : null;
      frame.state = 'colon';
    } else if (token.kind === 'string') complete('string', bytes, i);
    else if (token.kind === 'number') complete('number', bytes ? Number(new TextDecoder().decode(bytes)) : undefined, i);
    else complete(token.literal === 'null' ? 'null' : 'boolean', token.literal === 'null' ? null : token.literal === 'true', i);
    token = null;
  }

  function push(chunk) {
    let i = 0;
    while (i < chunk.length) {
      const b = chunk[i];
      if (token) {
        if (token.kind === 'string') {
          if (token.unicode) {
            if (!isHex(b)) fail('Escape Unicode inválido', i);
            token.unicode--; i++; continue;
          }
          if (token.escape) {
            if (b === 117) token.unicode = 4;
            else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(b)) fail('Escape JSON inválido', i);
            token.escape = false; i++; continue;
          }
          if (b === 34) { finishToken(chunk, i); i++; continue; }
          if (b < 32) fail('Carácter de control en string', i);
          if (b === 92) token.escape = true;
          i++; continue;
        }
        if (isDelimiter(b)) {
          if (token.kind === 'number' && !['zero', 'integer', 'fraction', 'exponentDigits'].includes(token.state)) fail('Número inválido', i);
          if (token.kind === 'literal' && token.position !== token.literal.length) fail('Literal inválido', i);
          finishToken(chunk, i); continue;
        }
        if (token.kind === 'literal') {
          if (b !== token.literal.charCodeAt(token.position++)) fail('Literal inválido', i);
        } else {
          switch (token.state) {
            case 'sign':
              if (!isDigit(b)) fail('Número inválido', i);
              token.state = b === 48 ? 'zero' : 'integer'; break;
            case 'zero': case 'integer':
              if (b === 46) token.state = 'dot';
              else if (b === 101 || b === 69) token.state = 'exponent';
              else if (!isDigit(b) || token.state === 'zero') fail('Número inválido', i);
              break;
            case 'dot':
              if (!isDigit(b)) fail('Número inválido', i);
              token.state = 'fraction'; break;
            case 'fraction':
              if (b === 101 || b === 69) token.state = 'exponent';
              else if (!isDigit(b)) fail('Número inválido', i);
              break;
            case 'exponent':
              if (b === 43 || b === 45) token.state = 'exponentSign';
              else if (isDigit(b)) token.state = 'exponentDigits';
              else fail('Número inválido', i);
              break;
            case 'exponentSign': case 'exponentDigits':
              if (!isDigit(b)) fail('Número inválido', i);
              token.state = 'exponentDigits'; break;
          }
        }
        i++; continue;
      }
      if (isWhitespace(b)) { i++; continue; }
      if (finished) fail('Contenido después del cierre del array', i);
      if (!started) {
        if (b !== 91) fail('Se esperaba "["', i);
        stack.push({ kind: 'array', state: 'first', root: true });
        started = true; i++; continue;
      }
      const frame = stack.at(-1);
      if (frame.state === 'comma') {
        if (b === 44) frame.state = frame.kind === 'array' ? 'value' : 'key';
        else if (b === (frame.kind === 'array' ? 93 : 125)) close(i);
        else fail('Se esperaba una coma o el cierre', i);
        i++; continue;
      }
      if (frame.state === 'colon') {
        if (b !== 58) fail('Se esperaba ":"', i);
        frame.state = 'value'; i++; continue;
      }
      if (frame.kind === 'object' && (frame.state === 'first' || frame.state === 'key')) {
        if (b === 125 && frame.state === 'first') { close(i); i++; continue; }
        if (b !== 34) fail('Se esperaba clave string', i);
        token = { kind: 'string', key: true, capture: !!frame.event, parts: [], start: i + 1 };
        i++; continue;
      }
      if (frame.kind === 'array' && frame.state === 'first' && b === 93) { close(i); i++; continue; }
      if (frame.root && b !== 123) fail('Se esperaba un objeto de reproducción', i);
      if (b === 123 || b === 91) {
        if (frame.spec) fail('Se esperaba un valor escalar', i, true);
        stack.push({ kind: b === 123 ? 'object' : 'array', state: 'first', event: frame.root ? {} : null });
      } else if (b === 34) {
        token = { kind: 'string', capture: !!frame.spec, parts: [], start: i + 1 };
      } else if (b === 45 || isDigit(b)) {
        token = { kind: 'number', capture: !!frame.spec, parts: [], start: i,
          state: b === 45 ? 'sign' : b === 48 ? 'zero' : 'integer' };
      } else if (b === 116 || b === 102 || b === 110) {
        token = { kind: 'literal', literal: b === 116 ? 'true' : b === 102 ? 'false' : 'null', position: 1 };
      } else fail('Se esperaba un valor JSON', i);
      i++;
    }
    if (token?.capture) { token.parts.push(chunk.slice(token.start)); token.start = 0; }
    offset += chunk.length;
  }

  function end() {
    if (!finished || token) fail('JSON incompleto', 0);
    return events;
  }
  return { push, end };
}
