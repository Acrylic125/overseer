import type { EdgeKind, Reference } from "./schemas.js";

const HOST_PATTERN = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Lowercased hostname from a URL, origin, route pattern (`*.acme.com/*`) or bare host. */
export function hostOf(raw: string) {
  let value = raw.trim().toLowerCase();
  if (!value) return null;
  const scheme = value.indexOf("://");
  if (scheme >= 0) value = value.slice(scheme + 3);
  value = value.split(/[/?#]/)[0] ?? "";
  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);
  value = value.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!HOST_PATTERN.test(value)) return null;
  return value;
}

// Common words (production, true) would match resource names, so only id-like values count.
function isIdLike(value: string) {
  if (value.length < 6) return false;
  if (/\s/.test(value)) return false;
  return /[-_0-9]/.test(value);
}

/**
 * Secret values only contribute their hostname: the raw value never leaves the
 * scanner, so nothing secret ends up in the cache.
 */
export function envReferences(
  envs: Array<{ value: string; secret: boolean }>,
  kind: EdgeKind = "env",
) {
  const references: Reference[] = [];
  const seen = new Set<string>();
  for (const env of envs) {
    const value = env.value.trim();
    if (!value) continue;
    // Dotted tokens (including JWTs) can resemble hostnames. Only extract a
    // secret's host when it is explicitly a URL, never from a bare token.
    const host = !env.secret || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? hostOf(value)
      : null;
    let reference: Reference | null = null;
    if (host) {
      reference = { type: "host", value: host, kind };
    } else if (!env.secret && isIdLike(value)) {
      reference = { type: "ref", value, kind };
    }
    if (!reference) continue;
    const key = `${reference.type}:${reference.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push(reference);
  }
  return references;
}

export function refReferences(
  values: Array<string | null | undefined>,
  kind: EdgeKind,
) {
  const references: Reference[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({ type: "ref", value, kind });
  }
  return references;
}
