/**
 * Orthogonal connector routing for the layout plane (x/y).
 * Ported from `ui/lib/graph/connector-paths.ts` (UI uses x/z on the ground).
 */

/** Stay this far outside every service AABB (icon gap is 1.5 → corridor ≈ 1.5). */
const CONNECTOR_CLEARANCE = 0.45;
/**
 * Stub length from the AABB face into the icon gap before the orthogonal walk.
 * Must be ≥ clearance and ≤ gap − clearance so the stub sits in the corridor
 * (ICON_GAP = 1.5 → usable band ≈ [0.45, 1.05]).
 */
const CONNECTOR_JUT = 0.5;
const CONNECTOR_STEP = 0.1;
/**
 * Preferred center-to-center gap between connectors after the jut
 * (≈4 CSS px at the same 48px-per-world-unit scale). Compressed when
 * the icon face can't fit that many ports.
 * Walk clearance matches this so parallel stubs aren't rejected and forced
 * to overlap (BFS still steps by {@link CONNECTOR_LANE}).
 */
const CONNECTOR_PORT_SEP = 4 / 48;
const CONNECTOR_SEP = CONNECTOR_PORT_SEP;
/** Lane pitch for detours / BFS grid — must stay coarse or routing freezes. */
const CONNECTOR_LANE = 0.5;
/**
 * Spacing-aware attempts before we ignore connector–connector separation
 * and just route around services (or take a simple L).
 */
const MAX_SPACING_TRIES = 3;
/** Hard cap so a dense map can't hang the scan. */
const MAX_BFS_VISITS = 20_000;
/**
 * Above this many services, skip connector↔connector spacing bookkeeping
 * (O(connectors²)). Service AABB avoidance always stays on.
 */
const DENSE_SPACING_MAX_SERVICES = 120;
/** Uniform grid cell size for obstacle queries (~2 icon footprints). */
const BOX_GRID_CELL = 2;

export type LayoutAabb = {
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cx: number;
  cy: number;
};

type Pt = { x: number; y: number };

type ConnectorPath = {
  id: string;
  sourceId: string;
  targetId: string;
  points: Pt[];
};

type SegmentObstacle = { a: Pt; b: Pt };
type Dir = { x: 1 | -1 | 0; y: 1 | -1 | 0 };

/** Spatial hash so walk/clear checks stay O(nearby boxes), not O(services). */
class BoxGrid {
  readonly cellSize: number;
  private readonly cells = new Map<string, LayoutAabb[]>();

  constructor(boxes: LayoutAabb[], cellSize = BOX_GRID_CELL) {
    this.cellSize = cellSize;
    for (const box of boxes) {
      const x0 = Math.floor(box.minX / cellSize);
      const x1 = Math.floor(box.maxX / cellSize);
      const y0 = Math.floor(box.minY / cellSize);
      const y1 = Math.floor(box.maxY / cellSize);
      for (let gx = x0; gx <= x1; gx += 1) {
        for (let gy = y0; gy <= y1; gy += 1) {
          const key = `${gx},${gy}`;
          const list = this.cells.get(key);
          if (list) list.push(box);
          else this.cells.set(key, [box]);
        }
      }
    }
  }

  queryRect(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): LayoutAabb[] {
    const x0 = Math.floor(minX / this.cellSize);
    const x1 = Math.floor(maxX / this.cellSize);
    const y0 = Math.floor(minY / this.cellSize);
    const y1 = Math.floor(maxY / this.cellSize);
    const seen = new Set<string>();
    const out: LayoutAabb[] = [];
    for (let gx = x0; gx <= x1; gx += 1) {
      for (let gy = y0; gy <= y1; gy += 1) {
        const list = this.cells.get(`${gx},${gy}`);
        if (!list) continue;
        for (const box of list) {
          if (seen.has(box.id)) continue;
          if (
            box.maxX < minX ||
            box.minX > maxX ||
            box.maxY < minY ||
            box.minY > maxY
          ) {
            continue;
          }
          seen.add(box.id);
          out.push(box);
        }
      }
    }
    return out;
  }

