import { serviceAabb, type ConnectorPath } from "./graph/connector-paths";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type AccessSide = "north" | "east" | "south" | "west";
export const ACCESS_SIDES: AccessSide[] = ["north", "east", "south", "west"];
export const ACCESS_ROTATION: Record<AccessSide, number> = {
  north: 0, east: -Math.PI / 2, south: Math.PI, west: Math.PI / 2,
};

/** Conveyor ports in each wall's local coordinates, including incoming links. */
export function serviceAccessPorts(
  service: Pick<InfrastructureService, "id" | "x" | "y" | "width" | "depth">,
  paths: ConnectorPath[],
): Map<AccessSide, number[]> {
  const box = serviceAabb(service);
  const result = new Map<AccessSide, number[]>();
  for (const path of paths) {
    for (const source of [true, false]) {
      if ((source ? path.sourceId : path.targetId) !== service.id) continue;
      const points = source ? path.points : [...path.points].reverse();
      const port = points[0];
      if (!port) continue;
      const next = points.find(p => Math.hypot(p.x - port.x, p.z - port.z) > 1e-6);
      if (!next) continue;
      const dx = next.x - port.x;
      const dz = next.z - port.z;
      const side: AccessSide = Math.abs(dx) > Math.abs(dz)
        ? dx > 0 ? "east" : "west"
        : dz > 0 ? "south" : "north";
      const offset = side === "north" ? port.x - box.cx
        : side === "south" ? box.cx - port.x
        : side === "east" ? port.z - box.cz : box.cz - port.z;
      const offsets = result.get(side) ?? [];
      if (!offsets.some(value => Math.abs(value - offset) < 1e-6)) offsets.push(offset);
      result.set(side, offsets);
    }
  }
  return result;
}
