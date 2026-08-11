import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export const CONNECTOR_CLEARANCE = 0.5;
export const CONNECTOR_STANDOFF = 0.4;
/** Ribbon width — keep below {@link CONNECTOR_PORT_SEP} so 4px centers don't fuse. */
export const CONNECTOR_SIZE = 0.03;
export const CONNECTOR_STEP = 0.1;
/**
 * Preferred center-to-center gap between connectors after the jut
 * (≈4 CSS px at 48px/unit). Compressed when the face can't fit.
 * Walk clearance matches this so parallel stubs aren't forced to overlap.
 */
export const CONNECTOR_PORT_SEP = 4 / 48;
export const CONNECTOR_SEP = CONNECTOR_PORT_SEP;
/** Lane pitch for detours / BFS grid — must stay coarse or routing freezes. */
export const CONNECTOR_LANE = 0.55;
/** How many lane offsets to try before giving up (down first, then up). */
const MAX_LANE_TRIES = 8;
/** Hard cap so a dense map can't hang routing. */
const MAX_BFS_VISITS = 20_000;

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
  variant?: "default" | "warning";
  labels?: [string | null, string | null];
};

export type SegmentObstacle = {
  a: { x: number; z: number };
  b: { x: number; z: number };
};

type Dir = { x: 1 | -1 | 0; z: 1 | -1 | 0 };
type Pt = { x: number; z: number };

type WalkSpace = {
  boxes: WorldAabb[];
  segments: SegmentObstacle[];
  clearance: number;
  sep: number;
  step: number;
};

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

function distPointToSegment(px: number, pz: number, a: Pt, b: Pt) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-12) return Math.hypot(px - a.x, pz - a.z);
  const t = clamp(((px - a.x) * abx + (pz - a.z) * abz) / len2, 0, 1);
  return Math.hypot(px - (a.x + abx * t), pz - (a.z + abz * t));
}

/**
 * Parallel runs must stay `sep` apart so tubes don't look joined.
 * Perpendicular crossings are allowed.
 */
function blockedBySegments(
  px: number,
  pz: number,
  moveDir: Dir | null,
  space: WalkSpace,
) {
  for (const seg of space.segments) {
    const dist = distPointToSegment(px, pz, seg.a, seg.b);
    if (dist >= space.sep) continue;

    const sdx = seg.b.x - seg.a.x;
    const sdz = seg.b.z - seg.a.z;
    const segAlongX = Math.abs(sdx) >= Math.abs(sdz);

    if (!moveDir) return true;

    const movingAlongX = moveDir.x !== 0;
    if (movingAlongX === segAlongX) return true;
  }
  return false;
}

