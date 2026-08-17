import { parseEnvUrl } from "./env.js";
import type { EnvVar } from "./env.js";
import type { ResourceClaims } from "../types.js";

export function envToClaims(envs: EnvVar[]) {
  const claims: ResourceClaims[] = [];
  for (const env of envs) {
    const value = env.value.trim();
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
