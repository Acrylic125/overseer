import * as THREE from "three";
import { difference, intersection } from "polyclip-ts";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { boundsOf, boundsOverlap, buildConveyorNetwork, containsPoint, conveyorFootprint, conveyorOwnerAt, type MultiPolygon } from "./conveyor-network";
import { DATA_CENTER, packetPosition, type PacketRoute } from "./data-center";
import type { ConnectorPath } from "./graph/connector-paths";

export const BELT_Y = 0.18;
export type ConveyorTint = { edge: string; dimmed: boolean };

function extrude(shape: MultiPolygon, bottom: number, top: number) {
  const shapes = shape.map(polygon => {
    const ring = (points: typeof polygon[number]) => points.slice(0, -1).map(([x, z]) => new THREE.Vector2(x, -z));
    const result = new THREE.Shape(ring(polygon[0]!));
    result.holes = polygon.slice(1).map(points => new THREE.Path(ring(points)));
    return result;
  });
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: top - bottom, bevelEnabled: false, steps: 1 });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

/** Union the visible network once; hover only recolors its resident buffers. */
export function buildConveyorBelts(routes: { path: ConnectorPath; motion: PacketRoute }[]) {
  const footprints = routes.map(route => {
    const outer = conveyorFootprint(route.motion.path.points, 0.345);
    return { id: route.path.id, outer, inner: conveyorFootprint(route.motion.path.points, 0.295), bounds: boundsOf(outer) };
  }).filter(footprint => footprint.outer.length);
  if (!footprints.length) return null;
  const network = buildConveyorNetwork(footprints);
  const rollerRegions = network.regions.map(region => ({ ...region, shape: intersection(region.shape, network.inner) }));
  const geometries: THREE.BufferGeometry[] = [];
  const edgePoints: number[] = [];
  const edgeColors: number[] = [];
  const ranges: { id: string; ids: string[]; fill: string; start: number; count: number; edgeStart: number; edgeCount: number }[] = [];
  const defaultTints = new Map(routes.map(route => [route.path.id, { edge: route.path.variant === "warning" ? "#ee6658" : "#ff9237", dimmed: false }]));
  let vertexCount = 0;

  // Outlines come from the full union, never from its color partitions.
  const addOutline = (geometry: THREE.BufferGeometry, fixedIds?: string[]) => {
    const edges = new THREE.EdgesGeometry(geometry, 25);
    const positions = edges.getAttribute("position");
    for (let i = 0; i < positions.count; i += 2) {
      const x = (positions.getX(i) + positions.getX(i + 1)) / 2;
      const z = (positions.getZ(i) + positions.getZ(i + 1)) / 2;
      const ids = fixedIds ?? footprints.filter(footprint => containsPoint(footprint.outer, x, z)).map(footprint => footprint.id);
      if (!ids.length) continue;
      const edge = new THREE.Color(sharedTint(ids, defaultTints).edge);
      const edgeStart = edgePoints.length / 6;
      for (let j = i; j < i + 2; j++) {
        edgePoints.push(positions.getX(j), positions.getY(j), positions.getZ(j));
        edgeColors.push(edge.r, edge.g, edge.b);
      }
      const previous = ranges.at(-1);
      if (previous?.count === 0 && previous.edgeStart + previous.edgeCount === edgeStart &&
        previous.ids.length === ids.length && previous.ids.every((id, index) => id === ids[index])) {
        previous.edgeCount++;
      } else {
        ranges.push({ id: ids[0]!, ids, fill: DATA_CENTER.surface, start: 0, count: 0, edgeStart, edgeCount: 1 });
      }
    }
    edges.dispose();
  };

  const addSurface = (shape: MultiPolygon, bottom: number, top: number, fill: string, ids: string[], outline = false) => {
    if (!shape.length) return;
    const geometry = extrude(shape, bottom, top);
    const count = geometry.getAttribute("position").count;
    const color = new THREE.Color(fill);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    ranges.push({ id: ids[0]!, ids, fill, start: vertexCount, count, edgeStart: 0, edgeCount: 0 });
    vertexCount += count;
    geometries.push(geometry);
    if (outline) addOutline(geometry, ids);
  };

  for (const region of network.regions) {
    addSurface(region.shape, BELT_Y - 0.028, BELT_Y + 0.028, DATA_CENTER.surface, region.ids);
    addSurface(intersection(region.shape, network.rails), BELT_Y + 0.028, BELT_Y + 0.09, "#f6f0e5", region.ids);
  }
  for (const [shape, bottom, top] of [
    [network.outer, BELT_Y - 0.028, BELT_Y + 0.028],
    [network.rails, BELT_Y + 0.028, BELT_Y + 0.09],
  ] as const) {
    if (!shape.length) continue;
    const geometry = extrude(shape, bottom, top);
    addOutline(geometry);
    geometry.dispose();
  }

  const placedRollers: { shape: MultiPolygon; bounds: ReturnType<typeof boundsOf> }[] = [];
  for (const route of routes) {
    const owned = rollerRegions.filter(region => region.ids[0] === route.path.id && region.shape.length);
    if (!owned.length) continue;
    const rollers = Math.min(160, Math.ceil(route.motion.length / 0.28));
    for (let i = 0; i < rollers; i++) {
      const point = packetPosition(route.motion, (i + 0.5) * route.motion.length / rollers)!;
      if (conveyorOwnerAt(network.regions, point.x, point.z) !== route.path.id) continue;
      const c = Math.cos(point.angle), s = Math.sin(point.angle);
      const rectangle: MultiPolygon = [[[[-0.13, -0.0125], [0.13, -0.0125], [0.13, 0.0125], [-0.13, 0.0125], [-0.13, -0.0125]]
        .map(([x, z]) => [point.x + x! * c + z! * s, point.z - x! * s + z! * c])]];
      const bounds = boundsOf(rectangle);
      for (const region of owned) {
        if (!boundsOverlap(bounds, region.bounds)) continue;
        let clipped = intersection(rectangle, region.shape);
        const overlapping = placedRollers.filter(roller => boundsOverlap(bounds, roller.bounds));
        if (clipped.length && overlapping.length) clipped = difference(clipped, ...overlapping.map(roller => roller.shape));
        if (clipped.length) placedRollers.push({ shape: clipped, bounds: boundsOf(clipped) });
        addSurface(clipped, BELT_Y + 0.029, BELT_Y + 0.047, "#e5d4b6", region.ids, true);
      }
    }
  }

  const geometry = mergeGeometries(geometries)!;
  geometries.forEach(g => g.dispose());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const lineGeometry = new LineSegmentsGeometry();
  lineGeometry.setPositions(edgePoints);
  lineGeometry.setColors(edgeColors);
  const lines = new LineSegments2(lineGeometry, new LineMaterial({ vertexColors: true, toneMapped: false, linewidth: 1.65 }));
  return { mesh, lines, ranges, regions: network.regions };
}

