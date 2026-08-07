import type { LayoutResource, SceneBake } from "./schema.js";

/** Matches UI `RENDER_WINDOW` / `RENDER_HALF` (service-streaming). */
const RENDER_WINDOW = 100;
const RENDER_HALF = RENDER_WINDOW / 2;

/** Matches UI public-internet footprint (cloud.svg ≈ 2:1). */
const PUBLIC_INTERNET_BASE_WIDTH = 4;
const PUBLIC_INTERNET_BASE_DEPTH = 2;
export const PUBLIC_INTERNET_GROUP = "public-internet";
export const PUBLIC_INTERNET_SHAPE = "cloud";
export const PUBLIC_INTERNET_LABEL = "Public Internet";
/** Edge gap between the cloud hub and the nearest service platform. */
export const PUBLIC_INTERNET_GAP = 4;

export function publicInternetFootprint(platformCount: number) {
  const n = Math.max(1, platformCount);
  const s = Math.sqrt(n);
  return {
    width: Math.max(
      PUBLIC_INTERNET_BASE_WIDTH,
      Math.round(PUBLIC_INTERNET_BASE_WIDTH * s),
    ),
    depth: Math.max(
      PUBLIC_INTERNET_BASE_DEPTH,
      Math.round(PUBLIC_INTERNET_BASE_DEPTH * s),
    ),
  };
}

function cameraFrame(centerX: number, centerZ: number) {
  const height = Math.min(42, Math.max(20, RENDER_HALF * 0.65));
  const far = Math.hypot(RENDER_HALF * 1.6, height) * 1.35;
  return {
    position: [centerX, height, centerZ] as [number, number, number],
    span: RENDER_WINDOW,
    far,
  };
}

function contentBounds(resources: LayoutResource[]) {
  const platforms = resources.filter((r) => r.type === "platform");
  const icons = resources.filter((r) => r.type === "icon");
  const shapes = resources.filter((r) => r.type === "shape");

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  const expand = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + w);
    minZ = Math.min(minZ, y);
    maxZ = Math.max(maxZ, y + h);
  };

  for (const platform of platforms) {
    expand(platform.x, platform.y, platform.width, platform.height);
  }
  for (const icon of icons) {
    expand(icon.x, icon.y, icon.width, icon.height);
  }
  for (const shape of shapes) {
    expand(shape.x, shape.y, shape.width, shape.height);
  }

  if (!Number.isFinite(minX)) {
    minX = -PUBLIC_INTERNET_BASE_WIDTH / 2;
    maxX = PUBLIC_INTERNET_BASE_WIDTH / 2;
    minZ = -PUBLIC_INTERNET_BASE_DEPTH / 2;
    maxZ = PUBLIC_INTERNET_BASE_DEPTH / 2;
  }

  return { minX, maxX, minZ, maxZ };
}

/**
 * Dense scene bake for the 3D UI — world XZ ground plane
 * (scan layout y → world z).
 *
 * Public Internet (`cloud` shape) is expected at the grid origin; this bake
 * reads it from resources when present and falls back to a centered footprint.
 */
export function bakeScene(resources: LayoutResource[]): SceneBake {
  const platforms = resources.filter((r) => r.type === "platform");
  const connectors = resources.filter((r) => r.type === "connector");
  const cloudResource = resources.find(
    (r): r is Extract<LayoutResource, { type: "shape" }> =>
      r.type === "shape" &&
      r.shape === PUBLIC_INTERNET_SHAPE &&
      r.group === PUBLIC_INTERNET_GROUP,
  );

  const cloud = cloudResource
    ? {
        width: cloudResource.width,
        depth: cloudResource.height,
        centerX: cloudResource.x + cloudResource.width / 2,
        centerZ: cloudResource.y + cloudResource.height / 2,
      }
    : {
        ...publicInternetFootprint(platforms.length),
        centerX: 0,
        centerZ: 0,
      };

  const publicInternet = {
    group: PUBLIC_INTERNET_GROUP,
    shape: PUBLIC_INTERNET_SHAPE,
    centerX: cloud.centerX,
    centerZ: cloud.centerZ,
    width: cloud.width,
    depth: cloud.depth,
  };

  const { minX, maxX, minZ, maxZ } = contentBounds(resources);
  const contentW = Math.max(maxX - minX, 1);
  const contentD = Math.max(maxZ - minZ, 1);

  const bounds = {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    width: Math.max(maxX - minX, contentW),
    depth: Math.max(maxZ - minZ, contentD),
  };

  // Frame the grid origin (cloud hub) so Public Internet stays centered in view.
  const camera = cameraFrame(0, 0);
  const centerGuide = {
    x: 0,
    y: 0,
    radius: Math.hypot(bounds.width, bounds.depth) / 2 + 4,
  };

  const connectorSegments: SceneBake["connectorSegments"] = [];
  const connectorJoints: SceneBake["connectorJoints"] = [];

  for (const connector of connectors) {
    const pts = connector.path.map((p) => ({ x: p.x, z: p.y }));
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
        sourceId: connector.sourceId,
        targetId: connector.targetId,
      });
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      connectorJoints.push({
        x: p.x,
        z: p.z,
        sourceId: connector.sourceId,
        targetId: connector.targetId,
      });
    }
  }

  return {
    bounds,
    camera,
    centerGuide,
    publicInternet,
    connectorSegments,
    connectorJoints,
  };
}
