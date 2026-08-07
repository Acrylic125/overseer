import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import {
  PUBLIC_INTERNET_BASE_DEPTH,
  PUBLIC_INTERNET_BASE_WIDTH,
  PUBLIC_INTERNET_GROUP,
} from "@/lib/infrastructure-styles";
import type {
  LayoutResource,
  ScannedService,
  SceneBake,
} from "@/lib/infrastructure-schema";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type ResourceLayoutResult = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  /** Pre-routed connectors from scan (world XZ; scan y → z). */
  connectorPaths: ConnectorPath[];
  /** Dense bake when present (bounds/camera/segments already in world XZ). */
  scene: SceneBake | null;
};

type EnrichFn = (
  scanned: ScannedService,
) => Omit<InfrastructureService, "x" | "y">;

function deriveSceneFallback(
  platforms: PackLayoutResult["platforms"],
  placed: InfrastructureService[],
  connectorPaths: ConnectorPath[],
): SceneBake {
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

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = PUBLIC_INTERNET_BASE_WIDTH;
    minZ = 0;
    maxZ = PUBLIC_INTERNET_BASE_DEPTH;
  }

  const contentW = Math.max(maxX - minX, 1);
  const contentD = Math.max(maxZ - minZ, 1);
  const cloudW = Math.max(
    PUBLIC_INTERNET_BASE_WIDTH,
    Math.round(
      PUBLIC_INTERNET_BASE_WIDTH * Math.sqrt(Math.max(platforms.length, 1)),
    ),
  );
  const cloudD = Math.max(
    PUBLIC_INTERNET_BASE_DEPTH,
    Math.round(
      PUBLIC_INTERNET_BASE_DEPTH * Math.sqrt(Math.max(platforms.length, 1)),
    ),
  );

  // Fallback: cloud hub at the grid origin (matches scan layout).
  const publicInternet = {
    group: PUBLIC_INTERNET_GROUP,
    shape: "cloud",
    centerX: 0,
    centerZ: 0,
    width: cloudW,
    depth: cloudD,
  };

  const boundsMinX = Math.min(minX, -cloudW / 2);
  const boundsMaxX = Math.max(maxX, cloudW / 2);
  const boundsMinZ = Math.min(minZ, -cloudD / 2);
  const boundsMaxZ = Math.max(maxZ, cloudD / 2);

  const bounds = {
    minX: boundsMinX,
    maxX: boundsMaxX,
    minZ: boundsMinZ,
    maxZ: boundsMaxZ,
    centerX: (boundsMinX + boundsMaxX) / 2,
    centerZ: (boundsMinZ + boundsMaxZ) / 2,
    width: Math.max(boundsMaxX - boundsMinX, contentW),
    depth: Math.max(boundsMaxZ - boundsMinZ, contentD),
  };

  const height = Math.min(42, Math.max(20, 50 * 0.65));
  const far = Math.hypot(50 * 1.6, height) * 1.35;

  const connectorSegments: SceneBake["connectorSegments"] = [];
  const connectorJoints: SceneBake["connectorJoints"] = [];
  for (const path of connectorPaths) {
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-5) continue;
      connectorSegments.push({
        midX: (a.x + b.x) / 2,
        midZ: (a.z + b.z) / 2,
        length,
        dx: dx / length,
        dz: dz / length,
        sourceId: path.sourceId,
        targetId: path.targetId,
      });
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      connectorJoints.push({
        x: p.x,
        z: p.z,
        sourceId: path.sourceId,
        targetId: path.targetId,
      });
    }
  }

  return {
    bounds,
    camera: {
      position: [0, height, 0],
      span: 100,
      far,
    },
    centerGuide: {
      x: 0,
      y: 0,
      radius: Math.hypot(bounds.width, bounds.depth) / 2 + 4,
    },
    publicInternet,
    connectorSegments,
    connectorJoints,
  };
}

/**
 * Apply scan-produced layout resources onto enriched services.
 *
 * Scan packs on an x/y plane; the 3D scene uses x/z on the ground (y up),
 * so resource.y maps to world z / service.y. Prefer `scene` when present.
 */
export function layoutFromResources(
  services: ScannedService[],
  resources: LayoutResource[],
  enrich: EnrichFn,
  scene: SceneBake | null | undefined = null,
): ResourceLayoutResult | null {
  const icons = resources.filter((r) => r.type === "icon");
  if (icons.length === 0) return null;

  const byId = new Map(services.map((service) => [service.id, service]));
  const placed: InfrastructureService[] = [];

  for (const icon of icons) {
    const scanned = byId.get(icon.id);
    if (!scanned) continue;
    const base = enrich(scanned);
    placed.push({
      ...base,
      type: icon.source || base.type,
      // CELL_SIZE = 1 → these are already world units on the ground plane.
      x: icon.x,
      y: icon.y,
      width: icon.width,
      depth: icon.height,
    });
  }

  if (placed.length === 0) return null;

  const placedIds = new Set(placed.map((service) => service.id));
  const placedGroups = new Set(placed.map((service) => service.group));

  const platforms = resources
    .filter((r) => r.type === "platform" && placedGroups.has(r.group))
    .map((platform) => ({
      group: platform.group,
      centerX: platform.x + platform.width / 2,
      centerZ: platform.y + platform.height / 2,
      width: platform.width,
      depth: platform.height,
    }));

  const connectorPaths: ConnectorPath[] = resources
    .filter(
      (r) =>
        r.type === "connector" &&
        placedIds.has(r.sourceId) &&
        placedIds.has(r.targetId),
    )
    .map((connector, index) => ({
      id: `${connector.sourceId}->${connector.targetId}:${index}`,
      sourceId: connector.sourceId,
      targetId: connector.targetId,
      // Scan path y → world z.
      points: connector.path.map((p) => ({ x: p.x, z: p.y })),
    }));

  const baked =
    scene ?? deriveSceneFallback(platforms, placed, connectorPaths);

  // Prefer an explicit scan shape resource for Public Internet when present.
  const cloudShape = resources.find(
    (r): r is Extract<LayoutResource, { type: "shape" }> =>
      r.type === "shape" &&
      r.shape === "cloud" &&
      r.group === PUBLIC_INTERNET_GROUP,
  );
  const publicInternet = cloudShape
    ? {
        group: cloudShape.group,
        shape: cloudShape.shape,
        centerX: cloudShape.x + cloudShape.width / 2,
        centerZ: cloudShape.y + cloudShape.height / 2,
        width: cloudShape.width,
        depth: cloudShape.height,
      }
    : baked.publicInternet;

  return {
    services: placed,
    platforms,
    publicInternet,
    bounds: {
      centerX: baked.bounds.centerX,
      centerZ: baked.bounds.centerZ,
      width: baked.bounds.width,
      depth: baked.bounds.depth,
    },
    connectorPaths,
    scene: { ...baked, publicInternet },
  };
}
