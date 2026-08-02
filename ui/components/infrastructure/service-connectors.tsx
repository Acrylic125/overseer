"use client";

import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  CONNECTOR_SIZE,
  buildAllConnectorPaths,
  type ConnectorPath,
} from "@/lib/graph/connector-paths";
import { SCENE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Tube sits just above the platform top (y = 0). */
const TUBE_Y = CONNECTOR_SIZE / 2 + 0.02;
const JOINT_RADIUS = CONNECTOR_SIZE * 0.55;
const HIGHLIGHT_SCALE = 1.55;

let connectorMaterial: THREE.MeshStandardMaterial | null = null;
let dimMaterial: THREE.MeshStandardMaterial | null = null;
let highlightMaterial: THREE.MeshStandardMaterial | null = null;
let segmentGeometry: THREE.BoxGeometry | null = null;
let jointGeometry: THREE.SphereGeometry | null = null;

function getConnectorMaterial() {
  const color = cssToThreeColor(SCENE.connector);
  if (!connectorMaterial) {
    connectorMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.08,
      roughness: 0.42,
      metalness: 0.08,
      flatShading: true,
    });
  } else {
    connectorMaterial.color.copy(color);
    connectorMaterial.emissive.copy(color);
    connectorMaterial.emissiveIntensity = 0.08;
  }
  return connectorMaterial;
}

function getDimMaterial() {
  const color = cssToThreeColor(SCENE.connector);
  if (!dimMaterial) {
    dimMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.02,
      roughness: 0.5,
      metalness: 0.05,
      flatShading: true,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
  } else {
    dimMaterial.color.copy(color);
    dimMaterial.emissive.copy(color);
  }
  return dimMaterial;
}

function getHighlightMaterial() {
  const color = cssToThreeColor(SCENE.connectorHighlight);
  if (!highlightMaterial) {
    highlightMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
      roughness: 0.28,
      metalness: 0.12,
      flatShading: true,
    });
  } else {
    highlightMaterial.color.copy(color);
    highlightMaterial.emissive.copy(color);
    highlightMaterial.emissiveIntensity = 0.55;
  }
  return highlightMaterial;
}

function getSegmentGeometry() {
  if (!segmentGeometry) {
    segmentGeometry = new THREE.BoxGeometry(
      CONNECTOR_SIZE,
      CONNECTOR_SIZE,
      1,
    );
  }
  return segmentGeometry;
}

function getJointGeometry() {
  if (!jointGeometry) {
    jointGeometry = new THREE.SphereGeometry(JOINT_RADIUS, 8, 6);
  }
  return jointGeometry;
}

type SegmentInstance = {
  midX: number;
  midZ: number;
  length: number;
  dx: number;
  dz: number;
};

function collectFromPaths(paths: ConnectorPath[]) {
  const segments: SegmentInstance[] = [];
  const joints: { x: number; z: number }[] = [];

  for (const path of paths) {
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-5) continue;
      segments.push({
        midX: (a.x + b.x) / 2,
        midZ: (a.z + b.z) / 2,
        length,
        dx: dx / length,
        dz: dz / length,
      });
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      joints.push({ x: p.x, z: p.z });
    }
  }

  return { segments, joints };
}

function buildMeshes(
  segments: SegmentInstance[],
  joints: { x: number; z: number }[],
  material: THREE.Material,
  scale = 1,
) {
  const zAxis = new THREE.Vector3(0, 0, 1);
  const dir = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const dummy = new THREE.Object3D();

  const segmentMesh =
    segments.length > 0
      ? new THREE.InstancedMesh(
          getSegmentGeometry(),
          material,
          segments.length,
        )
      : null;

  if (segmentMesh) {
    for (let i = 0; i < segments.length; i += 1) {
      const s = segments[i]!;
      dir.set(s.dx, 0, s.dz);
      quat.setFromUnitVectors(zAxis, dir);
      dummy.position.set(s.midX, TUBE_Y, s.midZ);
      dummy.scale.set(scale, scale, s.length);
      dummy.quaternion.copy(quat);
      dummy.updateMatrix();
      segmentMesh.setMatrixAt(i, dummy.matrix);
    }
    segmentMesh.instanceMatrix.needsUpdate = true;
    segmentMesh.frustumCulled = true;
    segmentMesh.computeBoundingSphere();
  }

  const jointMesh =
    joints.length > 0
      ? new THREE.InstancedMesh(
          getJointGeometry(),
          material,
          joints.length,
        )
      : null;

  if (jointMesh) {
    for (let i = 0; i < joints.length; i += 1) {
      const j = joints[i]!;
      dummy.position.set(j.x, TUBE_Y, j.z);
      dummy.scale.set(scale, scale, scale);
      dummy.quaternion.identity();
      dummy.updateMatrix();
      jointMesh.setMatrixAt(i, dummy.matrix);
    }
    jointMesh.instanceMatrix.needsUpdate = true;
    jointMesh.frustumCulled = true;
    jointMesh.computeBoundingSphere();
  }

  return { segmentMesh, jointMesh };
}

function pathLinkedTo(path: ConnectorPath, serviceId: string) {
  return path.sourceId === serviceId || path.targetId === serviceId;
}

export function ServiceConnectors({
  services,
  selectedServiceId = null,
}: {
  services: InfrastructureService[];
  selectedServiceId?: string | null;
}) {
  const paths = useMemo(() => buildAllConnectorPaths(services), [services]);

  const meshes = useMemo(() => {
    if (!selectedServiceId) {
      const { segments, joints } = collectFromPaths(paths);
      const built = buildMeshes(segments, joints, getConnectorMaterial());
      return {
        dimSeg: null as THREE.InstancedMesh | null,
        dimJoint: null as THREE.InstancedMesh | null,
        hiSeg: built.segmentMesh,
        hiJoint: built.jointMesh,
      };
    }

    const linked: ConnectorPath[] = [];
    const other: ConnectorPath[] = [];
    for (const path of paths) {
      if (pathLinkedTo(path, selectedServiceId)) linked.push(path);
      else other.push(path);
    }

    const dim = collectFromPaths(other);
    const hi = collectFromPaths(linked);
    const dimMeshes = buildMeshes(dim.segments, dim.joints, getDimMaterial());
    const hiMeshes = buildMeshes(
      hi.segments,
      hi.joints,
      getHighlightMaterial(),
      HIGHLIGHT_SCALE,
    );

    return {
      dimSeg: dimMeshes.segmentMesh,
      dimJoint: dimMeshes.jointMesh,
      hiSeg: hiMeshes.segmentMesh,
      hiJoint: hiMeshes.jointMesh,
    };
  }, [paths, selectedServiceId]);

  useLayoutEffect(
    () => () => {
      meshes.dimSeg?.dispose();
      meshes.dimJoint?.dispose();
      meshes.hiSeg?.dispose();
      meshes.hiJoint?.dispose();
    },
    [meshes],
  );

  return (
    <group>
      {meshes.dimSeg ? <primitive object={meshes.dimSeg} /> : null}
      {meshes.dimJoint ? <primitive object={meshes.dimJoint} /> : null}
      {meshes.hiSeg ? <primitive object={meshes.hiSeg} /> : null}
      {meshes.hiJoint ? <primitive object={meshes.hiJoint} /> : null}
    </group>
  );
}
