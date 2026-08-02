export type GridVec2 = { x: number; y: number };

export type LayoutEdge = {
  source: string;
  target: string;
  weight: number;
};

export type GridLayoutOptions = {
  gridW?: number;
  gridH?: number;
  minDist?: number;
  forceIterations?: number;
  annealIterations?: number;
  seed?: number;
};

const EPSILON = 1e-6;
const BIG_PENALTY = 1_000;
const LAMBDA = 0.5;
const COOLING_RATE = 0.995;

function createRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function length(v: GridVec2) {
  return Math.hypot(v.x, v.y);
}

function normalize(v: GridVec2): GridVec2 {
  const len = length(v);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function gridDistance(a: GridVec2, b: GridVec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cellKey(cell: GridVec2) {
  return `${cell.x},${cell.y}`;
}

function buildAdjacency(nodes: string[], edges: LayoutEdge[]) {
  const neighbors = new Map<string, Map<string, number>>();
  for (const id of nodes) neighbors.set(id, new Map());

  for (const edge of edges) {
    if (!neighbors.has(edge.source) || !neighbors.has(edge.target)) continue;
    const w = edge.weight;
    const forward = neighbors.get(edge.source)!;
    const backward = neighbors.get(edge.target)!;
    forward.set(edge.target, (forward.get(edge.target) ?? 0) + w);
    backward.set(edge.source, (backward.get(edge.source) ?? 0) + w);
  }

  return neighbors;
}

/** Weighted-degree centrality, normalized to [0, 1]. */
export function computeCentrality(nodes: string[], edges: LayoutEdge[]) {
  const neighbors = buildAdjacency(nodes, edges);
  const centrality = new Map<string, number>();
  let max = 0;

  for (const id of nodes) {
    let sum = 0;
    for (const weight of neighbors.get(id)!.values()) sum += weight;
    centrality.set(id, sum);
    max = Math.max(max, sum);
  }

  if (max <= 0) {
    for (const id of nodes) centrality.set(id, 0);
    return centrality;
  }

  for (const id of nodes) {
    centrality.set(id, (centrality.get(id) ?? 0) / max);
  }
  return centrality;
}

function randomPointInCircle(
  radius: number,
  random: () => number,
): GridVec2 {
  const t = 2 * Math.PI * random();
  const r = radius * Math.sqrt(random());
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
}

function forceDirectedLayout(
  nodes: string[],
  edges: LayoutEdge[],
  gridW: number,
  gridH: number,
  iterations: number,
  random: () => number,
) {
  const n = Math.max(nodes.length, 1);
  const area = gridW * gridH;
  const k = Math.sqrt(area / n);
  let temperature = Math.sqrt(area) / 4;
  const halfW = gridW / 2;
  const halfH = gridH / 2;

  const pos = new Map<string, GridVec2>();
  const initRadius = Math.sqrt(n);
  for (const id of nodes) {
    pos.set(id, randomPointInCircle(initRadius, random));
  }

  const clampToBounds = (p: GridVec2): GridVec2 => ({
    x: Math.min(halfW, Math.max(-halfW, p.x)),
    y: Math.min(halfH, Math.max(-halfH, p.y)),
  });

  for (let iter = 0; iter < iterations; iter += 1) {
    const disp = new Map<string, GridVec2>();
    for (const id of nodes) disp.set(id, { x: 0, y: 0 });

    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]!;
      const pa = pos.get(a)!;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]!;
        const pb = pos.get(b)!;
        const delta = { x: pa.x - pb.x, y: pa.y - pb.y };
        const dist = Math.max(length(delta), EPSILON);
        const force = (k * k) / dist;
        const dir = normalize(delta);
        const da = disp.get(a)!;
        const db = disp.get(b)!;
        da.x += dir.x * force;
        da.y += dir.y * force;
        db.x -= dir.x * force;
        db.y -= dir.y * force;
      }
    }

    for (const edge of edges) {
      const pa = pos.get(edge.source);
      const pb = pos.get(edge.target);
      if (!pa || !pb) continue;
      const delta = { x: pa.x - pb.x, y: pa.y - pb.y };
      const dist = Math.max(length(delta), EPSILON);
      const force = ((dist * dist) / k) * edge.weight;
      const dir = normalize(delta);
      const da = disp.get(edge.source)!;
      const db = disp.get(edge.target)!;
      da.x -= dir.x * force;
      da.y -= dir.y * force;
      db.x += dir.x * force;
      db.y += dir.y * force;
    }

    for (const id of nodes) {
      const d = disp.get(id)!;
      const mag = length(d);
      if (mag < EPSILON) continue;
      const step = Math.min(mag, temperature);
      const dir = normalize(d);
      const p = pos.get(id)!;
      pos.set(
        id,
        clampToBounds({
          x: p.x + dir.x * step,
          y: p.y + dir.y * step,
        }),
      );
    }

    temperature *= 1 - iter / (iterations * 1.1);
  }

  return pos;
}

