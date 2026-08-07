"use client";

import { Text } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import {
  CELL_SIZE,
  PUBLIC_INTERNET_BASE_DEPTH,
  PUBLIC_INTERNET_BASE_WIDTH,
} from "@/lib/infrastructure-styles";
import {
  loadPlatformGradient,
  loadShapeGeometry,
} from "@/lib/platform-assets";

export const PUBLIC_INTERNET_ID = "public-internet";
/** `gen-assets/shapes/cloud.svg` mesh name in `/shapes.glb`. */
export const PUBLIC_INTERNET_SHAPE = "cloud";

/** Lie flat on XZ (facing +Y). Parent group owns this so troika can't reset it. */
const FLAT_ON_GROUND: [number, number, number] = [-Math.PI / 2, 0, 0];
const TITLE_FONT = 0.35;

type PublicInternetCloudProps = {
  centerX?: number;
  centerZ?: number;
  /** Footprint width in world units (defaults to base 4). */
  width?: number;
  /** Footprint depth in world units (defaults to base 2). */
  depth?: number;
  /** Optional override; defaults to the cloud silhouette. */
  shape?: string;
  label?: string;
};

/**
 * Public Internet hub — `cloud` shape from gen-assets with the shared
 * platform gradient. Uniform scale preserves the SVG aspect ratio and fits
 * inside the reserved width×depth footprint.
 */
export function PublicInternetCloud({
  centerX = 0,
  centerZ = 0,
  width = PUBLIC_INTERNET_BASE_WIDTH * CELL_SIZE,
  depth = PUBLIC_INTERNET_BASE_DEPTH * CELL_SIZE,
  shape = PUBLIC_INTERNET_SHAPE,
  label = "Public Internet",
}: PublicInternetCloudProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [gradient, setGradient] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadShapeGeometry(shape), loadPlatformGradient()]).then(
      ([geo, texture]) => {
        if (cancelled) {
          geo.dispose();
          return;
        }
        setGeometry(geo);
        setGradient(texture);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [shape]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  const material = useMemo(() => {
    if (!gradient) return null;
    return new THREE.MeshBasicMaterial({
      map: gradient,
      toneMapped: false,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
  }, [gradient]);

  useEffect(() => {
    return () => {
      material?.dispose();
    };
  }, [material]);

  const box = useMemo(() => {
    if (!geometry) return null;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    if (!bounds) return null;
    // Bake/export may center the mesh — snap the top face to y = 0.
    if (Math.abs(bounds.max.y) > 1e-6) {
      geometry.translate(0, -bounds.max.y, 0);
      geometry.computeBoundingBox();
    }
    return geometry.boundingBox;
  }, [geometry]);

  // Unit bake: longer side = 1. Scale uniformly so the silhouette isn't squished.
  const baseW = box ? Math.max(box.max.x - box.min.x, 0.01) : 1;
  const baseD = box ? Math.max(box.max.z - box.min.z, 0.01) : 0.49;
  const scale = Math.min(width / baseW, depth / baseD);
  const fontSize = Math.max(TITLE_FONT, 0.28 * scale);

  if (!geometry || !material) return null;

  return (
    <group position={[centerX, 0, centerZ]}>
      <mesh geometry={geometry} material={material} scale={[scale, 1, scale]} />

      <group position={[0, 0.001, 0]} rotation={FLAT_ON_GROUND}>
        <Text
          fontSize={fontSize}
          color="#F8FAFC"
          anchorX="center"
          anchorY="middle"
          maxWidth={Math.max(width * 0.9, fontSize)}
          overflowWrap="normal"
          whiteSpace="nowrap"
          textAlign="center"
          renderOrder={2}
          depthOffset={-1}
        >
          {label}
        </Text>
      </group>
    </group>
  );
}
