import type { ResourceClaims } from "../types.js";

export function parseEnvUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed);
    }
    return new URL(`https://${trimmed}`);
  } catch {
    return null;
  }
}

export function envToClaims(values: string[]) {
  const claims: ResourceClaims[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const url = parseEnvUrl(value);
    if (url) {
      claims.push({ type: "url", value: url.hostname });
    } else {
      claims.push({ type: "ref", value });
    }
  }
  return claims;
}

function hostFromUrl(value: string) {
  return (
    parseEnvUrl(value)?.hostname.toLowerCase() ?? value.trim().toLowerCase()
  );
}

export function urlBaseMatchClaim(url: string, claim: ResourceClaims) {
  if (claim.type !== "url") {
    return false;
  }
  const urlHost = hostFromUrl(url);
  const claimHost = hostFromUrl(claim.value);
  if (!urlHost || !claimHost) {
    return false;
  }
  if (urlHost === claimHost) {
    return true;
  }
  if (urlHost.endsWith(`.${claimHost}`)) {
    return true;
  }
  if (claimHost.endsWith(`.${urlHost}`)) {
    return true;
  }
  return false;
}