function scaleToGrid(pos: Map<string, GridVec2>, minDist: number) {
  const ids = [...pos.keys()];
  if (ids.length < 2) return pos;

  let minPairwise = Infinity;
  for (let i = 0; i < ids.length; i += 1) {
    const a = pos.get(ids[i]!)!;
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = pos.get(ids[j]!)!;
      minPairwise = Math.min(minPairwise, length({ x: a.x - b.x, y: a.y - b.y }));
    }
  }

  if (!Number.isFinite(minPairwise) || minPairwise < EPSILON) {
    return pos;
  }

  const scaleFactor = minDist / minPairwise;
  for (const id of ids) {
    const p = pos.get(id)!;
    pos.set(id, { x: p.x * scaleFactor, y: p.y * scaleFactor });
  }
  return pos;
}

function isValid(
  cell: GridVec2,
  gridPos: Map<string, GridVec2>,
  minDist: number,
  ignoreId?: string,
) {
  for (const [id, other] of gridPos) {
    if (id === ignoreId) continue;
    if (gridDistance(cell, other) < minDist - EPSILON) return false;
  }
  return true;
}

function* ringAroundPoint(target: GridVec2, radius: number) {
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
      yield { x: target.x + dx, y: target.y + dy };
    }
  }
}

function inBounds(cell: GridVec2, gridW: number, gridH: number) {
  const halfW = Math.floor(gridW / 2);
  const halfH = Math.floor(gridH / 2);
  return (
    cell.x >= -halfW &&
    cell.x <= halfW &&
    cell.y >= -halfH &&
    cell.y <= halfH
  );
}

function findNearestValidCell(
  target: GridVec2,
  occupied: Set<string>,
  gridPos: Map<string, GridVec2>,
  minDist: number,
  gridW: number,
  gridH: number,
): GridVec2 {
  const maxRadius = Math.max(gridW, gridH);

  if (
    inBounds(target, gridW, gridH) &&
    !occupied.has(cellKey(target)) &&
    isValid(target, gridPos, minDist)
  ) {
    return target;
  }

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (const cell of ringAroundPoint(target, radius)) {
      if (!inBounds(cell, gridW, gridH)) continue;
      if (occupied.has(cellKey(cell))) continue;
      if (!isValid(cell, gridPos, minDist)) continue;
      return cell;
    }
  }

  throw new Error("grid too small / too dense for MIN_DIST constraint");
}

