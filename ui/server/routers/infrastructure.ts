import { z } from "zod";

import { loadInfrastructureDb, type Resource, type ServiceFields } from "@/lib/infrastructure-db";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import { layoutFromDb, type CameraFrame } from "@/lib/layout-from-db";
import { resolveServiceType } from "@/lib/service-types";
import { publicProcedure, router } from "@/server/trpc";

/** Visual block kind rendered in the 3D scene. */
export type InfrastructureCategory =
  | "compute"
  | "storage"
  | "database"
  | "integration";

/** @deprecated Prefer `category` for silhouette. */
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
  /** Console / dashboard URL from the scanner, when present. */
  url?: string;
  /** Grid-cell origin (bottom-left of footprint) after packing. */
  x: number;
  y: number;
  /** Footprint width in grid cells (default 1). */
  width: number;
  /** Footprint depth in grid cells (default 1). */
  depth: number;
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

/** Map wire-format resources into layout/render fields the 3D UI expects. */
function enrichResource(
  resource: Resource,
  connections: string[],
): Omit<InfrastructureService, "x" | "y" | "width" | "depth"> {
  const meta = resolveServiceType(resource.service);
  const category = meta.type;
  const species = speciesForCategory(category);

  return {
    id: resource.id,
    type: meta.icon,
    name: resource.name,
    ...(resource.url ? { url: resource.url } : {}),
    group: resource.group,
    connections,
    species,
    category,
    health: "healthy",
    zone: zoneForCategory(category),
    metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
    color: "#111827",
    fields: resource.fields,
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

      const scopedDb = input?.namespace
        ? {
            ...db,
            resources: db.resources.filter((resource) =>
              resource.id.startsWith(`${input.namespace}:`),
            ),
            connectors: db.connectors.filter(
              (connector) =>
                connector.nodes[0].startsWith(`${input.namespace}:`) ||
                connector.nodes[1].startsWith(`${input.namespace}:`) ||
                connector.nodes[0] === "internet" ||
                connector.nodes[1] === "internet",
            ),
          }
        : db;

      const fromScan = layoutFromDb(scopedDb, enrichResource);
      if (!fromScan) {
        return {
          services: [] as InfrastructureService[],
          platforms: [],
          publicInternet: {
            id: "internet",
            group: null,
            shape: "cloud",
            centerX: 0,
            centerZ: 0,
            width: 4,
            depth: 2,
          },
          bounds: { centerX: 0, centerZ: 0, width: 4, depth: 2 },
          connectorPaths: [] as ConnectorPath[],
          camera: null as CameraFrame | null,
        };
      }

      return {
        services: fromScan.services,
        platforms: fromScan.platforms,
        publicInternet: fromScan.publicInternet,
        bounds: fromScan.bounds,
        connectorPaths: fromScan.connectorPaths,
        camera: fromScan.camera,
      };
    }),
  alerts: publicProcedure
    .input(
      z
        .object({
          namespace: z.string().min(1).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = await loadInfrastructureDb();
      const resources = input?.namespace
        ? db.resources.filter((resource) =>
            resource.id.startsWith(`${input.namespace}:`),
          )
        : db.resources;

      const alerts = resources.flatMap((resource) => {
        const resourceAlerts = resource.alerts;
        if (!resourceAlerts) return [];
        return resourceAlerts.map((alert, index) => ({
          id: `${resource.id}:${index}`,
          resourceId: resource.id,
          resourceName: resource.name,
          group: resource.group,
          type: alert.type,
          message: alert.message,
        }));
      });

      alerts.sort((a, b) => {
        if (a.type === b.type) return 0;
        if (a.type === "error") return -1;
        return 1;
      });

      return alerts;
    }),
});
