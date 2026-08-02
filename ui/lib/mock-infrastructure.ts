import { layoutServices } from "@/lib/providers/cloudflare/layout";
import {
  SPECIES_STYLE,
  speciesToCategory,
} from "@/lib/infrastructure-styles";
import type {
  InfrastructureService,
  InfrastructureSpecies,
  InfrastructureZone,
  NodeHealth,
} from "@/server/routers/infrastructure";

const MOCK_SERVICE_COUNT = 56;
const MOCK_LAYOUT_CONNECTIONS_CAP = 10;

type MockMeta = {
  type: string;
  species: InfrastructureSpecies;
  zone: InfrastructureZone;
};

const MOCK_TYPES: MockMeta[] = [
  { type: "Worker", species: "microservice", zone: "compute" },
  { type: "API", species: "api_gateway", zone: "edge" },
  { type: "D1", species: "database", zone: "data" },
  { type: "KV", species: "database", zone: "data" },
  { type: "Queue", species: "queue", zone: "compute" },
  { type: "CDN", species: "cdn_edge", zone: "edge" },
  { type: "LB", species: "load_balancer", zone: "edge" },
  { type: "Auth", species: "microservice", zone: "auth" },
  { type: "Pay", species: "microservice", zone: "payment" },
  { type: "R2", species: "database", zone: "data" },
];

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomIds(
  pool: string[],
  count: number,
  excludeId: string,
  random: () => number,
) {
  const candidates = pool.filter((id) => id !== excludeId);
  const take = Math.min(count, candidates.length);
  for (let index = 0; index < take; index += 1) {
    const swapIndex =
      index + Math.floor(random() * (candidates.length - index));
    const current = candidates[index]!;
    candidates[index] = candidates[swapIndex]!;
    candidates[swapIndex] = current;
  }
  return candidates.slice(0, take);
}

function rollHealth(random: () => number): NodeHealth {
  const r = random();
  if (r < 0.08) return "critical";
  if (r < 0.22) return "warning";
  return "healthy";
}

export type MockInfrastructure = {
  services: InfrastructureService[];
  edges: { source: string; target: string; path: { x: number; y: number }[] }[];
  warnings: string[];
  centerGuide: { x: number; y: number; radius: number };
};

/**
 * TEMPORARY client-side mock — living topology for the 3D war-room scene.
 */
export function createMockInfrastructure(): MockInfrastructure {
  const random = mulberry32(42);
  const ids = Array.from(
    { length: MOCK_SERVICE_COUNT },
    (_, index) => `mock-service-${index}`,
  );

  const databases = ids.filter((_, i) => MOCK_TYPES[i % MOCK_TYPES.length]!.species === "database");
  const gateways = ids.filter((_, i) => MOCK_TYPES[i % MOCK_TYPES.length]!.species === "api_gateway");
  const balancers = ids.filter((_, i) => MOCK_TYPES[i % MOCK_TYPES.length]!.species === "load_balancer");

  const servicesPre = ids.map((id, index) => {
    const meta = MOCK_TYPES[index % MOCK_TYPES.length]!;
    const style = SPECIES_STYLE[meta.species];
    const health = rollHealth(random);

    let connections: string[] = [];
    if (meta.species === "microservice" || meta.species === "api_gateway") {
      connections = [
        ...pickRandomIds(databases, 1 + Math.floor(random() * 2), id, random),
        ...pickRandomIds(ids, Math.floor(random() * 3), id, random),
      ];
    } else if (meta.species === "queue") {
      connections = pickRandomIds(
        ids.filter((_, i) => MOCK_TYPES[i % MOCK_TYPES.length]!.species === "microservice"),
        2 + Math.floor(random() * 3),
        id,
        random,
      );
    } else if (meta.species === "cdn_edge" || meta.species === "load_balancer") {
      connections = pickRandomIds(
        [...gateways, ...balancers, ...ids.slice(0, 12)],
        2 + Math.floor(random() * 4),
        id,
        random,
      );
    } else if (meta.species === "database") {
      // mostly sink
      connections = random() < 0.2 ? pickRandomIds(databases, 1, id, random) : [];
    }

    connections = [...new Set(connections)].filter((c) => c !== id);

    const latencyBase =
      health === "critical" ? 280 : health === "warning" ? 140 : 45;

    return {
      id,
      type: meta.type,
      name: `${meta.type.toLowerCase()}-${index}`,
      connections,
      species: meta.species,
      category: speciesToCategory(meta.species),
      health,
      zone: meta.zone,
      metrics: {
        rps: Math.round(20 + random() * 800),
        errorRate:
          health === "critical"
            ? 0.08 + random() * 0.12
            : health === "warning"
              ? 0.02 + random() * 0.04
              : random() * 0.008,
        latencyMs: Math.round(latencyBase + random() * 80),
      },
      color: style.accent,
      additionalInfo:
        meta.species === "microservice" || meta.species === "api_gateway"
          ? `svc-${index}.internal`
          : undefined,
    };
  });

  const laidOut = layoutServices(servicesPre, {
    routeEdges: false,
    maxLayoutConnectionsPerNode: MOCK_LAYOUT_CONNECTIONS_CAP,
    forceIterations: 350,
    annealIterations: 2000,
    minDist: 3,
  });

  return {
    services: laidOut.services,
    edges: [],
    warnings: [
      "Living topology mock — species shapes, data veins, and health-driven glow.",
    ],
    centerGuide: laidOut.centerGuide,
  };
}