function snapToGrid(
  pos: Map<string, GridVec2>,
  nodes: string[],
  centrality: Map<string, number>,
  minDist: number,
  gridW: number,
  gridH: number,
) {
  const occupied = new Set<string>();
  const gridPos = new Map<string, GridVec2>();

  const ordered = [...nodes].sort(
    (a, b) => (centrality.get(b) ?? 0) - (centrality.get(a) ?? 0),
  );

  for (const id of ordered) {
    const p = pos.get(id) ?? { x: 0, y: 0 };
    const target = { x: Math.round(p.x), y: Math.round(p.y) };
    const cell = findNearestValidCell(
      target,
      occupied,
      gridPos,
      minDist,
      gridW,
      gridH,
    );
    gridPos.set(id, cell);
    occupied.add(cellKey(cell));
  }

  return { gridPos, occupied };
}

function energy(
  gridPos: Map<string, GridVec2>,
  nodes: string[],
  edges: LayoutEdge[],
  neighbors: Map<string, Map<string, number>>,
  centrality: Map<string, number>,
  minDist: number,
) {
  let e = 0;

  for (const edge of edges) {
    const a = gridPos.get(edge.source);
    const b = gridPos.get(edge.target);
    if (!a || !b) continue;
    e += edge.weight * gridDistance(a, b);
  }

  for (let i = 0; i < nodes.length; i += 1) {
    const a = gridPos.get(nodes[i]!)!;
    for (let j = i + 1; j < nodes.length; j += 1) {
      const b = gridPos.get(nodes[j]!)!;
      const d = gridDistance(a, b);
      if (d < minDist) e += BIG_PENALTY * (minDist - d);
    }
  }

  for (const id of nodes) {
    const nbrs = neighbors.get(id);
    if (!nbrs || nbrs.size === 0) continue;
    let cx = 0;
    let cy = 0;
    let count = 0;
    for (const m of nbrs.keys()) {
      const p = gridPos.get(m);
      if (!p) continue;
      cx += p.x;
      cy += p.y;
      count += 1;
    }
    if (count === 0) continue;
    const centroid = { x: cx / count, y: cy / count };
    e +=
      LAMBDA *
      (centrality.get(id) ?? 0) *
      gridDistance(gridPos.get(id)!, centroid);
  }

  return e;
}

function randomNearbyFreeCell(
  origin: GridVec2,
  occupied: Set<string>,
  gridPos: Map<string, GridVec2>,
  minDist: number,
  gridW: number,
  gridH: number,
  ignoreId: string,
  random: () => number,
  searchRadius = 8,
): GridVec2 | null {
  const candidates: GridVec2[] = [];
  for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      const cell = { x: origin.x + dx, y: origin.y + dy };
      if (!inBounds(cell, gridW, gridH)) continue;
      if (occupied.has(cellKey(cell))) continue;
      if (!isValid(cell, gridPos, minDist, ignoreId)) continue;
      candidates.push(cell);
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(random() * candidates.length)]!;
}

