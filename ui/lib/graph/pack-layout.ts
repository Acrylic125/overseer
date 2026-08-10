import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type GroupPlatform = {
  id?: string;
  group: string | null;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
  shape?: string;
};

export type PackLayoutResult = {
  services: InfrastructureService[];
  platforms: GroupPlatform[];
  publicInternet: GroupPlatform;
  bounds: {
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
};

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