  queryPoint(px: number, py: number, radius: number): LayoutAabb[] {
    return this.queryRect(px - radius, px + radius, py - radius, py + radius);
  }
}

type WalkSpace = {
  boxes: LayoutAabb[];
  /** Preferred — point/rect queries without scanning every service. */
  index: BoxGrid;
  /** Source/target icons the walk may touch at endpoints. */
  excludeIds: Set<string>;
  segments: SegmentObstacle[];
  clearance: number;
  sep: number;
  step: number;
};

function boxesNear(
  space: WalkSpace,
  px: number,
  py: number,
  radius: number,
): LayoutAabb[] {
  const hits = space.index.queryPoint(px, py, radius);
  if (space.excludeIds.size === 0) return hits;
  return hits.filter((box) => !space.excludeIds.has(box.id));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function same(a: number, b: number, eps = 1e-4) {
  return Math.abs(a - b) < eps;
}

function isCardinalSegment(a: Pt, b: Pt) {
  return same(a.x, b.x) || same(a.y, b.y);
}

export function iconAabb(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): LayoutAabb {
  return {
    id,
    minX: x,
    maxX: x + width,
    minY: y,
    maxY: y + height,
    cx: x + width / 2,
    cy: y + height / 2,
  };
}

function distPointToAabb(px: number, py: number, box: LayoutAabb) {
  const cx = clamp(px, box.minX, box.maxX);
  const cy = clamp(py, box.minY, box.maxY);
  return Math.hypot(px - cx, py - cy);
}

function distPointToSegment(px: number, py: number, a: Pt, b: Pt) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-12) return Math.hypot(px - a.x, py - a.y);
  const t = clamp(((px - a.x) * abx + (py - a.y) * aby) / len2, 0, 1);
  return Math.hypot(px - (a.x + abx * t), py - (a.y + aby * t));
}

function blockedBySegments(
  px: number,
  py: number,
  moveDir: Dir | null,
  space: WalkSpace,
) {
  for (const seg of space.segments) {
    const dist = distPointToSegment(px, py, seg.a, seg.b);
    if (dist >= space.sep) continue;
    const sdx = seg.b.x - seg.a.x;
    const sdy = seg.b.y - seg.a.y;
    const segAlongX = Math.abs(sdx) >= Math.abs(sdy);
    if (!moveDir) return true;
    const movingAlongX = moveDir.x !== 0;
    if (movingAlongX === segAlongX) return true;
  }
  return false;
}

function isWalkable(
  px: number,
  py: number,
  space: WalkSpace,
  moveDir: Dir | null = null,
) {
  for (const box of boxesNear(space, px, py, space.clearance)) {
    if (distPointToAabb(px, py, box) < space.clearance) return false;
  }
  return !blockedBySegments(px, py, moveDir, space);
}

function finalizeOrthogonal(points: Pt[]): Pt[] {
  if (points.length === 0) return points;

  const orth: Pt[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const prev = orth[orth.length - 1]!;
    const cur = points[i]!;
    if (!isCardinalSegment(prev, cur)) {
      orth.push({ x: cur.x, y: prev.y });
    }
    const last = orth[orth.length - 1]!;
    if (!same(last.x, cur.x) || !same(last.y, cur.y)) {
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
    const colY = same(prev.y, cur.y) && same(cur.y, next.y);
    if (colX || colY) continue;
    out.push(cur);
  }
  out.push(orth[orth.length - 1]!);
  return out;
}

function segmentDir(a: Pt, b: Pt): Dir | null {
  if (same(a.x, b.x) && same(a.y, b.y)) return null;
  if (same(a.x, b.x)) return { x: 0, y: (Math.sign(b.y - a.y) || 1) as 1 | -1 };
  if (same(a.y, b.y)) return { x: (Math.sign(b.x - a.x) || 1) as 1 | -1, y: 0 };
  return null;
}

function pathClear(points: Pt[], space: WalkSpace) {
  const orth = finalizeOrthogonal(points);
  for (let i = 0; i < orth.length - 1; i += 1) {
    const a = orth[i]!;
    const b = orth[i + 1]!;
    const dir = segmentDir(a, b);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / space.step));
    for (let s = 1; s <= n; s += 1) {
      const t = s / n;
      const px = a.x + (b.x - a.x) * t;
      const py = a.y + (b.y - a.y) * t;
      if (!isWalkable(px, py, space, dir)) return false;
    }
  }
  return true;
}

