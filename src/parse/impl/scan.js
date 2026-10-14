// scan.js — scanner JSON incremental (state machine sobre bytes)
//
// Procesa un array de objetos JSON: [{"ts":"...","ms_played":123,...}, ...].
// - Emite eventos completos (objetos con campos allowlist) al cerrar cada objeto.
// - Skip de claves no permitidas SIN alocar (ip_addr/conn_country nunca se materializan).
// - Maneja valores que cruzan límites de chunk (rangeCarry).
// - Fail-fast: JSON malformado → ParseError, tipo incorrecto → SchemaError, con byteOffset.
//
// El test de split-invariance (mismo dataset para todo tamaño de chunk) es la red
// de seguridad de este módulo.

import { ParseError, SchemaError } from '../errors.js';
import { utf8Encode } from '../text.js';

const S = {
  ARRAY_START: 0,
  ARRAY_ITEM: 1,
  OBJECT_KEY: 2,
  OBJECT_COLON: 3,
  OBJECT_VALUE: 4,
  OBJECT_COMMA: 5,
  STRING: 6,
  STRING_ESCAPE: 7,
  NUMBER: 8,
  LITERAL: 9,
  SKIP_STRING: 10,
  SKIP_STRING_ESCAPE: 11,
  SKIP_VALUE: 12,
  END: 13
};

const SP = 0x20, TAB = 0x09, LF = 0x0a, CR = 0x0d;
const QUOTE = 0x22, BACKSLASH = 0x5c, COMMA = 0x2c, COLON = 0x3a;
const LBRACE = 0x7b, RBRACE = 0x7d, LBRACKET = 0x5b, RBRACKET = 0x5d;
const MINUS = 0x2d;
const ZERO = 0x30, NINE = 0x39;

function isWS(b) { return b === SP || b === TAB || b === LF || b === CR; }
function isDigit(b) { return b >= ZERO && b <= NINE; }

// Allowlist: nombre crudo → {type, name}. Los campos fuera de esta lista se
// saltan sin alocar (privacidad por tipo: ip_addr/conn_country/etc. no existen).
const ALLOWLIST = {
  ts: { type: 'string', name: 'ts' },
  ms_played: { type: 'number', name: 'ms' },
  master_metadata_track_name: { type: 'string', name: 'track' },
  master_metadata_album_artist_name: { type: 'string', name: 'artist' },
  master_metadata_album_album_name: { type: 'string', name: 'album' },
  spotify_track_uri: { type: 'string', name: 'uri' },
  reason_start: { type: 'string', name: 'reasonStart' },
  reason_end: { type: 'string', name: 'reasonEnd' },
  shuffle: { type: 'boolean', name: 'shuffle' },
  skipped: { type: 'boolean', name: 'skipped' },
  offline: { type: 'boolean', name: 'offline' }
};

// Keys pre-codificadas para comparación por bytes (sin materializar strings de keys).
const ALLOWLIST_KEYS = Object.entries(ALLOWLIST).map(([raw, spec]) => ({
  bytes: utf8Encode(raw),
  spec
}));

