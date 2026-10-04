import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from "polygon-clipping";
import { conveyorEdges } from "./conveyor-geometry";

const { difference, intersection, union } = polygonClipping;

type Bounds = { minX: number; minZ: number; maxX: number; maxZ: number };
export type ConveyorRegion = { shape: MultiPolygon; bounds: Bounds; ids: string[] };
export type ConveyorFootprint = { id: string; outer: MultiPolygon; inner: MultiPolygon; bounds: Bounds };
const snap = (value: number) => Math.round(value * 1e8) / 1e8;

export function conveyorFootprint(points: readonly { x: number; z: number }[], width: number): MultiPolygon {
  const edges = conveyorEdges(points, 0, width);
  const pieces: Polygon[] = [];
  for (let i = 1; i < edges.length; i++) {
    const a = edges[i - 1]!;
    const b = edges[i]!;
    pieces.push([[a[0]!, a[1]!, b[1]!, b[0]!].map(p => [snap(p.x), snap(p.z)] as Pair)]);
  }
  return pieces.length ? union(pieces) : [];
}

export function boundsOf(shape: MultiPolygon): Bounds {
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const polygon of shape) for (const ring of polygon) for (const [x, z] of ring) {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  }
  return bounds;
}

export function boundsOverlap(a: Bounds, b: Bounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

function inRing(ring: Pair[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!;
    const [bx, bz] = ring[i]!;
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length > 0 && Math.abs((x - ax) * dz - (z - az) * dx) <= 1e-5 * length &&
      x >= Math.min(ax, bx) - 1e-5 && x <= Math.max(ax, bx) + 1e-5 &&
      z >= Math.min(az, bz) - 1e-5 && z <= Math.max(az, bz) + 1e-5) return true;
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

export function containsPoint(shape: MultiPolygon, x: number, z: number) {
  return shape.some(polygon => inRing(polygon[0]!, x, z) && !polygon.slice(1).some(hole => inRing(hole, x, z)));
}

/** Disjoint coverage regions retain every logical connection on a shared lane. */
export function buildConveyorNetwork(footprints: ConveyorFootprint[]) {
  let regions: ConveyorRegion[] = [];
  for (const footprint of footprints) {
    let uncovered = footprint.outer;
    const next: ConveyorRegion[] = [];
    for (const region of regions) {
      if (!boundsOverlap(region.bounds, footprint.bounds)) { next.push(region); continue; }
      const shared = intersection(region.shape, footprint.outer);
      if (!shared.length) { next.push(region); continue; }
      const remainder = difference(region.shape, footprint.outer);
      if (remainder.length) next.push({ shape: remainder, bounds: boundsOf(remainder), ids: region.ids });
      next.push({ shape: shared, bounds: boundsOf(shared), ids: [...region.ids, footprint.id] });
      uncovered = difference(uncovered, region.shape);
    }
    if (uncovered.length) next.push({ shape: uncovered, bounds: boundsOf(uncovered), ids: [footprint.id] });
    regions = next;
  }
  const outer = footprints.length ? union(footprints.flatMap(footprint => footprint.outer)) : [];
  const inner = footprints.length ? union(footprints.flatMap(footprint => footprint.inner)) : [];
  const rails = outer.length ? difference(outer, inner) : [];
  return { regions, outer, inner, rails };
}

/** Stable ownership prevents duplicate rollers/supports on merged lanes. */
export function conveyorOwnerAt(regions: ConveyorRegion[], x: number, z: number) {
  return regions.find(region => x >= region.bounds.minX && x <= region.bounds.maxX &&
    z >= region.bounds.minZ && z <= region.bounds.maxZ && containsPoint(region.shape, x, z))?.ids[0];
}
