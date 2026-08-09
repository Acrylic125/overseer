import { z } from "zod";

import {
  loadInfrastructureDb,
  type PlacedService,
  type ServiceFields,
} from "@/lib/infrastructure-db";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { SceneBake } from "@/lib/infrastructure-schema";
import { INTERNET_ID } from "@/lib/internet";
import { layoutFromDb } from "@/lib/layout-from-db";
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
  /** Blocks with the same group are packed together. `null` = ungrouped hub. */
  group: string | null;
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

function speciesForCategory(
  category: InfrastructureCategory,
): InfrastructureSpecies {
  switch (category) {
    case "database":
      return "database";
    case "storage":
      return "object_storage";
    case "integration":
      return "queue";
    case "compute":
      return "microservice";
  }
}

function zoneForCategory(category: InfrastructureCategory): InfrastructureZone {
  switch (category) {
    case "database":
    case "storage":
      return "data";
    case "integration":
    case "compute":
      return "compute";
  }
}

/** Map wire-format scan rows into layout/render fields the 3D UI expects. */
function enrichScannedService(
  scanned: PlacedService,
): Omit<InfrastructureService, "x" | "y" | "width" | "depth"> {
  // `service` is an assets.glb mesh basename; unknown → all-unknown.
  const meta = resolveServiceType(scanned.service);
  const category = meta.type;
  const species = speciesForCategory(category);

  return {
    id: scanned.id,
    type: meta.icon,
    name: scanned.name,
    group: scanned.group,
    connections: scanned.connections,
    species,
    category,
    health: "healthy",
    zone: zoneForCategory(category),
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
        ? db.services.filter(
            (service) =>
              service.id === INTERNET_ID ||
              service.id.startsWith(`${input.namespace}:`),
          )
        : db.services;

      const fromScan = layoutFromDb(
        services,
        db.pads,
        db.connectors,
        enrichScannedService,
      );

      if (fromScan) {
        const scene = fromScan.scene;
        return {
          services: fromScan.services,
          edges: [] as {
            source: string;
            target: string;
            path: { x: number; y: number }[];
          }[],
          warnings: db.warnings,
          centerGuide: scene.centerGuide,
          platforms: fromScan.platforms,
          publicInternet: fromScan.publicInternet,
          bounds: fromScan.bounds,
          connectorPaths: fromScan.connectorPaths,
          camera: scene.camera,
          connectorSegments: scene.connectorSegments,
          connectorJoints: scene.connectorJoints,
          scannedAt: db.scannedAt,
        };
      }

      // Fallback when the DB has no placed services — client rebuilds layout.
      const laidOut = layoutServices(
        services.map((service) => ({
          ...enrichScannedService(service),
          width: 1,
          depth: 1,
        })),
      );

      return {
        services: laidOut.services,
        edges: laidOut.edges,
        warnings: db.warnings,
        centerGuide: laidOut.centerGuide,
        platforms: laidOut.platforms,
        publicInternet: laidOut.publicInternet,
        bounds: laidOut.bounds,
        connectorPaths: null as ConnectorPath[] | null,
        camera: null as SceneBake["camera"] | null,
        connectorSegments: null as SceneBake["connectorSegments"] | null,
        connectorJoints: null as SceneBake["connectorJoints"] | null,
        scannedAt: db.scannedAt,
      };
    }),
});