function pathClearOfBoxes(points: Pt[], space: WalkSpace) {
  return pathClear(points, { ...space, segments: [] });
}

/** Only boxes that could touch an L/Z between exit→entry (plus lane pad). */
function obstaclesNearPath(
  exit: Pt,
  entry: Pt,
  index: BoxGrid,
  excludeIds: Set<string>,
  pad: number,
): LayoutAabb[] {
  const minX = Math.min(exit.x, entry.x) - pad;
  const maxX = Math.max(exit.x, entry.x) + pad;
  const minY = Math.min(exit.y, entry.y) - pad;
  const maxY = Math.max(exit.y, entry.y) + pad;
  return index
    .queryRect(minX, maxX, minY, maxY)
    .filter((box) => !excludeIds.has(box.id));
}

function laneOffsets(max = MAX_SPACING_TRIES): number[] {
  const out: number[] = [];
  for (let k = 1; k <= max; k += 1) out.push(k);
  for (let k = 1; k <= max; k += 1) out.push(-k);
  return out;
}

/** Cheap L/Z + a few lane offsets — never O(services) skirts. */
function candidateRoutes(exit: Pt, entry: Pt): Pt[][] {
  const candidates: Pt[][] = [];
  const lanes = laneOffsets();

  candidates.push([exit, { x: entry.x, y: exit.y }, entry]);
  candidates.push([exit, { x: exit.x, y: entry.y }, entry]);

  for (const k of lanes) {
    const dy = k * CONNECTOR_LANE;
    const dx = k * CONNECTOR_LANE;

    const yFromExit = exit.y + dy;
    candidates.push([
      exit,
      { x: exit.x, y: yFromExit },
      { x: entry.x, y: yFromExit },
      entry,
    ]);

    const yFromEntry = entry.y + dy;
    candidates.push([
      exit,
      { x: exit.x, y: yFromEntry },
      { x: entry.x, y: yFromEntry },
      entry,
    ]);

    const yBelow = Math.max(exit.y, entry.y) + Math.abs(dy);
    const yAbove = Math.min(exit.y, entry.y) - Math.abs(dy);
    if (k > 0) {
      candidates.push([
        exit,
        { x: exit.x, y: yBelow },
        { x: entry.x, y: yBelow },
        entry,
      ]);
    } else {
      candidates.push([
        exit,
        { x: exit.x, y: yAbove },
        { x: entry.x, y: yAbove },
        entry,
      ]);
    }

    const xFromExit = exit.x + dx;
    candidates.push([
      exit,
      { x: xFromExit, y: exit.y },
      { x: xFromExit, y: entry.y },
      entry,
    ]);

    const xFromEntry = entry.x + dx;
    candidates.push([
      exit,
      { x: xFromEntry, y: exit.y },
      { x: xFromEntry, y: entry.y },
      entry,
    ]);

    const xRight = Math.max(exit.x, entry.x) + Math.abs(dx);
    const xLeft = Math.min(exit.x, entry.x) - Math.abs(dx);
    if (k > 0) {
      candidates.push([
        exit,
        { x: xRight, y: exit.y },
        { x: xRight, y: entry.y },
        entry,
      ]);
    } else {
      candidates.push([
        exit,
        { x: xLeft, y: exit.y },
        { x: xLeft, y: entry.y },
        entry,
      ]);
    }
  }

  return candidates;
}

