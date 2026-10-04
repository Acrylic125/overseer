"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { conveyorRibbon } from "@/lib/conveyor-geometry";

import {
  CampusGeometry,
  type CampusPart,
} from "@/components/infrastructure/data-center-geometry";
import {
  conveyorPacketRoute,
  DATA_CENTER,
  packetPosition,
  packetRoute,
} from "@/lib/data-center";
import type { ConnectorPath } from "@/lib/graph/connector-paths";

const BELT_Y = 0.18;

/** Tape, a shipping label and barcode share one instanced detail batch. */
function parcelDetails() {
  const geometries: THREE.BufferGeometry[] = [];
  const add = (size: [number, number, number], position: [number, number, number], fill: string) => {
    const geometry = new THREE.BoxGeometry(...size);
    geometry.translate(...position);
    const color = new THREE.Color(fill);
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([color.r, color.g, color.b], i);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometries.push(geometry);
  };
  add([0.042, 0.004, 0.224], [0, 0.112, 0], "#fff5df");
  add([0.042, 0.222, 0.004], [0, 0, 0.112], "#fff5df");
  add([0.042, 0.222, 0.004], [0, 0, -0.112], "#fff5df");
  add([0.004, 0.075, 0.105], [0.112, 0.005, 0.015], "#ffffff");
  for (let i = 0; i < 5; i++)
    add([0.002, 0.032, i % 2 ? 0.005 : 0.003], [0.115, -0.005, -0.022 + i * 0.012], "#a97644");
  // A lid seam across the top reinforces the folded carton silhouette.
  add([0.222, 0.002, 0.003], [0, 0.115, 0], "#d8863c");
  const merged = mergeGeometries(geometries)!;
  geometries.forEach(geometry => geometry.dispose());
  return merged;
}

