import {
  buildAllConnectorPaths,
  iconAabb,
  type LayoutAabb,
} from "./connectors.js";
import {
  connectionsForLayout,
  createInternetService,
  domainConnectorLabel,
  INTERNET_ID,
  isInternetService,
  isOpenToInternet,
  linkInternetDomains,
  networkingDomains,
} from "../../internet.js";
import type {
  Connector,
  Group,
  Pos,
  Resource,
  ScannedService,
  Size,
} from "../../schema.js";
import {
  roundCoord,
  roundPos,
  toWireGroup,
  toWireResource,
} from "../../schema.js";

/** Default icon cell size (matches unit-sized GLB glyphs). */
const ICON_W = 1;
const ICON_H = 1;
/** Gap between icons inside a cluster. */
const ICON_GAP = 2;
/** Edge-to-edge gap between platforms. */
const PLATFORM_GAP = 2;

/** Group label inset from the platform's top-left corner. */
const LABEL_INSET_Y = 0.5;
/** Matches UI group-title `fontSize` (single-line band). */
const GROUP_TITLE_HEIGHT = 0.35;
/** Clearance from the title band to the first icon row. */
const TITLE_CONTENT_GAP = 1;

/** Platform padding: (top, left, right, bottom). */
const PAD_TOP = LABEL_INSET_Y + GROUP_TITLE_HEIGHT + TITLE_CONTENT_GAP;
const PAD_LEFT = 1;
const PAD_RIGHT = 1;
const PAD_BOTTOM = 1;

const PLATFORM_Z = roundCoord(0);
/** Icons above connectors. */
const ICON_Z = roundCoord(0.01);
const CONNECTOR_Z = roundCoord(0);
/** Nested platforms sit slightly above their parent to avoid z-fighting. */
const NEST_Z_STEP = 0.002;

/** Path separator for nested groups (`root/mid/leaf`, max 3 segments). */
export const GROUP_SEP = "/";
export const MAX_GROUP_DEPTH = 3;

/** Matches UI public-internet footprint (cloud.svg ≈ 2:1). */
const PUBLIC_INTERNET_BASE_WIDTH = 4;
const PUBLIC_INTERNET_BASE_DEPTH = 2;
/** Edge gap between the cloud hub and the nearest service platform. */
const PUBLIC_INTERNET_GAP = 4;

function publicInternetFootprint(platformCount: number) {
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

type ClusterItem = { x: number; y: number };

type ClusterLayout = {
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

export type LayoutResult = {
  resources: Resource[];
  groups: Group[];
  static: {
    publicInternet: {
      id: "internet";
      pos: Pos;
      size?: Size;
    };
  };
  connectors: Connector[];
  totalWidth: number;
  totalHeight: number;
};

type GroupNode = {
  path: string;
  children: Map<string, GroupNode>;
  services: ScannedService[];
};

type NestedPack = {
  path: string;
  platformW: number;
  platformH: number;
  /** Child platforms — offsets are relative to this platform's top-left. */
  children: { pack: NestedPack; x: number; y: number }[];
  /** Leaf icon cluster when this node has services. */
  leaf: ClusterLayout | null;
};

/** Cap columns at ⌈√n⌉ so grids stay near-square (never wider than tall-ish). */
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
      child = { path, children: new Map(), services: [] };
      level.set(segment, child);
    }
    node = child;
    level = child.children;
  }
  return node!;
}

