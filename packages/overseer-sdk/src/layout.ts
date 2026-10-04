import { createConnectorEngine, type LayoutAabb } from "./connectors.js";
import type { Edge } from "./core/schemas.js";
import { meshSizesFromGlb, type MeshSize } from "./glb.js";
import {
  connectionKey,
  resourceConnection,
  type LayoutOutput,
  type Pos,
  type Resource,
  type ResourceConnection,
  type ResourceLayoutItem,
} from "./types.js";

export const layoutLenses = ["application", "traffic", "ownership"] as const;
export type LayoutLens = (typeof layoutLenses)[number];

export type LayoutInput = {
  resources: Resource[];
  edges: Edge[];
  glb: Uint8Array | ArrayBuffer;
  /** Which dimension becomes the platforms. Defaults to `application`. */
  lens?: LayoutLens;
  config?: LayoutConfig;
  previous?: LayoutOutput;
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
  /** Edge-to-edge gap between root platforms. */
  groupGap: number;
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
    groupGap: 2,
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

/** Path separator for nested groups (`root/mid/leaf`, max 3 segments). */
export const GROUP_SEP = "/";
export const MAX_GROUP_DEPTH = 3;

const LABEL_INSET_Y = 0.5;
const GROUP_TITLE_HEIGHT = 0.35;
const TITLE_CONTENT_GAP = 1;

const PAD_TOP = LABEL_INSET_Y + GROUP_TITLE_HEIGHT + TITLE_CONTENT_GAP;
const PAD_LEFT = 1;
const PAD_RIGHT = 1;
const PAD_BOTTOM = 1;

const PLATFORM_Z = roundCoord(0);
const ICON_Z = roundCoord(0.01);
const CONNECTOR_Z = roundCoord(0);
const NEST_Z_STEP = 0.002;

const INTERNET_RESOURCE_ID = "internet:public";

const SHARED_GROUP = "Shared";
const UNCONNECTED_GROUP = "Unconnected";

// Numeric prefixes keep tiers ordered left to right when platforms sort by name.
const TRAFFIC_TIERS: Array<[string, string[]]> = [
  ["1 · Entry", ["DNS"]],
  ["2 · Compute", ["Project", "Worker", "Workflow", "Durable Object"]],
  ["3 · Messaging", ["Queue"]],
  ["4 · Data", ["D1", "KV", "R2", "Vectorize"]],
  ["5 · Identity", ["Entra"]],
];
const OTHER_TIER = "6 · Other";

function groupSegment(name: string) {
  return name.split(GROUP_SEP).join("-").trim() || UNCONNECTED_GROUP;
}

function trafficGroup(resource: Resource) {
  for (const [tier, services] of TRAFFIC_TIERS) {
    if (services.includes(resource.service)) return tier;
  }
  return OTHER_TIER;
}

function ownershipGroup(resource: Resource) {
  const provider = resource.tags.provider ?? resource.id.split(":")[0] ?? "unknown";
  return [provider, resource.tags.account, resource.tags.namespace ?? resource.group].filter(Boolean).map((part) => groupSegment(part!)).join(GROUP_SEP);
}

/**
 * An application is everything reachable from a root (a resource nothing points
 * at, e.g. a DNS hostname or a frontend). Resources reached from several roots
 * are shared; cycles with no root fall back to their connected component.
 */
export function applicationGroups(resources: Resource[], edges: Edge[]) {
  const byId = new Map<string, Resource>(resources.map((resource) => [resource.id, resource]));
  const outgoing = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const out = outgoing.get(edge.from) ?? [];
    out.push(edge.to);
    outgoing.set(edge.from, out);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    for (const [a, b] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      const list = neighbours.get(a) ?? [];
      list.push(b);
      neighbours.set(a, list);
    }
  }

  const roots = resources
    .filter((resource) => !inDegree.get(resource.id) && outgoing.has(resource.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const apps = new Map<string, Set<string>>();
  for (const root of roots) {
    const seen = new Set<string>([root.id]);
    const queue: string[] = [root.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const set = apps.get(id) ?? new Set<string>();
      set.add(root.id);
      apps.set(id, set);
      for (const next of outgoing.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }

  const groups = new Map<string, string>();
  for (const resource of resources) {
    if (groups.has(resource.id)) continue;
    const owners = apps.get(resource.id);
    if (owners && owners.size === 1) {
      groups.set(resource.id, groupSegment(byId.get([...owners][0]!)?.name ?? resource.name));
      continue;
    }
    if (owners && owners.size > 1) {
      groups.set(resource.id, SHARED_GROUP);
      continue;
    }
    if (!neighbours.has(resource.id)) {
      groups.set(resource.id, UNCONNECTED_GROUP);
      continue;
    }

    const component: Resource[] = [];
    const seen = new Set<string>([resource.id]);
    const queue: string[] = [resource.id];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const member = byId.get(id);
      if (member && !apps.has(id)) component.push(member);
      for (const next of neighbours.get(id) ?? []) {
        if (seen.has(next) || apps.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    const name = component
      .map((member) => member.name)
      .sort((a, b) => a.localeCompare(b))[0];
    for (const member of component) {
      groups.set(member.id, groupSegment(name ?? UNCONNECTED_GROUP));
    }
  }
  return groups;
}

function groupsForLens(lens: LayoutLens, resources: Resource[], edges: Edge[]) {
  if (lens === "application") return applicationGroups(resources, edges);
  const groups = new Map<string, string>();
  for (const resource of resources) {
    if (lens === "traffic") groups.set(resource.id, trafficGroup(resource));
    else groups.set(resource.id, ownershipGroup(resource));
  }
  return groups;
}

function connectionsFromEdges(edges: Edge[]) {
  const connections: ResourceConnection[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const key = connectionKey([edge.from, edge.to]);
    if (seen.has(key)) continue;
    seen.add(key);
    const failing = edge.alerts.some((alert) => alert.type === "error");
    connections.push(
      resourceConnection(
        edge.from,
        edge.to,
        edge.label,
        "",
        failing ? "error" : undefined,
      ),
    );
  }
  return connections;
}

function sizeForAsset(
  asset: string,
  sizes: Map<string, MeshSize>,
  fallback: MeshSize,
): MeshSize {
  return sizes.get(asset) ?? sizes.get("all-unknown") ?? fallback;
}

function sizeForResource(resource: Resource, sizes: Map<string, MeshSize>, fallback: MeshSize): MeshSize {
  return resource.size
    ? { width: resource.size[0], height: resource.size[1] }
    : sizeForAsset(resource.asset, sizes, fallback);
}

type ClusterItem = { x: number; y: number };

type ClusterLayout = {
  name: string;
  cols: number;
  rows: number;
  W: number;
  H: number;
  platformW: number;
  platformH: number;
  items: ClusterItem[];
  resources: Resource[];
};

type PlacedCluster = {
  cluster: ClusterLayout;
  offsetX: number;
  offsetY: number;
};

type PackGridResult = {
  placed: PlacedCluster[];
  totalWidth: number;
  totalHeight: number;
};

type GroupNode = {
  path: string;
  children: Map<string, GroupNode>;
  resources: Resource[];
};

type NestedPack = {
  path: string;
  platformW: number;
  platformH: number;
  children: { pack: NestedPack; x: number; y: number }[];
  leaf: ClusterLayout | null;
};

function maxColsFor(n: number): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.ceil(Math.sqrt(n)));
}

function splitGroupPath(group: string): string[] {
  return group
    .split(GROUP_SEP)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, MAX_GROUP_DEPTH);
}

function ensureGroupNode(
  roots: Map<string, GroupNode>,
  segments: string[],
): GroupNode {
  let level = roots;
  let path = "";
  let node: GroupNode | undefined;
  for (const segment of segments) {
    path = path ? `${path}${GROUP_SEP}${segment}` : segment;
    let child = level.get(segment);
    if (!child) {
      child = { path, children: new Map(), resources: [] };
      level.set(segment, child);
    }
    node = child;
    level = child.children;
  }
  return node!;
}

function buildGroupForest(resources: Resource[]): Map<string, GroupNode> {
  const roots = new Map<string, GroupNode>();
  for (const resource of resources) {
    if (resource.id === INTERNET_RESOURCE_ID) continue;
    const segments = splitGroupPath(resource.group);
    const path = (segments.length > 0 ? segments : ["default"]).join(GROUP_SEP);
    const node = ensureGroupNode(
      roots,
      segments.length > 0 ? segments : ["default"],
    );
    node.resources.push(
      resource.group === path
        ? resource
        : { ...resource, group: path },
    );
  }
  return roots;
}

function shelfPackRects(
  items: { w: number; h: number }[],
  gap: number,
): { placed: { x: number; y: number }[]; width: number; height: number } {
  if (items.length === 0) {
    return { placed: [], width: 0, height: 0 };
  }

  const area = items.reduce(
    (sum, item) => sum + (item.w + gap) * (item.h + gap),
    0,
  );
  const targetW = Math.max(
    ...items.map((item) => item.w),
    Math.ceil(Math.sqrt(area)),
  );

  const placed: { x: number; y: number }[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  let maxX = 0;

  for (const item of items) {
    if (cursorX > 0 && cursorX + item.w > targetW) {
      cursorX = 0;
      cursorY += rowH + gap;
      rowH = 0;
    }
    placed.push({ x: cursorX, y: cursorY });
    cursorX += item.w + gap;
    rowH = Math.max(rowH, item.h);
    maxX = Math.max(maxX, cursorX - gap);
  }

  return {
    placed,
    width: maxX,
    height: cursorY + rowH,
  };
}

function packCluster(
  n: number,
  w: number,
  h: number,
  G: number,
): Omit<ClusterLayout, "name" | "resources" | "platformW" | "platformH"> {
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

function packPlatformsInRow(
  clusters: ClusterLayout[],
  platformGap: number,
): PackGridResult {
  const placed: PlacedCluster[] = [];
  let cursorX = 0;
  let totalHeight = 0;
  for (const cluster of clusters) {
    placed.push({ cluster, offsetX: cursorX, offsetY: 0 });
    cursorX += cluster.platformW + platformGap;
    totalHeight = Math.max(totalHeight, cluster.platformH);
  }
  return {
    placed,
    totalWidth: Math.max(0, cursorX - platformGap),
    totalHeight,
  };
}

function packPlatforms(
  clusters: ClusterLayout[],
  platformGap: number,
): PackGridResult {
  const n = clusters.length;
  if (n === 0) {
    return { placed: [], totalWidth: 0, totalHeight: 0 };
  }

  const cellW = Math.max(...clusters.map((cluster) => cluster.platformW));
  const cellH = Math.max(...clusters.map((cluster) => cluster.platformH));
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

function packDomainCluster(
  name: string,
  resources: Resource[],
  sizes: Map<string, MeshSize>,
  fallback: MeshSize,
  iconGap: number,
  previous?: LayoutOutput,
): ClusterLayout {
  const oldGroup = previous?.layout.find((item) => item.type === "group" && item.group === name);
  if (oldGroup?.type === "group") {
    const oldResources = new Map(previous!.resources.map((resource) => [resource.id, resource]));
    const positions = new Map(previous!.layout.flatMap((item) => item.type === "resource" ? [[item.ref, item.pos] as const] : []));
    const ordered = [...resources].sort((a, b) => a.id.localeCompare(b.id));
    const items: ClusterItem[] = [];
    let width = oldGroup.to[0] - oldGroup.from[0] - PAD_LEFT - PAD_RIGHT;
    let height = oldGroup.to[1] - oldGroup.from[1] - PAD_TOP - PAD_BOTTOM;
    let nextY = height + iconGap;
    for (const resource of ordered) {
      const old = oldResources.get(resource.id);
      const pos = positions.get(resource.id);
      if (pos && old?.group === name && old.asset === resource.asset && JSON.stringify(old.size) === JSON.stringify(resource.size)) {
        items.push({ x: pos[0] - oldGroup.from[0] - PAD_LEFT, y: pos[1] - oldGroup.from[1] - PAD_TOP });
      } else {
        const size = sizeForResource(resource, sizes, fallback);
        items.push({ x: 0, y: nextY });
        width = Math.max(width, size.width);
        height = nextY + size.height;
        nextY = height + iconGap;
      }
    }
    return { name, cols: 1, rows: ordered.length, W: width, H: height,
      platformW: width + PAD_LEFT + PAD_RIGHT, platformH: height + PAD_TOP + PAD_BOTTOM,
      items, resources: ordered };
  }
  const byAsset = new Map<string, Resource[]>();
  for (const resource of resources) {
    const footprint = sizeForResource(resource, sizes, fallback);
    const key = `${resource.asset}:${footprint.width}:${footprint.height}`;
    const list = byAsset.get(key) ?? [];
    list.push(resource);
    byAsset.set(key, list);
  }

  const assetBlocks = [...byAsset.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, members]) => {
      const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
      const footprint = sizeForResource(sorted[0]!, sizes, fallback);
      const packed = packCluster(
        sorted.length,
        footprint.width,
        footprint.height,
        iconGap,
      );
      return {
        resources: sorted,
        ...packed,
      };
    });

  if (assetBlocks.length === 0) {
    return {
      name,
      cols: 0,
      rows: 0,
      W: 0,
      H: 0,
      platformW: PAD_LEFT + PAD_RIGHT,
      platformH: PAD_TOP + PAD_BOTTOM,
      items: [],
      resources: [],
    };
  }

  const area = assetBlocks.reduce(
    (sum, block) => sum + (block.W + iconGap) * (block.H + iconGap),
    0,
  );
  const targetW = Math.max(
    ...assetBlocks.map((block) => block.W),
    Math.ceil(Math.sqrt(area)),
  );

  const items: ClusterItem[] = [];
  const orderedResources: Resource[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  let maxX = 0;

  for (const block of assetBlocks) {
    if (cursorX > 0 && cursorX + block.W > targetW) {
      cursorX = 0;
      cursorY += rowH + iconGap;
      rowH = 0;
    }

    for (let j = 0; j < block.items.length; j += 1) {
      const item = block.items[j]!;
      const resource = block.resources[j];
      if (!resource) continue;
      items.push({
        x: cursorX + item.x,
        y: cursorY + item.y,
      });
      orderedResources.push(resource);
    }

    cursorX += block.W + iconGap;
    rowH = Math.max(rowH, block.H);
    maxX = Math.max(maxX, cursorX - iconGap);
  }

  const contentW = maxX;
  const contentH = cursorY + rowH;

  return {
    name,
    cols: assetBlocks.length,
    rows: 1,
    W: contentW,
    H: contentH,
    platformW: contentW + PAD_LEFT + PAD_RIGHT,
    platformH: contentH + PAD_TOP + PAD_BOTTOM,
    items,
    resources: orderedResources,
  };
}

function packGroupNode(
  node: GroupNode,
  sizes: Map<string, MeshSize>,
  fallback: MeshSize,
  iconGap: number,
  platformGap: number,
  previous?: LayoutOutput,
): NestedPack {
  const childPacks = [...node.children.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((child) =>
      packGroupNode(child, sizes, fallback, iconGap, platformGap, previous),
    );

  const leaf =
    node.resources.length > 0
      ? packDomainCluster(node.path, node.resources, sizes, fallback, iconGap, node.children.size === 0 ? previous : undefined)
      : null;

  if (childPacks.length === 0) {
    if (!leaf) {
      return {
        path: node.path,
        platformW: PAD_LEFT + PAD_RIGHT,
        platformH: PAD_TOP + PAD_BOTTOM,
        children: [],
        leaf: null,
      };
    }
    return {
      path: node.path,
      platformW: leaf.platformW,
      platformH: leaf.platformH,
      children: [],
      leaf,
    };
  }

  type Block =
    | { kind: "child"; pack: NestedPack; w: number; h: number }
    | { kind: "leaf"; leaf: ClusterLayout; w: number; h: number };

  const blocks: Block[] = childPacks.map((pack) => ({
    kind: "child" as const,
    pack,
    w: pack.platformW,
    h: pack.platformH,
  }));
  if (leaf) {
    blocks.push({
      kind: "leaf",
      leaf,
      w: leaf.W,
      h: leaf.H,
    });
  }

  const shelf = shelfPackRects(
    blocks.map((block) => ({ w: block.w, h: block.h })),
    platformGap,
  );

  const children: NestedPack["children"] = [];
  let leafOut: ClusterLayout | null = null;

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    const at = shelf.placed[i]!;
    if (block.kind === "child") {
      children.push({
        pack: block.pack,
        x: PAD_LEFT + at.x,
        y: PAD_TOP + at.y,
      });
    } else {
      leafOut = {
        ...block.leaf,
        items: block.leaf.items.map((item) => ({
          x: at.x + item.x,
          y: at.y + item.y,
        })),
      };
    }
  }

  return {
    path: node.path,
    platformW: shelf.width + PAD_LEFT + PAD_RIGHT,
    platformH: shelf.height + PAD_TOP + PAD_BOTTOM,
    children,
    leaf: leafOut,
  };
}

function nestDepth(path: string): number {
  return Math.max(0, path.split(GROUP_SEP).length - 1);
}

function labelsForPath(
  sourceId: string,
  targetId: string,
  connections: ResourceConnection[],
): [string, string] {
  for (const connection of connections) {
    const [from, to] = connection.nodes;
    if (from === sourceId && to === targetId) return connection.labels;
    if (from === targetId && to === sourceId) {
      return [connection.labels[1], connection.labels[0]];
    }
  }
  return ["", ""];
}

function emitNestedPack(
  pack: NestedPack,
  absX: number,
  absY: number,
  sizes: Map<string, MeshSize>,
  fallback: MeshSize,
  layoutItems: ResourceLayoutItem<string>[],
  boxes: LayoutAabb[],
  iconAabb: (
    id: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ) => LayoutAabb,
): void {
  const z = roundCoord(PLATFORM_Z + nestDepth(pack.path) * NEST_Z_STEP);

  layoutItems.push({
    type: "group",
    group: pack.path,
    from: roundPos([absX, absY, z]),
    to: roundPos([absX + pack.platformW, absY + pack.platformH, z]),
  });

  for (const child of pack.children) {
    emitNestedPack(
      child.pack,
      absX + child.x,
      absY + child.y,
      sizes,
      fallback,
      layoutItems,
      boxes,
      iconAabb,
    );
  }

  if (!pack.leaf) return;

  const contentOriginX = absX + PAD_LEFT;
  const contentOriginY = absY + PAD_TOP;

  for (let i = 0; i < pack.leaf.items.length; i += 1) {
    const item = pack.leaf.items[i]!;
    const resource = pack.leaf.resources[i];
    if (!resource) continue;

    const absoluteX = contentOriginX + item.x;
    const absoluteY = contentOriginY + item.y;
    const pos: Pos = roundPos([absoluteX, absoluteY, ICON_Z]);

    layoutItems.push({
      type: "resource",
      ref: resource.id,
      pos,
    });

    const footprint = sizeForResource(resource, sizes, fallback);
    boxes.push(
      iconAabb(
        resource.id,
        roundCoord(absoluteX),
        roundCoord(absoluteY),
        footprint.width,
        footprint.height,
      ),
    );
  }
}

export function layout({
  resources,
  edges,
  glb,
  lens = "application",
  config = DEFAULT_LAYOUT_CONFIG,
  previous,
}: LayoutInput): LayoutOutput {
  const { pack, connectors: connectorConfig } = config;
  const { iconAabb, buildAllConnectorPaths } =
    createConnectorEngine(connectorConfig);

  const sizes = meshSizesFromGlb(glb);
  const fallback: MeshSize = {
    width: pack.iconWidth,
    height: pack.iconHeight,
  };

  const connections = connectionsFromEdges(edges);
  const visible = resources.filter(
    (resource) => resource.id !== INTERNET_RESOURCE_ID,
  );
  const groups = groupsForLens(lens, visible, edges);
  const packable = visible.map((resource) => ({
    ...resource,
    group: groups.get(resource.id) ?? UNCONNECTED_GROUP,
  }));

  const forest = buildGroupForest(packable);
  const rootPacks = [...forest.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((node) =>
      packGroupNode(node, sizes, fallback, pack.iconGap, pack.groupGap, previous),
    );

  const rootClusters: ClusterLayout[] = rootPacks.map((nested) => ({
    name: nested.path,
    cols: 0,
    rows: 0,
    W: 0,
    H: 0,
    platformW: nested.platformW,
    platformH: nested.platformH,
    items: [],
    resources: [],
  }));
  let packed: PackGridResult;
  if (lens === "traffic") {
    packed = packPlatformsInRow(rootClusters, pack.groupGap);
  } else {
    packed = packPlatforms(rootClusters, pack.groupGap);
  }

  let serviceOffsetY = -packed.totalHeight / 2;
  if (previous) {
    const oldRoots = new Map(previous.layout.flatMap((item) =>
      item.type === "group" && !item.group.includes(GROUP_SEP) ? [[item.group, item] as const] : []));
    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    const placements = new Map<string, { x: number; y: number }>();
    // Anchor unchanged platforms first. A growing platform only moves if its
    // enlarged bounds would cover a neighbour; other platforms keep their place.
    const sorted = [...rootClusters].sort((a, b) => {
      const fits = (cluster: ClusterLayout) => {
        const old = oldRoots.get(cluster.name);
        return old && cluster.platformW <= old.to[0] - old.from[0] + POS_PRECISION && cluster.platformH <= old.to[1] - old.from[1] + POS_PRECISION;
      };
      return Number(!!fits(b)) - Number(!!fits(a));
    });
    for (const cluster of sorted) {
      const old = oldRoots.get(cluster.name);
      let x = old?.from[0] ?? 0;
      let y = old?.from[1] ?? 0;
      const overlaps = occupied.some((rect) => x < rect.x + rect.w + pack.groupGap - POS_PRECISION && x + cluster.platformW + pack.groupGap > rect.x + POS_PRECISION && y < rect.y + rect.h + pack.groupGap - POS_PRECISION && y + cluster.platformH + pack.groupGap > rect.y + POS_PRECISION);
      if (!old || overlaps) {
        x = occupied.reduce((right, rect) => Math.max(right, rect.x + rect.w + pack.groupGap), 0);
        y = 0;
      }
      placements.set(cluster.name, { x, y });
      occupied.push({ x, y, w: cluster.platformW, h: cluster.platformH });
    }
    packed.placed = rootClusters.map((cluster) => ({ cluster, offsetX: placements.get(cluster.name)!.x, offsetY: placements.get(cluster.name)!.y }));
    serviceOffsetY = 0;
  }

  const layoutItems: ResourceLayoutItem<string>[] = [];
  const boxes: LayoutAabb[] = [];

  for (let i = 0; i < packed.placed.length; i += 1) {
    const placement = packed.placed[i]!;
    const root = rootPacks[i]!;
    emitNestedPack(
      root,
      placement.offsetX,
      placement.offsetY + serviceOffsetY,
      sizes,
      fallback,
      layoutItems,
      boxes,
      iconAabb,
    );
  }

  // Retain an explicit Internet hub and its routes outside the service platforms.
  const needsInternet = resources.some(resource => resource.id === INTERNET_RESOURCE_ID)
    || connections.some(connection => connection.nodes.includes(INTERNET_RESOURCE_ID));
  const internetResource: Resource | null = needsInternet ? resources.find(resource => resource.id === INTERNET_RESOURCE_ID) ?? {
    id: INTERNET_RESOURCE_ID, name: "Public Internet", group: "internet", service: "Internet",
    url: "", asset: "all-unknown", fields: {}, alerts: [], tags: {},
  } : null;
  if (internetResource) {
    const x = boxes.reduce((right, box) => Math.max(right, box.maxX), 0) + pack.groupGap;
    const y = boxes.length ? (Math.min(...boxes.map(box => box.minY)) + Math.max(...boxes.map(box => box.maxY))) / 2 - 1 : 0;
    boxes.push(iconAabb(INTERNET_RESOURCE_ID, x, y, 4, 2));
    layoutItems.push({ type: "group", group: "__public_internet__", from: roundPos([x, y, 0]), to: roundPos([x + 4, y + 2, 0]) });
    layoutItems.push({ type: "resource", ref: INTERNET_RESOURCE_ID, pos: roundPos([x, y, ICON_Z]) });
  }

  const adjacent = new Map<string, Set<string>>();
  for (const { nodes: [from, to] } of connections) {
    for (const [a, b] of [[from, to], [to, from]] as const) {
      const targets = adjacent.get(a) ?? new Set<string>();
      targets.add(b);
      adjacent.set(a, targets);
    }
  }
  const paths = buildAllConnectorPaths(
    boxes,
    packable.map((resource) => ({ id: resource.id, connections: [...(adjacent.get(resource.id) ?? [])] })),
  );

  for (const path of paths) {
    if (path.sourceId === path.targetId) continue;
    layoutItems.push({
      type: "connector",
      nodes: [path.sourceId, path.targetId],
      labels: labelsForPath(path.sourceId, path.targetId, connections),
      path: path.points.map(
        (point): Pos => roundPos([point.x, point.y, pack.connectorZ]),
      ),
    });
  }

  const visibleConnections = connections.filter((connection) => {
    const [from, to] = connection.nodes;
    if (from === to) return false;
    return true;
  });

  return {
    resources: internetResource ? [...packable, internetResource] : packable,
    connections: visibleConnections,
    layout: layoutItems,
  };
}
