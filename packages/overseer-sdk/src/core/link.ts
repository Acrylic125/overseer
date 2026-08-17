import { pushConnection } from "./connections.js";
import { parseEnvUrl } from "./env.js";
import type {
  ConnectionRequirement,
  Resource,
  ResourceClaims,
  ResourceConnection,
  ResourceConnectionHandler,
} from "../types.js";

export type LinkEntry = {
  resource: Resource;
  connection: ResourceConnectionHandler;
};

function claimKey(claim: ResourceClaims) {
  if (claim.type === "url") {
    const host =
      parseEnvUrl(claim.value)?.hostname.toLowerCase() ??
      claim.value.trim().toLowerCase();
    return `url:${host}`;
  }
  return `ref:${claim.value.trim().toLowerCase()}`;
}

function isValidClaimKey(key: string) {
  if (!key) return false;
  if (key === "url:" || key === "ref:") return false;
  return true;
}

export function linkResources(entries: LinkEntry[]): ResourceConnection[] {
  const connections: ResourceConnection[] = [];
  const seenConnections = new Set<string>();
  const matchesByClaim = new Map<
    string,
    Array<{
      resource: Resource;
      requirement: Extract<ConnectionRequirement, { type: "connected" }>;
    }>
  >();

  for (const entry of entries) {
    for (const claim of entry.connection.claims) {
      const key = claimKey(claim);
      if (!isValidClaimKey(key)) continue;
      if (matchesByClaim.has(key)) continue;

      const matches: Array<{
        resource: Resource;
        requirement: Extract<ConnectionRequirement, { type: "connected" }>;
      }> = [];

      for (const candidate of entries) {
        const requirement = candidate.connection.require(claim);
        if (!requirement) continue;
        matches.push({
          resource: candidate.resource,
          requirement,
        });
      }

      matchesByClaim.set(key, matches);
    }
  }

  for (const from of entries) {
    const seenClaims = new Set<string>();
    for (const claim of from.connection.claims) {
      const key = claimKey(claim);
      if (!isValidClaimKey(key)) continue;
      if (seenClaims.has(key)) continue;
      seenClaims.add(key);

      const matches = matchesByClaim.get(key);
      if (!matches) continue;

      for (const match of matches) {
        if (from.resource.id === match.resource.id) continue;
        if (match.requirement.errorMessage) {
          from.resource.alerts.push({
            type: "error",
            message: match.requirement.errorMessage,
          });
        }
        pushConnection(
          connections,
          seenConnections,
          from.resource.id,
          match.resource.id,
          match.requirement.label,
          "",
          match.requirement.errorMessage ? "error" : undefined,
        );
      }
    }
  }

  return connections;
}
