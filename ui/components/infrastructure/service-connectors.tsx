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
const CORNER_RADIUS = CONNECTOR_SIZE * 0.35;

let connectorMaterial: THREE.MeshStandardMaterial | null = null;

function getConnectorMaterial() {
  if (!connectorMaterial) {
    connectorMaterial = new THREE.MeshStandardMaterial({
      color: cssToThreeColor(SCENE.connector),
      roughness: 0,
      metalness: 0,
      flatShading: true,
    });
  } else {
    connectorMaterial.color.copy(cssToThreeColor(SCENE.connector));
  }
  return connectorMaterial;
}

function createRoundedRectShape(size: number, radius: number) {
  const s = size / 2;
  const r = Math.min(radius, s * 0.9);
  const shape = new THREE.Shape();
  shape.moveTo(-s + r, -s);
  shape.lineTo(s - r, -s);
  shape.quadraticCurveTo(s, -s, s, -s + r);
  shape.lineTo(s, s - r);
  shape.quadraticCurveTo(s, s, s - r, s);
  shape.lineTo(-s + r, s);
  shape.quadraticCurveTo(-s, s, -s, s - r);
  shape.lineTo(-s, -s + r);
  shape.quadraticCurveTo(-s, -s, -s + r, -s);
  return shape;
}

function addSegment(
  root: THREE.Group,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  material: THREE.MeshStandardMaterial,
) {
  const dx = bx - ax;
  const dz = bz - az;
  const length = Math.hypot(dx, dz);
  if (length < 1e-5) return;

  const geometry = new THREE.ExtrudeGeometry(
    createRoundedRectShape(CONNECTOR_SIZE, CORNER_RADIUS),
    { depth: length, bevelEnabled: false },
  );
  geometry.translate(0, 0, -length / 2);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set((ax + bx) / 2, TUBE_Y, (az + bz) / 2);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(dx, 0, dz).normalize(),
  );
  root.add(mesh);
}

function addJoint(
  root: THREE.Group,
  x: number,
  z: number,
  material: THREE.MeshStandardMaterial,
) {
  const geometry = new THREE.SphereGeometry(CONNECTOR_SIZE * 0.55, 12, 10);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, TUBE_Y, z);
  root.add(mesh);
}

function ConnectorTube({ path }: { path: ConnectorPath }) {
  const material = getConnectorMaterial();
  const group = useMemo(() => {
    const root = new THREE.Group();
    const pts = path.points;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      addSegment(root, a.x, a.z, b.x, b.z, material);
    }
    for (let i = 1; i < pts.length - 1; i += 1) {
      const p = pts[i]!;
      addJoint(root, p.x, p.z, material);
    }
    return root;
  }, [path, material]);

  useLayoutEffect(
    () => () => {
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) obj.geometry.dispose();
      });
    },
    [group],
  );

  return <primitive object={group} />;
}

export function ServiceConnectors({
  services,
}: {
  services: InfrastructureService[];
}) {
  const paths = useMemo(() => buildAllConnectorPaths(services), [services]);

  return (
    <group>
      {paths.map((path) => (
        <ConnectorTube key={path.id} path={path} />
      ))}
    </group>
  );
}
