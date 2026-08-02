import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  infrastructureDbSchema,
  type InfrastructureDb,
  type ScannedService,
} from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scanRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(scanRoot, "..");
const defaultOutPath = path.join(
  repoRoot,
  "ui",
  "data",
  "infrastructure.json",
);

const SERVICE_COUNT = 1000;
const GROUP_COUNT = 100;
/** Minimum distinct service kinds that must appear inside every group. */
const MIN_KINDS_PER_GROUP = 3;
const MAX_KINDS_PER_GROUP = 6;

const ZONES = ["payment", "auth", "edge", "data", "compute"] as const;
const HEALTH = ["healthy", "warning", "critical"] as const;

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

const COLORS = [
  "#111827",
  "#1e3a5f",
  "#14532d",
  "#713f12",
  "#4c1d95",
  "#7f1d1d",
  "#0f766e",
  "#1e40af",
] as const;

/** Distinct service kinds that can be mixed inside a group. */
const SERVICE_KINDS = [
  {
    type: "Worker",
    species: "microservice",
    category: "compute",
  },
  {
    type: "D1",
    species: "database",
    category: "database",
  },
  {
    type: "KV",
    species: "database",
    category: "database",
  },
  {
    type: "R2",
    species: "object_storage",
    category: "storage",
  },
  {
    type: "Queue",
    species: "queue",
    category: "integration",
  },
  {
    type: "Vectorize",
    species: "database",
    category: "database",
  },
  {
    type: "Gateway",
    species: "api_gateway",
    category: "integration",
  },
  {
    type: "CDN",
    species: "cdn_edge",
    category: "compute",
  },
  {
    type: "LoadBalancer",
    species: "load_balancer",
    category: "compute",
  },
] as const satisfies ReadonlyArray<{
  type: string;
  species: ScannedService["species"];
  category: ScannedService["category"];
}>;

type ServiceKind = (typeof SERVICE_KINDS)[number];

type MockGroup = {
  group: string;
  zone: ScannedService["zone"];
  color: string;
  /** Mixture of kinds that members of this group will draw from. */
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

function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function pickKinds(rand: () => number): ServiceKind[] {
  const count =
    MIN_KINDS_PER_GROUP +
    Math.floor(rand() * (MAX_KINDS_PER_GROUP - MIN_KINDS_PER_GROUP + 1));
  return shuffle(rand, SERVICE_KINDS).slice(0, count);
}

function buildGroups(rand: () => number): MockGroup[] {
  const groups: MockGroup[] = [];
  const used = new Set<string>();

  while (groups.length < GROUP_COUNT) {
    const base = pick(rand, GROUP_NAMES);
    const suffix = pick(rand, SUFFIXES);
    const group = `${base}-${suffix}`;
    if (used.has(group)) continue;
    used.add(group);

    groups.push({
      group,
      zone: pick(rand, ZONES),
      color: pick(rand, COLORS),
      kinds: pickKinds(rand),
    });
  }

  return groups;
}

function randomMetrics(rand: () => number): ScannedService["metrics"] {
  return {
    rps: Math.round(rand() * 5000),
    errorRate: Number((rand() * 0.08).toFixed(4)),
    latencyMs: Math.round(8 + rand() * 240),
  };
}

/**
 * Assign roughly even membership across groups, then guarantee every group
 * contains at least MIN_KINDS_PER_GROUP distinct service types.
 */
function allocateMembership(
  rand: () => number,
  groups: MockGroup[],
): number[] {
  const membership = Array.from({ length: SERVICE_COUNT }, () =>
    Math.floor(rand() * groups.length),
  );

  // Ensure no group is empty so the mixture pass can run.
  for (let g = 0; g < groups.length; g += 1) {
    if (membership.includes(g)) continue;
    membership[g % SERVICE_COUNT] = g;
  }

  return membership;
}

/** Build 1000 scanned services across ~100 groups with mixed kinds per group. */
export function createMockServices(seed = 42): ScannedService[] {
  const rand = mulberry32(seed);
  const groups = buildGroups(rand);
  const membership = allocateMembership(rand, groups);
  const services: ScannedService[] = [];

  // Per-group counters so we can force a mixture of kinds.
  const kindCursor = groups.map(() => 0);

  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const groupIndex = membership[i]!;
    const template = groups[groupIndex]!;
    const cursor = kindCursor[groupIndex]!;
    // Round-robin through the group's kind mix so every kind appears,
    // then fall back to random picks for leftovers.
    const kind =
      cursor < template.kinds.length
        ? template.kinds[cursor]!
        : pick(rand, template.kinds);
    kindCursor[groupIndex] = cursor + 1;

    const n = i + 1;
    services.push({
      id: `mock-${String(n).padStart(4, "0")}`,
      type: kind.type,
      name: `${template.group}-${kind.type.toLowerCase()}-${String(n).padStart(4, "0")}`,
      width: 1,
      depth: 1,
      group: template.group,
      connections: [],
      species: kind.species,
      category: kind.category,
      health: pick(rand, HEALTH),
      zone: template.zone,
      metrics: randomMetrics(rand),
      color: template.color,
    });
  }

  // Wire a few random connections so the UI has something to draw.
  for (let i = 0; i < SERVICE_COUNT; i += 1) {
    const degree = Math.floor(rand() * 3);
    const source = services[i]!;
    const targets = new Set<string>();
    for (let d = 0; d < degree; d += 1) {
      const target = pick(rand, services);
      if (target.id === source.id) continue;
      targets.add(target.id);
    }
    source.connections = [...targets];
  }

  return services;
}

export function createMockInfrastructureDb(seed = 42): InfrastructureDb {
  return infrastructureDbSchema.parse({
    version: 1 as const,
    scannedAt: new Date().toISOString(),
    services: createMockServices(seed),
    warnings: ["Generated from scan/src/mock.ts"],
  });
}

async function main() {
  const outPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultOutPath;

  const db = createMockInfrastructureDb();

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");

  const byGroup = new Map<string, Set<string>>();
  for (const service of db.services) {
    const types = byGroup.get(service.group) ?? new Set<string>();
    types.add(service.type);
    byGroup.set(service.group, types);
  }

  const mixed = [...byGroup.values()].filter((types) => types.size >= 2).length;
  console.log(
    `[mock] wrote ${db.services.length} services across ${byGroup.size} groups → ${outPath}`,
  );
  console.log(
    `[mock] ${mixed}/${byGroup.size} groups contain a mixture of service types`,
  );
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error("[mock] failed", error);
    process.exitCode = 1;
  });
}
