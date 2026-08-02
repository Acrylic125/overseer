import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** World-space XZ window (full width × depth) streamed around the camera. */
export const RENDER_WINDOW = 100;
export const RENDER_HALF = RENDER_WINDOW / 2;

/** Quantize focus so React state only updates when the window meaningfully moves. */
export const STREAM_CELL = 8;

type SpatialIndex = {
  cellSize: number;
  cells: Map<string, InfrastructureService[]>;
};

function cellKey(cx: number, cz: number) {
  return `${cx},${cz}`;
}

/** Bucket services by world XZ for fast window queries. */
export function buildServiceSpatialIndex(
  services: InfrastructureService[],
  cellSize = STREAM_CELL,
): SpatialIndex {
  const cells = new Map<string, InfrastructureService[]>();
  for (const service of services) {
    const [wx, , wz] = serviceWorldCenter(service);
    const key = cellKey(
      Math.floor(wx / cellSize),
      Math.floor(wz / cellSize),
    );
    const bucket = cells.get(key);
    if (bucket) bucket.push(service);
    else cells.set(key, [service]);
  }
  return { cellSize, cells };
}

/** Services whose centers lie inside the axis-aligned XZ window. */
export function queryServicesInWindow(
  index: SpatialIndex,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): InfrastructureService[] {
  const { cellSize, cells } = index;
  const x0 = Math.floor(minX / cellSize);
  const x1 = Math.floor(maxX / cellSize);
  const z0 = Math.floor(minZ / cellSize);
  const z1 = Math.floor(maxZ / cellSize);
  const out: InfrastructureService[] = [];
  const seen = new Set<string>();

  for (let cx = x0; cx <= x1; cx += 1) {
    for (let cz = z0; cz <= z1; cz += 1) {
      const bucket = cells.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (const service of bucket) {
        if (seen.has(service.id)) continue;
        const [wx, , wz] = serviceWorldCenter(service);
        if (wx < minX || wx > maxX || wz < minZ || wz > maxZ) continue;
        seen.add(service.id);
        out.push(service);
      }
    }
  }

  return out;
}

export function windowAround(focusX: number, focusZ: number, half = RENDER_HALF) {
  return {
    minX: focusX - half,
    maxX: focusX + half,
    minZ: focusZ - half,
    maxZ: focusZ + half,
  };
}
