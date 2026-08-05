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

function buildGroups(rand: () => number): MockGroup[] {
  const groups: MockGroup[] = [];
  const used = new Set<string>();

  while (groups.length < GROUP_COUNT) {
    const group = `${pick(rand, GROUP_NAMES)}-${pick(rand, SUFFIXES)}`;
    if (used.has(group)) continue;
    used.add(group);

    groups.push({
      group,
      kinds: pickKinds(rand),
    });
  }

  return groups;
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
        service: "Worker",
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
        service: "R2",
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
        service: kind,
        fields: {
          networking: {
            "bool:Is Open To Internet": false,
          },
        },
      };
  }
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
    services.push(
      buildService(kind, {
        id: `mock-${String(n).padStart(4, "0")}`,
        name: `${template.group}-${kind.toLowerCase()}-${String(n).padStart(4, "0")}`,
        group: template.group,
        connections: [],
      }),
    );
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
    types.add(service.service);
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
