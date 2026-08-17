import type { ConnectorConfig } from "./layout.js";

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

type SegmentObstacle = { a: Pt; b: Pt };
type Axis = "x" | "y";
type Dir = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export type RoutedConnectorPath = {
  id: string;
  sourceId: string;
  targetId: string;
  points: Pt[];
};

type ConnectionRow = {
  id: string;
  connections: string[];
};

type ConnectorPair = {
  source: LayoutAabb;
  target: LayoutAabb;
  sourceDir: Dir;
  targetDir: Dir;
};

type RouteContext = {
  boxes: LayoutAabb[];
  sourceId: string;
  targetId: string;
  config: ConnectorConfig;
  priorSegments: SegmentObstacle[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function same(a: number, b: number, epsilon = 1e-4): boolean {
  return Math.abs(a - b) < epsilon;
}

function isVertical(a: Pt, b: Pt): boolean {
  return same(a.x, b.x);
}

function iconAabb(
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

function distPointToAabb(point: Pt, box: LayoutAabb): number {
  const x = clamp(point.x, box.minX, box.maxX);
  const y = clamp(point.y, box.minY, box.maxY);
  return Math.hypot(point.x - x, point.y - y);
}

function distPointToSegment(point: Pt, a: Pt, b: Pt): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSquared = abx * abx + aby * aby;

  if (lengthSquared < 1e-12) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = clamp(
    ((point.x - a.x) * abx + (point.y - a.y) * aby) / lengthSquared,
    0,
    1,
  );

  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

function simplifyPath(points: Pt[]): Pt[] {
  if (points.length === 0) return [];

  const deduped: Pt[] = [points[0]!];
  for (let i = 1; i < points.length; i += 1) {
    const prev = deduped[deduped.length - 1]!;
    const current = points[i]!;
    if (same(prev.x, current.x) && same(prev.y, current.y)) continue;
    deduped.push(current);
  }

  if (deduped.length <= 2) return deduped;

  const simplified: Pt[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const prev = simplified[simplified.length - 1]!;
    const current = deduped[i]!;
    const next = deduped[i + 1]!;

    const sameX = same(prev.x, current.x) && same(current.x, next.x);
    const sameY = same(prev.y, current.y) && same(current.y, next.y);
    if (sameX || sameY) continue;

    simplified.push(current);
  }
  simplified.push(deduped[deduped.length - 1]!);
  return simplified;
}

function cardinalToward(from: Pt, to: Pt): Dir {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: (Math.sign(dx) || 1) as -1 | 1, y: 0 };
  }

  return { x: 0, y: (Math.sign(dy) || 1) as -1 | 1 };
}

function faceKey(id: string, dir: Dir): string {
  return `${id}|${dir.x},${dir.y}`;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function incrementCount(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function faceTangent(dir: Dir): Dir {
  return dir.x !== 0 ? { x: 0, y: 1 } : { x: 1, y: 0 };
}

function faceExit(box: LayoutAabb, dir: Dir, jut: number): Pt {
  if (dir.x !== 0) {
    return {
      x: (dir.x > 0 ? box.maxX : box.minX) + dir.x * jut,
      y: box.cy,
    };
  }

  return {
    x: box.cx,
    y: (dir.y > 0 ? box.maxY : box.minY) + dir.y * jut,
  };
}

function offsetPort(
  point: Pt,
  dir: Dir,
  box: LayoutAabb,
  slot: number,
  slotCount: number,
  portSep: number,
): Pt {
  if (slotCount <= 1) return point;

  const tangent = faceTangent(dir);
  const midpoint = (slotCount - 1) / 2;
  const inset = 0.1;
  const available =
    tangent.x !== 0
      ? Math.max(0, box.maxX - box.minX - inset * 2)
      : Math.max(0, box.maxY - box.minY - inset * 2);
  const desired = (slotCount - 1) * portSep;
  const actualSep =
    desired <= available ? portSep : available / (slotCount - 1);
  const delta = (slot - midpoint) * actualSep;

  if (dir.x !== 0) {
    return {
      x: point.x,
      y: clamp(point.y + tangent.y * delta, box.minY + inset, box.maxY - inset),
    };
  }

  return {
    x: clamp(point.x + tangent.x * delta, box.minX + inset, box.maxX - inset),
    y: point.y,
  };
}

function segmentDirection(a: Pt, b: Pt): Axis | null {
  if (same(a.x, b.x) && same(a.y, b.y)) return null;
  return isVertical(a, b) ? "y" : "x";
}

function pointHitsBox(point: Pt, box: LayoutAabb, clearance: number): boolean {
  return distPointToAabb(point, box) < clearance;
}

function pointHitsSegments(
  point: Pt,
  direction: Axis | null,
  segments: SegmentObstacle[],
  spacing: number,
): boolean {
  for (const segment of segments) {
    if (distPointToSegment(point, segment.a, segment.b) >= spacing) continue;
    if (!direction) return true;
    const segmentAxis = segmentDirection(segment.a, segment.b);
    if (segmentAxis === direction) return true;
  }
  return false;
}

function segmentIsClear(a: Pt, b: Pt, ctx: RouteContext): boolean {
  const direction = segmentDirection(a, b);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(length / ctx.config.step));

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };

    for (const box of ctx.boxes) {
      if (box.id === ctx.sourceId || box.id === ctx.targetId) continue;
      if (pointHitsBox(point, box, ctx.config.clearance)) return false;
    }

    if (
      pointHitsSegments(point, direction, ctx.priorSegments, ctx.config.portSep)
    ) {
      return false;
    }
  }

  return true;
}

