import { applicationGroups, layoutLenses } from "@acrylic125/overseer-sdk/layout";
import { z } from "zod";

import { loadGraphSnapshot, loadInfrastructureDb } from "@/lib/infrastructure-db";
import type { Resource, ServiceFields } from "@/lib/infrastructure-schema";
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
  app?: string;
  provider?: string;
  namespace?: string;
  /** Service IDs this service can access (undirected, for connectors). */
  connections: string[];
  /** Directed: services this one calls, binds to, or routes to. */
  dependsOn: string[];
  /** Set when the resource changed since the previous scrape of its scope. */
  change?: "added" | "modified";
  /** @deprecated Prefer `category`. */
  species: InfrastructureSpecies;
  category: InfrastructureCategory;
  health: NodeHealth;
  zone: InfrastructureZone;
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

function healthFor(alerts: Array<{ type: "warning" | "error" }>): NodeHealth {
  if (alerts.some((alert) => alert.type === "error")) return "critical";
  if (alerts.length > 0) return "warning";
  return "healthy";
}

const scopeInput = z
  .object({
    namespace: z.string().min(1).optional(),
    lens: z.enum(layoutLenses).optional(),
  })
  .optional();

function inNamespace(id: string, namespace: string | undefined) {
  if (!namespace) return true;
  return id.startsWith(`${namespace}:`);
}

export const infrastructureRouter = router({
  list: publicProcedure.input(scopeInput).query(async ({ input }) => {
    const lens = input?.lens ?? "application";
    const namespace = input?.namespace;
    const { db, snapshot } = await loadInfrastructureDb(lens);

    const apps = applicationGroups(snapshot.resources, snapshot.edges);
    const facts = new Map<string, typeof snapshot.resources[number]>(snapshot.resources.map((resource) => [resource.id, resource]));
    const dependsOn = new Map<string, string[]>();
    const edgeAlerts = new Map<string, Array<{ type: "warning" | "error" }>>();
    for (const edge of snapshot.edges) {
      const targets = dependsOn.get(edge.from) ?? [];
      targets.push(edge.to);
      dependsOn.set(edge.from, targets);
      if (edge.alerts.length === 0) continue;
      const alerts = edgeAlerts.get(edge.from) ?? [];
      alerts.push(...edge.alerts);
      edgeAlerts.set(edge.from, alerts);
    }

    const enrich = (resource: Resource, connections: string[]) => {
      const meta = resolveServiceType(resource.service);
      const change = snapshot.changes[resource.id];
      return {
        id: resource.id,
        type: meta.icon,
        name: resource.name,
        ...(resource.url ? { url: resource.url } : {}),
        group: resource.group,
        app: apps.get(resource.id),
        provider: facts.get(resource.id)?.tags.provider ?? resource.id.split(":")[0],
        namespace: facts.get(resource.id)?.tags.namespace,
        connections,
        dependsOn: dependsOn.get(resource.id) ?? [],
        ...(change ? { change } : {}),
        species: speciesForCategory(meta.type),
        category: meta.type,
        health: healthFor([
          ...(resource.alerts ?? []),
          ...(edgeAlerts.get(resource.id) ?? []),
        ]),
        zone: zoneForCategory(meta.type),
        color: "#111827",
        fields: resource.fields,
      };
    };

    const scopedDb = namespace
      ? {
          ...db,
          resources: db.resources.filter((resource) =>
            inNamespace(resource.id, namespace),
          ),
          connectors: db.connectors.filter(
            (connector) =>
              inNamespace(connector.nodes[0], namespace) ||
              inNamespace(connector.nodes[1], namespace) ||
              connector.nodes[0] === "internet" ||
              connector.nodes[1] === "internet",
          ),
        }
      : db;

    const changedIds = Object.entries(snapshot.changes).filter(([id]) =>
      inNamespace(id, namespace),
    );
    const changes = {
      added: changedIds.filter(([, change]) => change === "added").length,
      modified: changedIds.filter(([, change]) => change === "modified").length,
      removed: snapshot.removed.filter((row) => inNamespace(row.id, namespace)),
    };

    const fromScan = layoutFromDb(scopedDb, enrich);
    if (!fromScan) {
      return {
        lens,
        generatedAt: snapshot.generatedAt,
        changes,
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
      lens,
      generatedAt: snapshot.generatedAt,
      changes,
      services: fromScan.services,
      platforms: fromScan.platforms,
      publicInternet: fromScan.publicInternet,
      bounds: fromScan.bounds,
      connectorPaths: fromScan.connectorPaths,
      camera: fromScan.camera,
    };
  }),
  alerts: publicProcedure.input(scopeInput).query(async ({ input }) => {
    const snapshot = await loadGraphSnapshot();
    const namespace = input?.namespace;
    const resources = snapshot.resources.filter((resource) =>
      inNamespace(resource.id, namespace),
    );
    const names = new Map<string, string>(
      snapshot.resources.map((resource) => [resource.id, resource.name]),
    );

    const alerts = resources.flatMap((resource) =>
      resource.alerts.map((alert, index) => ({
        id: `${resource.id}:${index}`,
        resourceId: String(resource.id),
        resourceName: resource.name,
        group: resource.group,
        type: alert.type,
        message: alert.message,
      })),
    );

    for (const edge of snapshot.edges) {
      if (!inNamespace(edge.from, namespace)) continue;
      edge.alerts.forEach((alert, index) => {
        alerts.push({
          id: `${edge.from}->${edge.to}:${index}`,
          resourceId: edge.from,
          resourceName: names.get(edge.from) ?? edge.from,
          group: "",
          type: alert.type,
          message: `${alert.message} (→ ${names.get(edge.to) ?? edge.to})`,
        });
      });
    }

    alerts.sort((a, b) => {
      if (a.type === b.type) return 0;
      if (a.type === "error") return -1;
      return 1;
    });

    return alerts;
  }),
});
