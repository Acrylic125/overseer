import { packServicesByGroup } from "@/lib/graph/pack-layout";
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

const MOCK_SERVICE_COUNT = 36;

type MockMeta = {
  type: string;
  species: InfrastructureSpecies;
  zone: InfrastructureZone;
  group: string;
};

const MOCK_TYPES: MockMeta[] = [
  { type: "Worker", species: "microservice", zone: "compute", group: "app" },
  { type: "API", species: "api_gateway", zone: "edge", group: "edge" },
  { type: "D1", species: "database", zone: "data", group: "data" },
  { type: "KV", species: "database", zone: "data", group: "data" },
  { type: "Queue", species: "queue", zone: "compute", group: "messaging" },
  { type: "CDN", species: "cdn_edge", zone: "edge", group: "edge" },
  { type: "LB", species: "load_balancer", zone: "edge", group: "edge" },
  { type: "Auth", species: "microservice", zone: "auth", group: "auth" },
  { type: "Pay", species: "microservice", zone: "payment", group: "payments" },
  { type: "R2", species: "queue", zone: "data", group: "storage" },
];

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rollHealth(random: () => number): NodeHealth {
  const r = random();
  if (r < 0.08) return "critical";
  if (r < 0.22) return "warning";
  return "healthy";
}

export type MockInfrastructure = {
  services: InfrastructureService[];
  platforms: {
    group: string;
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  }[];
  bounds: {
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
  warnings: string[];
};

/**
 * TEMPORARY client-side mock — grouped blocks for the 3D platform scene.
 */
export function createMockInfrastructure(): MockInfrastructure {
  const random = mulberry32(42);

  const servicesPre = Array.from({ length: MOCK_SERVICE_COUNT }, (_, index) => {
    const meta = MOCK_TYPES[index % MOCK_TYPES.length]!;
    const style = SPECIES_STYLE[meta.species];
    const health = rollHealth(random);
    const category = speciesToCategory(meta.species);
    const latencyBase =
      health === "critical" ? 280 : health === "warning" ? 140 : 45;

    return {
      id: `mock-service-${index}`,
      type: meta.type,
      name: `${meta.type.toLowerCase()}-${index}`,
      width: 1,
      depth: 1,
      group: meta.group,
      connections: [] as string[],
      species: meta.species,
      category,
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

  // Wire a handful of cross-group links so connectors are visible.
  for (let index = 0; index < servicesPre.length; index += 1) {
    const service = servicesPre[index]!;
    const targets = [
      servicesPre[(index + 3) % servicesPre.length]!.id,
      servicesPre[(index + 7) % servicesPre.length]!.id,
    ];
    if (random() > 0.45) {
      service.connections = [...new Set(targets)].filter(
        (id) => id !== service.id,
      );
    }
  }

  const laidOut = packServicesByGroup(servicesPre);

  return {
    services: laidOut.services,
    platforms: laidOut.platforms,
    bounds: laidOut.bounds,
    warnings: [
      "Grouped platform mock — compute / storage / database blocks.",
    ],
  };
}
