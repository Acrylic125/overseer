/**
 * Redact secret values: keep first 3 and last 3 chars, obscure the middle.
 * Short values keep a leading prefix then `*********`.
 */
export function redactSensitiveValue(value: string): string {
  if (value.length === 0) return "*********";
  if (value.length <= 6) {
    return `${value.slice(0, Math.min(3, value.length))}*********`;
  }
  return `${value.slice(0, 3)}*********${value.slice(-3)}`;
}

/** True when an env var type should be redacted in scan output. */
export function isSecretEnvType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return (
    normalized === "sensitive" ||
    normalized === "secret" ||
    normalized === "secret_text" ||
    normalized === "encrypted"
  );
}