export function DataCenterTransport({
  paths,
  relevantIds,
  activeConnectorId,
  animate,
}: {
  paths: ConnectorPath[];
  relevantIds: Set<string> | null;
  activeConnectorId: string | null;
  animate: boolean;
}) {
  const routes = useMemo(() => paths.map((path) => ({
    ...packetRoute(path),
    motion: conveyorPacketRoute(path),
    dimmed: relevantIds != null && !relevantIds.has(path.sourceId) && !relevantIds.has(path.targetId),
    active: activeConnectorId === path.id,
  })).filter(route => route.length > 0), [paths, relevantIds, activeConnectorId]);

  const { size } = useThree();
  const belts = useMemo(() => {
    const geometries: THREE.BufferGeometry[] = [];
    const edgePoints: number[] = [];
    const edgeColors: number[] = [];
    for (const route of routes) {
      const edge = new THREE.Color(route.path.variant === "warning" ? "#ee6658" : route.active ? "#ff7f25" : "#ff9237");
      if (route.dimmed) edge.lerp(new THREE.Color(DATA_CENTER.background), 0.8);
      for (const [side, width, bottom, top, fill] of [
        [0, 0.3, BELT_Y - 0.028, BELT_Y + 0.028, DATA_CENTER.surface],
        [-0.16, 0.025, BELT_Y + 0.028, BELT_Y + 0.09, "#ffe4b8"],
        [0.16, 0.025, BELT_Y + 0.028, BELT_Y + 0.09, "#ffe4b8"],
      ] as const) {
        const geometry = conveyorRibbon(route.motion.path.points, side, width, bottom, top);
        const fillColor = new THREE.Color(fill);
        if (route.dimmed) fillColor.lerp(new THREE.Color(DATA_CENTER.background), 0.8);
        const colors = new Float32Array(geometry.getAttribute("position").count * 3);
        for (let i = 0; i < colors.length; i += 3) colors.set([fillColor.r, fillColor.g, fillColor.b], i);
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const edges = new THREE.EdgesGeometry(geometry, 25);
        const positions = edges.getAttribute("position");
        for (let i = 0; i < positions.count; i++) {
          edgePoints.push(positions.getX(i), positions.getY(i), positions.getZ(i));
          edgeColors.push(edge.r, edge.g, edge.b);
        }
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
    return { mesh, lines };
  }, [routes]);
  useLayoutEffect(() => { belts?.lines.material.resolution.set(size.width, size.height); }, [belts, size]);
  useEffect(() => () => {
    if (!belts) return;
    belts.mesh.geometry.dispose();
    (belts.mesh.material as THREE.Material).dispose();
    belts.lines.geometry.dispose();
    belts.lines.material.dispose();
  }, [belts]);

  const parts = useMemo(() => {
    const out: CampusPart[] = [];
    for (const route of routes) {
      const edge = route.path.variant === "warning" ? "#ee6658" : route.active ? "#ff7f25" : "#ff9237";
      const rollers = Math.min(160, Math.ceil(route.motion.length / 0.28));
      for (let i = 0; i < rollers; i++) {
        const point = packetPosition(route.motion, (i + 0.5) * route.motion.length / rollers)!;
        out.push({ position: [point.x, BELT_Y + 0.038, point.z], size: [0.26, 0.018, 0.025], rotation: [0, point.angle, 0], color: "#ffbc61", edge, dimmed: route.dimmed });
      }
      const legs = Math.min(40, Math.ceil(route.motion.length / 1.3));
      for (let i = 0; i < legs; i++) {
        const point = packetPosition(route.motion, (i + 0.5) * route.motion.length / legs)!;
        out.push({ position: [point.x, 0.075, point.z], size: [0.18, 0.15, 0.03], rotation: [0, point.angle, 0], color: DATA_CENTER.surface, edge, dimmed: route.dimmed });
      }
    }
    return out;
  }, [routes]);

  const packets = useMemo(() => routes.flatMap((route, index) => {
    const count = Math.min(6, Math.max(1, Math.ceil(route.motion.length / 4)));
    return Array.from({ length: count }, (_, i) => ({ route, offset: route.motion.length * i / count + index * 0.37 }));
  }), [routes]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const detailsRef = useRef<THREE.InstancedMesh>(null);
  const details = useMemo(() => parcelDetails(), []);
  const elapsed = useRef(0);
  const vertex = useMemo(() => new THREE.Vector3(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const outline = useMemo(() => {
    const cube = new THREE.BoxGeometry(0.22, 0.22, 0.22);
    const geometry = new THREE.EdgesGeometry(cube);
    cube.dispose();
    const positions = new Float32Array(packets.length * geometry.getAttribute("position").array.length);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: "#d8863c", toneMapped: false }));
    lines.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    lines.frustumCulled = false;
    return { lines, base: geometry };
  }, [packets]);
  useEffect(() => () => {
    outline.lines.geometry.dispose();
    (outline.lines.material as THREE.Material).dispose();
    outline.base.dispose();
  }, [outline]);
  useEffect(() => () => details.dispose(), [details]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    packets.forEach(({ route }, i) => mesh.setColorAt(i, new THREE.Color(route.dimmed ? "#fff0da" : route.path.variant === "warning" ? "#efaaa0" : "#ffc36a")));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packets]);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const detailMesh = detailsRef.current;
    if (!mesh || !detailMesh) return;
    if (animate) elapsed.current += Math.min(delta, 0.1);
    const base = outline.base.getAttribute("position");
    const positions = outline.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    packets.forEach(({ route, offset }, i) => {
      const point = packetPosition(route.motion, elapsed.current * 0.65 + offset)!;
      dummy.position.set(point.x, BELT_Y + 0.16, point.z);
      dummy.rotation.set(0, point.angle, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      detailMesh.setMatrixAt(i, dummy.matrix);
      for (let j = 0; j < base.count; j++) {
        vertex.fromBufferAttribute(base, j).applyMatrix4(dummy.matrix);
        positions.setXYZ(i * base.count + j, vertex.x, vertex.y, vertex.z);
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    detailMesh.instanceMatrix.needsUpdate = true;
    positions.needsUpdate = true;
  });
  return (
    <group>
      {belts && <><primitive object={belts.mesh} /><primitive object={belts.lines} /></>}
      <CampusGeometry parts={parts} />
      {packets.length > 0 && (
        <>
          <instancedMesh ref={meshRef} args={[undefined, undefined, packets.length]} frustumCulled={false}>
            <boxGeometry args={[0.22, 0.22, 0.22]} />
            <meshBasicMaterial toneMapped={false} />
          </instancedMesh>
          <instancedMesh ref={detailsRef} args={[details, undefined, packets.length]} frustumCulled={false}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </instancedMesh>
          <primitive object={outline.lines} />
        </>
      )}
    </group>
  );
}
