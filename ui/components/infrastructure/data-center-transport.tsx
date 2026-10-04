"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  CampusGeometry,
  type CampusPart,
  type CampusTint,
} from "@/components/infrastructure/data-center-geometry";
import {
  conveyorPacketRoute,
  DATA_CENTER,
  packetPosition,
  packetRoute,
} from "@/lib/data-center";
import type { ConnectorPath } from "@/lib/graph/connector-paths";

import { BELT_Y, buildConveyorBelts, tintConveyorBelts } from "@/lib/data-center-transport-geometry";
import { conveyorOwnerAt } from "@/lib/conveyor-network";

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

  })).filter(route => route.length > 0), [paths]);

  const tints = useMemo(() => new Map<string, CampusTint>(routes.map(route => [route.path.id, {
    edge: route.path.variant === "warning" ? "#ee6658" : activeConnectorId === route.path.id ? "#ff7f25" : "#ff9237",
    dimmed: relevantIds != null && !relevantIds.has(route.path.sourceId) && !relevantIds.has(route.path.targetId),
  }])), [routes, relevantIds, activeConnectorId]);

  const { size } = useThree();
  const belts = useMemo(() => buildConveyorBelts(routes), [routes]);
  useLayoutEffect(() => tintConveyorBelts(belts, tints), [belts, tints]);
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
      const edge = route.path.variant === "warning" ? "#ee6658" : "#ff9237";
      const legs = Math.min(40, Math.ceil(route.motion.length / 1.3));
      for (let i = 0; i < legs; i++) {
        const point = packetPosition(route.motion, (i + 0.5) * route.motion.length / legs)!;
        if (!belts || conveyorOwnerAt(belts.regions, point.x, point.z) !== route.path.id) continue;
        out.push({ position: [point.x, 0.075, point.z], size: [0.18, 0.15, 0.03], rotation: [0, point.angle, 0], color: DATA_CENTER.surface, edge, groupId: route.path.id });
      }
    }
    return out;
  }, [routes, belts]);

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
    packets.forEach(({ route }, i) => mesh.setColorAt(i, new THREE.Color(relevantIds != null && !relevantIds.has(route.path.sourceId) && !relevantIds.has(route.path.targetId) ? "#fff0da" : route.path.variant === "warning" ? "#efaaa0" : "#ffc36a")));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [packets, relevantIds]);

  const positionedPackets = useRef<typeof packets | null>(null);
  useFrame((_, delta) => {
    const mesh = meshRef.current;
    const detailMesh = detailsRef.current;
    if (!mesh || !detailMesh || (!animate && positionedPackets.current === packets)) return;
    positionedPackets.current = packets;
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
      <CampusGeometry parts={parts} tints={tints} />
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
