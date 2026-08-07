"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  CONNECTOR_SIZE,
  buildAllConnectorPaths,
  type ConnectorPath,
} from "@/lib/graph/connector-paths";
import type { SceneBake } from "@/lib/infrastructure-schema";
import { SCENE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Flat ribbon thickness — centered on y = 0 (below icons at 0.01). */
const CONNECTOR_THICKNESS = 0.008;
const CONNECTOR_Y = 0;
const JOINT_RADIUS = CONNECTOR_SIZE * 0.7;
const HIGHLIGHT_SCALE = 1.55;

let connectorMaterial: THREE.MeshBasicMaterial | null = null;
let highlightMaterial: THREE.MeshBasicMaterial | null = null;
let segmentGeometry: THREE.BoxGeometry | null = null;
let jointGeometry: THREE.CylinderGeometry | null = null;

function getConnectorMaterial() {
  const color = cssToThreeColor(SCENE.connector);
  if (!connectorMaterial) {
    connectorMaterial = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      depthWrite: true,
    });
  } else {
    connectorMaterial.color.copy(color);
  }
  return connectorMaterial;
}

function getHighlightMaterial() {
  const color = cssToThreeColor(SCENE.connectorHighlight);
  if (!highlightMaterial) {
    highlightMaterial = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      depthWrite: true,
    });
  } else {
    highlightMaterial.color.copy(color);
  }
  return highlightMaterial;
}

/** Unit-length flat ribbon in XZ (width × thickness × length-1). */
function getSegmentGeometry() {
  if (!segmentGeometry) {
    segmentGeometry = new THREE.BoxGeometry(
      CONNECTOR_SIZE,
      CONNECTOR_THICKNESS,
      1,
    );
  }
  return segmentGeometry;
}

/** Flat disc joint (thin cylinder standing on Y). */
function getJointGeometry() {
  if (!jointGeometry) {
    jointGeometry = new THREE.CylinderGeometry(
      JOINT_RADIUS,
      JOINT_RADIUS,
      CONNECTOR_THICKNESS,
      12,
    );
  }
  return jointGeometry;
}

type SegmentInstance = {
  midX: number;
  midZ: number;
  length: number;
  dx: number;
  dz: number;
  sourceId?: string;
  targetId?: string;
};

type JointInstance = {
  x: number;
  z: number;
  sourceId?: string;
  targetId?: string;
};

function collectFromPaths(paths: ConnectorPath[]) {
  const segments: SegmentInstance[] = [];
  const joints: JointInstance[] = [];

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
        sourceId: path.sourceId,
        targetId: path.targetId,
      });
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      joints.push({
        x: p.x,
        z: p.z,
        sourceId: path.sourceId,
        targetId: path.targetId,
      });
    }
  }

  return { segments, joints };
}

function linkedTo(
  item: { sourceId?: string; targetId?: string },
  serviceId: string,
) {
  return item.sourceId === serviceId || item.targetId === serviceId;
}

function buildMeshes(
  segments: SegmentInstance[],
  joints: JointInstance[],
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
      dummy.position.set(s.midX, CONNECTOR_Y, s.midZ);
      // Scale X (width) + Y (thickness) uniformly; Z stretches to segment length.
      dummy.scale.set(scale, 1, s.length);
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
      ? new THREE.InstancedMesh(getJointGeometry(), material, joints.length)
      : null;

  if (jointMesh) {
    for (let i = 0; i < joints.length; i += 1) {
      const j = joints[i]!;
      dummy.position.set(j.x, CONNECTOR_Y, j.z);
      dummy.scale.set(scale, 1, scale);
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

function servicesSignature(services: InfrastructureService[]) {
  // Identity + connection lists — enough to know routing inputs changed.
  let sig = `${services.length}|`;
  for (const service of services) {
    sig += service.id;
    sig += ">";
    sig += service.connections.join(",");
    sig += ";";
  }
  return sig;
}

function scheduleIdle(fn: () => void): () => void {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    const id = window.requestIdleCallback(() => fn(), { timeout: 180 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 0);
  return () => window.clearTimeout(id);
}

export function ServiceConnectors({
  services,
  selectedServiceId = null,
  /** When provided (from scan layout), skip client-side re-routing. */
  precomputedPaths = null,
  /** Dense bake from scan — preferred over deriving segments from paths. */
  precomputedSegments = null,
  precomputedJoints = null,
}: {
  services: InfrastructureService[];
  selectedServiceId?: string | null;
  precomputedPaths?: ConnectorPath[] | null;
  precomputedSegments?: SceneBake["connectorSegments"] | null;
  precomputedJoints?: SceneBake["connectorJoints"] | null;
}) {
  const signature = useMemo(() => servicesSignature(services), [services]);
  const servicesRef = useRef(services);
  servicesRef.current = services;

  const hasBakedInstances =
    precomputedSegments != null && precomputedJoints != null;

  const [paths, setPaths] = useState<ConnectorPath[]>(
    () => precomputedPaths ?? [],
  );

  // Prefer scan-authored paths; otherwise build routes off the critical path.
  // Skip entirely when segment instances are already baked.
  useEffect(() => {
    if (hasBakedInstances) return;

    if (precomputedPaths != null) {
      setPaths(precomputedPaths);
      return;
    }

    let cancelled = false;
    const cancel = scheduleIdle(() => {
      if (cancelled) return;
      setPaths(buildAllConnectorPaths(servicesRef.current));
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [signature, precomputedPaths, hasBakedInstances]);

  const meshes = useMemo(() => {
    const all =
      hasBakedInstances
        ? {
            segments: precomputedSegments,
            joints: precomputedJoints,
          }
        : collectFromPaths(paths);

    if (!selectedServiceId) {
      const built = buildMeshes(
        all.segments,
        all.joints,
        getConnectorMaterial(),
      );
      return {
        allSeg: built.segmentMesh,
        allJoint: built.jointMesh,
        hiSeg: null as THREE.InstancedMesh | null,
        hiJoint: null as THREE.InstancedMesh | null,
      };
    }

    const hiSegments = all.segments.filter((s) =>
      linkedTo(s, selectedServiceId),
    );
    const hiJoints = all.joints.filter((j) => linkedTo(j, selectedServiceId));
    const hiMeshes = buildMeshes(
      hiSegments,
      hiJoints,
      getHighlightMaterial(),
      HIGHLIGHT_SCALE,
    );

    return {
      allSeg: null as THREE.InstancedMesh | null,
      allJoint: null as THREE.InstancedMesh | null,
      hiSeg: hiMeshes.segmentMesh,
      hiJoint: hiMeshes.jointMesh,
    };
  }, [
    paths,
    selectedServiceId,
    hasBakedInstances,
    precomputedSegments,
    precomputedJoints,
  ]);

  useLayoutEffect(
    () => () => {
      meshes.allSeg?.dispose();
      meshes.allJoint?.dispose();
      meshes.hiSeg?.dispose();
      meshes.hiJoint?.dispose();
    },
    [meshes],
  );

  return (
    <group>
      {meshes.allSeg ? <primitive object={meshes.allSeg} /> : null}
      {meshes.allJoint ? <primitive object={meshes.allJoint} /> : null}
      {meshes.hiSeg ? <primitive object={meshes.hiSeg} /> : null}
      {meshes.hiJoint ? <primitive object={meshes.hiJoint} /> : null}
    </group>
  );
}