function pathIsClear(points: Pt[], ctx: RouteContext): boolean {
  const simplified = simplifyPath(points);
  for (let i = 0; i < simplified.length - 1; i += 1) {
    if (!segmentIsClear(simplified[i]!, simplified[i + 1]!, ctx)) return false;
  }
  return true;
}

function collectBlockingBoxes(
  candidates: Pt[][],
  ctx: RouteContext,
): LayoutAabb[] {
  const blockers = new Map<string, LayoutAabb>();

  for (const candidate of candidates) {
    const simplified = simplifyPath(candidate);
    for (let i = 0; i < simplified.length - 1; i += 1) {
      const a = simplified[i]!;
      const b = simplified[i + 1]!;
      const minX = Math.min(a.x, b.x) - ctx.config.clearance;
      const maxX = Math.max(a.x, b.x) + ctx.config.clearance;
      const minY = Math.min(a.y, b.y) - ctx.config.clearance;
      const maxY = Math.max(a.y, b.y) + ctx.config.clearance;

      for (const box of ctx.boxes) {
        if (box.id === ctx.sourceId || box.id === ctx.targetId) continue;
        const overlaps =
          box.maxX >= minX &&
          box.minX <= maxX &&
          box.maxY >= minY &&
          box.minY <= maxY;
        if (overlaps) blockers.set(box.id, box);
      }
    }
  }

  return [...blockers.values()];
}

function detourLines(
  exit: Pt,
  entry: Pt,
  blockingBoxes: LayoutAabb[],
  config: ConnectorConfig,
): { xs: number[]; ys: number[] } {
  const minX = Math.min(exit.x, entry.x);
  const maxX = Math.max(exit.x, entry.x);
  const minY = Math.min(exit.y, entry.y);
  const maxY = Math.max(exit.y, entry.y);
  const basePad = config.clearance + config.jut + config.lane;

  let left = minX - basePad;
  let right = maxX + basePad;
  let top = minY - basePad;
  let bottom = maxY + basePad;

  for (const box of blockingBoxes) {
    left = Math.min(left, box.minX - basePad);
    right = Math.max(right, box.maxX + basePad);
    top = Math.min(top, box.minY - basePad);
    bottom = Math.max(bottom, box.maxY + basePad);
  }

  const xs: number[] = [];
  const ys: number[] = [];
  for (let step = 1; step <= config.detourSteps; step += 1) {
    const offset = step * config.lane;
    xs.push(left - offset, right + offset);
    ys.push(top - offset, bottom + offset);
  }

  return { xs, ys };
}

function directCandidates(exit: Pt, entry: Pt): Pt[][] {
  return [
    [exit, { x: entry.x, y: exit.y }, entry],
    [exit, { x: exit.x, y: entry.y }, entry],
  ];
}

function detourCandidates(
  exit: Pt,
  entry: Pt,
  xs: number[],
  ys: number[],
): Pt[][] {
  const candidates: Pt[][] = [];

  for (const y of ys) {
    candidates.push([exit, { x: exit.x, y }, { x: entry.x, y }, entry]);
  }

  for (const x of xs) {
    candidates.push([exit, { x, y: exit.y }, { x, y: entry.y }, entry]);
  }

  for (const y of ys) {
    for (const x of xs) {
      candidates.push([
        exit,
        { x: exit.x, y },
        { x, y },
        { x, y: entry.y },
        entry,
      ]);
    }
  }

  return candidates;
}

