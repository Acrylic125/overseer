import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { conveyorRibbon } from "./conveyor-geometry";
import { DATA_CENTER, type PacketRoute } from "./data-center";
import type { ConnectorPath } from "./graph/connector-paths";

export const BELT_Y = 0.18;
export type ConveyorTint = { edge: string; dimmed: boolean };

/** Geometry is keyed only by routes, never by hover or selection state. */
export function buildConveyorBelts(routes: { path: ConnectorPath; motion: PacketRoute }[]) {
  const geometries: THREE.BufferGeometry[] = [];
  const edgePoints: number[] = [];
  const edgeColors: number[] = [];
  const ranges: { id: string; fill: string; start: number; count: number; edgeStart: number; edgeCount: number }[] = [];
  let vertexCount = 0;
  for (const route of routes) {
    const edge = new THREE.Color(route.path.variant === "warning" ? "#ee6658" : "#ff9237");

    for (const [side, width, bottom, top, fill] of [
      [0, 0.3, BELT_Y - 0.028, BELT_Y + 0.028, DATA_CENTER.surface],
      [-0.16, 0.025, BELT_Y + 0.028, BELT_Y + 0.09, "#f6f0e5"],
      [0.16, 0.025, BELT_Y + 0.028, BELT_Y + 0.09, "#f6f0e5"],
    ] as const) {
      const geometry = conveyorRibbon(route.motion.path.points, side, width, bottom, top);
      const fillColor = new THREE.Color(fill);

      const colors = new Float32Array(geometry.getAttribute("position").count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([fillColor.r, fillColor.g, fillColor.b], i);
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const edgeStart = edgePoints.length / 6;
      const edges = new THREE.EdgesGeometry(geometry, 25);
      const positions = edges.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        edgePoints.push(positions.getX(i), positions.getY(i), positions.getZ(i));
        edgeColors.push(edge.r, edge.g, edge.b);
      }
      ranges.push({ id: route.path.id, fill, start: vertexCount, count: geometry.getAttribute("position").count, edgeStart, edgeCount: positions.count / 2 });
      vertexCount += geometry.getAttribute("position").count;
      edges.dispose();
      geometries.push(geometry);
    }
  }
  if (!geometries.length) return null;
  const geometry = mergeGeometries(geometries)!;
  geometries.forEach(g => g.dispose());
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const lineGeometry = new LineSegmentsGeometry();
  lineGeometry.setPositions(edgePoints);
  lineGeometry.setColors(edgeColors);
  const lines = new LineSegments2(lineGeometry, new LineMaterial({ vertexColors: true, toneMapped: false, linewidth: 1.65 }));
  return { mesh, lines, ranges };
}

export function tintConveyorBelts(belts: ReturnType<typeof buildConveyorBelts>, tints: ReadonlyMap<string, ConveyorTint>) {
  if (!belts) return;
  const fillColors = belts.mesh.geometry.getAttribute("color");
  const starts = belts.lines.geometry.getAttribute("instanceColorStart");
  const ends = belts.lines.geometry.getAttribute("instanceColorEnd");
  const color = new THREE.Color();
  const background = new THREE.Color(DATA_CENTER.background);
  for (const range of belts.ranges) {
    const tint = tints.get(range.id)!;
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
