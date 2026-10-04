const VISIBLE_CHARS = 3;
const MASK = "******";
// Below this length a 3+3 hint would reveal most of the secret, so mask it fully.
const MIN_LENGTH_FOR_HINT = 12;

export function redactSensitiveValue(value: string) {
  if (value.length < MIN_LENGTH_FOR_HINT) return MASK;
  return `${value.slice(0, VISIBLE_CHARS)}${MASK}${value.slice(-VISIBLE_CHARS)}`;
}
