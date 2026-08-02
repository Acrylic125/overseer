import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export const CONNECTOR_CLEARANCE = 0.5;
export const CONNECTOR_STANDOFF = 0.4;
export const CONNECTOR_SIZE = 0.05;
export const CONNECTOR_STEP = 0.1;

export type WorldAabb = {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  cz: number;
};

export type ConnectorPath = {
  id: string;
  sourceId: string;
  targetId: string;
  points: { x: number; z: number }[];
};

type Dir = { x: 1 | -1 | 0; z: 1 | -1 | 0 };
type Pt = { x: number; z: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function same(a: number, b: number, eps = 1e-4) {
  return Math.abs(a - b) < eps;
}

function isCardinalSegment(a: Pt, b: Pt) {
  return same(a.x, b.x) || same(a.z, b.z);
}

export function serviceAabb(
  service: Pick<InfrastructureService, "id" | "x" | "y" | "width" | "depth">,
): WorldAabb {
  const minX = service.x * CELL_SIZE;
  const maxX = (service.x + service.width) * CELL_SIZE;
  const minZ = service.y * CELL_SIZE;
  const maxZ = (service.y + service.depth) * CELL_SIZE;
  return {
    id: service.id,
    minX,
    maxX,
    minZ,
    maxZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
  };
}

function closestPointOnAabb(box: WorldAabb, px: number, pz: number): Pt {
  return {
    x: clamp(px, box.minX, box.maxX),
    z: clamp(pz, box.minZ, box.maxZ),
  };
}

export function closestPointsBetween(
  a: WorldAabb,
  b: WorldAabb,
): { from: Pt; to: Pt } {
  let from = closestPointOnAabb(a, b.cx, b.cz);
  let to = closestPointOnAabb(b, from.x, from.z);
  from = closestPointOnAabb(a, to.x, to.z);
  to = closestPointOnAabb(b, from.x, from.z);
  return { from, to };
}

function distPointToAabb(px: number, pz: number, box: WorldAabb) {
  const cx = clamp(px, box.minX, box.maxX);
  const cz = clamp(pz, box.minZ, box.maxZ);
  return Math.hypot(px - cx, pz - cz);
}

function isWalkable(
  px: number,
  pz: number,
  obstacles: WorldAabb[],
  clearance: number,
) {
  return !obstacles.some((box) => distPointToAabb(px, pz, box) < clearance);
}

function outwardNormal(box: WorldAabb, point: Pt, toward: Pt): Dir {
  const eps = 1e-4;
  const onMinX = Math.abs(point.x - box.minX) < eps;
  const onMaxX = Math.abs(point.x - box.maxX) < eps;
  const onMinZ = Math.abs(point.z - box.minZ) < eps;
  const onMaxZ = Math.abs(point.z - box.maxZ) < eps;
  const dx = toward.x - point.x;
  const dz = toward.z - point.z;

  if ((onMinX || onMaxX) && (onMinZ || onMaxZ)) {
    if (Math.abs(dx) >= Math.abs(dz)) {
      return { x: onMaxX ? 1 : -1, z: 0 };
    }
    return { x: 0, z: onMaxZ ? 1 : -1 };
  }
  if (onMinX) return { x: -1, z: 0 };
  if (onMaxX) return { x: 1, z: 0 };
  if (onMinZ) return { x: 0, z: -1 };
  if (onMaxZ) return { x: 0, z: 1 };
  if (Math.abs(dx) >= Math.abs(dz)) {
    return { x: Math.sign(dx) || 1, z: 0 };
  }
  return { x: 0, z: Math.sign(dz) || 1 };
}

/** Drop collinear midpoints; force every remaining span to be H or V. */
function finalizeOrthogonal(points: Pt[]): Pt[] {
  if (points.length === 0) return points;

  // Break any diagonal into an elbow (X then Z).
  const orth: Pt[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const prev = orth[orth.length - 1]!;
    const cur = points[i]!;
    if (!isCardinalSegment(prev, cur)) {
      orth.push({ x: cur.x, z: prev.z });
    }
    if (!same(orth[orth.length - 1]!.x, cur.x) || !same(orth[orth.length - 1]!.z, cur.z)) {
      orth.push(cur);
    }
  }

  if (orth.length <= 2) return orth;
  const out: Pt[] = [orth[0]!];
  for (let i = 1; i < orth.length - 1; i += 1) {
    const prev = out[out.length - 1]!;
    const cur = orth[i]!;
    const next = orth[i + 1]!;
    const colX = same(prev.x, cur.x) && same(cur.x, next.x);
    const colZ = same(prev.z, cur.z) && same(cur.z, next.z);
    if (colX || colZ) continue;
    out.push(cur);
  }
  out.push(orth[orth.length - 1]!);
  return out;
}

function pathClear(
  points: Pt[],
  obstacles: WorldAabb[],
  clearance: number,
  step = CONNECTOR_STEP,
) {
  const orth = finalizeOrthogonal(points);
  for (let i = 0; i < orth.length - 1; i += 1) {
    const a = orth[i]!;
    const b = orth[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / step));
    for (let s = 1; s <= n; s += 1) {
      const t = s / n;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      if (!isWalkable(px, pz, obstacles, clearance)) return false;
    }
  }
  return true;
}