function sharedTint(ids: string[], tints: ReadonlyMap<string, ConveyorTint>): ConveyorTint {
  const owners = ids.map(id => tints.get(id)).filter((tint): tint is ConveyorTint => !!tint);
  const visible = owners.filter(tint => !tint.dimmed);
  const candidates = visible.length ? visible : owners;
  const tint = candidates.find(tint => tint.edge === "#ff7f25") ?? candidates.find(tint => tint.edge === "#ee6658") ?? candidates[0];
  return { edge: tint?.edge ?? "#ff9237", dimmed: owners.length > 0 && !visible.length };
}

export function tintConveyorBelts(belts: ReturnType<typeof buildConveyorBelts>, tints: ReadonlyMap<string, ConveyorTint>) {
  if (!belts) return;
  const fillColors = belts.mesh.geometry.getAttribute("color");
  const starts = belts.lines.geometry.getAttribute("instanceColorStart");
  const ends = belts.lines.geometry.getAttribute("instanceColorEnd");
  const color = new THREE.Color();
  const background = new THREE.Color(DATA_CENTER.background);
  const sharedTints = new Map<string[], ConveyorTint>();
  for (const range of belts.ranges) {
    let tint = sharedTints.get(range.ids);
    if (!tint) { tint = sharedTint(range.ids, tints); sharedTints.set(range.ids, tint); }
    color.set(range.fill);
    if (tint.dimmed) color.lerp(background, 0.8);
    for (let i = range.start; i < range.start + range.count; i++) fillColors.setXYZ(i, color.r, color.g, color.b);
    color.set(tint.edge);
    if (tint.dimmed) color.lerp(background, 0.8);
    for (let i = range.edgeStart; i < range.edgeStart + range.edgeCount; i++) {
      starts.setXYZ(i, color.r, color.g, color.b);
      ends.setXYZ(i, color.r, color.g, color.b);
    }
  }
  fillColors.needsUpdate = true;
  starts.needsUpdate = true;
}
