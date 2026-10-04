"use client";

import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { DATA_CENTER } from "@/lib/data-center";

export type CampusPart = {
  shape?: "box" | "cylinder" | "roof";
  position: [number, number, number];
  size: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  edge?: string;
  dimmed?: boolean;
};

export function DataCenterGround() {
  return null;
}

function gableRoof() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
    0.5, -0.5, 0.5, -0.5, -0.5, 0.5,
    0, 0.5, -0.5, 0, 0.5, 0.5,
  ], 3));
  geometry.setIndex([0, 4, 1, 3, 2, 5, 0, 3, 5, 0, 5, 4, 1, 4, 5, 1, 5, 2, 0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  const expanded = geometry.toNonIndexed();
  geometry.dispose();
  expanded.computeVertexNormals();
  return expanded;
}

/** Buildings, fixtures and transport lanes share three instanced shape batches. */
export function CampusGeometry({ parts }: { parts: CampusPart[] }) {
  const { size } = useThree();
  const batches = useMemo(() => {
    const result: { mesh: THREE.InstancedMesh; lines: LineSegments2 }[] =
      [];
    const dummy = new THREE.Object3D();
    const vertex = new THREE.Vector3();
    const color = new THREE.Color();
    for (const shape of ["box", "cylinder", "roof"] as const) {
      const items = parts.filter((part) => (part.shape ?? "box") === shape);
      if (!items.length) continue;
      const geometry =
        shape === "box"
          ? new THREE.BoxGeometry(1, 1, 1)
          : shape === "cylinder"
            ? new THREE.CylinderGeometry(0.5, 0.5, 1, 40)
            : gableRoof();
      const material = new THREE.MeshBasicMaterial({
        toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, items.length);
      const edges = new THREE.EdgesGeometry(geometry, 25);
      const edgePositions = edges.getAttribute("position");
      const positions: number[] = [];
      const colors: number[] = [];
      items.forEach((part, i) => {
        dummy.position.set(...part.position);
        dummy.scale.set(...part.size);
        dummy.rotation.set(...(part.rotation ?? [0, 0, 0]));
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        color.set(part.color);
        if (part.dimmed) color.lerp(new THREE.Color(DATA_CENTER.background), 0.8);
        mesh.setColorAt(i, color);
        color.set(part.edge ?? DATA_CENTER.blue);
        if (part.dimmed) color.lerp(new THREE.Color(DATA_CENTER.background), 0.8);
        for (let j = 0; j < edgePositions.count; j++) {
          vertex.fromBufferAttribute(edgePositions, j).applyMatrix4(dummy.matrix);
          positions.push(vertex.x, vertex.y, vertex.z);
          colors.push(color.r, color.g, color.b);
        }
      });
      mesh.computeBoundingSphere();
      const lineGeometry = new LineSegmentsGeometry();
      lineGeometry.setPositions(positions);
      lineGeometry.setColors(colors);
      const lines = new LineSegments2(
        lineGeometry,
        new LineMaterial({ vertexColors: true, toneMapped: false, linewidth: 1.65 }),
      );
      edges.dispose();
      result.push({ mesh, lines });
    }
    return result;
  }, [parts]);

  useLayoutEffect(() => {
    for (const { lines } of batches) lines.material.resolution.set(size.width, size.height);
  }, [batches, size]);

  useEffect(
    () => () => {
      for (const { mesh, lines } of batches) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
        lines.geometry.dispose();
        (lines.material as THREE.Material).dispose();
      }
    },
    [batches],
  );

  return (
    <group>
      {batches.map(({ mesh, lines }, i) => (
        <group key={i}>
          <primitive object={mesh} />
          <primitive object={lines} />
        </group>
      ))}
    </group>
  );
}