/**
 * First clear path wins. Caps attempts so dense maps don't evaluate every
 * candidate against every prior segment.
 */
function pickFirstClear(
  candidates: Pt[][],
  space: WalkSpace,
  boxesOnly: boolean,
  maxTries: number,
): Pt[] | null {
  let tries = 0;
  for (const raw of candidates) {
    if (tries >= maxTries) break;
    tries += 1;
    const path = finalizeOrthogonal(raw);
    const clear = boxesOnly
      ? pathClearOfBoxes(path, space)
      : pathClear(path, space);
    if (clear) return path;
  }
  return null;
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
          finalizeOrthogonal([a, { x: c.x, y: a.y }, c]),
          finalizeOrthogonal([a, { x: a.x, y: c.y }, c]),
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
    10,
    Math.hypot(entry.x - exit.x, entry.y - exit.y) + 6,
  );
  const minX = Math.min(exit.x, entry.x) - margin;
  const maxX = Math.max(exit.x, entry.x) + margin;
  const minY = Math.min(exit.y, entry.y) - margin;
  const maxY = Math.max(exit.y, entry.y) + margin;

  const snap = (v: number) => Math.round(v / step) * step;
  const start: Pt = { x: snap(exit.x), y: snap(exit.y) };
  const goal: Pt = { x: snap(entry.x), y: snap(entry.y) };

  const walkSpace: WalkSpace = avoidSegments
    ? space
    : { ...space, segments: [] };

  const key = (p: Pt) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const inBounds = (p: Pt) =>
    p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  const okBox = (p: Pt) =>
    boxesNear(walkSpace, p.x, p.y, walkSpace.clearance).every(
      (box) => distPointToAabb(p.x, p.y, box) >= walkSpace.clearance,
    );
  const ok = (p: Pt, dir: Dir | null) => {
    if (!inBounds(p)) return false;
    return isWalkable(p.x, p.y, walkSpace, dir);
  };

  if (!okBox(start) || !okBox(goal)) return null;

  type Node = { pt: Pt; dir: Dir | null };
  const dirs: Dir[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const came = new Map<string, string | null>();
  const camePt = new Map<string, Pt>();
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
      Math.abs(cur.pt.y - goal.y) <= goalR
    ) {
      found = cur.pt;
      break;
    }
    for (const dir of dirs) {
      const next = {
        x: cur.pt.x + dir.x * step,
        y: cur.pt.y + dir.y * step,
      };
      const k = key(next);
      if (came.has(k)) continue;
      if (!ok(next, dir)) continue;
      came.set(k, key(cur.pt));
      camePt.set(k, next);
      const node = { pt: next, dir };
      const straight =
        cur.dir && cur.dir.x === dir.x && cur.dir.y === dir.y;
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

/** Last-resort detour around the obstacle hull — only returns verified-clear paths. */
function hullDetour(
  exit: Pt,
  entry: Pt,
  boxes: LayoutAabb[],
  space: WalkSpace,
): Pt[] | null {
  if (boxes.length === 0) {
    return finalizeOrthogonal([exit, { x: entry.x, y: exit.y }, entry]);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pad = space.clearance + CONNECTOR_LANE;
  for (const box of boxes) {
    minX = Math.min(minX, box.minX - pad);
    maxX = Math.max(maxX, box.maxX + pad);
    minY = Math.min(minY, box.minY - pad);
    maxY = Math.max(maxY, box.maxY + pad);
  }

  const candidates: Pt[][] = [
    [exit, { x: exit.x, y: minY }, { x: entry.x, y: minY }, entry],
    [exit, { x: exit.x, y: maxY }, { x: entry.x, y: maxY }, entry],
    [exit, { x: minX, y: exit.y }, { x: minX, y: entry.y }, entry],
    [exit, { x: maxX, y: exit.y }, { x: maxX, y: entry.y }, entry],
    // Two-bend corners — vertical legs don't have to span the full hull.
    [
      exit,
      { x: exit.x, y: minY },
      { x: minX, y: minY },
      { x: minX, y: entry.y },
      entry,
    ],
    [
      exit,
      { x: exit.x, y: maxY },
      { x: maxX, y: maxY },
      { x: maxX, y: entry.y },
      entry,
    ],
    [
      exit,
      { x: exit.x, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: entry.y },
      entry,
    ],
    [
      exit,
      { x: exit.x, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: entry.y },
      entry,
    ],
  ];

  return pickFirstClear(
    candidates,
    { ...space, boxes, segments: [] },
    true,
    candidates.length,
  );
}

/**
 * Escape ring far outside every obstacle — verified clear or null.
 * Used only when corridor routing fails on dense maps.
 */
function outerRingDetour(
  exit: Pt,
  entry: Pt,
  boxes: LayoutAabb[],
  space: WalkSpace,
  clearance: number,
): Pt[] | null {
  if (boxes.length === 0) {
    return finalizeOrthogonal([exit, { x: entry.x, y: exit.y }, entry]);
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pad = clearance + CONNECTOR_LANE * 2;
  for (const box of boxes) {
    minX = Math.min(minX, box.minX - pad);
    maxX = Math.max(maxX, box.maxX + pad);
    minY = Math.min(minY, box.minY - pad);
    maxY = Math.max(maxY, box.maxY + pad);
  }

  // Push the ring outside both endpoints too.
  minX = Math.min(minX, exit.x - pad, entry.x - pad);
  maxX = Math.max(maxX, exit.x + pad, entry.x + pad);
  minY = Math.min(minY, exit.y - pad, entry.y - pad);
  maxY = Math.max(maxY, exit.y + pad, entry.y + pad);

  const candidates: Pt[][] = [
    [exit, { x: exit.x, y: minY }, { x: entry.x, y: minY }, entry],
    [exit, { x: exit.x, y: maxY }, { x: entry.x, y: maxY }, entry],
    [exit, { x: minX, y: exit.y }, { x: minX, y: entry.y }, entry],
    [exit, { x: maxX, y: exit.y }, { x: maxX, y: entry.y }, entry],
  ];

  return pickFirstClear(
    candidates,
    { ...space, boxes, clearance, segments: [] },
    true,
    candidates.length,
  );
}

/** Pick a clear orthogonal route with few bends (UI walk algorithm). */
function walkConnectorPath(
  exit: Pt,
  entry: Pt,
  boxes: LayoutAabb[],
  index: BoxGrid,
  excludeIds: Set<string>,
  segments: SegmentObstacle[] = [],
  clearance = CONNECTOR_CLEARANCE,
  step = CONNECTOR_STEP,
): Pt[] {
  // Search pad must cover the BFS wander margin — otherwise a "clear" path
  // can leave the narrow corridor filter and cut through services outside it.
  const bfsMargin = Math.max(
    10,
    Math.hypot(entry.x - exit.x, entry.y - exit.y) + 6,
  );
  const pad = Math.max(
    clearance + CONNECTOR_LANE * (MAX_SPACING_TRIES + 2) + CONNECTOR_JUT + 1,
    bfsMargin + clearance,
  );
  const searchObstacles = obstaclesNearPath(
    exit,
    entry,
    index,
    excludeIds,
    pad,
  );
  const trackSpacing = segments.length > 0;

  // Always validate accepted routes against the full obstacle set (via index).
  const fullSpace: WalkSpace = {
    boxes,
    index,
    excludeIds,
    segments: trackSpacing ? segments : [],
    clearance,
    sep: CONNECTOR_SEP,
    step,
  };
  const searchSpace: WalkSpace = {
    boxes: searchObstacles,
    index,
    excludeIds,
    segments: trackSpacing ? segments : [],
    clearance,
    sep: CONNECTOR_SEP,
    step,
  };

  const candidates = candidateRoutes(exit, entry);

  // 1) Up to MAX_SPACING_TRIES routes that respect connector separation.
  if (trackSpacing) {
    const spaced = pickFirstClear(
      candidates,
      fullSpace,
      false,
      MAX_SPACING_TRIES,
    );
    if (spaced) return spaced;
  }

  // 2) Ignore other connectors — must still miss services.
  const boxesOnly = pickFirstClear(
    candidates,
    fullSpace,
    true,
    candidates.length,
  );
  if (boxesOnly) return boxesOnly;

  // 3) BFS around search-pad obstacles; accept only if clear of ALL services.
  const bfsBoxes = bfsAroundBoxes(exit, entry, searchSpace, false);
  if (bfsBoxes && pathClearOfBoxes(bfsBoxes, fullSpace)) return bfsBoxes;

  // 4) Verified hull around the search obstacle set.
  const hull = hullDetour(exit, entry, searchObstacles, fullSpace);
  if (hull && pathClearOfBoxes(hull, fullSpace)) return hull;

  // 5) Outer ring around search-pad obstacles — last verified option.
  const ring = outerRingDetour(
    exit,
    entry,
    searchObstacles,
    fullSpace,
    clearance,
  );
  if (ring) return ring;

  // 6) Expanded BFS still constrained to the corridor index (full validate).
  const bfsWide = bfsAroundBoxes(exit, entry, fullSpace, false);
  if (bfsWide && pathClearOfBoxes(bfsWide, fullSpace)) return bfsWide;

  // 7) Corner ring hops — verified clear or give up to empty-L only.
  const corner = outerCornerPath(exit, entry, searchObstacles, fullSpace);
  if (corner) return corner;

  if (boxes.length === 0) {
    return finalizeOrthogonal([exit, { x: entry.x, y: exit.y }, entry]);
  }

  // Still no route: grow the outer corner ring until a verified path exists.
  for (let extra = 2; extra <= 64; extra *= 2) {
    const grown = outerCornerPath(exit, entry, searchObstacles, {
      ...fullSpace,
      clearance: clearance + CONNECTOR_LANE * extra,
    });
    if (grown) return grown;
  }

  // Routing failed completely — keep endpoints connected with a far U-turn
  // outside a padded search hull (verified).
  const last = outerRingDetour(
    exit,
    entry,
    searchObstacles,
    fullSpace,
    clearance + CONNECTOR_LANE * 128,
  );
  if (last) return last;

  // No obstacles (or degenerate): simple L.
  return finalizeOrthogonal([exit, { x: entry.x, y: exit.y }, entry]);
}

/** Walk exit → outer corner → opposite corner → entry, only if fully clear. */
function outerCornerPath(
  exit: Pt,
  entry: Pt,
  boxes: LayoutAabb[],
  space: WalkSpace,
): Pt[] | null {
  if (boxes.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const pad = space.clearance + CONNECTOR_LANE * 2;
  for (const box of boxes) {
    minX = Math.min(minX, box.minX - pad);
    maxX = Math.max(maxX, box.maxX + pad);
    minY = Math.min(minY, box.minY - pad);
    maxY = Math.max(maxY, box.maxY + pad);
  }
  minX = Math.min(minX, exit.x, entry.x) - pad;
  maxX = Math.max(maxX, exit.x, entry.x) + pad;
  minY = Math.min(minY, exit.y, entry.y) - pad;
  maxY = Math.max(maxY, exit.y, entry.y) + pad;

  const corners: Pt[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
  ];

  const guard: WalkSpace = { ...space, boxes, segments: [] };

  for (const a of corners) {
    for (const b of corners) {
      if (a === b) continue;
      const path = finalizeOrthogonal([exit, a, b, entry]);
      if (pathClearOfBoxes(path, guard)) return path;
    }
  }
  return null;
}

function faceTangent(out: Dir): Dir {
  if (out.x !== 0) return { x: 0, y: 1 };
  return { x: 1, y: 0 };
}

function segmentsFromPoints(points: Pt[]): SegmentObstacle[] {
  const segs: SegmentObstacle[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]!;
    const b = points[i + 1]!;
    if (same(a.x, b.x) && same(a.y, b.y)) continue;
    segs.push({ a: { ...a }, b: { ...b } });
  }
  return segs;
}

/** Cardinal direction from `from` toward `to`. */
function cardinalToward(from: Pt, to: Pt): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: (Math.sign(dx) || 1) as 1 | -1, y: 0 };
  }
  return { x: 0, y: (Math.sign(dy) || 1) as 1 | -1 };
}

