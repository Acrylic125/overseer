import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import { INTERNET_ID } from "@/lib/internet";
import type { Connector, InfrastructureDb, Resource } from "@/lib/infrastructure-schema";
import { resolveSize } from "@/lib/infrastructure-schema";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type CameraFrame = {
  position: [number, number, number];
  span: number;
  far: number;
};

export type ResourceLayoutResult = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  connectorPaths: ConnectorPath[];
  camera: CameraFrame;
};

type EnrichFn = (
  resource: Resource,
  connections: string[],
) => Omit<InfrastructureService, "x" | "y" | "width" | "depth">;

function connectionsForResource(
  resourceId: string,
  connectors: Connector[],
): string[] {
  const targets = new Set<string>();
  for (const connector of connectors) {
    const [from, to] = connector.nodes;
    if (from === resourceId) targets.add(to);
    if (to === resourceId) targets.add(from);
  }
  return [...targets];
}

function computeBounds(
  platforms: PackLayoutResult["platforms"],
  placed: InfrastructureService[],
  publicInternet: PackLayoutResult["publicInternet"],
): PackLayoutResult["bounds"] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const platform of platforms) {
    minX = Math.min(minX, platform.centerX - platform.width / 2);
    maxX = Math.max(maxX, platform.centerX + platform.width / 2);
    minZ = Math.min(minZ, platform.centerZ - platform.depth / 2);
    maxZ = Math.max(maxZ, platform.centerZ + platform.depth / 2);
  }
  for (const service of placed) {
    minX = Math.min(minX, service.x);
    maxX = Math.max(maxX, service.x + service.width);
    minZ = Math.min(minZ, service.y);
    maxZ = Math.max(maxZ, service.y + service.depth);
  }

  minX = Math.min(minX, publicInternet.centerX - publicInternet.width / 2);
  maxX = Math.max(maxX, publicInternet.centerX + publicInternet.width / 2);
  minZ = Math.min(minZ, publicInternet.centerZ - publicInternet.depth / 2);
  maxZ = Math.max(maxZ, publicInternet.centerZ + publicInternet.depth / 2);

  if (!Number.isFinite(minX)) {
    return {
      centerX: 0,
      centerZ: 0,
      width: publicInternet.width,
      depth: publicInternet.depth,
    };
  }

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: Math.max(maxX - minX, 1),
    depth: Math.max(maxZ - minZ, 1),
  };
}

function computeCamera(): CameraFrame {
  const height = Math.min(42, Math.max(20, 50 * 0.65));
  return {
    position: [0, height, 0],
    span: 100,
    far: Math.hypot(50 * 1.6, height) * 1.35,
  };
}

/**
 * Apply scan layout onto enriched UI services. Scan packs on an x/y plane; the
 * 3D scene uses x/z on the ground (y up), so layout y maps to world z.
 */
export function layoutFromDb(
  db: InfrastructureDb,
  enrich: EnrichFn,
): ResourceLayoutResult | null {
  if (db.resources.length === 0) return null;

  const placed: InfrastructureService[] = [];
  for (const resource of db.resources) {
    const connections = connectionsForResource(resource.id, db.connectors);
    const base = enrich(resource, connections);
    const [w, d] = resolveSize(resource.size);
    const [x, y] = resource.pos;
    placed.push({
      ...base,
      type: resource.service || base.type,
      x,
      y,
      width: w,
      depth: d,
    });
  }

  const placedGroups = new Set(placed.map((service) => service.group));

  const platforms = db.groups
    .filter(
      (group) =>
        placedGroups.has(group.group) ||
        [...placedGroups].some((path) => path.startsWith(`${group.group}/`)),
    )
    .map((group) => {
      const [w, h] = resolveSize(group.size);
      const [x, y] = group.pos;
      return {
        group: group.group,
        centerX: x + w / 2,
        centerZ: y + h / 2,
        width: w,
        depth: h,
      };
    });

  const knownIds = new Set([
    ...db.resources.map((resource) => resource.id),
    INTERNET_ID,
  ]);

  const connectorPaths: ConnectorPath[] = db.connectors
    .filter(
      (connector) =>
        knownIds.has(connector.nodes[0]) && knownIds.has(connector.nodes[1]),
    )
    .map((connector, index) => ({
      id: `${connector.nodes[0]}->${connector.nodes[1]}:${index}`,
      sourceId: connector.nodes[0],
      targetId: connector.nodes[1],
      points: connector.path.map(([x, y]) => ({ x, z: y })),
      ...(connector.variant === "warning" ? { variant: "warning" as const } : {}),
    }));

  const [w, h] = resolveSize(db.static.publicInternet.size);
  const [x, y] = db.static.publicInternet.pos;
  const publicInternet: PackLayoutResult["publicInternet"] = {
    id: db.static.publicInternet.id,
    group: null,
    shape: "cloud",
    centerX: x + w / 2,
    centerZ: y + h / 2,
    width: w,
    depth: h,
  };

  return {
    services: placed,
    platforms,
    publicInternet,
    bounds: computeBounds(platforms, placed, publicInternet),
    connectorPaths,
    camera: computeCamera(),
  };
}
