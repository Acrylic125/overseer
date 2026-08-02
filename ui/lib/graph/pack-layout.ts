import {
  BLOCK_GAP,
  CELL_SIZE,
  PLATFORM_PAD,
  PLATFORM_SEPARATION,
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
  /** One frosted platform per group. */
  platforms: GroupPlatform[];
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

/**
 * Pack services by group into an orderly rectangular footprint.
 * Same-group blocks stay contiguous; every block is ≥1 cell from its neighbors.
 * Each group gets its own platform; platforms are ≥ PLATFORM_SEPARATION apart.
 */
export function packServicesByGroup(
  services: PackableService[],
): PackLayoutResult {
  if (services.length === 0) {
    return {
      services: [],
      platforms: [],
      bounds: { centerX: 0, centerZ: 0, width: 8, depth: 8 },
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

  const groupPacks: GroupPack[] = groupEntries.map(([group, members]) => {
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

  // Content gap so platform edges (content ± PLATFORM_PAD) stay ≥ PLATFORM_SEPARATION apart.
  const contentGap = PLATFORM_SEPARATION + PLATFORM_PAD * 2;

  const groupArea = groupPacks.reduce(
    (sum, g) =>
      sum + (g.width + contentGap) * (g.depth + contentGap),
    0,
  );
  const groupTargetWidth = Math.max(
    groupPacks[0]!.width,
    Math.ceil(Math.sqrt(groupArea)),
  );

  let cursorX = 0;
  let cursorY = 0;
  let rowDepth = 0;
  let layoutWidth = 0;
  let layoutDepth = 0;
  const groupOrigins = new Map<string, { x: number; y: number }>();

  for (const pack of groupPacks) {
    if (cursorX > 0 && cursorX + pack.width > groupTargetWidth) {
      cursorX = 0;
      cursorY += rowDepth + contentGap;
      rowDepth = 0;
    }
    groupOrigins.set(pack.group, { x: cursorX, y: cursorY });
    rowDepth = Math.max(rowDepth, pack.depth);
    layoutWidth = Math.max(layoutWidth, cursorX + pack.width);
    layoutDepth = Math.max(layoutDepth, cursorY + pack.depth);
    cursorX += pack.width + contentGap;
  }

  const byId = new Map(normalized.map((s) => [s.id, s]));
  const placedServices: InfrastructureService[] = [];

  for (const pack of groupPacks) {
    const origin = groupOrigins.get(pack.group)!;
    for (const item of pack.placed) {
      const service = byId.get(item.id)!;
      placedServices.push({
        ...service,
        width: item.width,
        depth: item.depth,
        x: origin.x + item.x,
        y: origin.y + item.y,
      });
    }
  }

  const offsetX = layoutWidth / 2;
  const offsetY = layoutDepth / 2;
  for (const service of placedServices) {
    service.x -= offsetX;
    service.y -= offsetY;
  }

  const platforms: GroupPlatform[] = groupPacks.map((pack) => {
    const origin = groupOrigins.get(pack.group)!;
    const minX = origin.x - offsetX;
    const minY = origin.y - offsetY;
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

  return {
    services: placedServices,
    platforms,
    bounds: {
      centerX: 0,
      centerZ: 0,
      width: (layoutWidth + PLATFORM_PAD * 2) * CELL_SIZE,
      depth: (layoutDepth + PLATFORM_PAD * 2) * CELL_SIZE,
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
