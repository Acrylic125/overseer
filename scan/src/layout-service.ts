import {
  buildAllConnectorPaths,
  iconAabb,
  type LayoutAabb,
} from "./connector-paths.js";
import {
  bakeScene,
  PUBLIC_INTERNET_GAP,
  PUBLIC_INTERNET_GROUP,
  PUBLIC_INTERNET_LABEL,
  PUBLIC_INTERNET_SHAPE,
  publicInternetFootprint,
} from "./scene-bake.js";
import type { LayoutResource, SceneBake, ScannedService } from "./schema.js";

/** Default icon cell size (matches unit-sized GLB glyphs). */
export const ICON_W = 1;
export const ICON_H = 1;
/** Gap between icons inside a cluster. */
export const ICON_GAP = 1;
/** Edge-to-edge gap between platforms. */
export const PLATFORM_GAP = 2;

/** Group label inset from the platform's top-left corner. */
export const LABEL_INSET_X = 0.5;
export const LABEL_INSET_Y = 0.5;
/** Matches UI group-title `fontSize` (single-line band). */
export const GROUP_TITLE_HEIGHT = 0.35;
/** Clearance from the title band to the first icon row. */
export const TITLE_CONTENT_GAP = 1;

/** Platform padding: (top, left, right, bottom). */
export const PAD_TOP =
  LABEL_INSET_Y + GROUP_TITLE_HEIGHT + TITLE_CONTENT_GAP;
export const PAD_LEFT = 1;
export const PAD_RIGHT = 1;
export const PAD_BOTTOM = 1;

const PLATFORM_Z = 0;
/** Icons above connectors. */
const ICON_Z = 0.01;
const CONNECTOR_Z = 0;

export type ClusterItem = { x: number; y: number };

export type ClusterLayout = {
  name: string;
  cols: number;
  rows: number;
  /** Content width (icons only). */
  W: number;
  /** Content height (icons only). */
  H: number;
  /** Full platform width including pads. */
  platformW: number;
  /** Full platform height including pads. */
  platformH: number;
  items: ClusterItem[];
  /** Services in the same order as `items`. */
  services: ScannedService[];
};

export type PlacedCluster = {
  cluster: ClusterLayout;
  offsetX: number;
  offsetY: number;
};

export type PackGridResult = {
  placed: PlacedCluster[];
  totalWidth: number;
  totalHeight: number;
};

export type LayoutResult = {
  resources: LayoutResource[];
  /** Dense 3D scene bake (bounds, camera, segments) in world XZ. */
  scene: SceneBake;
  /** Absolute top-left of every icon, keyed by service id. */
  positions: Map<string, { x: number; y: number; width: number; height: number }>;
  totalWidth: number;
  totalHeight: number;
};

type TypeSpec = {
  name: string;
  w: number;
  h: number;
  count: number;
  services: ScannedService[];
};

/** Cap columns at ⌈√n⌉ so grids stay near-square (never wider than tall-ish). */
export function maxColsFor(n: number): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.ceil(Math.sqrt(n)));
}

// ============================================================
// PHASE 1 — CLUSTER SHAPING
// Arrange n equal cells into the cols×rows grid closest to square,
// with cols limited to ⌈√n⌉.
// ============================================================

export function packCluster(
  n: number,
  w: number,
  h: number,
  G: number,
): Omit<
  ClusterLayout,
  "name" | "services" | "platformW" | "platformH"
> {
  if (n <= 0) {
    return { cols: 0, rows: 0, W: 0, H: 0, items: [] };
  }

  const maxCols = maxColsFor(n);
  let bestScore = Infinity;
  let bestLayout: { cols: number; rows: number; W: number; H: number } | null =
    null;

  for (let cols = 1; cols <= maxCols; cols += 1) {
    const rows = Math.ceil(n / cols);
    const W = cols * w + (cols - 1) * G;
    const H = rows * h + (rows - 1) * G;
    const score = Math.abs(W - H);

    if (score < bestScore) {
      bestScore = score;
      bestLayout = { cols, rows, W, H };
    }
  }

  if (!bestLayout) {
    return { cols: 0, rows: 0, W: 0, H: 0, items: [] };
  }

  const items: ClusterItem[] = [];
  let idx = 0;
  for (let r = 0; r < bestLayout.rows; r += 1) {
    for (let c = 0; c < bestLayout.cols; c += 1) {
      if (idx >= n) break;
      items.push({
        x: c * (w + G),
        y: r * (h + G),
      });
      idx += 1;
    }
  }

  return {
    cols: bestLayout.cols,
    rows: bestLayout.rows,
    W: bestLayout.W,
    H: bestLayout.H,
    items,
  };
}

// ============================================================
// PHASE 2 — PLATFORM GRID
// Same near-square algorithm as icons: N platforms in a cols≤√N grid,
// cell size = max platform footprint, gap = PLATFORM_GAP.
// ============================================================

