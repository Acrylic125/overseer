"use client";

import { Html } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  CONNECTOR_SIZE,
  buildAllConnectorPaths,
  type ConnectorPath,
} from "@/lib/graph/connector-paths";
import { SCENE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Flat ribbon thickness — centered on y = 0 (below icons at 0.01). */
const CONNECTOR_THICKNESS = 0.008;
const CONNECTOR_Y = 0;
const JOINT_RADIUS = CONNECTOR_SIZE * 0.7;
const HIGHLIGHT_SCALE = 1.55;

type ConnectorVariant = "default" | "warning";

let connectorMaterial: THREE.MeshBasicMaterial | null = null;
let highlightMaterial: THREE.MeshBasicMaterial | null = null;
let warningMaterial: THREE.MeshBasicMaterial | null = null;
let warningHighlightMaterial: THREE.MeshBasicMaterial | null = null;
let segmentGeometry: THREE.BoxGeometry | null = null;
let jointGeometry: THREE.CylinderGeometry | null = null;

function getOrUpdateMaterial(
  existing: THREE.MeshBasicMaterial | null,
  css: string,
): THREE.MeshBasicMaterial {
  const color = cssToThreeColor(css);
  if (!existing) {
    return new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      depthWrite: true,
    });
  }
  existing.color.copy(color);
  return existing;
}

function getConnectorMaterial() {
  connectorMaterial = getOrUpdateMaterial(connectorMaterial, SCENE.connector);
  return connectorMaterial;
}

function getHighlightMaterial() {
  highlightMaterial = getOrUpdateMaterial(
    highlightMaterial,
    SCENE.connectorHighlight,
  );
  return highlightMaterial;
}

function getWarningMaterial() {
  warningMaterial = getOrUpdateMaterial(
    warningMaterial,
    SCENE.connectorWarning,
  );
  return warningMaterial;
}

function getWarningHighlightMaterial() {
  warningHighlightMaterial = getOrUpdateMaterial(
    warningHighlightMaterial,
    SCENE.connectorWarningHighlight,
  );
  return warningHighlightMaterial;
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
  variant: ConnectorVariant;
  text?: string;
};

type JointInstance = {
  x: number;
  z: number;
  sourceId?: string;
  targetId?: string;
  variant: ConnectorVariant;
  text?: string;
};

type LabelInstance = {
  x: number;
  z: number;
  text: string;
  warning: boolean;
  key: string;
};

function connectorLabelForPath(
  path: ConnectorPath,
  serviceId: string,
): [string, string] | null {
  if (serviceId === path.sourceId) return path.from ?? path.to ?? null;
  if (serviceId === path.targetId) return path.to ?? path.from ?? null;
  return null;
}

function formatConnectorLabel(label: [string, string]): string {
  return `${label[0]}: ${label[1]}`;
}

function collectFromPaths(paths: ConnectorPath[]) {
  const segments: SegmentInstance[] = [];
  const joints: JointInstance[] = [];
  const labels: LabelInstance[] = [];

  for (const path of paths) {
    const variant: ConnectorVariant =
      path.variant === "warning" ? "warning" : "default";
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
        variant,
        ...(path.text ? { text: path.text } : {}),
      });
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      joints.push({
        x: p.x,
        z: p.z,
        sourceId: path.sourceId,
        targetId: path.targetId,
        variant,
        ...(path.text ? { text: path.text } : {}),
      });
    }
    if (path.text && pts.length > 0) {
      const mid = pts[Math.floor(pts.length / 2)]!;
      labels.push({
        x: mid.x,
        z: mid.z,
        text: path.text,
        warning: variant === "warning",
        key: path.id,
      });
    }
  }

  return { segments, joints, labels };
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

type MeshBundle = {
  defaultSeg: THREE.InstancedMesh | null;
  defaultJoint: THREE.InstancedMesh | null;
  warningSeg: THREE.InstancedMesh | null;
  warningJoint: THREE.InstancedMesh | null;
};

function emptyBundle(): MeshBundle {
  return {
    defaultSeg: null,
    defaultJoint: null,
    warningSeg: null,
    warningJoint: null,
  };
}

