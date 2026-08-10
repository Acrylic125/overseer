/**
 * Redact secret values: keep first 3 and last 3 chars when long enough,
 * with a fixed `******` middle. Shorter values are fully masked.
 */
export function redactSensitiveValue(value: string): string {
  if (value.length <= 6) return "******";
  return `${value.slice(0, 3)}******${value.slice(-3)}`;
}

/** Trimmed env value used for cross-service linking (secrets may still be `decrypted: false`). */
export function envValueForLinking(env: {
  value?: string;
  decrypted?: boolean;
}): string | null {
  const value = env.value?.trim();
  if (!value) return null;
  return value;
}

export function parseEnvUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return trimmed.includes("://")
      ? new URL(trimmed)
      : new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
}

/** Extract parseable URLs embedded in an env value. */
export function urlsFromEnvValue(value: string): URL[] {
  const urls: URL[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const url = parseEnvUrl(raw);
    if (!url) return;
    const key = url.href;
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  add(value);
  for (const match of value.matchAll(/https?:\/\/[^\s"'`]+/gi)) {
    add(match[0] ?? "");
  }

  return urls;
}
