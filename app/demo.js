// app/demo.js — datos de ejemplo: generador sintético → ByteSource memory
//
// La demo no se testea: es el generador de fixtures (mismo tipo de datos que el
// parser consume). Determinista: siempre muestra lo mismo.

import { generateSyntheticEvents } from '../src/synthetic.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';

export function demoSource(n = 3000, seed = 42) {
  return memoryBytes('demo.json', JSON.stringify(generateSyntheticEvents(n, seed)));
}