function isWalkable(
  px: number,
  pz: number,
  space: WalkSpace,
  moveDir: Dir | null = null,
) {
  if (space.boxes.some((box) => distPointToAabb(px, pz, box) < space.clearance)) {
    return false;
  }
  return !blockedBySegments(px, pz, moveDir, space);
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

  const orth: Pt[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const prev = orth[orth.length - 1]!;
    const cur = points[i]!;
    if (!isCardinalSegment(prev, cur)) {
      orth.push({ x: cur.x, z: prev.z });
    }
    if (
      !same(orth[orth.length - 1]!.x, cur.x) ||
      !same(orth[orth.length - 1]!.z, cur.z)
    ) {
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

function segmentDir(a: Pt, b: Pt): Dir | null {
  if (same(a.x, b.x) && same(a.z, b.z)) return null;
  if (same(a.x, b.x)) return { x: 0, z: Math.sign(b.z - a.z) || 1 };
  if (same(a.z, b.z)) return { x: Math.sign(b.x - a.x) || 1, z: 0 };
  return null;
}

function pathClear(points: Pt[], space: WalkSpace) {
  const orth = finalizeOrthogonal(points);
  for (let i = 0; i < orth.length - 1; i += 1) {
    const a = orth[i]!;
    const b = orth[i + 1]!;
    const dir = segmentDir(a, b);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = Math.max(1, Math.ceil(len / space.step));
    for (let s = 1; s <= n; s += 1) {
      const t = s / n;
      const px = a.x + (b.x - a.x) * t;
      const pz = a.z + (b.z - a.z) * t;
      if (!isWalkable(px, pz, space, dir)) return false;
    }
  }
  return true;
}

/** Hard check: does the path clip any service box? */
function pathClearOfBoxes(points: Pt[], space: WalkSpace) {
  return pathClear(points, { ...space, segments: [] });
}

function pathLength(points: Pt[]) {
  let len = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    len += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return len;
}

function scorePath(path: Pt[]) {
  return Math.max(0, path.length - 2) * 1000 + pathLength(path);
}

/** Lane multipliers: +1,+2,… (down) then −1,−2,… (up). */
function laneOffsets(max = MAX_LANE_TRIES): number[] {
  const out: number[] = [];
  for (let k = 1; k <= max; k += 1) out.push(k);
  for (let k = 1; k <= max; k += 1) out.push(-k);
  return out;
}

/**
 * Build clean orthogonal candidates — L, Z, and U bends on lane grids,
 * plus channels that skirt each service AABB.
 */
function candidateRoutes(
  exit: Pt,
  entry: Pt,
  boxes: WorldAabb[],
  clearance: number,
): Pt[][] {
  const candidates: Pt[][] = [];
  const lanes = laneOffsets();

  // Direct L-bends.
  candidates.push([exit, { x: entry.x, z: exit.z }, entry]);
  candidates.push([exit, { x: exit.x, z: entry.z }, entry]);

  for (const k of lanes) {
    const dz = k * CONNECTOR_LANE;
    const dx = k * CONNECTOR_LANE;

    const zFromExit = exit.z + dz;
    candidates.push([
      exit,
      { x: exit.x, z: zFromExit },
      { x: entry.x, z: zFromExit },
      entry,
    ]);

    const zFromEntry = entry.z + dz;
    candidates.push([
      exit,
      { x: exit.x, z: zFromEntry },
      { x: entry.x, z: zFromEntry },
      entry,
    ]);

    // Prefer going downwards (+Z) past both ends, then turn back up.
    const zBelow = Math.max(exit.z, entry.z) + Math.abs(dz);
    const zAbove = Math.min(exit.z, entry.z) - Math.abs(dz);
    if (k > 0) {
      candidates.push([
        exit,
        { x: exit.x, z: zBelow },
        { x: entry.x, z: zBelow },
        entry,
      ]);
    } else {
      candidates.push([
        exit,
        { x: exit.x, z: zAbove },
        { x: entry.x, z: zAbove },
        entry,
      ]);
    }

    const xFromExit = exit.x + dx;
    candidates.push([
      exit,
      { x: xFromExit, z: exit.z },
      { x: xFromExit, z: entry.z },
      entry,
    ]);

    const xFromEntry = entry.x + dx;
    candidates.push([
      exit,
      { x: xFromEntry, z: exit.z },
      { x: xFromEntry, z: entry.z },
      entry,
    ]);

    const xRight = Math.max(exit.x, entry.x) + Math.abs(dx);
    const xLeft = Math.min(exit.x, entry.x) - Math.abs(dx);
    if (k > 0) {
      candidates.push([
        exit,
        { x: xRight, z: exit.z },
        { x: xRight, z: entry.z },
        entry,
      ]);
    } else {
      candidates.push([
        exit,
        { x: xLeft, z: exit.z },
        { x: xLeft, z: entry.z },
        entry,
      ]);
    }
  }

  // Skirt each service on all four sides (hard clearance + one lane).
  const pad = clearance + CONNECTOR_LANE;
  for (const box of boxes) {
    const zHi = box.maxZ + pad;
    const zLo = box.minZ - pad;
    const xHi = box.maxX + pad;
    const xLo = box.minX - pad;

    candidates.push(
      [exit, { x: exit.x, z: zHi }, { x: entry.x, z: zHi }, entry],
      [exit, { x: exit.x, z: zLo }, { x: entry.x, z: zLo }, entry],
      [exit, { x: xHi, z: exit.z }, { x: xHi, z: entry.z }, entry],
      [exit, { x: xLo, z: exit.z }, { x: xLo, z: entry.z }, entry],
      // Corner wraps (still only a few clean bends).
      [
        exit,
        { x: exit.x, z: zHi },
        { x: xHi, z: zHi },
        { x: xHi, z: entry.z },
        entry,
      ],
      [
        exit,
        { x: exit.x, z: zHi },
        { x: xLo, z: zHi },
        { x: xLo, z: entry.z },
        entry,
      ],
      [
        exit,
        { x: exit.x, z: zLo },
        { x: xHi, z: zLo },
        { x: xHi, z: entry.z },
        entry,
      ],
      [
        exit,
        { x: exit.x, z: zLo },
        { x: xLo, z: zLo },
        { x: xLo, z: entry.z },
        entry,
      ],
    );
  }

  return candidates;
}

/**
 * Orthogonal BFS that never enters service clearance.
 * Prefers long straight runs so the result doesn't stair-step.
 */
function bfsAroundBoxes(
  exit: Pt,
  entry: Pt,
  space: WalkSpace,
  avoidSegments: boolean,
): Pt[] | null {
  const step = CONNECTOR_LANE;
  const margin = Math.max(
    8,
    Math.hypot(entry.x - exit.x, entry.z - exit.z) + 4,
  );
  const minX = Math.min(exit.x, entry.x) - margin;
  const maxX = Math.max(exit.x, entry.x) + margin;
  const minZ = Math.min(exit.z, entry.z) - margin;
  const maxZ = Math.max(exit.z, entry.z) + margin;

  const snap = (v: number) => Math.round(v / step) * step;
  const start: Pt = { x: snap(exit.x), z: snap(exit.z) };
  const goal: Pt = { x: snap(entry.x), z: snap(entry.z) };

  const walkSpace: WalkSpace = avoidSegments
    ? space
    : { ...space, segments: [] };

  const key = (p: Pt) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const inBounds = (p: Pt) =>
    p.x >= minX && p.x <= maxX && p.z >= minZ && p.z <= maxZ;
  const okBox = (p: Pt) =>
    !walkSpace.boxes.some(
      (box) => distPointToAabb(p.x, p.z, box) < walkSpace.clearance,
    );
  const ok = (p: Pt, dir: Dir | null) => {
    if (!inBounds(p)) return false;
    return isWalkable(p.x, p.z, walkSpace, dir);
  };

  // Endpoints only need to clear services (they may sit near peer stubs).
  if (!okBox(start) || !okBox(goal)) return null;

  type Node = { pt: Pt; dir: Dir | null };
  const dirs: Dir[] = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0, z: 1 },
    { x: 0, z: -1 },
  ];
  const came = new Map<string, string | null>();
  const camePt = new Map<string, Pt>();
  // 0-1 BFS: prefer continuing straight (cost 0) over turning (cost 1).
  const q: Node[] = [{ pt: start, dir: null }];
  came.set(key(start), null);
  camePt.set(key(start), start);

  let found: Pt | null = null;
  const goalR = step * 0.51;
  let visits = 0;

  while (q.length > 0) {
    if (visits >= MAX_BFS_VISITS) return null;
    visits += 1;
    const cur = q.shift()!;
    if (
      Math.abs(cur.pt.x - goal.x) <= goalR &&
      Math.abs(cur.pt.z - goal.z) <= goalR
    ) {
      found = cur.pt;
      break;
    }
    for (const dir of dirs) {
      const next = {
        x: cur.pt.x + dir.x * step,
        z: cur.pt.z + dir.z * step,
      };
      const k = key(next);
      if (came.has(k)) continue;
      if (!ok(next, dir)) continue;
      came.set(k, key(cur.pt));
      camePt.set(k, next);
      const node = { pt: next, dir };
      const straight =
        cur.dir && cur.dir.x === dir.x && cur.dir.z === dir.z;
      if (straight) q.unshift(node);
      else q.push(node);
    }
  }

  if (!found) return null;

  const gridPath: Pt[] = [];
  let ck: string | null = key(found);
  while (ck) {
    gridPath.push(camePt.get(ck)!);
    ck = came.get(ck) ?? null;
  }
  gridPath.reverse();

  return collapseToCleanBends(
    finalizeOrthogonal([exit, ...gridPath, entry]),
    walkSpace,
  );
}

/** Replace stair-steps with a single L/Z whenever that shortcut stays clear. */
function collapseToCleanBends(path: Pt[], space: WalkSpace): Pt[] {
  let pts = finalizeOrthogonal(path);
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length - 2; i += 1) {
      const a = pts[i]!;
      for (let j = i + 2; j < pts.length; j += 1) {
        const c = pts[j]!;
        const elbows = [
          finalizeOrthogonal([a, { x: c.x, z: a.z }, c]),
          finalizeOrthogonal([a, { x: a.x, z: c.z }, c]),
        ];
        for (const elbow of elbows) {
          if (!pathClear(elbow, space)) continue;
          const trial = finalizeOrthogonal([
            ...pts.slice(0, i),
            ...elbow,
            ...pts.slice(j + 1),
          ]);
          if (trial.length < pts.length && pathClear(trial, space)) {
            pts = trial;
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
      if (changed) break;
    }
  }
  return pts;
}

function pickBestClear(
  candidates: Pt[][],
  space: WalkSpace,
  boxesOnly: boolean,
): Pt[] | null {
  let best: Pt[] | null = null;
  let bestScore = Infinity;
  for (const raw of candidates) {
    const path = finalizeOrthogonal(raw);
    const clear = boxesOnly
      ? pathClearOfBoxes(path, space)
      : pathClear(path, space);
    if (!clear) continue;
    const score = scorePath(path);
    if (score < bestScore) {
      bestScore = score;
      best = path;
    }
  }
  return best;
}

/**
 * Pick a clear orthogonal route with few bends.
 * Service boxes are hard obstacles; connector spacing is preferred but secondary.
 */
export function walkConnectorPath(
  exit: Pt,
  entry: Pt,
  obstacles: WorldAabb[],
  segments: SegmentObstacle[] = [],
  clearance = CONNECTOR_CLEARANCE,
  step = CONNECTOR_STEP,
): Pt[] {
  const space: WalkSpace = {
    boxes: obstacles,
    segments,
    clearance,
    sep: CONNECTOR_SEP,
    step,
  };

  const candidates = candidateRoutes(exit, entry, obstacles, clearance);

  // 1) Prefer routes clear of services AND other connectors.
  const full = pickBestClear(candidates, space, false);
  if (full) return full;

  // 2) BFS that respects both (still clean corners after collapse).
  const bfsFull = bfsAroundBoxes(exit, entry, space, true);
  if (bfsFull && pathClear(bfsFull, space)) return finalizeOrthogonal(bfsFull);

  // 3) Must not hit services — allow connector overlap if unavoidable.
  const boxesOnly = pickBestClear(candidates, space, true);
  if (boxesOnly) return boxesOnly;

  const bfsBoxes = bfsAroundBoxes(exit, entry, space, false);
  if (bfsBoxes && pathClearOfBoxes(bfsBoxes, space)) {
    return finalizeOrthogonal(bfsBoxes);
  }

  // Last resort L — only if even BFS failed (should be rare).
  return finalizeOrthogonal([exit, { x: entry.x, z: exit.z }, entry]);
}

function segmentsFromPoints(points: Pt[]): SegmentObstacle[] {
  const segs: SegmentObstacle[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (same(a.x, b.x) && same(a.z, b.z)) continue;
    segs.push({ a: { ...a }, b: { ...b } });
  }
  return segs;
}

/** Spread ports along a face so multiple edges don't share one stub. */
function faceTangent(out: Dir): Dir {
  if (out.x !== 0) return { x: 0, z: 1 };
  return { x: 1, z: 0 };
}

function offsetAlongFace(
  face: Pt,
  out: Dir,
  box: WorldAabb,
  slot: number,
  slotCount: number,
): Pt {
  if (slotCount <= 1) return face;
  const tangent = faceTangent(out);
  const mid = (slotCount - 1) / 2;
  const inset = 0.15;
  const avail =
    tangent.x !== 0
      ? Math.max(0, box.maxX - box.minX - inset * 2)
      : Math.max(0, box.maxZ - box.minZ - inset * 2);
  const desired = (slotCount - 1) * CONNECTOR_PORT_SEP;
  const sep =
    desired <= avail ? CONNECTOR_PORT_SEP : avail / (slotCount - 1);
  const delta = (slot - mid) * sep;
  const ox = face.x + tangent.x * delta;
  const oz = face.z + tangent.z * delta;
  if (out.x !== 0) {
    return { x: face.x, z: clamp(oz, box.minZ + inset, box.maxZ - inset) };
  }
  return { x: clamp(ox, box.minX + inset, box.maxX - inset), z: face.z };
}

export function buildConnectorPath(
  source: InfrastructureService,
  target: InfrastructureService,
  /** Precomputed AABBs for obstacle avoidance; empty skips routing checks. */
  obstacles: WorldAabb[] = [],
  /** Previously routed connector mid-paths to avoid overlapping. */
  priorSegments: SegmentObstacle[] = [],
  portSlots?: {
    fromSlot: number;
    fromCount: number;
    toSlot: number;
    toCount: number;
  },
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

  let faceFrom: Pt = {
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
  let faceTo: Pt = {
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

  if (portSlots) {
    faceFrom = offsetAlongFace(
      faceFrom,
      outFrom,
      fromBox,
      portSlots.fromSlot,
      portSlots.fromCount,
    );
    faceTo = offsetAlongFace(
      faceTo,
      outTo,
      toBox,
      portSlots.toSlot,
      portSlots.toCount,
    );
  }

  const exit: Pt = {
    x: faceFrom.x + outFrom.x * CONNECTOR_STANDOFF,
    z: faceFrom.z + outFrom.z * CONNECTOR_STANDOFF,
  };
  const entry: Pt = {
    x: faceTo.x + outTo.x * CONNECTOR_STANDOFF,
    z: faceTo.z + outTo.z * CONNECTOR_STANDOFF,
  };

  const mid = walkConnectorPath(exit, entry, obstacles, priorSegments);

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

/** Above this, skip per-segment obstacle walks — they are O(paths × services). */
const OBSTACLE_ROUTING_MAX_SERVICES = 120;

function faceKey(id: string, out: { x: number; z: number }): string {
  return `${id}|${out.x},${out.z}`;
}

export function buildAllConnectorPaths(
  services: InfrastructureService[],
): ConnectorPath[] {
  const byId = new Map(services.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const pairs: {
    source: InfrastructureService;
    target: InfrastructureService;
    outFrom: Dir;
    outTo: Dir;
  }[] = [];

  for (const source of services) {
    for (const targetId of source.connections) {
      const target = byId.get(targetId);
      if (!target) continue;
      const key = [source.id, target.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const fromBox = serviceAabb(source);
      const toBox = serviceAabb(target);
      const { from: faceHint, to: faceHintTo } = closestPointsBetween(
        fromBox,
        toBox,
      );
      pairs.push({
        source,
        target,
        outFrom: outwardNormal(fromBox, faceHint, faceHintTo),
        outTo: outwardNormal(toBox, faceHintTo, faceHint),
      });
    }
  }

  // Slot ports per exit face so same-side stubs pack at PORT_SEP.
  const faceDegree = new Map<string, number>();
  for (const { source, target, outFrom, outTo } of pairs) {
    const fromFace = faceKey(source.id, outFrom);
    const toFace = faceKey(target.id, outTo);
    faceDegree.set(fromFace, (faceDegree.get(fromFace) ?? 0) + 1);
    faceDegree.set(toFace, (faceDegree.get(toFace) ?? 0) + 1);
  }
  const faceUsed = new Map<string, number>();

  const routeAroundObstacles = services.length <= OBSTACLE_ROUTING_MAX_SERVICES;
  const allAabbs = routeAroundObstacles ? services.map(serviceAabb) : null;
  const priorSegments: SegmentObstacle[] = [];
  const paths: ConnectorPath[] = [];

  for (const { source, target, outFrom, outTo } of pairs) {
    const fromFace = faceKey(source.id, outFrom);
    const toFace = faceKey(target.id, outTo);
    const fromSlot = faceUsed.get(fromFace) ?? 0;
    const toSlot = faceUsed.get(toFace) ?? 0;
    faceUsed.set(fromFace, fromSlot + 1);
    faceUsed.set(toFace, toSlot + 1);

    const obstacles = allAabbs
      ? allAabbs.filter(
          (box) => box.id !== source.id && box.id !== target.id,
        )
      : [];

    const path = buildConnectorPath(
      source,
      target,
      obstacles,
      routeAroundObstacles ? priorSegments : [],
      {
        fromSlot,
        fromCount: faceDegree.get(fromFace) ?? 1,
        toSlot,
        toCount: faceDegree.get(toFace) ?? 1,
      },
    );
    paths.push(path);

    // Register only the routed mid (exit…entry), not face stubs into the blocks.
    // points: center → face → mid… → face → center
    if (routeAroundObstacles && path.points.length >= 6) {
      const mid = path.points.slice(2, -2);
      priorSegments.push(...segmentsFromPoints(mid));
    } else if (routeAroundObstacles && path.points.length >= 4) {
      const mid = path.points.slice(1, -1);
      priorSegments.push(...segmentsFromPoints(mid));
    }
  }

  return paths;
}
