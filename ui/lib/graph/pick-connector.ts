import * as THREE from "three";

import type { ConnectorPath } from "@/lib/graph/connector-paths";

export type ConnectorPickHit = {
  pathId: string;
  sourceId: string;
  targetId: string;
  /** Closest point on the connector polyline in world XZ. */
  point: { x: number; z: number };
  /** Screen px (cursor pick) or world XZ distance (ray pick). */
  distancePx: number;
};

const _world = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _rayHit = new THREE.Vector3();

/** Max screen-space distance (px) from the cursor to count as a hit. */
const HIT_RADIUS_PX = 14;
/** Max world XZ distance from a screen-center ray to a connector segment. */
const RAY_HIT_RADIUS_WORLD = 0.28;

export function canvasCenterClient(domElement: HTMLElement): {
  x: number;
  y: number;
} {
  const rect = domElement.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function pickableConnectorPaths(
  paths: ConnectorPath[] | null | undefined,
  selectedServiceId: string | null,
): ConnectorPath[] {
  if (!paths?.length) return [];
  if (!selectedServiceId) return paths;
  return paths.filter(
    (path) =>
      path.sourceId === selectedServiceId ||
      path.targetId === selectedServiceId,
  );
}

function distPointToSegmentPx(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-6) {
    const dist = Math.hypot(px - ax, py - ay);
    return { dist, t: 0, cx: ax, cy: ay };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return { dist: Math.hypot(px - cx, py - cy), t, cx, cy };
}

function distPointToSegmentXZ(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  if (len2 < 1e-8) {
    const dist = Math.hypot(px - ax, pz - az);
    return { dist, t: 0, cx: ax, cz: az };
  }
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2),
  );
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { dist: Math.hypot(px - cx, pz - cz), t, cx, cz };
}

function projectPoint(
  x: number,
  z: number,
  camera: THREE.Camera,
  rect: DOMRect,
): { sx: number; sy: number } | null {
  _world.set(x, 0, z);
  _world.project(camera);
  if (_world.z > 1) return null;
  return {
    sx: ((_world.x + 1) / 2) * rect.width + rect.left,
    sy: ((1 - _world.y) / 2) * rect.height + rect.top,
  };
}

/**
 * Pick the nearest connector under the screen center by casting a ray onto the
 * ground plane and measuring world-space distance to each segment.
 */
export function pickConnectorAlongRay(
  camera: THREE.Camera,
  paths: ConnectorPath[],
  ndcX = 0,
  ndcY = 0,
  maxDist = RAY_HIT_RADIUS_WORLD,
): ConnectorPickHit | null {
  if (paths.length === 0) return null;

  _ndc.set(ndcX, ndcY);
  _raycaster.setFromCamera(_ndc, camera);
  const onGround = _raycaster.ray.intersectPlane(_groundPlane, _rayHit);
  if (!onGround) return null;

  let best: ConnectorPickHit | null = null;

  for (const path of paths) {
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const hit = distPointToSegmentXZ(
        _rayHit.x,
        _rayHit.z,
        a.x,
        a.z,
        b.x,
        b.z,
      );
      if (hit.dist > maxDist) continue;
      if (best && hit.dist >= best.distancePx) continue;

      best = {
        pathId: path.id,
        sourceId: path.sourceId,
        targetId: path.targetId,
        point: { x: hit.cx, z: hit.cz },
        distancePx: hit.dist,
      };
    }
  }

  return best;
}

/**
 * Pick the nearest connector under the cursor using screen-space distance
 * to each orthogonal segment.
 */
export function pickConnectorAt(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  domElement: HTMLElement,
  paths: ConnectorPath[],
): ConnectorPickHit | null {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || paths.length === 0) return null;

  let best: ConnectorPickHit | null = null;

  for (const path of paths) {
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const pa = projectPoint(a.x, a.z, camera, rect);
      const pb = projectPoint(b.x, b.z, camera, rect);
      if (!pa || !pb) continue;

      const hit = distPointToSegmentPx(
        clientX,
        clientY,
        pa.sx,
        pa.sy,
        pb.sx,
        pb.sy,
      );
      if (hit.dist > HIT_RADIUS_PX) continue;
      if (best && hit.dist >= best.distancePx) continue;

      best = {
        pathId: path.id,
        sourceId: path.sourceId,
        targetId: path.targetId,
        point: {
          x: a.x + (b.x - a.x) * hit.t,
          z: a.z + (b.z - a.z) * hit.t,
        },
        distancePx: hit.dist,
      };
    }
  }

  return best;
}
