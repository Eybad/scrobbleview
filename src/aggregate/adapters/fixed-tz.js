// adapters/fixed-tz.js — offset constante (tests, zonas sin DST)

export function fixedTz(id, offsetMinutesValue) {
  return {
    id,
    offsetMinutes: () => offsetMinutesValue
  };
}