"use client";

import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { cssToThreeColor } from "@/lib/css-color";
import {
  CELL_SIZE,
  PUBLIC_INTERNET_BASE_DEPTH,
  PUBLIC_INTERNET_BASE_WIDTH,
  SCENE,
} from "@/lib/infrastructure-styles";

export const PUBLIC_INTERNET_ID = "public-internet";

type Puff = {
  /** Position / scale authored for the BASE 3×2 footprint. */
  position: [number, number, number];
  /** Horizontal radius X and thin height Y; mesh scale is [X, Y, X]. */
  scale: [number, number];
};

/**
 * Iconic cloud from five flat ellipsoids, authored for a 3×2 cell footprint.
 * Scale rule per lobe: [X, Y, X]. Lobe centers sit on y = 0.
 */
const BASE_PUFFS: Puff[] = [
  // Wide base
  { position: [0.0, 0, 0.06], scale: [1.15, 0.28] },
  // Left lobe
  { position: [-0.95, 0, 0.02], scale: [0.75, 0.26] },
  // Right lobe
  { position: [1.0, 0, 0.02], scale: [0.8, 0.26] },
  // Rear-left bump
  { position: [-0.35, 0, -0.35], scale: [0.65, 0.3] },
  // Peak bump
  { position: [0.35, 0, -0.32], scale: [0.75, 0.32] },
];

/** Low tessellation is enough for flat ellipsoids; keeps the bake cheap. */
const SPHERE_WIDTH_SEGMENTS = 16;
const SPHERE_HEIGHT_SEGMENTS = 12;

/** Baked once at base 3×2 — live footprints only scale this mesh. */
let cachedCloudGeometry: THREE.BufferGeometry | null = null;

function getCloudGeometry(): THREE.BufferGeometry {
  if (cachedCloudGeometry) return cachedCloudGeometry;

  const parts: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();

  for (const puff of BASE_PUFFS) {
    const sx = puff.scale[0];
    const sy = puff.scale[1];
    matrix.makeScale(sx, sy, sx);
    matrix.setPosition(puff.position[0], puff.position[1], puff.position[2]);

    const part = new THREE.SphereGeometry(
      1,
      SPHERE_WIDTH_SEGMENTS,
      SPHERE_HEIGHT_SEGMENTS,
    );
    part.applyMatrix4(matrix);
    parts.push(part);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    throw new Error("Failed to merge public-internet cloud geometry");
  }
  merged.computeVertexNormals();
  cachedCloudGeometry = merged;
  return merged;
}

type PublicInternetCloudProps = {
  centerX?: number;
  centerZ?: number;
  /** Footprint width in world units (defaults to base 3). */
  width?: number;
  /** Footprint depth in world units (defaults to base 2). */
  depth?: number;
};

export function PublicInternetCloud({
  centerX = 0,
  centerZ = 0,
  width = PUBLIC_INTERNET_BASE_WIDTH * CELL_SIZE,
  depth = PUBLIC_INTERNET_BASE_DEPTH * CELL_SIZE,
}: PublicInternetCloudProps) {
  const color = useMemo(() => cssToThreeColor(SCENE.publicInternet), []);
  const geometry = useMemo(() => getCloudGeometry(), []);
  const scaleX = width / (PUBLIC_INTERNET_BASE_WIDTH * CELL_SIZE);
  const scaleZ = depth / (PUBLIC_INTERNET_BASE_DEPTH * CELL_SIZE);
  const scaleY = (scaleX + scaleZ) / 2;
  const fontSize = Math.max(0.28, 0.36 * scaleX);
  // Just above the tallest lobe (peak bump half-height 0.32).
  const labelY = 0.45 * scaleY;

  return (
    <group position={[centerX, 0, centerZ]}>
      <mesh geometry={geometry} scale={[scaleX, scaleY, scaleZ]}>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.2}
          roughness={0.72}
          metalness={0}
        />
      </mesh>

      <Text
        position={[0, labelY, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={fontSize}
        color="#d7dde5"
        anchorX="center"
        anchorY="middle"
        renderOrder={3}
        maxWidth={width * 0.9}
        textAlign="center"
      >
        Public Internet
      </Text>
    </group>
  );
}