/** Run cardinal-only until blocked or the goal axis is reached. */
function runStraight(
  start: Pt,
  dir: Dir,
  goal: Pt,
  obstacles: WorldAabb[],
  clearance: number,
  step: number,
): Pt {
  let cur = { ...start };

  while (true) {
    if (dir.x !== 0) {
      const nextX = cur.x + dir.x * step;
      if ((dir.x > 0 && nextX >= goal.x) || (dir.x < 0 && nextX <= goal.x)) {
        const snapped = { x: goal.x, z: cur.z };
        return pathClear([cur, snapped], obstacles, clearance, step)
          ? snapped
          : cur;
      }
    } else {
      const nextZ = cur.z + dir.z * step;
      if ((dir.z > 0 && nextZ >= goal.z) || (dir.z < 0 && nextZ <= goal.z)) {
        const snapped = { x: cur.x, z: goal.z };
        return pathClear([cur, snapped], obstacles, clearance, step)
          ? snapped
          : cur;
      }
    }

    const next = { x: cur.x + dir.x * step, z: cur.z + dir.z * step };
    if (!isWalkable(next.x, next.z, obstacles, clearance)) return cur;
    cur = next;
  }
}

/**
 * Straight runs only. Turns are always exactly 90°.
 * Prefers a single L-bend when clear.
 */
export function walkConnectorPath(
  exit: Pt,
  entry: Pt,
  obstacles: WorldAabb[],
  clearance = CONNECTOR_CLEARANCE,
  step = CONNECTOR_STEP,
): Pt[] {
  const elbowA = finalizeOrthogonal([
    exit,
    { x: entry.x, z: exit.z },
    entry,
  ]);
  const elbowB = finalizeOrthogonal([
    exit,
    { x: exit.x, z: entry.z },
    entry,
  ]);
  if (pathClear(elbowA, obstacles, clearance, step)) return elbowA;
  if (pathClear(elbowB, obstacles, clearance, step)) return elbowB;

  const path: Pt[] = [{ ...exit }];
  let pos = { ...exit };
  let guard = 0;

  while (
    (Math.abs(pos.x - entry.x) > 1e-4 || Math.abs(pos.z - entry.z) > 1e-4) &&
    guard < 500
  ) {
    guard += 1;
    const dx = entry.x - pos.x;
    const dz = entry.z - pos.z;

    const progress: Dir[] = [];
    if (Math.abs(dx) > 1e-4) {
      progress.push({ x: Math.sign(dx) as 1 | -1, z: 0 });
    }
    if (Math.abs(dz) > 1e-4) {
      progress.push({ x: 0, z: Math.sign(dz) as 1 | -1 });
    }
    progress.sort((a, b) => {
      const ra = a.x !== 0 ? Math.abs(dx) : Math.abs(dz);
      const rb = b.x !== 0 ? Math.abs(dx) : Math.abs(dz);
      return rb - ra;
    });

    let advanced = false;
    for (const dir of progress) {
      const next = runStraight(pos, dir, entry, obstacles, clearance, step);
      if (!same(next.x, pos.x) || !same(next.z, pos.z)) {
        pos = next;
        path.push({ ...pos });
        advanced = true;
        break;
      }
    }
    if (advanced) continue;

    // 90° side-step only — run sideways until a progress axis opens.
    const sides: Dir[] = (
      [
        { x: 0, z: 1 },
        { x: 0, z: -1 },
        { x: 1, z: 0 },
        { x: -1, z: 0 },
      ] as Dir[]
    ).filter(
      (d) =>
        !progress.some((p) => p.x === d.x && p.z === d.z) &&
        !progress.some((p) => p.x === -d.x && p.z === -d.z),
    );

    let escaped = false;
    for (const side of sides) {
      let probe = { ...pos };
      let moved = false;
      for (let i = 0; i < 200; i += 1) {
        const next = {
          x: probe.x + side.x * step,
          z: probe.z + side.z * step,
        };
        if (!isWalkable(next.x, next.z, obstacles, clearance)) break;
        probe = next;
        moved = true;

        const canProgress = progress.some((dir) => {
          const n = runStraight(probe, dir, entry, obstacles, clearance, step);
          return !same(n.x, probe.x) || !same(n.z, probe.z);
        });
        if (canProgress) break;
      }

      if (moved && (!same(probe.x, pos.x) || !same(probe.z, pos.z))) {
        pos = probe;
        path.push({ ...pos });
        escaped = true;
        break;
      }
    }

    if (!escaped) {
      // Cardinal fallback L from current position — never diagonal.
      const via =
        Math.abs(entry.x - pos.x) >= Math.abs(entry.z - pos.z)
          ? { x: entry.x, z: pos.z }
          : { x: pos.x, z: entry.z };
      path.push(via, { ...entry });
      break;
    }
  }

  if (!same(pos.x, entry.x) || !same(pos.z, entry.z)) {
    if (!same(path[path.length - 1]!.x, entry.x) || !same(path[path.length - 1]!.z, entry.z)) {
      // Join with at most one 90° elbow.
      const last = path[path.length - 1]!;
      if (!isCardinalSegment(last, entry)) {
        path.push({ x: entry.x, z: last.z });
      }
      path.push({ ...entry });
    }
  }

  return finalizeOrthogonal(path);
}

