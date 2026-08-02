import {
  edgesFromConnections,
  layoutGraphOnGrid,
} from "@/lib/graph/grid-force-layout";
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
 * Place services on an integer grid via force-directed layout + annealing.
 * `x` / `y` are grid cell coordinates (world units = cell × block width).
 */
export function layoutServices(
  services: PlacedService[],
  options: LayoutServicesOptions = {},
): LayoutResult {
  if (services.length === 0) {
    return {
      services: [],
      edges: [],
      centerGuide: { x: 0, y: 0, radius: 4 },
    };
  }

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

  const nodes = capped.map((service) => service.id);
  const edges = edgesFromConnections(capped);
  const gridPos = layoutGraphOnGrid(nodes, edges, {
    minDist: options.minDist ?? 4,
    seed: options.seed ?? 42,
    forceIterations: options.forceIterations,
    annealIterations: options.annealIterations,
  });

  const placed = services.map((service) => {
    const cell = gridPos.get(service.id) ?? { x: 0, y: 0 };
    return {
      ...service,
      x: cell.x,
      y: cell.y,
    };
  });

  let maxR = 0;
  for (const service of placed) {
    maxR = Math.max(maxR, Math.hypot(service.x, service.y));
  }

  return {
    services: placed,
    edges: [],
    centerGuide: { x: 0, y: 0, radius: maxR + 4 },
  };
}