export function ServiceConnectors({
  services,
  selectedServiceId = null,
  /** When provided (from scan layout), skip client-side re-routing. */
  precomputedPaths = null,
}: {
  services: InfrastructureService[];
  selectedServiceId?: string | null;
  precomputedPaths?: ConnectorPath[] | null;
}) {
  const signature = useMemo(() => servicesSignature(services), [services]);
  const servicesRef = useRef(services);
  servicesRef.current = services;

  const [paths, setPaths] = useState<ConnectorPath[]>(
    () => precomputedPaths ?? [],
  );

  useEffect(() => {
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
  }, [signature, precomputedPaths]);

  const geometry = useMemo(() => collectFromPaths(paths), [paths]);

  const meshes = useMemo(() => {
    const split = (items: { variant: ConnectorVariant }[]) => ({
      default: items.filter((item) => item.variant !== "warning"),
      warning: items.filter((item) => item.variant === "warning"),
    });

    if (!selectedServiceId) {
      const segs = split(geometry.segments);
      const joints = split(geometry.joints);
      const def = buildMeshes(
        segs.default as SegmentInstance[],
        joints.default as JointInstance[],
        getConnectorMaterial(),
      );
      const warn = buildMeshes(
        segs.warning as SegmentInstance[],
        joints.warning as JointInstance[],
        getWarningMaterial(),
      );
      return {
        idle: {
          defaultSeg: def.segmentMesh,
          defaultJoint: def.jointMesh,
          warningSeg: warn.segmentMesh,
          warningJoint: warn.jointMesh,
        } satisfies MeshBundle,
        focused: emptyBundle(),
      };
    }

    const linkedSegs = geometry.segments.filter((s) =>
      linkedTo(s, selectedServiceId),
    );
    const linkedJoints = geometry.joints.filter((j) =>
      linkedTo(j, selectedServiceId),
    );
    const segs = split(linkedSegs);
    const joints = split(linkedJoints);
    const def = buildMeshes(
      segs.default as SegmentInstance[],
      joints.default as JointInstance[],
      getHighlightMaterial(),
      HIGHLIGHT_SCALE,
    );
    const warn = buildMeshes(
      segs.warning as SegmentInstance[],
      joints.warning as JointInstance[],
      getWarningHighlightMaterial(),
      HIGHLIGHT_SCALE,
    );

    return {
      idle: emptyBundle(),
      focused: {
        defaultSeg: def.segmentMesh,
        defaultJoint: def.jointMesh,
        warningSeg: warn.segmentMesh,
        warningJoint: warn.jointMesh,
      } satisfies MeshBundle,
    };
  }, [geometry, selectedServiceId]);

  const focusLabels = useMemo(() => {
    if (!selectedServiceId) return [] as LabelInstance[];

    const labels: LabelInstance[] = [];
    for (const path of paths) {
      const pts = path.points;
      if (pts.length === 0) continue;

      const label = connectorLabelForPath(path, selectedServiceId);
      if (!label) continue;

      const mid = pts[Math.floor(pts.length / 2)]!;
      labels.push({
        x: mid.x,
        z: mid.z,
        text: formatConnectorLabel(label),
        warning: path.variant === "warning",
        key: path.id,
      });
    }
    return labels;
  }, [paths, selectedServiceId]);

  useLayoutEffect(
    () => () => {
      for (const bundle of [meshes.idle, meshes.focused]) {
        bundle.defaultSeg?.dispose();
        bundle.defaultJoint?.dispose();
        bundle.warningSeg?.dispose();
        bundle.warningJoint?.dispose();
      }
    },
    [meshes],
  );

  const active = selectedServiceId ? meshes.focused : meshes.idle;

  return (
    <group>
      {active.defaultSeg ? <primitive object={active.defaultSeg} /> : null}
      {active.defaultJoint ? <primitive object={active.defaultJoint} /> : null}
      {active.warningSeg ? <primitive object={active.warningSeg} /> : null}
      {active.warningJoint ? <primitive object={active.warningJoint} /> : null}
      {focusLabels.map((label) => (
        <Html
          key={label.key}
          position={[label.x, 0.35, label.z]}
          center
          distanceFactor={18}
          style={{ pointerEvents: "none" }}
        >
          <div
            className={
              label.warning
                ? "rounded-md border border-red-500/50 bg-red-950/90 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-red-100 shadow-lg"
                : "rounded-md border border-sky-400/40 bg-slate-950/90 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-sky-100 shadow-lg"
            }
          >
            {label.text}
          </div>
        </Html>
      ))}
    </group>
  );
}
