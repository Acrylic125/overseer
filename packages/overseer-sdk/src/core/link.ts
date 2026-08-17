import { pushConnection } from "./connections.js";
import type { Resource, ResourceConnection, ScannerExposure } from "../types.js";

export type LinkEntry = {
  resource: Resource;
  references: string[];
  isExposedBy: (use: string) => ScannerExposure;
};

function normalizedReference(value: string) {
  return value.trim().toLowerCase();
}

export function linkResources(entries: LinkEntry[]): ResourceConnection[] {
  const connections: ResourceConnection[] = [];
  const seenConnections = new Set<string>();
  const exposuresByReference = new Map<
    string,
    Array<{
      resource: Resource;
      exposure: Extract<ScannerExposure, { isConnected: true }>;
    }>
  >();

  for (const entry of entries) {
    for (const reference of entry.references) {
      const key = normalizedReference(reference);
      if (!key) continue;
      if (exposuresByReference.has(key)) continue;

      const matches: Array<{
        resource: Resource;
        exposure: Extract<ScannerExposure, { isConnected: true }>;
      }> = [];

      for (const candidate of entries) {
        const exposure = candidate.isExposedBy(reference);
        if (!exposure.isConnected) continue;
        matches.push({
          resource: candidate.resource,
          exposure,
        });
      }

      exposuresByReference.set(key, matches);
    }
  }

  for (const from of entries) {
    const seenReferences = new Set<string>();
    for (const reference of from.references) {
      const key = normalizedReference(reference);
      if (!key) continue;
      if (seenReferences.has(key)) continue;
      seenReferences.add(key);

      const matches = exposuresByReference.get(key);
      if (!matches) continue;

      for (const match of matches) {
        if (from.resource.id === match.resource.id) continue;
        if (match.exposure.error) {
          from.resource.alerts.push({
            type: "error",
            message: match.exposure.error,
          });
        }
        pushConnection(
          connections,
          seenConnections,
          from.resource.id,
          match.resource.id,
          match.exposure.label,
          "",
          match.exposure.error ? "error" : undefined,
        );
      }
    }
  }

  return connections;
}
