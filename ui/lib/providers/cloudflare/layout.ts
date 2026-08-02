import { packServicesByGroup } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type InfrastructureEdgePath = {
  source: string;
  target: string;
  path: { x: number; y: number }[];
};

type PlacedService = Omit<InfrastructureService, "x" | "y">;

export type LayoutResult = {
  services: InfrastructureService[];
  edges: InfrastructureEdgePath[];
  centerGuide: { x: number; y: number; radius: number };
  platforms: {
    group: string;
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  }[];
  bounds: {
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
};

export type LayoutServicesOptions = {
  /** Kept for API compatibility; edge routing is unused in the 3D grid layout. */
  routeEdges?: boolean;
  /** Cap outbound edges per node fed into the layout solver. */
  maxLayoutConnectionsPerNode?: number;
  minDist?: number;
  seed?: number;
  forceIterations?: number;
  annealIterations?: number;
};

/**
 * Place services by group into an orderly rectangular footprint.
 * `x` / `y` are grid-cell origins (world units = cell × CELL_SIZE).
 */
export function layoutServices(
  services: PlacedService[],
  options: LayoutServicesOptions = {},
): LayoutResult {
  const capped = services.map((service) => {
    if (options.maxLayoutConnectionsPerNode == null) return service;
    return {
      ...service,
      connections: service.connections.slice(
        0,
        options.maxLayoutConnectionsPerNode,
      ),
    };
  });

  const packed = packServicesByGroup(capped);

  let maxR = 0;
  for (const service of packed.services) {
    const cx = service.x + service.width / 2;
    const cy = service.y + service.depth / 2;
    maxR = Math.max(maxR, Math.hypot(cx, cy));
  }

  return {
    services: packed.services,
    edges: [],
    centerGuide: { x: 0, y: 0, radius: maxR + 4 },
    platforms: packed.platforms,
    bounds: packed.bounds,
  };
}
