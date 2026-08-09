import { iconServiceForCfKind } from "./icons.js";
import {
  ensureInternetHub,
  isInternetService,
  isOpenToInternet,
} from "./internet.js";
import type { ScannedService } from "./schema.js";

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
  /** Full path, e.g. `payments-hub`, `payments-hub/checkout`, or `…/edge`. */
  group: string;
  kinds: ServiceKind[];
};

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

function uniqueSegment(rand: () => number, used: Set<string>): string {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const segment = `${pick(rand, GROUP_NAMES)}-${pick(rand, SUFFIXES)}`;
    if (!used.has(segment)) {
      used.add(segment);
      return segment;
    }
  }
  const fallback = `group-${used.size}`;
  used.add(fallback);
  return fallback;
}

function pickKinds(rand: () => number): ServiceKind[] {
  const count =
    MIN_KINDS_PER_GROUP +
    Math.floor(rand() * (MAX_KINDS_PER_GROUP - MIN_KINDS_PER_GROUP + 1));
  const pool = [...SERVICE_KINDS];
  const kinds: ServiceKind[] = [];
  while (kinds.length < count && pool.length > 0) {
    const index = Math.floor(rand() * pool.length);
    kinds.push(pool.splice(index, 1)[0]!);
  }
  return kinds;
}

/** Register `a`, `a/b`, … for a path so ancestors can own services too. */
function addPathAndAncestors(
  path: string,
  rand: () => number,
  groups: MockGroup[],
  usedPaths: Set<string>,
): void {
  const segments = path.split(GROUP_SEP).filter(Boolean);
  for (let i = 1; i <= segments.length; i += 1) {
    const prefix = segments.slice(0, i).join(GROUP_SEP);
    if (usedPaths.has(prefix)) continue;
    usedPaths.add(prefix);
    groups.push({ group: prefix, kinds: pickKinds(rand) });
  }
}

/**
 * Build group paths (depth 1–3). Deep A→B→C trees also register A and A/B so
 * services can sit on ancestors, not only leaves.
 */
function buildGroups(rand: () => number): MockGroup[] {
  const groups: MockGroup[] = [];
  const usedSegments = new Set<string>();
  const usedPaths = new Set<string>();

  // Guaranteed A → B → C trees with services at every level.
  for (let i = 0; i < DEEP_TREES_WITH_ANCESTOR_SERVICES; i += 1) {
    const a = uniqueSegment(rand, usedSegments);
    const b = uniqueSegment(rand, usedSegments);
    const c = uniqueSegment(rand, usedSegments);
    addPathAndAncestors([a, b, c].join(GROUP_SEP), rand, groups, usedPaths);
  }

  // Fill remaining diversity with random depths (ancestors included).
  while (groups.length < GROUP_PATH_COUNT) {
    const depth = 1 + Math.floor(rand() * MAX_GROUP_DEPTH);
    const segments: string[] = [];
    for (let d = 0; d < depth; d += 1) {
      segments.push(uniqueSegment(rand, usedSegments));
    }
    const before = groups.length;
    addPathAndAncestors(segments.join(GROUP_SEP), rand, groups, usedPaths);
    if (groups.length === before) break;
  }

  return groups;
}

/** Assign roughly even membership across all service-bearing group paths. */
function allocateMembership(rand: () => number, groups: MockGroup[]): number[] {
  const membership = Array.from({ length: SERVICE_COUNT }, () =>
    Math.floor(rand() * groups.length),
  );

  for (let g = 0; g < groups.length; g += 1) {
    if (membership.includes(g)) continue;
    membership[g % SERVICE_COUNT] = g;
  }

  return membership;
}

function buildService(
  kind: ServiceKind,
  base: {
    id: string;
    name: string;
    group: string;
    connections: string[];
  },
): ScannedService {
  const shared = {
    ...base,
    sourceType: "cf",
  };

  switch (kind) {
    case "Worker":
      return {
        ...shared,
        service: iconServiceForCfKind("Worker"),
        fields: {
          networking: {
            "bool:Is Open To Internet": true,
            "link:Entry Domain": `${base.name}.example.workers.dev`,
          },
          observability: {
            "link:View Logs": `https://dash.cloudflare.com/mock/workers/services/view/${encodeURIComponent(base.name)}/production/observability/events`,
          },
        },
      };
    case "R2":
      return {
        ...shared,
        service: iconServiceForCfKind("R2"),
        fields: {
          networking: {
            "bool:Is Open To Internet": false,
            "link:S3 API URL": `https://mock.r2.cloudflarestorage.com/${base.name}`,
            cors: ["GET https://example.com", "PUT https://example.com"],
          },
        },
      };
    case "D1":
    case "KV":
    case "Queue":
    case "Vectorize":
      return {
        ...shared,
        service: iconServiceForCfKind(kind),
        fields: {
          networking: {
            "bool:Is Open To Internet": false,
          },
        },
      };
  }
}

/**
 * Build 10000 scanned services across nested groups (depth ≤ 3).
 * Deep trees place services on A, A/B, and A/B/C — not only the leaf.
 */
export function createMockServices(seed = 42): ScannedService[] {
  const rand = mulberry32(seed);
  const groups = buildGroups(rand);
  const membership = allocateMembership(rand, groups);
  const services: ScannedService[] = [];

  const kindCursor = groups.map(() => 0);

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
    services.push(
      buildService(kind, {
        id: `mock-${String(n).padStart(5, "0")}`,
        name: `${label}-${kind.toLowerCase()}-${String(n).padStart(5, "0")}`,
        group: template.group,
        connections: [],
      }),
    );
  }

  // Prefer connections inside the same group path (including A↔A, B↔B).
  const byGroup = new Map<string, ScannedService[]>();
  for (const service of services) {
    if (service.group == null) continue;
    const list = byGroup.get(service.group) ?? [];
    list.push(service);
    byGroup.set(service.group, list);
  }

  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const degree = Math.floor(rand() * 3);
    const source = services[i]!;
    const pool =
      (source.group != null ? byGroup.get(source.group) : undefined) ??
      services;
    const targets = new Set<string>();
    for (let d = 0; d < degree; d += 1) {
      const target = pick(rand, pool);
      if (target.id === source.id) continue;
      targets.add(target.id);
    }
    source.connections = [...targets];
  }

  // Cap how many workers advertise open-to-internet (layout derives hub edges).
  let internetLinks = 0;
  return ensureInternetHub(services).map((service) => {
    if (isInternetService(service)) return service;
    if (!isOpenToInternet(service.fields)) return service;
    internetLinks += 1;
    if (internetLinks <= MAX_MOCK_INTERNET_LINKS) return service;
    return {
      ...service,
      fields: {
        ...service.fields,
        networking: {
          ...(service.fields.networking ?? {}),
          "bool:Is Open To Internet": false,
        },
      },
    };
  });
}