export function packPlatforms(
  clusters: ClusterLayout[],
  platformGap: number,
): PackGridResult {
  const n = clusters.length;
  if (n === 0) {
    return { placed: [], totalWidth: 0, totalHeight: 0 };
  }

  const cellW = Math.max(...clusters.map((c) => c.platformW));
  const cellH = Math.max(...clusters.map((c) => c.platformH));
  const grid = packCluster(n, cellW, cellH, platformGap);

  const placed: PlacedCluster[] = clusters.map((cluster, index) => {
    const item = grid.items[index]!;
    return {
      cluster,
      offsetX: item.x,
      offsetY: item.y,
    };
  });

  return {
    placed,
    totalWidth: grid.W,
    totalHeight: grid.H,
  };
}

// ============================================================
// TOP-LEVEL DRIVER
// ============================================================

export function packGrid(
  types: TypeSpec[],
  iconGap: number,
  platformGap: number,
): PackGridResult {
  const clusters: ClusterLayout[] = [];

  for (const type of types) {
    // Services within a platform — same near-square pack, cols ≤ √n.
    const packed = packCluster(type.count, type.w, type.h, iconGap);
    clusters.push({
      ...packed,
      platformW: packed.W + PAD_LEFT + PAD_RIGHT,
      platformH: packed.H + PAD_TOP + PAD_BOTTOM,
      name: type.name,
      services: type.services,
    });
  }

  // Platforms among themselves — same algorithm.
  return packPlatforms(clusters, platformGap);
}

export type LayoutOptions = {
  iconW?: number;
  iconH?: number;
  iconGap?: number;
  platformGap?: number;
};

/**
 * Pack scanned services into platforms + icons + orthogonal connectors.
 * Clusters are keyed by `service.group`.
 */
export function layoutServices(
  services: ScannedService[],
  options: LayoutOptions = {},
): LayoutResult {
  const iconW = options.iconW ?? ICON_W;
  const iconH = options.iconH ?? ICON_H;
  const iconGap = options.iconGap ?? ICON_GAP;
  const platformGap = options.platformGap ?? PLATFORM_GAP;

  // Bucket by group → one cluster / platform per group.
  const byGroup = new Map<string, ScannedService[]>();
  for (const service of services) {
    const list = byGroup.get(service.group) ?? [];
    list.push(service);
    byGroup.set(service.group, list);
  }

  const types: TypeSpec[] = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, members]) => ({
      name,
      w: iconW,
      h: iconH,
      count: members.length,
      services: members,
    }));

  const packed = packGrid(types, iconGap, platformGap);
  const cloud = publicInternetFootprint(packed.placed.length);

  // Cloud hub sits at the grid origin. Dock the packed service cluster to its
  // right (same convention as the UI pack-layout), then emit absolute resources.
  const serviceOffsetX = cloud.width / 2 + PUBLIC_INTERNET_GAP;
  const serviceOffsetY = -packed.totalHeight / 2;

  const resources: LayoutResource[] = [];
  const positions = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  const boxes: LayoutAabb[] = [];

  resources.push({
    type: "shape",
    shape: PUBLIC_INTERNET_SHAPE,
    group: PUBLIC_INTERNET_GROUP,
    label: PUBLIC_INTERNET_LABEL,
    width: cloud.width,
    height: cloud.depth,
    x: -cloud.width / 2,
    y: -cloud.depth / 2,
    z: PLATFORM_Z,
  });

  for (const placement of packed.placed) {
    const { cluster, offsetX, offsetY } = placement;
    const absX = offsetX + serviceOffsetX;
    const absY = offsetY + serviceOffsetY;

    resources.push({
      type: "platform",
      group: cluster.name,
      width: cluster.platformW,
      height: cluster.platformH,
      x: absX,
      y: absY,
      z: PLATFORM_Z,
    });

    const contentOriginX = absX + PAD_LEFT;
    const contentOriginY = absY + PAD_TOP;

    for (let i = 0; i < cluster.items.length; i += 1) {
      const item = cluster.items[i]!;
      const service = cluster.services[i];
      if (!service) continue;

      const absoluteX = contentOriginX + item.x;
      const absoluteY = contentOriginY + item.y;

      resources.push({
        type: "icon",
        id: service.id,
        source: service.service,
        width: iconW,
        height: iconH,
        x: absoluteX,
        y: absoluteY,
        z: ICON_Z,
      });

      positions.set(service.id, {
        x: absoluteX,
        y: absoluteY,
        width: iconW,
        height: iconH,
      });
      boxes.push(iconAabb(service.id, absoluteX, absoluteY, iconW, iconH));
    }
  }

  const paths = buildAllConnectorPaths(
    boxes,
    services.map((service) => ({
      id: service.id,
      connections: service.connections,
    })),
  );

  for (const path of paths) {
    resources.push({
      type: "connector",
      sourceId: path.sourceId,
      targetId: path.targetId,
      path: path.points.map((p) => ({ x: p.x, y: p.y, z: CONNECTOR_Z })),
    });
  }

  return {
    resources,
    scene: bakeScene(resources),
    positions,
    totalWidth: cloud.width / 2 + PUBLIC_INTERNET_GAP + packed.totalWidth,
    totalHeight: Math.max(cloud.depth, packed.totalHeight),
  };
}
