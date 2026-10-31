import { generateSyntheticEvents } from '../src/synthetic.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';

export function demoSource(n = 3000, seed = 42) {
  return memoryBytes('demo.json', JSON.stringify(generateSyntheticEvents(n, seed)));
}
