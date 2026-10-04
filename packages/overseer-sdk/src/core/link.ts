import { hostOf } from "./claims.js";
import type { Edge, Exposure, LinkEntry, Reference } from "./schemas.js";
import type { ResourceAlert } from "../types.js";

type Candidate = { entry: LinkEntry; exposure: Exposure };

function matchKey(item: { type: "host" | "ref"; value: string }) {
  if (item.type === "ref") return `ref:${item.value.trim().toLowerCase()}`;
  const host = hostOf(item.value);
  if (!host) return null;
  return `host:${host}`;
}

function push(map: Map<string, Candidate[]>, key: string, candidate: Candidate) {
  const list = map.get(key);
  if (list) list.push(candidate);
  else map.set(key, [candidate]);
}

function corsAlerts(
  from: LinkEntry,
  reference: Reference,
  candidates: Candidate[],
) {
  const alerts: ResourceAlert[] = [];
  if (reference.kind !== "env") return alerts;

  const origins: string[] = [];
  for (const exposure of from.exposes) {
    if (exposure.type !== "host" || exposure.entry) continue;
    const host = hostOf(exposure.value);
    if (host && !host.startsWith("*.")) origins.push(host);
  }
  if (origins.length === 0) return alerts;

  for (const candidate of candidates) {
    const allowed = candidate.exposure.allowedOrigins;
    if (!allowed) continue;
    const blocked = origins.filter(
      (origin) =>
        !allowed.some((rule) => rule.trim() === "*" || hostOf(rule) === origin),
    );
    if (blocked.length === 0) continue;
    alerts.push({
      type: blocked.length === origins.length ? "error" : "warning",
      message: `CORS on ${candidate.exposure.label} does not allow ${blocked.join(", ")}`,
    });
  }
  return alerts;
}

/**
 * Resolve references against exposures with an index (exact host, then the most
 * specific wildcard). A DNS hostname (`entry`) fronts the services behind it, so
 * references to that host go through the DNS resource instead of skipping it.
 */
export function linkEntries(entries: LinkEntry[]) {
  const exact = new Map<string, Candidate[]>();
  const wildcard = new Map<string, Candidate[]>();

  for (const entry of entries) {
    for (const exposure of entry.exposes) {
      const key = matchKey(exposure);
      if (!key) continue;
      if (key.startsWith("host:*.")) {
        push(wildcard, key.slice("host:*.".length), { entry, exposure });
      } else {
        push(exact, key, { entry, exposure });
      }
    }
  }

  const lookup = (key: string, selfId: string) => {
    const others = (list: Candidate[] | undefined) =>
      (list ?? []).filter((candidate) => candidate.entry.resource.id !== selfId);
    if (key.startsWith("ref:")) return others(exact.get(key));
    if (key.startsWith("host:*.")) {
      return others(wildcard.get(key.slice("host:*.".length)));
    }
    const direct = others(exact.get(key));
    if (direct.length > 0) return direct;
    let rest = key.slice("host:".length);
    while (true) {
      const dot = rest.indexOf(".");
      if (dot < 0) break;
      rest = rest.slice(dot + 1);
      if (!rest.includes(".")) break;
      const hits = others(wildcard.get(rest));
      if (hits.length > 0) return hits;
    }
    return [];
  };

  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const id = entry.resource.id;
    for (const reference of entry.references) {
      const key = matchKey(reference);
      if (!key) continue;
      let candidates = lookup(key, id);
      if (reference.kind === "binding") {
        const source = entry.resource.tags;
        candidates = candidates.filter(({ entry: target }) => {
          const tags = target.resource.tags;
          return source.provider === tags.provider && source.account === tags.account && source.namespace === tags.namespace;
        });
      }
      if (candidates.length === 0) continue;

      const selfFronts = entry.exposes.some(
        (exposure) => exposure.entry && matchKey(exposure) === key,
      );
      const fronts = candidates.filter((candidate) => candidate.exposure.entry);
      let targets = candidates;
      if (selfFronts) {
        targets = candidates.filter((candidate) => !candidate.exposure.entry);
      } else if (fronts.length > 0) {
        targets = fronts;
      }

      const alerts = corsAlerts(entry, reference, candidates);
      for (const target of targets) {
        const to = target.entry.resource.id;
        const edgeKey = `${id}\0${to}\0${reference.kind}`;
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        edges.push({
          from: id,
          to,
          kind: reference.kind,
          label: target.exposure.label,
          alerts,
        });
      }
    }
  }

  return edges;
}
