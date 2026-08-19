export function redactSensitiveValue(value: string) {
  // No redaction, too short. 5 char secrets are your problem.
  // Not secure to be redacted. More utility in verification.
  if (value.length <= 5) return value;
  return `${value.slice(0, 3)}******${value.slice(-3)}`;
}