/**
 * Offset a face-exit point along the face tangent so multiple ports don't stack.
 * Prefer {@link CONNECTOR_PORT_SEP} (4px); if that span doesn't fit the icon
 * face, compress evenly. Keeps the point on the outward face (not inside).
 */
function offsetJut(
  jut: Pt,
  out: Dir,
  box: LayoutAabb,
  slot: number,
  slotCount: number,
): Pt {
  if (slotCount <= 1) return jut;
  const tangent = faceTangent(out);
  const mid = (slotCount - 1) / 2;
  const inset = 0.1;
  const avail =
    tangent.x !== 0
      ? Math.max(0, box.maxX - box.minX - inset * 2)
      : Math.max(0, box.maxY - box.minY - inset * 2);
  const desired = (slotCount - 1) * CONNECTOR_PORT_SEP;
  const sep =
    desired <= avail ? CONNECTOR_PORT_SEP : avail / (slotCount - 1);
  const delta = (slot - mid) * sep;
  const ox = jut.x + tangent.x * delta;
  const oy = jut.y + tangent.y * delta;
  // Stay on the outward face line; only clamp the tangent axis.
  if (out.x !== 0) {
    return {
      x: jut.x,
      y: clamp(oy, box.minY + inset, box.maxY - inset),
    };
  }
  return {
    x: clamp(ox, box.minX + inset, box.maxX - inset),
    y: jut.y,
  };
}