function matchKey(bytes) {
  for (const { bytes: kb, spec } of ALLOWLIST_KEYS) {
    if (bytes.length === kb.length) {
      let eq = true;
      for (let i = 0; i < kb.length; i++) {
        if (bytes[i] !== kb[i]) { eq = false; break; }
      }
      if (eq) return spec;
    }
  }
  return null;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function createScanner({ onEvent, onError }) {
  let state = S.ARRAY_START;
  let afterString = S.OBJECT_COLON; // estado al cerrar un string (key → colon, value → comma)
  let currentKey = null; // spec de la key actual, o null (no permitida / sin key)
  let currentEvent = null;
  let rangeStart = -1; // inicio del rango (string/number/literal) en el chunk actual
  let rangeCarry = null; // bytes acumulados de chunks previos
  let chunkStart = 0; // offset del chunk actual en el stream
  let events = 0;
  let expectKey = false; // tras "," en objeto: la próxima key es obligatoria (JSON estricto)
  let expectItem = false; // tras "," en array: el próximo item es obligatorio

  function fail(code, msg, i) {
    const err = code === 'E_PARSE'
      ? new ParseError(msg, { byteOffset: chunkStart + i })
      : new SchemaError(msg, { byteOffset: chunkStart + i });
    if (onError) onError(err);
    throw err;
  }

  function closeRange(chunk, i) {
    if (rangeCarry) {
      const b = concat(rangeCarry, chunk.subarray(rangeStart, i));
      rangeCarry = null;
      return b;
    }
    return chunk.subarray(rangeStart, i);
  }

  function beginRange(i) {
    rangeStart = i;
    rangeCarry = null;
  }

  function closeObject(i) {
    if (currentEvent && Object.keys(currentEvent).length > 0) {
      onEvent(currentEvent);
      events++;
    }
    currentEvent = null;
    currentKey = null;
    state = S.ARRAY_ITEM;
  }

  function setStringValue(bytes, i) {
    if (afterString === S.OBJECT_COLON) {
      // es una key
      currentKey = matchKey(bytes);
      state = S.OBJECT_COLON;
    } else {
      // es un value string
      if (currentKey) {
        if (currentKey.type !== 'string') {
          fail('E_SCHEMA', `Campo "${currentKey.name}": se esperaba ${currentKey.type}`, i);
        }
        currentEvent[currentKey.name] = bytes;
      }
      currentKey = null;
      state = S.OBJECT_COMMA;
    }
  }

  function setNumberValue(bytes, i) {
    const s = decodeJSONString(bytes);
    const v = parseFloat(s);
    if (!Number.isFinite(v)) fail('E_PARSE', 'Número inválido', i);
    if (currentKey) {
      if (currentKey.type !== 'number') {
        fail('E_SCHEMA', `Campo "${currentKey.name}": se esperaba ${currentKey.type}`, i);
      }
      currentEvent[currentKey.name] = v;
    }
    currentKey = null;
    state = S.OBJECT_COMMA;
  }

  function setLiteralValue(bytes, i) {
    let v;
    if (bytes.length === 4 && bytes[0] === 0x74 && bytes[1] === 0x72 && bytes[2] === 0x75 && bytes[3] === 0x65) v = true;
    else if (bytes.length === 5 && bytes[0] === 0x66 && bytes[1] === 0x61 && bytes[2] === 0x6c && bytes[3] === 0x73 && bytes[4] === 0x65) v = false;
    else if (bytes.length === 4 && bytes[0] === 0x6e && bytes[1] === 0x75 && bytes[2] === 0x6c && bytes[3] === 0x6c) v = null;
    else fail('E_PARSE', 'Literal inválido', i);
    if (currentKey) {
      if (v === null) {
        // null = ausente (campos opcionales; ts null → NO_TS, ms null → 0, etc.)
      } else if (currentKey.type !== 'boolean') {
        fail('E_SCHEMA', `Campo "${currentKey.name}": se esperaba ${currentKey.type}`, i);
      } else {
        currentEvent[currentKey.name] = v;
      }
    }
    currentKey = null;
    state = S.OBJECT_COMMA;
  }

  function push(chunk) {
    let i = 0;
    const n = chunk.length;
    while (i < n) {
      const b = chunk[i];
      switch (state) {
        case S.ARRAY_START:
          if (b === LBRACKET) { state = S.ARRAY_ITEM; i++; }
          else if (isWS(b)) i++;
          else fail('E_PARSE', 'Se esperaba "["', i);
          break;

        case S.ARRAY_ITEM:
          if (b === LBRACE) { currentEvent = {}; expectItem = false; state = S.OBJECT_KEY; i++; }
          else if (b === RBRACKET) {
            if (expectItem) fail('E_PARSE', 'Coma final en array', i);
            state = S.END; i++;
          }
          else if (b === COMMA) { expectItem = true; i++; }
          else if (isWS(b)) i++;
          else fail('E_PARSE', 'Se esperaba "{" o "]"', i);
          break;

        case S.OBJECT_KEY:
          if (b === QUOTE) { afterString = S.OBJECT_COLON; expectKey = false; beginRange(i + 1); state = S.STRING; i++; }
          else if (b === RBRACE) {
            if (expectKey) fail('E_PARSE', 'Coma final en objeto', i);
            closeObject(i); i++;
          }
          else if (isWS(b)) i++;
          else fail('E_PARSE', 'Se esperaba clave string o "}"', i);
          break;

        case S.OBJECT_COLON:
          if (b === COLON) { state = S.OBJECT_VALUE; i++; }
          else if (isWS(b)) i++;
          else fail('E_PARSE', 'Se esperaba ":"', i);
          break;

        case S.OBJECT_VALUE:
          if (b === QUOTE) {
            if (currentKey) { afterString = S.OBJECT_COMMA; beginRange(i + 1); state = S.STRING; }
            else state = S.SKIP_STRING;
            i++;
          } else if (isDigit(b) || b === MINUS) {
            if (currentKey) { beginRange(i); state = S.NUMBER; }
            else state = S.SKIP_VALUE;
            i++;
          } else if (b === 0x74 || b === 0x66 || b === 0x6e) { // t/f/n
            if (currentKey) { beginRange(i); state = S.LITERAL; }
            else state = S.SKIP_VALUE;
            i++;
          } else if (isWS(b)) i++;
          else fail('E_PARSE', 'Se esperaba valor', i);
          break;

        case S.OBJECT_COMMA:
          if (b === COMMA) { expectKey = true; state = S.OBJECT_KEY; i++; }
          else if (b === RBRACE) { closeObject(i); i++; }
          else if (isWS(b)) i++;
          else fail('E_PARSE', 'Se esperaba "," o "}"', i);
          break;

        case S.STRING:
          if (b === QUOTE) {
            const bytes = closeRange(chunk, i);
            setStringValue(bytes, i);
            i++;
          } else if (b === BACKSLASH) {
            state = S.STRING_ESCAPE;
            i++;
          } else {
            i++;
          }
          break;

        case S.STRING_ESCAPE:
          state = S.STRING;
          i++;
          break;

        case S.NUMBER:
          if (b === COMMA || b === RBRACE || isWS(b)) {
            const bytes = closeRange(chunk, i);
            setNumberValue(bytes, i);
            // el byte actual se procesa en OBJECT_COMMA (no avanzar)
          } else {
            i++;
          }
          break;

        case S.LITERAL:
          if (b === COMMA || b === RBRACE || isWS(b)) {
            const bytes = closeRange(chunk, i);
            setLiteralValue(bytes, i);
          } else {
            i++;
          }
          break;

        case S.SKIP_STRING:
          if (b === QUOTE) { state = S.OBJECT_COMMA; i++; }
          else if (b === BACKSLASH) { state = S.SKIP_STRING_ESCAPE; i++; }
          else i++;
          break;

        case S.SKIP_STRING_ESCAPE:
          state = S.SKIP_STRING;
          i++;
          break;

        case S.SKIP_VALUE:
          if (b === COMMA) { state = S.OBJECT_KEY; i++; }
          else if (b === RBRACE) { closeObject(i); i++; }
          else if (isWS(b)) i++;
          else i++;
          break;

        case S.END:
          if (isWS(b)) i++;
          else fail('E_PARSE', 'Contenido después del cierre del array', i);
          break;
      }
    }

    // Fin del chunk: si quedó un rango abierto (string/number/literal), acumular.
    if (state === S.STRING || state === S.STRING_ESCAPE || state === S.NUMBER || state === S.LITERAL) {
      const from = rangeStart >= 0 ? rangeStart : 0;
      const part = chunk.subarray(from);
      rangeCarry = rangeCarry ? concat(rangeCarry, part) : part;
      rangeStart = 0;
    }
    chunkStart += n;
  }

  function end() {
    if (state === S.STRING || state === S.STRING_ESCAPE) fail('E_PARSE', 'String sin cerrar', 0);
    if (state === S.NUMBER || state === S.LITERAL) fail('E_PARSE', 'Valor sin cerrar', 0);
    if (state !== S.END) fail('E_PARSE', 'JSON incompleto', 0);
    return events;
  }

  return { push, end };
}

import { decodeJSONString } from '../text.js';