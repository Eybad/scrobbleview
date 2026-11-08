import { generateSyntheticEvents } from '../src/synthetic.js';
import { memoryBytes } from '../src/parse/adapters/memory-bytes.js';

export function demoSource(n = 3000, seed = 42) {
  const events = generateSyntheticEvents(n, seed);
  if (events.length) {
    const latestTimestampMs = events.reduce((latest, event) => Math.max(latest, Date.parse(event.ts)), -Infinity);
    const targetTimestampMs = Math.floor(Date.now() / 1000) * 1000;
    const shiftMs = targetTimestampMs - latestTimestampMs;
    for (const event of events) {
      event.ts = new Date(Date.parse(event.ts) + shiftMs).toISOString();
    }
  }
  return memoryBytes('demo.json', JSON.stringify(events));
}
