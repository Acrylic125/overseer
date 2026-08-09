import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import { INTERNET_ID } from "@/lib/internet";
import {
  PUBLIC_INTERNET_BASE_DEPTH,
  PUBLIC_INTERNET_BASE_WIDTH,
} from "@/lib/infrastructure-styles";
import type {
  Connector,
  Pad,
  PlacedService,
  SceneBake,
} from "@/lib/infrastructure-schema";
import { resolveSize } from "@/lib/infrastructure-schema";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type ResourceLayoutResult = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  /** Pre-routed connectors from scan (world XZ; scan y → z). */
  connectorPaths: ConnectorPath[];
  /** Dense bake derived at load (bounds/camera/segments in world XZ). */
  scene: SceneBake;
};

type EnrichFn = (
  scanned: PlacedService,
) => Omit<InfrastructureService, "x" | "y" | "width" | "depth">;

function deriveScene(
  platforms: PackLayoutResult["platforms"],
  placed: InfrastructureService[],
  connectorPaths: ConnectorPath[],
  publicInternet: PackLayoutResult["publicInternet"],
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

  minX = Math.min(minX, publicInternet.centerX - publicInternet.width / 2);
  maxX = Math.max(maxX, publicInternet.centerX + publicInternet.width / 2);
  minZ = Math.min(minZ, publicInternet.centerZ - publicInternet.depth / 2);
  maxZ = Math.max(maxZ, publicInternet.centerZ + publicInternet.depth / 2);

  if (!Number.isFinite(minX)) {
    minX = -PUBLIC_INTERNET_BASE_WIDTH / 2;
    maxX = PUBLIC_INTERNET_BASE_WIDTH / 2;
    minZ = -PUBLIC_INTERNET_BASE_DEPTH / 2;
    maxZ = PUBLIC_INTERNET_BASE_DEPTH / 2;
  }

  const bounds = {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: Math.max(maxX - minX, 1),
    depth: Math.max(maxZ - minZ, 1),
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
        variant: path.variant ?? "default",
        ...(path.text ? { text: path.text } : {}),
      });
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      connectorJoints.push({
        x: p.x,
        z: p.z,
        sourceId: path.sourceId,
        targetId: path.targetId,
        variant: path.variant ?? "default",
        ...(path.text ? { text: path.text } : {}),
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
    publicInternet: {
      group: publicInternet.group,
      shape: publicInternet.shape ?? "cloud",
      centerX: publicInternet.centerX,
      centerZ: publicInternet.centerZ,
      width: publicInternet.width,
      depth: publicInternet.depth,
    },
    connectorSegments,
    connectorJoints,
  };
}

/**
 * Apply scan v2 layout (placed services + pads + connectors) onto enriched
 * UI services. Scan packs on an x/y plane; the 3D scene uses x/z on the ground
 * (y up), so layout y maps to world z / service.y.
 */
export function layoutFromDb(
  services: PlacedService[],
  pads: Pad[],
  connectors: Connector[],
  enrich: EnrichFn,
): ResourceLayoutResult | null {
  if (services.length === 0) return null;

  const placed: InfrastructureService[] = [];
  for (const scanned of services) {
    const base = enrich(scanned);
    const [w, d] = resolveSize(scanned.size);
    const [x, y] = scanned.pos;
    placed.push({
      ...base,
      type: scanned.service || base.type,
      x,
      y,
      width: w,
      depth: d,
    });
  }

  const placedIds = new Set(placed.map((service) => service.id));
  const placedGroups = new Set(
    placed
      .map((service) => service.group)
      .filter((group): group is string => group != null),
  );

  const platforms = pads
    .filter(
      (pad): pad is Extract<Pad, { type: "platform" }> =>
        pad.type === "platform",
    )
    .filter((platform) =>
      // Keep leaf platforms and any ancestor that wraps placed services.
      [...placedGroups].some(
        (group) =>
          group === platform.group ||
          group.startsWith(`${platform.group}/`),
      ),
    )
    .map((platform) => {
      const [w, h] = resolveSize(platform.size);
      const [x, y] = platform.pos;
      return {
        id: platform.id,
        group: platform.group,
        parent: platform.parent,
        centerX: x + w / 2,
        centerZ: y + h / 2,
        width: w,
        depth: h,
      };
    });

  const connectorPaths: ConnectorPath[] = connectors
    .filter((c) => placedIds.has(c.from) && placedIds.has(c.to))
    .map((connector, index) => ({
      id: `${connector.from}->${connector.to}:${index}`,
      sourceId: connector.from,
      targetId: connector.to,
      variant: connector.variant ?? "default",
      ...(connector.text ? { text: connector.text } : {}),
      // Scan path y → world z.
      points: connector.path.map(([x, y]) => ({ x, z: y })),
    }));

  const cloudShape = pads.find(
    (pad): pad is Extract<Pad, { type: "shape" }> =>
      pad.type === "shape" &&
      (pad.id === INTERNET_ID || pad.shape === "cloud"),
  );

  const internetService = placed.find((service) => service.id === INTERNET_ID);

  const publicInternet: PackLayoutResult["publicInternet"] = cloudShape
    ? (() => {
        const [w, h] = resolveSize(cloudShape.size);
        const [x, y] = cloudShape.pos;
        return {
          id: cloudShape.id || INTERNET_ID,
          group: cloudShape.group ?? null,
          shape: cloudShape.shape,
          centerX: x + w / 2,
          centerZ: y + h / 2,
          width: w,
          depth: h,
        };
      })()
    : internetService
      ? {
          id: INTERNET_ID,
          group: internetService.group,
          shape: "cloud",
          centerX: internetService.x + internetService.width / 2,
          centerZ: internetService.y + internetService.depth / 2,
          width: internetService.width,
          depth: internetService.depth,
        }
      : {
          id: INTERNET_ID,
          group: null,
          shape: "cloud",
          centerX: 0,
          centerZ: 0,
          width: PUBLIC_INTERNET_BASE_WIDTH,
          depth: PUBLIC_INTERNET_BASE_DEPTH,
        };

  const scene = deriveScene(platforms, placed, connectorPaths, publicInternet);

  return {
    services: placed,
    platforms,
    publicInternet,
    bounds: {
      centerX: scene.bounds.centerX,
      centerZ: scene.bounds.centerZ,
      width: scene.bounds.width,
      depth: scene.bounds.depth,
    },
    connectorPaths,
    scene,
  };
}
