import {
  connectionKey,
  INTERNET_ID,
  internetResource,
  resourceConnection,
  type Resource,
  type ResourceConnection,
} from "@acrylic125/overseer-sdk";

import { iconServiceForCfKind } from "./icons.js";

/** Cap open-to-internet workers so mock connector routing stays responsive. */
const MAX_MOCK_INTERNET_LINKS = 64;

const SERVICE_COUNT = 10000;
/** Rough target for distinct group paths that can hold services. */
const GROUP_PATH_COUNT = 120;
/**
 * How many A→B→C trees always place services on A, on A/B, and on A/B/C.
 */
const DEEP_TREES_WITH_ANCESTOR_SERVICES = 16;
/** Nesting depth inclusive: 1 = flat, 3 = root/mid/leaf. */
const MAX_GROUP_DEPTH = 3;
const GROUP_SEP = "/";

/** Minimum distinct service kinds that must appear inside every group path. */
const MIN_KINDS_PER_GROUP = 3;
const MAX_KINDS_PER_GROUP = 6;

const GROUP_NAMES = [
  "auth",
  "billing",
  "checkout",
  "catalog",
  "edge",
  "events",
  "feed",
  "gateway",
  "identity",
  "ingest",
  "inventory",
  "ledger",
  "media",
  "notify",
  "orders",
  "payments",
  "profile",
  "search",
  "session",
  "shipping",
  "stream",
  "support",
  "telemetry",
  "wallet",
  "analytics",
  "compliance",
  "fraud",
  "loyalty",
  "messaging",
  "partner",
  "pricing",
  "recommendations",
  "reporting",
  "risk",
  "scheduler",
  "security",
  "subscriptions",
  "tax",
  "tickets",
  "workflow",
] as const;

const SUFFIXES = [
  "core",
  "platform",
  "hub",
  "stack",
  "plane",
  "domain",
  "cluster",
  "system",
] as const;

/** Distinct service kinds that can be mixed inside a group. */
const SERVICE_KINDS = [
  "Worker",
  "D1",
  "KV",
  "R2",
  "Queue",
  "Vectorize",
] as const;

type ServiceKind = (typeof SERVICE_KINDS)[number];

type MockGroup = {
  group: string;
  kinds: ServiceKind[];
};

function pushConnection(
  connections: ResourceConnection[],
  seen: Set<string>,
  from: string,
  to: string,
) {
  if (from === to) return;
  const connection = resourceConnection(from, to, "", "");
  const key = connectionKey(connection.nodes);
  if (seen.has(key)) return;
  seen.add(key);
  connections.push(connection);
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function buildGroups(rand: () => number): MockGroup[] {
  const groups: MockGroup[] = [];
  const used = new Set<string>();

  while (groups.length < GROUP_PATH_COUNT) {
    const depth = 1 + Math.floor(rand() * MAX_GROUP_DEPTH);
    const parts: string[] = [];
    for (let d = 0; d < depth; d += 1) {
      parts.push(pick(rand, GROUP_NAMES));
      if (d < depth - 1 && rand() < 0.35) {
        parts.push(pick(rand, SUFFIXES));
      }
    }
    const group = parts.join(GROUP_SEP);
    if (used.has(group)) continue;
    used.add(group);

    const kindCount =
      MIN_KINDS_PER_GROUP +
      Math.floor(rand() * (MAX_KINDS_PER_GROUP - MIN_KINDS_PER_GROUP + 1));
    const kinds = new Set<ServiceKind>();
    while (kinds.size < kindCount) {
      kinds.add(pick(rand, SERVICE_KINDS));
    }
    groups.push({ group, kinds: [...kinds] });
  }

  for (let t = 0; t < DEEP_TREES_WITH_ANCESTOR_SERVICES; t += 1) {
    const root = pick(rand, GROUP_NAMES);
    const mid = pick(rand, GROUP_NAMES);
    const leaf = pick(rand, GROUP_NAMES);
    for (const group of [`${root}`, `${root}/${mid}`, `${root}/${mid}/${leaf}`]) {
      if (used.has(group)) continue;
      used.add(group);
      groups.push({
        group,
        kinds: [pick(rand, SERVICE_KINDS), pick(rand, SERVICE_KINDS)],
      });
    }
  }

  return groups;
}

function allocateMembership(rand: () => number, groups: MockGroup[]): number[] {
  const membership = new Array<number>(SERVICE_COUNT);
  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    membership[i] = Math.floor(rand() * groups.length);
  }

  for (let g = 0; g < groups.length; g += 1) {
    if (membership.includes(g)) continue;
    membership[g % SERVICE_COUNT] = g;
  }

  return membership;
}

function buildService(
  kind: ServiceKind,
  base: {
    id: `mock:${string}`;
    name: string;
    group: string;
  },
): Resource {
  return {
    ...base,
    url: "",
    service: kind,
    asset: iconServiceForCfKind(kind),
    fields:
      kind === "Worker"
        ? {
            Domains: [`${base.name}.example.workers.dev`],
          }
        : kind === "R2"
          ? {
              "S3 API URL": `https://mock.r2.cloudflarestorage.com/${base.name}`,
            }
          : {},
    alerts: [],
    tags: { namespace: base.group },
  };
}

/** Build scanned resources across nested groups for layout stress tests. */
export function createMockServices(seed = 42) {
  const rand = mulberry32(seed);
  const groups = buildGroups(rand);
  const membership = allocateMembership(rand, groups);
  const services: Resource[] = [];
  const connections: ResourceConnection[] = [];
  const seenConnections = new Set<string>();
  const kindCursor = groups.map(() => 0);
  const openToInternet = new Set<string>();

  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const groupIndex = membership[i]!;
    const template = groups[groupIndex]!;
    const cursor = kindCursor[groupIndex]!;
    const kind =
      cursor < template.kinds.length
        ? template.kinds[cursor]!
        : pick(rand, template.kinds);
    kindCursor[groupIndex] = cursor + 1;

    const n = i + 1;
    const label = template.group.split(GROUP_SEP).at(-1) ?? template.group;
    const service = buildService(kind, {
      id: `mock:${String(n).padStart(5, "0")}`,
      name: `${label}-${kind.toLowerCase()}-${String(n).padStart(5, "0")}`,
      group: template.group,
    });
    if (kind === "Worker") {
      openToInternet.add(service.id);
    }
    services.push(service);
  }

  const byGroup = new Map<string, Resource[]>();
  for (const service of services) {
    const list = byGroup.get(service.group) ?? [];
    list.push(service);
    byGroup.set(service.group, list);
  }

  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const degree = Math.floor(rand() * 3);
    const source = services[i]!;
    const pool = byGroup.get(source.group) ?? services;
    for (let d = 0; d < degree; d += 1) {
      const target = pick(rand, pool);
      if (target.id === source.id) continue;
      pushConnection(connections, seenConnections, source.id, target.id);
    }
  }

  let internetLinks = 0;
  for (const service of services) {
    if (!openToInternet.has(service.id)) continue;
    internetLinks += 1;
    if (internetLinks > MAX_MOCK_INTERNET_LINKS) {
      continue;
    }
    pushConnection(connections, seenConnections, service.id, INTERNET_ID);
  }

  return {
    resources: [internetResource(), ...services],
    connections,
  };
}
