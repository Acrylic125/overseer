import { z } from "zod";

import {
  loadInfrastructureDb,
  type ScannedService,
  type ServiceFields,
} from "@/lib/infrastructure-db";
import { layoutServices } from "@/lib/providers/cloudflare/layout";
import { resolveServiceType } from "@/lib/service-types";
import { publicProcedure, router } from "@/server/trpc";

/** Visual block kind rendered in the 3D scene. */
export type InfrastructureCategory =
  | "compute"
  | "storage"
  | "database"
  | "integration";

/** @deprecated Prefer `category` for silhouette. Kept for Cloudflare transformer compatibility. */
export type InfrastructureSpecies =
  | "database"
  | "api_gateway"
  | "microservice"
  | "queue"
  | "cdn_edge"
  | "load_balancer"
  | "object_storage";

export type NodeHealth = "healthy" | "warning" | "critical";

export type InfrastructureZone =
  | "payment"
  | "auth"
  | "edge"
  | "data"
  | "compute";

export type NodeMetrics = {
  rps: number;
  errorRate: number;
  latencyMs: number;
};

export type InfrastructureService = {
  id: string;
  type: string;
  name: string;
  /** Grid-cell origin (bottom-left of footprint) after packing. */
  x: number;
  y: number;
  /** Footprint width in grid cells (default 1). */
  width: number;
  /** Footprint depth in grid cells (default 1). */
  depth: number;
  /** Blocks with the same group are packed together. */
  group: string;
  /** Service IDs this service can access */
  connections: string[];
  /** @deprecated Prefer `category`. */
  species: InfrastructureSpecies;
  category: InfrastructureCategory;
  health: NodeHealth;
  zone: InfrastructureZone;
  metrics: NodeMetrics;
  /** Accent / type color */
  color: string;
  /** Categorized typed fields from the scanner. */
  fields: ServiceFields;
};

function speciesForService(service: string): InfrastructureSpecies {
  switch (service) {
    case "D1":
    case "KV":
    case "Vectorize":
      return "database";
    case "R2":
      return "object_storage";
    case "Queue":
      return "queue";
    case "Worker":
      return "microservice";
    default:
      return "microservice";
  }
}

function zoneForService(service: string): InfrastructureZone {
  switch (service) {
    case "D1":
    case "KV":
    case "Vectorize":
    case "R2":
      return "data";
    case "Queue":
    case "Worker":
      return "compute";
    default:
      return "compute";
  }
}

/** Map wire-format scan rows into layout/render fields the 3D UI expects. */
function enrichScannedService(
  scanned: ScannedService,
): Omit<InfrastructureService, "x" | "y"> {
  const species = speciesForService(scanned.service);
  const category =
    resolveServiceType(scanned.service)?.type ??
    (species === "object_storage"
      ? "storage"
      : species === "queue"
        ? "integration"
        : species === "database"
          ? "database"
          : "compute");

  return {
    id: scanned.id,
    type: scanned.service,
    name: scanned.name,
    width: 1,
    depth: 1,
    group: scanned.group,
    connections: scanned.connections,
    species,
    category,
    health: "healthy",
    zone: zoneForService(scanned.service),
    metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
    color: "#111827",
    fields: scanned.fields,
  };
}

export const infrastructureRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          namespace: z.string().min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await loadInfrastructureDb();

      const services = input?.namespace
        ? db.services.filter((service) =>
            service.id.startsWith(`${input.namespace}:`),
          )
        : db.services;

      const laidOut = layoutServices(services.map(enrichScannedService));

      return {
        services: laidOut.services,
        edges: laidOut.edges,
        warnings: db.warnings,
        centerGuide: laidOut.centerGuide,
        platforms: laidOut.platforms,
        publicInternet: laidOut.publicInternet,
        bounds: laidOut.bounds,
        scannedAt: db.scannedAt,
      };
    }),
});
