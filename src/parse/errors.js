// errors.js — errores del parseo (fail-fast, todo o nada, con localización)

export class ParseError extends Error {
  constructor(message, { byteOffset, field } = {}) {
    super(message);
    this.name = 'ParseError';
    this.code = 'E_PARSE';
    this.byteOffset = byteOffset;
    this.field = field;
  }
}

export class SchemaError extends Error {
  constructor(message, { byteOffset, field } = {}) {
    super(message);
    this.name = 'SchemaError';
    this.code = 'E_SCHEMA';
    this.byteOffset = byteOffset;
    this.field = field;
  }
}

export class FileError extends Error {
  constructor(message, { cause } = {}) {
    super(message, { cause });
    this.name = 'FileError';
    this.code = 'E_FILE';
  }
}

export class AbortError extends Error {
  constructor(message = 'Operación abortada') {
    super(message);
    this.name = 'AbortError';
    this.code = 'E_ABORT';
  }
}

export class EmptyFileError extends Error {
  constructor(message = 'No se encontraron eventos musicales') {
    super(message);
    this.name = 'EmptyFileError';
    this.code = 'E_EMPTY';
  }
}