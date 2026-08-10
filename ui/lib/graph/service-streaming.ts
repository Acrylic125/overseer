import type { ConnectorPath } from "@/lib/graph/connector-paths";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** World-space XZ window (full width × depth) streamed around the camera. */
export const RENDER_WINDOW = 100;
export const RENDER_HALF = RENDER_WINDOW / 2;

/** Quantize focus so React state only updates when the window meaningfully moves. */
export const STREAM_CELL = 8;

export type SpatialIndex = {
  cellSize: number;
  cells: Map<string, InfrastructureService[]>;
};

export type StreamFocus = {
  focusX: number;
  focusZ: number;
};

export type StreamWindow = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type WorldFootprint = {
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
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

export function windowAround(
  focusX: number,
  focusZ: number,
  half = RENDER_HALF,
): StreamWindow {
  return {
    minX: focusX - half,
    maxX: focusX + half,
    minZ: focusZ - half,
    maxZ: focusZ + half,
  };
}

/** Snap camera focus to stream cells so React only re-renders on meaningful pan. */
export function quantizeFocus(
  x: number,
  z: number,
  cellSize = STREAM_CELL,
): StreamFocus {
  return {
    focusX: Math.floor(x / cellSize) * cellSize + cellSize / 2,
    focusZ: Math.floor(z / cellSize) * cellSize + cellSize / 2,
  };
}

export function streamServicesInWindow(
  index: SpatialIndex,
  focusX: number,
  focusZ: number,
  half = RENDER_HALF,
): InfrastructureService[] {
  const { minX, maxX, minZ, maxZ } = windowAround(focusX, focusZ, half);
  return queryServicesInWindow(index, minX, minZ, maxX, maxZ);
}

/** True when a world XZ footprint overlaps the stream window. */
export function footprintInWindow(
  footprint: WorldFootprint,
  window: StreamWindow,
): boolean {
  const halfW = footprint.width / 2;
  const halfD = footprint.depth / 2;
  const minX = footprint.centerX - halfW;
  const maxX = footprint.centerX + halfW;
  const minZ = footprint.centerZ - halfD;
  const maxZ = footprint.centerZ + halfD;
  return (
    maxX >= window.minX &&
    minX <= window.maxX &&
    maxZ >= window.minZ &&
    minZ <= window.maxZ
  );
}

/** Keep selected service and its direct neighbors visible for connector highlights. */
export function expandWithLinkedServices(
  visible: InfrastructureService[],
  all: InfrastructureService[],
  selectedId: string | null,
): InfrastructureService[] {
  if (!selectedId) return visible;

  const byId = new Map(all.map((service) => [service.id, service]));
  const visibleIds = new Set(visible.map((service) => service.id));
  const out = [...visible];

  const ensure = (id: string) => {
    if (visibleIds.has(id)) return;
    const service = byId.get(id);
    if (!service) return;
    visibleIds.add(id);
    out.push(service);
  };

  ensure(selectedId);
  const selected = byId.get(selectedId);
  if (!selected) return out;

  for (const id of selected.connections) ensure(id);
  for (const service of all) {
    if (service.connections.includes(selectedId)) ensure(service.id);
  }

  return out;
}

export function filterConnectorPaths(
  paths: ConnectorPath[],
  allowedIds: Set<string>,
): ConnectorPath[] {
  return paths.filter(
    (path) =>
      allowedIds.has(path.sourceId) && allowedIds.has(path.targetId),
  );
}
