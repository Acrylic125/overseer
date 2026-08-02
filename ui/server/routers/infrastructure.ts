import { z } from "zod";

import { loadInfrastructureDb } from "@/lib/infrastructure-db";
import { layoutServices } from "@/lib/providers/cloudflare/layout";
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
  /** Optional secondary line (e.g. Worker domain) */
  additionalInfo?: string;
};

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

      const laidOut = layoutServices(services);

      return {
        services: laidOut.services,
        edges: laidOut.edges,
        warnings: db.warnings,
        centerGuide: laidOut.centerGuide,
        platforms: laidOut.platforms,
        bounds: laidOut.bounds,
        scannedAt: db.scannedAt,
      };
    }),
});
