/**
 * Redact secret values: keep first 3 and last 3 chars when long enough,
 * with a fixed `******` middle. Shorter values are fully masked.
 */
export function redactSensitiveValue(value: string): string {
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}******${value.slice(-3)}`;
}