function chooseRoute(exit: Pt, entry: Pt, ctx: RouteContext): Pt[] {
  const direct = directCandidates(exit, entry);

  for (const candidate of direct) {
    const simplified = simplifyPath(candidate);
    if (pathIsClear(simplified, ctx)) return simplified;
  }

  const blockers = collectBlockingBoxes(direct, ctx);
  const { xs, ys } = detourLines(exit, entry, blockers, ctx.config);

  for (const candidate of detourCandidates(exit, entry, xs, ys)) {
    const simplified = simplifyPath(candidate);
    if (pathIsClear(simplified, ctx)) return simplified;
  }

  return simplifyPath([exit, { x: entry.x, y: exit.y }, entry]);
}

function segmentsFromPath(points: Pt[]): SegmentObstacle[] {
  const segments: SegmentObstacle[] = [];
  const simplified = simplifyPath(points);

  for (let i = 0; i < simplified.length - 1; i += 1) {
    const a = simplified[i]!;
    const b = simplified[i + 1]!;
    if (same(a.x, b.x) && same(a.y, b.y)) continue;
    segments.push({ a, b });
  }

  return segments;
}

function buildPairs(
  boxes: LayoutAabb[],
  connections: ConnectionRow[],
): ConnectorPair[] {
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const seen = new Set<string>();
  const pairs: ConnectorPair[] = [];

  for (const row of connections) {
    const source = boxById.get(row.id);
    if (!source) continue;

    for (const targetId of row.connections) {
      const target = boxById.get(targetId);
      if (!target) continue;

      const key = pairKey(source.id, target.id);
      if (seen.has(key)) continue;
      seen.add(key);

      const sourceCenter = { x: source.cx, y: source.cy };
      const targetCenter = { x: target.cx, y: target.cy };

      pairs.push({
        source,
        target,
        sourceDir: cardinalToward(sourceCenter, targetCenter),
        targetDir: cardinalToward(targetCenter, sourceCenter),
      });
    }
  }

  return pairs;
}

function buildConnectorPath(
  pair: ConnectorPair,
  boxes: LayoutAabb[],
  priorSegments: SegmentObstacle[],
  config: ConnectorConfig,
  slots: {
    sourceSlot: number;
    sourceCount: number;
    targetSlot: number;
    targetCount: number;
  },
): RoutedConnectorPath {
  const start = { x: pair.source.cx, y: pair.source.cy };
  const end = { x: pair.target.cx, y: pair.target.cy };

  const exit = offsetPort(
    faceExit(pair.source, pair.sourceDir, config.jut),
    pair.sourceDir,
    pair.source,
    slots.sourceSlot,
    slots.sourceCount,
    config.portSep,
  );
  const entry = offsetPort(
    faceExit(pair.target, pair.targetDir, config.jut),
    pair.targetDir,
    pair.target,
    slots.targetSlot,
    slots.targetCount,
    config.portSep,
  );

  const route = chooseRoute(exit, entry, {
    boxes,
    sourceId: pair.source.id,
    targetId: pair.target.id,
    config,
    priorSegments,
  });

  return {
    id: `${pair.source.id}->${pair.target.id}`,
    sourceId: pair.source.id,
    targetId: pair.target.id,
    points: simplifyPath([start, ...route, end]),
  };
}

export function createConnectorEngine(config: ConnectorConfig): {
  iconAabb: typeof iconAabb;
  buildAllConnectorPaths: (
    boxes: LayoutAabb[],
    connections: ConnectionRow[],
  ) => RoutedConnectorPath[];
} {
  function buildAllConnectorPaths(
    boxes: LayoutAabb[],
    connections: ConnectionRow[],
  ): RoutedConnectorPath[] {
    const pairs = buildPairs(boxes, connections);
    const faceDegree = new Map<string, number>();

    for (const pair of pairs) {
      incrementCount(faceDegree, faceKey(pair.source.id, pair.sourceDir));
      incrementCount(faceDegree, faceKey(pair.target.id, pair.targetDir));
    }

    const faceUsage = new Map<string, number>();
    const priorSegments: SegmentObstacle[] = [];
    const paths: RoutedConnectorPath[] = [];

    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i]!;
      const sourceFace = faceKey(pair.source.id, pair.sourceDir);
      const targetFace = faceKey(pair.target.id, pair.targetDir);
      const sourceSlot = faceUsage.get(sourceFace) ?? 0;
      const targetSlot = faceUsage.get(targetFace) ?? 0;

      faceUsage.set(sourceFace, sourceSlot + 1);
      faceUsage.set(targetFace, targetSlot + 1);

      const path = buildConnectorPath(pair, boxes, priorSegments, config, {
        sourceSlot,
        sourceCount: faceDegree.get(sourceFace) ?? 1,
        targetSlot,
        targetCount: faceDegree.get(targetFace) ?? 1,
      });

      paths.push(path);
      priorSegments.push(...segmentsFromPath(path.points.slice(1, -1)));
    }

    return paths;
  }

  return { iconAabb, buildAllConnectorPaths };
}