/** Exit just outside the AABB face so walks start in the icon gap, not inside. */
function faceExit(box: LayoutAabb, out: Dir, jut: number): Pt {
  if (out.x !== 0) {
    return {
      x: (out.x > 0 ? box.maxX : box.minX) + out.x * jut,
      y: box.cy,
    };
  }
  return {
    x: box.cx,
    y: (out.y > 0 ? box.maxY : box.minY) + out.y * jut,
  };
}

function buildConnectorPath(
  source: LayoutAabb,
  target: LayoutAabb,
  boxes: LayoutAabb[],
  index: BoxGrid,
  priorSegments: SegmentObstacle[],
  portSlots: {
    fromSlot: number;
    fromCount: number;
    toSlot: number;
    toCount: number;
  },
): ConnectorPath {
  const centerFrom: Pt = { x: source.cx, y: source.cy };
  const centerTo: Pt = { x: target.cx, y: target.cy };
  const excludeIds = new Set([source.id, target.id]);

  const outFrom = cardinalToward(centerFrom, centerTo);
  const outTo = cardinalToward(centerTo, centerFrom);

  let exit = faceExit(source, outFrom, CONNECTOR_JUT);
  let entry = faceExit(target, outTo, CONNECTOR_JUT);

  exit = offsetJut(
    exit,
    outFrom,
    source,
    portSlots.fromSlot,
    portSlots.fromCount,
  );
  entry = offsetJut(
    entry,
    outTo,
    target,
    portSlots.toSlot,
    portSlots.toCount,
  );

  const mid = walkConnectorPath(
    exit,
    entry,
    boxes,
    index,
    excludeIds,
    priorSegments,
  );

  // Walk already runs exit→entry; don't re-introduce elbows via duplicate joints.
  let route = mid;
  if (
    route.length === 0 ||
    !same(route[0]!.x, exit.x) ||
    !same(route[0]!.y, exit.y)
  ) {
    route = [exit, ...route];
  }
  const last = route[route.length - 1]!;
  if (!same(last.x, entry.x) || !same(last.y, entry.y)) {
    route = [...route, entry];
  }

  // center → orthogonal walk → center. Re-validate mid against all obstacles
  // so finalizeOrthogonal can't sneak in a cutter.
  const orthMid = finalizeOrthogonal(route);
  const guard: WalkSpace = {
    boxes,
    index,
    excludeIds,
    segments: [],
    clearance: CONNECTOR_CLEARANCE,
    sep: CONNECTOR_SEP,
    step: CONNECTOR_STEP,
  };
  const safeMid = pathClearOfBoxes(orthMid, guard)
    ? orthMid
    : walkConnectorPath(exit, entry, boxes, index, excludeIds, []);

  const points = finalizeOrthogonal([centerFrom, ...safeMid, centerTo]);

  return {
    id: `${source.id}->${target.id}`,
    sourceId: source.id,
    targetId: target.id,
    points,
  };
}

