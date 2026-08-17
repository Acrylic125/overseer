import { createConnectorEngine, type LayoutAabb } from "./connectors.js";
import { meshSizesFromGlb, type MeshSize } from "./glb.js";
import type {
  LayoutOutput,
  Pos,
  Resource,
  ResourceConnection,
  ResourceLayoutItem,
} from "./types.js";

export type LayoutInput = {
  resources: Resource[];
  connections: ResourceConnection[];
  glb: Uint8Array | ArrayBuffer;
  config?: LayoutConfig;
};

export const POS_PRECISION = 0.0001;

export function roundCoord(n: number, precision = POS_PRECISION): number {
  const scale = 1 / precision;
  return Math.round(n * scale) / scale;
}

export function roundPos(pos: Pos, precision = POS_PRECISION): Pos {
  return [
    roundCoord(pos[0], precision),
    roundCoord(pos[1], precision),
    roundCoord(pos[2], precision),
  ];
}

export type PackConfig = {
  /** Icon footprint width. */
  iconWidth: number;
  /** Icon footprint height. */
  iconHeight: number;
  /** Gap between icons inside a group. */
  iconGap: number;
  /** Gap between adjacent groups. */
  groupGap: number;
  /** Padding around group bounds. */
  groupPad: number;
  /** Max columns when grid-packing icons in a group. */
  groupCols: number;
  /** Z for group/platform plane. */
  platformZ: number;
  /** Z for resource icons (above connectors). */
  iconZ: number;
  /** Z for connector path points. */
  connectorZ: number;
};

export type ConnectorConfig = {
  /** Stay this far outside every resource AABB. */
  clearance: number;
  /** Stub length from the AABB face before the orthogonal walk. */
  jut: number;
  /** Sampling step when validating path segments. */
  step: number;
  /** Preferred center-to-center gap between connectors on the same face. */
  portSep: number;
  /** Lane pitch for orthogonal detours. */
  lane: number;
  /** How many widening detour lanes to try. */
  detourSteps: number;
};

export type LayoutConfig = {
  pack: PackConfig;
  connectors: ConnectorConfig;
};

export const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  pack: {
    iconWidth: 1,
    iconHeight: 1,
    iconGap: 2,
    groupGap: 4,
    groupPad: 1,
    groupCols: 3,
    platformZ: 0,
    iconZ: 0.01,
    connectorZ: 0,
  },
  connectors: {
    clearance: 0.45,
    jut: 0.5,
    step: 0.1,
    portSep: 4 / 48,
    lane: 0.5,
    detourSteps: 3,
  },
};

type GroupPlacement = {
  boxes: LayoutAabb[];
  items: ResourceLayoutItem<string>[];
  maxX: number;
};

function groupResources(resources: Resource[]): Map<string, Resource[]> {
  const grouped = new Map<string, Resource[]>();

  for (const resource of resources) {
    const members = grouped.get(resource.group) ?? [];
    members.push(resource);
    grouped.set(resource.group, members);
  }

  return grouped;
}

function sizeForAsset(
  asset: string,
  sizes: Map<string, MeshSize>,
  fallback: MeshSize,
): MeshSize {
  return sizes.get(asset) ?? sizes.get("all-unknown") ?? fallback;
}

function placeGroup(
  members: Resource[],
  offsetX: number,
  config: LayoutConfig["pack"],
  sizes: Map<string, MeshSize>,
  iconAabb: (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => LayoutAabb,
): GroupPlacement {
  const fallback: MeshSize = {
    width: config.iconWidth,
    height: config.iconHeight,
  };
  const boxes: LayoutAabb[] = [];
  const items: ResourceLayoutItem<string>[] = [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let x = offsetX;
  let y = 0;
  let col = 0;
  let rowHeight = 0;

  for (const resource of members) {
    const size = sizeForAsset(resource.asset, sizes, fallback);
    if (col >= config.groupCols) {
      x = offsetX;
      y += rowHeight + config.iconGap;
      col = 0;
      rowHeight = 0;
    }

    const pos: Pos = roundPos([x, y, config.iconZ]);
    boxes.push(iconAabb(resource.id, x, y, size.width, size.height));
    items.push({ type: "resource", ref: resource.id, pos });

    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + size.width);
    maxY = Math.max(maxY, y + size.height);

    x += size.width + config.iconGap;
    rowHeight = Math.max(rowHeight, size.height);
    col += 1;
  }

  if (members.length > 0) {
    items.push({
      type: "group",
      from: roundPos([
        minX - config.groupPad,
        minY - config.groupPad,
        config.platformZ,
      ]),
      to: roundPos([
        maxX + config.groupPad,
        maxY + config.groupPad,
        config.platformZ,
      ]),
    });
  }

  return { boxes, items, maxX };
}

export function layout({
  resources,
  connections,
  glb,
  config = DEFAULT_LAYOUT_CONFIG,
}: LayoutInput): LayoutOutput {
  const { pack, connectors: connectorConfig } = config;
  const sizes = meshSizesFromGlb(glb);
  const { iconAabb, buildAllConnectorPaths } =
    createConnectorEngine(connectorConfig);

  const layoutItems: ResourceLayoutItem<string>[] = [];
  const byGroup = groupResources(resources);

  const boxes: LayoutAabb[] = [];
  let groupOffsetX = 0;

  for (const [, members] of [...byGroup.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const placed = placeGroup(members, groupOffsetX, pack, sizes, iconAabb);
    boxes.push(...placed.boxes);
    layoutItems.push(...placed.items);
    if (members.length > 0) groupOffsetX = placed.maxX + pack.groupGap;
  }

  const connectionRows = resources.map((resource) => {
    const targets = new Set<string>();
    for (const connection of connections) {
      const [from, to] = connection.nodes;
      if (from === resource.id) targets.add(to);
      if (to === resource.id) targets.add(from);
    }
    return {
      id: resource.id,
      connections: [...targets],
    };
  });

  const paths = buildAllConnectorPaths(boxes, connectionRows);

  for (const path of paths) {
    layoutItems.push({
      type: "connector",
      nodes: [path.sourceId, path.targetId] as [string, string],
      path: path.points.map(
        (point): Pos => roundPos([point.x, point.y, pack.connectorZ]),
      ),
    });
  }

  return {
    resources,
    connections,
    layout: layoutItems,
  };
}
