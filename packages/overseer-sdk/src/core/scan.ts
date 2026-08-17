import type { Resource, ScannerExposure } from "../types.js";
import { linkResources, type LinkEntry } from "./link.js";

export function scanEntries<T>(
  scanner: {
    transform: (item: T, namespace: string) => Resource | null;
    references: (item: T) => string[];
    isExposedBy: (item: T, use: string) => ScannerExposure;
  },
  items: T[],
  namespace: string,
) {
  const entries = [];
  for (const item of items) {
    const resource = scanner.transform(item, namespace);
    if (!resource) continue;
    const entry: LinkEntry = {
      resource,
      references: scanner.references(item),
      isExposedBy: (use: string) => scanner.isExposedBy(item, use),
    };
    entries.push(entry);
  }
  return entries;
}

export { linkResources as linkByReferences };