function simulatedAnnealingRefine(
  gridPos: Map<string, GridVec2>,
  occupied: Set<string>,
  nodes: string[],
  edges: LayoutEdge[],
  neighbors: Map<string, Map<string, number>>,
  centrality: Map<string, number>,
  minDist: number,
  gridW: number,
  gridH: number,
  iterations: number,
  random: () => number,
) {
  if (nodes.length < 2) return gridPos;

  let currentEnergy = energy(
    gridPos,
    nodes,
    edges,
    neighbors,
    centrality,
    minDist,
  );
  let temperature = Math.max(minDist * 2, 4);

  for (let iter = 0; iter < iterations; iter += 1) {
    const relocate = random() < 0.5;

    if (relocate) {
      const n = nodes[Math.floor(random() * nodes.length)]!;
      const oldCell = gridPos.get(n)!;
      const newCell = randomNearbyFreeCell(
        oldCell,
        occupied,
        gridPos,
        minDist,
        gridW,
        gridH,
        n,
        random,
      );
      if (!newCell) {
        temperature *= COOLING_RATE;
        continue;
      }

      occupied.delete(cellKey(oldCell));
      gridPos.set(n, newCell);
      occupied.add(cellKey(newCell));

      const nextEnergy = energy(
        gridPos,
        nodes,
        edges,
        neighbors,
        centrality,
        minDist,
      );
      const delta = nextEnergy - currentEnergy;
      if (delta < 0 || random() < Math.exp(-delta / Math.max(temperature, EPSILON))) {
        currentEnergy = nextEnergy;
      } else {
        occupied.delete(cellKey(newCell));
        gridPos.set(n, oldCell);
        occupied.add(cellKey(oldCell));
      }
    } else {
      const i = Math.floor(random() * nodes.length);
      let j = Math.floor(random() * nodes.length);
      if (i === j) j = (j + 1) % nodes.length;
      const n1 = nodes[i]!;
      const n2 = nodes[j]!;
      const c1 = gridPos.get(n1)!;
      const c2 = gridPos.get(n2)!;

      gridPos.set(n1, c2);
      gridPos.set(n2, c1);

      // Swaps preserve occupancy; still verify spacing vs non-swapped nodes.
      const valid =
        isValid(c2, gridPos, minDist, n1) && isValid(c1, gridPos, minDist, n2);

      if (!valid) {
        gridPos.set(n1, c1);
        gridPos.set(n2, c2);
        temperature *= COOLING_RATE;
        continue;
      }

      const nextEnergy = energy(
        gridPos,
        nodes,
        edges,
        neighbors,
        centrality,
        minDist,
      );
      const delta = nextEnergy - currentEnergy;
      if (delta < 0 || random() < Math.exp(-delta / Math.max(temperature, EPSILON))) {
        currentEnergy = nextEnergy;
      } else {
        gridPos.set(n1, c1);
        gridPos.set(n2, c2);
      }
    }

    temperature *= COOLING_RATE;
  }

  return gridPos;
}

/**
 * Force-directed layout snapped onto an integer grid with spacing constraints,
 * then refined via simulated annealing.
 */
export function layoutGraphOnGrid(
  nodes: string[],
  edges: LayoutEdge[],
  options: GridLayoutOptions = {},
): Map<string, GridVec2> {
  if (nodes.length === 0) return new Map();

  const minDist = options.minDist ?? 4;
  const forceIterations = options.forceIterations ?? 500;
  const annealIterations = options.annealIterations ?? 5000;
  const random = createRng(options.seed ?? 42);

  // Size the working grid from N and MIN_DIST so packing stays feasible.
  const span = Math.max(
    Math.ceil(Math.sqrt(nodes.length) * minDist * 2.5),
    minDist * 6,
  );
  const gridW = options.gridW ?? span;
  const gridH = options.gridH ?? span;

  const centrality = computeCentrality(nodes, edges);
  const neighbors = buildAdjacency(nodes, edges);

  let pos = forceDirectedLayout(
    nodes,
    edges,
    gridW,
    gridH,
    forceIterations,
    random,
  );
  pos = scaleToGrid(pos, minDist);

  const { gridPos, occupied } = snapToGrid(
    pos,
    nodes,
    centrality,
    minDist,
    gridW,
    gridH,
  );

  return simulatedAnnealingRefine(
    gridPos,
    occupied,
    nodes,
    edges,
    neighbors,
    centrality,
    minDist,
    gridW,
    gridH,
    annealIterations,
    random,
  );
}

/** Build undirected weighted edges from directed connection lists. */
export function edgesFromConnections(
  services: { id: string; connections: string[] }[],
): LayoutEdge[] {
  const weights = new Map<string, number>();

  for (const service of services) {
    for (const target of service.connections) {
      if (target === service.id) continue;
      const a = service.id < target ? service.id : target;
      const b = service.id < target ? target : service.id;
      const key = `${a}::${b}`;
      weights.set(key, (weights.get(key) ?? 0) + 1);
    }
  }

  const edges: LayoutEdge[] = [];
  for (const [key, weight] of weights) {
    const [source, target] = key.split("::") as [string, string];
    edges.push({ source, target, weight });
  }
  return edges;
}