/** Build a forest from `service.group` paths (`a`, `a/b`, `a/b/c`). */
function buildGroupForest(services: ScannedService[]): Map<string, GroupNode> {
  const roots = new Map<string, GroupNode>();
  for (const service of services) {
    // Ungrouped hubs (public internet) are placed separately.
    if (service.group == null) continue;
    const segments = splitGroupPath(service.group);
    const path = (segments.length > 0 ? segments : ["default"]).join(GROUP_SEP);
    const node = ensureGroupNode(
      roots,
      segments.length > 0 ? segments : ["default"],
    );
    node.services.push(
      service.group === path ? service : { ...service, group: path },
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

/** Pack one group node bottom-up: children platforms + optional leaf icons. */
function packGroupNode(
  node: GroupNode,
  iconW: number,
  iconH: number,
  iconGap: number,
): NestedPack {
  const childPacks = [...node.children.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((child) => packGroupNode(child, iconW, iconH, iconGap));

  const leaf =
    node.services.length > 0
      ? packDomainCluster(node.path, node.services, iconW, iconH, iconGap)
      : null;

  // Leaf-only node: platform is just the icon cluster (already padded).
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

  // Parent: shelf-pack child platforms (and a leaf block if this node also
  // has direct services — uncommon in mock, supported for scanners).
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
    PLATFORM_GAP,
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
      // Items relative to this platform's content origin (after PAD_*).
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

// ============================================================
// PHASE 1 — CLUSTER SHAPING
// Arrange n equal cells into the cols×rows grid closest to square,
// with cols limited to ⌈√n⌉.
// ============================================================

function packCluster(
  n: number,
  w: number,
  h: number,
  G: number,
): Omit<ClusterLayout, "name" | "services" | "platformW" | "platformH"> {
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

function packPlatforms(
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

/**
 * Pack one domain group's services into a platform, clustering icons by
 * `service` (icon type) into near-square sub-blocks first.
 */
function packDomainCluster(
  name: string,
  services: ScannedService[],
  iconW: number,
  iconH: number,
  iconGap: number,
): ClusterLayout {
  // Bucket by icon basename so same types form contiguous sub-clusters.
  const byType = new Map<string, ScannedService[]>();
  for (const service of services) {
    const list = byType.get(service.service) ?? [];
    list.push(service);
    byType.set(service.service, list);
  }

  const typeBlocks = [...byType.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, members]) => {
      const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
      const packed = packCluster(sorted.length, iconW, iconH, iconGap);
      return {
        services: sorted,
        ...packed,
      };
    });

  if (typeBlocks.length === 0) {
    return {
      name,
      cols: 0,
      rows: 0,
      W: 0,
      H: 0,
      platformW: PAD_LEFT + PAD_RIGHT,
      platformH: PAD_TOP + PAD_BOTTOM,
      items: [],
      services: [],
    };
  }

  // Shelf-pack type blocks by their real footprints (tight, no max-cell waste).
  const area = typeBlocks.reduce(
    (sum, b) => sum + (b.W + iconGap) * (b.H + iconGap),
    0,
  );
  const targetW = Math.max(
    ...typeBlocks.map((b) => b.W),
    Math.ceil(Math.sqrt(area)),
  );

  const items: ClusterItem[] = [];
  const orderedServices: ScannedService[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  let maxX = 0;

  for (const block of typeBlocks) {
    if (cursorX > 0 && cursorX + block.W > targetW) {
      cursorX = 0;
      cursorY += rowH + iconGap;
      rowH = 0;
    }

    for (let j = 0; j < block.items.length; j += 1) {
      const item = block.items[j]!;
      const service = block.services[j];
      if (!service) continue;
      items.push({
        x: cursorX + item.x,
        y: cursorY + item.y,
      });
      orderedServices.push(service);
    }

    cursorX += block.W + iconGap;
    rowH = Math.max(rowH, block.H);
    maxX = Math.max(maxX, cursorX - iconGap);
  }

  const contentW = maxX;
  const contentH = cursorY + rowH;

  return {
    name,
    cols: typeBlocks.length,
    rows: 1,
    W: contentW,
    H: contentH,
    platformW: contentW + PAD_LEFT + PAD_RIGHT,
    platformH: contentH + PAD_TOP + PAD_BOTTOM,
    items,
    services: orderedServices,
  };
}

type LayoutOptions = {
  iconW?: number;
  iconH?: number;
  iconGap?: number;
  platformGap?: number;
};

function nestDepth(path: string): number {
  return Math.max(0, path.split(GROUP_SEP).length - 1);
}

function emitNestedPack(
  pack: NestedPack,
  absX: number,
  absY: number,
  iconW: number,
  iconH: number,
  iconSize: Size,
  groups: Group[],
  resources: Resource[],
  boxes: LayoutAabb[],
): void {
  const z = roundCoord(PLATFORM_Z + nestDepth(pack.path) * NEST_Z_STEP);

  groups.push(
    toWireGroup(pack.path, roundPos([absX, absY, z]), [
      pack.platformW,
      pack.platformH,
    ]),
  );

  for (const child of pack.children) {
    emitNestedPack(
      child.pack,
      absX + child.x,
      absY + child.y,
      iconW,
      iconH,
      iconSize,
      groups,
      resources,
      boxes,
    );
  }

  if (!pack.leaf) return;

  const contentOriginX = absX + PAD_LEFT;
  const contentOriginY = absY + PAD_TOP;

  for (let i = 0; i < pack.leaf.items.length; i += 1) {
    const item = pack.leaf.items[i]!;
    const service = pack.leaf.services[i];
    if (!service) continue;

    const absoluteX = contentOriginX + item.x;
    const absoluteY = contentOriginY + item.y;
    const pos: Pos = roundPos([absoluteX, absoluteY, ICON_Z]);

    resources.push(
      toWireResource({
        ...service,
        group: service.group!,
        pos,
        ...(iconW === 1 && iconH === 1 ? {} : { size: iconSize }),
      }),
    );

    boxes.push(
      iconAabb(
        service.id,
        roundCoord(absoluteX),
        roundCoord(absoluteY),
        iconW,
        iconH,
      ),
    );
  }
}

/**
 * Pack scanned services into platforms + icons + orthogonal connectors.
 * Clusters are keyed by `service.group`. Nested groups use `/` paths
 * (`root`, `root/mid`, `root/mid/leaf` — max {@link MAX_GROUP_DEPTH} segments)
 * and emit pad `parent` links.
 *
 * Public internet (`id: "internet"`) is placed in `static.publicInternet` and
 * included in connector routing as an AABB hub.
 */
export async function layoutServices(
  services: ScannedService[],
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const iconW = options.iconW ?? ICON_W;
  const iconH = options.iconH ?? ICON_H;
  const iconGap = options.iconGap ?? ICON_GAP;
  const platformGap = options.platformGap ?? PLATFORM_GAP;
  const iconSize: Size = [iconW, iconH];

  const domainsByServiceId = new Map<string, string[]>();
  for (const service of services) {
    if (isInternetService(service)) continue;
    const domains = networkingDomains(service.fields);
    if (domains.length > 0) {
      domainsByServiceId.set(service.id, domains);
    }
  }
  linkInternetDomains(services, domainsByServiceId);

  const internet = services.find(isInternetService) ?? createInternetService();
  const packable = services.filter((service) => {
    if (isInternetService(service)) {
      // Grouped internet packs with its cluster; ungrouped is the cloud hub.
      return service.group != null;
    }
    return true;
  });

  const forest = buildGroupForest(packable);
  const rootPacks = [...forest.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((node) => packGroupNode(node, iconW, iconH, iconGap));

  // Roots among themselves — same near-square platform grid as before.
  const rootClusters: ClusterLayout[] = rootPacks.map((pack) => ({
    name: pack.path,
    cols: 0,
    rows: 0,
    W: 0,
    H: 0,
    platformW: pack.platformW,
    platformH: pack.platformH,
    items: [],
    services: [],
  }));
  const packed = packPlatforms(rootClusters, platformGap);
  const hubInternet = internet.group == null ? internet : null;
  const cloud = publicInternetFootprint(Math.max(1, packed.placed.length));

  const serviceOffsetX = hubInternet
    ? cloud.width / 2 + PUBLIC_INTERNET_GAP
    : 0;
  const serviceOffsetY = -packed.totalHeight / 2;

  const groups: Group[] = [];
  const resources: Resource[] = [];
  const boxes: LayoutAabb[] = [];
  let publicInternet: LayoutResult["static"]["publicInternet"] = {
    id: INTERNET_ID,
    pos: roundPos([
      -PUBLIC_INTERNET_BASE_WIDTH / 2,
      -PUBLIC_INTERNET_BASE_DEPTH / 2,
      PLATFORM_Z,
    ]),
    size: [PUBLIC_INTERNET_BASE_WIDTH, PUBLIC_INTERNET_BASE_DEPTH],
  };

  if (hubInternet) {
    const cloudPos = roundPos([-cloud.width / 2, -cloud.depth / 2, PLATFORM_Z]);
    const cloudSize: Size = [cloud.width, cloud.depth];

    publicInternet = {
      id: INTERNET_ID,
      pos: cloudPos,
      size: cloudSize,
    };

    boxes.push(
      iconAabb(INTERNET_ID, cloudPos[0], cloudPos[1], cloud.width, cloud.depth),
    );
  }

  for (let i = 0; i < packed.placed.length; i += 1) {
    const placement = packed.placed[i]!;
    const root = rootPacks[i]!;
    const absX = placement.offsetX + serviceOffsetX;
    const absY = placement.offsetY + serviceOffsetY;
    emitNestedPack(
      root,
      absX,
      absY,
      iconW,
      iconH,
      iconSize,
      groups,
      resources,
      boxes,
    );
  }

  const graphServices = [...packable, ...(hubInternet ? [hubInternet] : [])];

  const paths = await buildAllConnectorPaths(
    boxes,
    graphServices.map((service) => ({
      id: service.id,
      // Internet edges come from `bool:Is Open To Internet`, not stored connections.
      connections: connectionsForLayout(service),
    })),
  );

  const serviceById = new Map(
    graphServices.map((service) => [service.id, service]),
  );

  const connectorLabels = (
    sourceId: string,
    targetId: string,
  ): {
    labels?: [string | null, string | null];
    variant?: "default" | "warning";
  } => {
    const involvesInternet =
      sourceId === INTERNET_ID || targetId === INTERNET_ID;

    if (involvesInternet) {
      const peerId = sourceId === INTERNET_ID ? targetId : sourceId;
      const peer = serviceById.get(peerId);
      if (!peer) return {};

      const meta = peer.connectionMeta?.[INTERNET_ID];
      if (meta?.labels) {
        return {
          labels: [meta.labels[0] ?? null, meta.labels[1] ?? null],
          variant: meta.variant,
        };
      }

      if (isOpenToInternet(peer.fields)) {
        const label = domainConnectorLabel(networkingDomains(peer.fields));
        if (label) {
          return { labels: [null, label], variant: "default" };
        }
      }
      return {};
    }

    const forward = serviceById.get(sourceId)?.connectionMeta?.[targetId];
    if (forward?.labels) {
      return {
        labels: [forward.labels[0] ?? null, forward.labels[1] ?? null],
        variant: forward.variant,
      };
    }

    const reverse = serviceById.get(targetId)?.connectionMeta?.[sourceId];
    if (reverse?.labels) {
      return {
        labels: [reverse.labels[1] ?? null, reverse.labels[0] ?? null],
        variant: reverse.variant,
      };
    }

    return {};
  };

  const connectors: Connector[] = paths.map((path) => {
    let sourceId = path.sourceId;
    let targetId = path.targetId;
    let pathPoints = path.points;

    const involvesInternet =
      sourceId === INTERNET_ID || targetId === INTERNET_ID;
    if (involvesInternet && sourceId !== INTERNET_ID) {
      sourceId = INTERNET_ID;
      targetId = path.sourceId;
      pathPoints = [...path.points].reverse();
    }

    const { labels, variant } = connectorLabels(sourceId, targetId);

    return {
      nodes: [sourceId, targetId],
      ...(labels ? { labels: [...labels] } : {}),
      ...(variant === "warning" ? { variant: "warning" as const } : {}),
      path: pathPoints.map((p): Pos => roundPos([p.x, p.y, CONNECTOR_Z])),
    };
  });

  return {
    resources,
    groups,
    static: { publicInternet },
    connectors,
    totalWidth: roundCoord(
      (hubInternet ? cloud.width / 2 + PUBLIC_INTERNET_GAP : 0) +
        packed.totalWidth,
    ),
    totalHeight: roundCoord(
      Math.max(hubInternet ? cloud.depth : 0, packed.totalHeight),
    ),
  };
}
