import type { Edge, GraphSnapshot } from "./schemas.js";
import type { Resource } from "../types.js";

export function createGraph(snapshot: GraphSnapshot) {
  const byId = new Map<string, Resource>();
  for (const resource of snapshot.resources) byId.set(resource.id, resource);

  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const edge of snapshot.edges) {
    const out = outgoing.get(edge.from);
    if (out) out.push(edge);
    else outgoing.set(edge.from, [edge]);
    const inc = incoming.get(edge.to);
    if (inc) inc.push(edge);
    else incoming.set(edge.to, [edge]);
  }

  const walk = (start: string, direction: "down" | "up") => {
    const seen = new Set<string>([start]);
    const queue = [start];
    const found: Resource[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const edges =
        direction === "down" ? outgoing.get(id) : incoming.get(id);
      for (const edge of edges ?? []) {
        const next = direction === "down" ? edge.to : edge.from;
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
        const resource = byId.get(next);
        if (resource) found.push(resource);
      }
    }
    return found;
  };

  return {
    snapshot,
    byId,
    outgoing,
    incoming,
    resources(filter: { service?: string; provider?: string; namespace?: string } = {}) {
      return snapshot.resources.filter((resource) => {
        if (filter.service && resource.service !== filter.service) return false;
        if (filter.provider && resource.tags.provider !== filter.provider && !resource.id.startsWith(`${filter.provider}:`)) {
          return false;
        }
        if (filter.namespace && resource.tags.namespace !== filter.namespace) {
          return false;
        }
        return true;
      });
    },
    downstream: (id: string) => walk(id, "down"),
    upstream: (id: string) => walk(id, "up"),
    /** Shortest directed chain from `from` to `to`, inclusive, or null. */
    path(from: string, to: string) {
      if (!byId.has(from) || !byId.has(to)) return null;
      const previous = new Map<string, string>();
      const seen = new Set<string>([from]);
      const queue = [from];
      while (queue.length > 0) {
        const id = queue.shift()!;
        if (id === to) break;
        for (const edge of outgoing.get(id) ?? []) {
          if (seen.has(edge.to)) continue;
          seen.add(edge.to);
          previous.set(edge.to, id);
          queue.push(edge.to);
        }
      }
      if (!seen.has(to)) return null;
      const ids = [to];
      while (ids[0] !== from) ids.unshift(previous.get(ids[0]!)!);
      return ids.map((id) => byId.get(id)).filter((resource) => resource != null);
    },
  };
}

export type Graph = ReturnType<typeof createGraph>;
