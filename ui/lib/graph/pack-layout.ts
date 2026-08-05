import {
  BLOCK_GAP,
  CELL_SIZE,
  PLATFORM_PAD,
  PLATFORM_SEPARATION,
  PUBLIC_INTERNET_BASE_DEPTH,
  PUBLIC_INTERNET_BASE_WIDTH,
  PUBLIC_INTERNET_GROUP,
  publicInternetFootprint,
} from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type PackableService = Omit<InfrastructureService, "x" | "y"> & {
  width?: number;
  depth?: number;
};

export type GroupPlatform = {
  group: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
};

export type PackLayoutResult = {
  services: InfrastructureService[];
  /** One frosted platform per service group (excludes public internet). */
  platforms: GroupPlatform[];
  /**
   * Public-internet platform sized to (3×2) * sqrt(service platform count);
   * layout is recentered on it.
   */
  publicInternet: GroupPlatform;
  /** Axis-aligned bounds of all content (world units), for camera framing. */
  bounds: {
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
};

type SizedItem = {
  id: string;
  width: number;
  depth: number;
};

type PlacedItem = SizedItem & { x: number; y: number };

/**
 * Shelf-pack items into a rectangle with a fixed edge gap between footprints.
 * Coordinates are grid-cell origins (bottom-left of each footprint).
 */
function shelfPack(
  items: SizedItem[],
  gap: number,
  targetRowWidth: number,
): { placed: PlacedItem[]; width: number; depth: number } {
  const placed: PlacedItem[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowDepth = 0;
  let maxWidth = 0;
  let maxDepth = 0;

  for (const item of items) {
    if (cursorX > 0 && cursorX + item.width > targetRowWidth) {
      cursorX = 0;
      cursorY += rowDepth + gap;
      rowDepth = 0;
    }

    placed.push({ ...item, x: cursorX, y: cursorY });
    rowDepth = Math.max(rowDepth, item.depth);
    maxWidth = Math.max(maxWidth, cursorX + item.width);
    maxDepth = Math.max(maxDepth, cursorY + item.depth);
    cursorX += item.width + gap;
  }

  return { placed, width: maxWidth, depth: maxDepth };
}

function totalArea(items: SizedItem[], gap: number) {
  let area = 0;
  for (const item of items) {
    area += (item.width + gap) * (item.depth + gap);
  }
  return Math.max(area, 1);
}

function publicInternetPlatform(
  width: number,
  depth: number,
  centerX = 0,
  centerZ = 0,
): GroupPlatform {
  return {
    group: PUBLIC_INTERNET_GROUP,
    centerX,
    centerZ,
    width: width * CELL_SIZE,
    depth: depth * CELL_SIZE,
  };
}

/**
 * Pack services by group into an orderly rectangular footprint.
 * Same-group blocks stay contiguous; every block is ≥1 cell from its neighbors.
 * Each group gets its own platform; platforms are ≥ PLATFORM_SEPARATION apart.
 *
 * The public-internet cloud is sized to (3×2) * sqrt(platform count) and placed
 * at the origin. Service platforms are packed among themselves first, then docked
 * beside the cloud with PLATFORM_SEPARATION — not shelf-packed into the same
 * grid as the cloud (which left a large empty band under the short cloud row).
 */
export function packServicesByGroup(
  services: PackableService[],
): PackLayoutResult {
  if (services.length === 0) {
    return {
      services: [],
      platforms: [],
      publicInternet: publicInternetPlatform(
        PUBLIC_INTERNET_BASE_WIDTH,
        PUBLIC_INTERNET_BASE_DEPTH,
      ),
      bounds: {
        centerX: 0,
        centerZ: 0,
        width: PUBLIC_INTERNET_BASE_WIDTH * CELL_SIZE,
        depth: PUBLIC_INTERNET_BASE_DEPTH * CELL_SIZE,
      },
    };
  }

  const normalized = services.map((service) => ({
    ...service,
    width: Math.max(1, service.width ?? 1),
    depth: Math.max(1, service.depth ?? 1),
  }));

  const byGroup = new Map<string, typeof normalized>();
  for (const service of normalized) {
    const list = byGroup.get(service.group) ?? [];
    list.push(service);
    byGroup.set(service.group, list);
  }

  const groupEntries = [...byGroup.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  type GroupPack = {
    group: string;
    placed: PlacedItem[];
    width: number;
    depth: number;
  };

  const servicePacks: GroupPack[] = groupEntries.map(([group, members]) => {
    const items: SizedItem[] = members
      .slice()
      .sort(
        (a, b) =>
          b.width * b.depth - a.width * a.depth || a.id.localeCompare(b.id),
      )
      .map((m) => ({ id: m.id, width: m.width, depth: m.depth }));

    const area = totalArea(items, BLOCK_GAP);
    const targetRowWidth = Math.max(
      items[0]!.width,
      Math.ceil(Math.sqrt(area)),
    );
    const packed = shelfPack(items, BLOCK_GAP, targetRowWidth);
    return { group, ...packed };
  });

  // Gap between service platform *content* boxes so frosted edges stay ≥ SEP apart.
  const serviceContentGap = PLATFORM_SEPARATION + PLATFORM_PAD * 2;

  const groupArea = servicePacks.reduce(
    (sum, g) =>
      sum + (g.width + serviceContentGap) * (g.depth + serviceContentGap),
    0,
  );
  const groupTargetWidth = Math.max(
    servicePacks[0]!.width,
    Math.ceil(Math.sqrt(groupArea)),
  );

  let cursorX = 0;
  let cursorY = 0;
  let rowDepth = 0;
  let layoutWidth = 0;
  let layoutDepth = 0;
  const groupOrigins = new Map<string, { x: number; y: number }>();

  for (const pack of servicePacks) {
    if (cursorX > 0 && cursorX + pack.width > groupTargetWidth) {
      cursorX = 0;
      cursorY += rowDepth + serviceContentGap;
      rowDepth = 0;
    }
    groupOrigins.set(pack.group, { x: cursorX, y: cursorY });
    rowDepth = Math.max(rowDepth, pack.depth);
    layoutWidth = Math.max(layoutWidth, cursorX + pack.width);
    layoutDepth = Math.max(layoutDepth, cursorY + pack.depth);
    cursorX += pack.width + serviceContentGap;
  }

  const cloud = publicInternetFootprint(servicePacks.length);
  // Cloud has no frosted pad; service platforms do — edge gap SEP ⇒ content gap SEP+PAD.
  const cloudToServiceGap = PLATFORM_SEPARATION + PLATFORM_PAD;

  // Dock the service cluster to the right of the cloud (cloud centered on origin later).
  // Cloud occupies [0, cloud.width] × [0, cloud.depth] in this pre-center space.
  const serviceOffsetX = cloud.width + cloudToServiceGap;
  // Vertically align cluster center with cloud center.
  const serviceOffsetY = cloud.depth / 2 - layoutDepth / 2;

  const byId = new Map(normalized.map((s) => [s.id, s]));
  const placedServices: InfrastructureService[] = [];

  for (const pack of servicePacks) {
    const origin = groupOrigins.get(pack.group)!;
    for (const item of pack.placed) {
      const service = byId.get(item.id)!;
      placedServices.push({
        ...service,
        width: item.width,
        depth: item.depth,
        x: serviceOffsetX + origin.x + item.x,
        y: serviceOffsetY + origin.y + item.y,
      });
    }
  }

  // Recenter so the cloud sits at the world origin.
  const offsetX = cloud.width / 2;
  const offsetY = cloud.depth / 2;
  for (const service of placedServices) {
    service.x -= offsetX;
    service.y -= offsetY;
  }

  const platforms: GroupPlatform[] = servicePacks.map((pack) => {
    const origin = groupOrigins.get(pack.group)!;
    const minX = serviceOffsetX + origin.x - offsetX;
    const minY = serviceOffsetY + origin.y - offsetY;
    const centerX = (minX + pack.width / 2) * CELL_SIZE;
    const centerZ = (minY + pack.depth / 2) * CELL_SIZE;
    return {
      group: pack.group,
      centerX,
      centerZ,
      width: (pack.width + PLATFORM_PAD * 2) * CELL_SIZE,
      depth: (pack.depth + PLATFORM_PAD * 2) * CELL_SIZE,
    };
  });

  const publicInternet = publicInternetPlatform(cloud.width, cloud.depth, 0, 0);

  const allPlatforms = [...platforms, publicInternet];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const platform of allPlatforms) {
    minX = Math.min(minX, platform.centerX - platform.width / 2);
    maxX = Math.max(maxX, platform.centerX + platform.width / 2);
    minZ = Math.min(minZ, platform.centerZ - platform.depth / 2);
    maxZ = Math.max(maxZ, platform.centerZ + platform.depth / 2);
  }

  return {
    services: placedServices,
    platforms,
    publicInternet,
    bounds: {
      centerX: 0,
      centerZ: 0,
      width: Math.max(maxX - minX, cloud.width * CELL_SIZE),
      depth: Math.max(maxZ - minZ, cloud.depth * CELL_SIZE),
    },
  };
}

/** World-space center of a service footprint. */
export function serviceWorldCenter(
  service: Pick<InfrastructureService, "x" | "y" | "width" | "depth">,
): [number, number, number] {
  return [
    (service.x + service.width / 2) * CELL_SIZE,
    0,
    (service.y + service.depth / 2) * CELL_SIZE,
  ];
}