export function buildConnectorPath(
  source: InfrastructureService,
  target: InfrastructureService,
  all: InfrastructureService[],
): ConnectorPath {
  const fromBox = serviceAabb(source);
  const toBox = serviceAabb(target);
  const { from: faceHint, to: faceHintTo } = closestPointsBetween(
    fromBox,
    toBox,
  );

  const outFrom = outwardNormal(fromBox, faceHint, faceHintTo);
  const outTo = outwardNormal(toBox, faceHintTo, faceHint);

  const insideFrom: Pt = { x: fromBox.cx, z: fromBox.cz };
  const insideTo: Pt = { x: toBox.cx, z: toBox.cz };

  const faceFrom: Pt = {
    x:
      outFrom.x !== 0
        ? outFrom.x > 0
          ? fromBox.maxX
          : fromBox.minX
        : insideFrom.x,
    z:
      outFrom.z !== 0
        ? outFrom.z > 0
          ? fromBox.maxZ
          : fromBox.minZ
        : insideFrom.z,
  };
  const faceTo: Pt = {
    x:
      outTo.x !== 0
        ? outTo.x > 0
          ? toBox.maxX
          : toBox.minX
        : insideTo.x,
    z:
      outTo.z !== 0
        ? outTo.z > 0
          ? toBox.maxZ
          : toBox.minZ
        : insideTo.z,
  };

  const exit: Pt = {
    x: faceFrom.x + outFrom.x * CONNECTOR_STANDOFF,
    z: faceFrom.z + outFrom.z * CONNECTOR_STANDOFF,
  };
  const entry: Pt = {
    x: faceTo.x + outTo.x * CONNECTOR_STANDOFF,
    z: faceTo.z + outTo.z * CONNECTOR_STANDOFF,
  };

  const obstacles = all
    .filter((s) => s.id !== source.id && s.id !== target.id)
    .map(serviceAabb);

  const mid = walkConnectorPath(exit, entry, obstacles);

  // mid already includes exit…entry; keep AA stubs into block centers.
  const points = finalizeOrthogonal([
    insideFrom,
    faceFrom,
    ...mid,
    faceTo,
    insideTo,
  ]);

  return {
    id: `${source.id}->${target.id}`,
    sourceId: source.id,
    targetId: target.id,
    points,
  };
}

export function buildAllConnectorPaths(
  services: InfrastructureService[],
): ConnectorPath[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const paths: ConnectorPath[] = [];

  for (const source of services) {
    for (const targetId of source.connections) {
      const target = byId.get(targetId);
      if (!target) continue;
      const key = [source.id, target.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      paths.push(buildConnectorPath(source, target, services));
    }
  }

  return paths;
}
