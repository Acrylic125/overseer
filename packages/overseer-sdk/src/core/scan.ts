import type { Resource } from "../types.js";
import { linkResources, type LinkEntry } from "./link.js";

export function scanEntries<T>(
  scanner: {
    transform: (item: T, namespace: string) => Resource | null;
    connection: (item: T) => LinkEntry["connection"];
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
      connection: scanner.connection(item),
    };
    entries.push(entry);
  }
  return entries;
}

export { linkResources as linkByReferences };