function faceKey(id: string, out: Dir): string {
  return `${id}|${out.x},${out.y}`;
}

/** Route all undirected connection pairs with obstacle-aware orthogonal walks. */
export async function buildAllConnectorPaths(
  boxes: LayoutAabb[],
  connections: { id: string; connections: string[] }[],
): Promise<ConnectorPath[]> {
  const byId = new Map(boxes.map((box) => [box.id, box]));
  const seen = new Set<string>();
  const pairs: {
    source: LayoutAabb;
    target: LayoutAabb;
    outFrom: Dir;
    outTo: Dir;
  }[] = [];

  for (const row of connections) {
    const source = byId.get(row.id);
    if (!source) continue;
    for (const targetId of row.connections) {
      const target = byId.get(targetId);
      if (!target) continue;
      const key = [source.id, target.id].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const centerFrom = { x: source.cx, y: source.cy };
      const centerTo = { x: target.cx, y: target.cy };
      pairs.push({
        source,
        target,
        outFrom: cardinalToward(centerFrom, centerTo),
        outTo: cardinalToward(centerTo, centerFrom),
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

  // Always avoid service AABBs. Only skip connector↔connector spacing when
  // the graph is huge (that bookkeeping is O(connectors²)).
  const trackSpacing = boxes.length <= DENSE_SPACING_MAX_SERVICES;
  const index = new BoxGrid(boxes);
  const priorSegments: SegmentObstacle[] = [];
  const paths: ConnectorPath[] = [];

  for (let i = 0; i < pairs.length; i += 1) {
    const { source, target, outFrom, outTo } = pairs[i]!;
    const fromFace = faceKey(source.id, outFrom);
    const toFace = faceKey(target.id, outTo);
    const fromSlot = faceUsed.get(fromFace) ?? 0;
    const toSlot = faceUsed.get(toFace) ?? 0;
    faceUsed.set(fromFace, fromSlot + 1);
    faceUsed.set(toFace, toSlot + 1);

    const path = buildConnectorPath(
      source,
      target,
      boxes,
      index,
      trackSpacing ? priorSegments : [],
      {
        fromSlot,
        fromCount: faceDegree.get(fromFace) ?? 1,
        toSlot,
        toCount: faceDegree.get(toFace) ?? 1,
      },
    );
    paths.push(path);

    if (trackSpacing) {
      // Register mid-path only (skip center↔jut stubs) so port packing at
      // PORT_SEP isn't treated as an overlap of the whole route.
      if (path.points.length >= 4) {
        priorSegments.push(
          ...segmentsFromPoints(path.points.slice(1, -1)),
        );
      } else if (path.points.length >= 2) {
        priorSegments.push(...segmentsFromPoints(path.points));
      }
    }

    // Yield so the CLI spinner can paint during large mock/scans.
    if (i > 0 && i % 100 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  return paths;
}
