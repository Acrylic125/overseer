import {
  connectionKey,
  resourceConnection,
  type ResourceConnection,
} from "../types.js";

export function pushConnection(
  connections: ResourceConnection[],
  seen: Set<string>,
  from: string,
  to: string,
  labelFromTo = "",
  labelToFrom = "",
  type?: "error",
) {
  if (from === to) return;
  const connection = resourceConnection(from, to, labelFromTo, labelToFrom, type);
  const key = connectionKey(connection.nodes);
  if (seen.has(key)) return;
  seen.add(key);
  connections.push(connection);
}

export function mergeResourceConnections(
  ...groups: ReadonlyArray<ReadonlyArray<ResourceConnection>>
) {
  const merged: ResourceConnection[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    for (const connection of group) {
      const key = connectionKey(connection.nodes);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(connection);
    }
  }

  return merged;
}
