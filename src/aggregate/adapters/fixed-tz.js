export function fixedTz(id, offsetMinutesValue) {
  return {
    id,
    offsetMinutes: () => offsetMinutesValue
  };
}
