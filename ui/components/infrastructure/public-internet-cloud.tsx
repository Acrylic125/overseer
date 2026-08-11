"use client";

import { Text } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";

import {
  CELL_SIZE,
  PUBLIC_INTERNET_BASE_DEPTH,
  PUBLIC_INTERNET_BASE_WIDTH,
} from "@/lib/infrastructure-styles";
import { INTERNET_ID } from "@/lib/internet";
import {
  loadPlatformGradient,
  loadShapeBorderGeometry,
  loadShapeGeometry,
} from "@/lib/platform-assets";
import { BORDER_HEX, SQUIRCLE_BORDER } from "@/lib/platform-mesh";

export const PUBLIC_INTERNET_ID = INTERNET_ID;
/** `scan/assets/shapes/cloud.svg` mesh name in `/assets.glb`. */
export const PUBLIC_INTERNET_SHAPE = "cloud";

/**
 * Lift the cloud + label above connector lines (y = 0) so paths pass underneath
 * instead of z-fighting through the silhouette.
 */
const CLOUD_Y = 0.06;

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
  /** Full opacity when 1; dimmed service blocks use 0.2 when a service is focused. */
  opacity?: number;
};

/**
 * Public Internet hub — `cloud` shape from scan assets with the shared
 * platform gradient and a rim matching {@link SQUIRCLE_BORDER} (same as pads).
 */
export function PublicInternetCloud({
  centerX = 0,
  centerZ = 0,
  width = PUBLIC_INTERNET_BASE_WIDTH * CELL_SIZE,
  depth = PUBLIC_INTERNET_BASE_DEPTH * CELL_SIZE,
  shape = PUBLIC_INTERNET_SHAPE,
  label = "Public Internet",
  opacity = 1,
}: PublicInternetCloudProps) {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const [borderGeometry, setBorderGeometry] =
    useState<THREE.BufferGeometry | null>(null);
  const [gradient, setGradient] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      loadShapeGeometry(shape),
      loadShapeBorderGeometry(shape),
      loadPlatformGradient(),
    ]).then(([geo, border, texture]) => {
      if (cancelled) {
        geo.dispose();
        border?.dispose();
        return;
      }
      setGeometry(geo);
      setBorderGeometry(border);
      setGradient(texture);
    });
    return () => {
      cancelled = true;
    };
  }, [shape]);

  useEffect(() => {
    return () => {
      geometry?.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      borderGeometry?.dispose();
    };
  }, [borderGeometry]);

  const material = useMemo(() => {
    if (!gradient) return null;
    return new THREE.MeshBasicMaterial({
      map: gradient,
      toneMapped: false,
      side: THREE.FrontSide,
      depthWrite: true,
    });
  }, [gradient]);

  const borderMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(BORDER_HEX),
        toneMapped: false,
        side: THREE.FrontSide,
        depthWrite: true,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      material?.dispose();
    };
  }, [material]);

  useEffect(() => {
    return () => {
      borderMaterial.dispose();
    };
  }, [borderMaterial]);

  useLayoutEffect(() => {
    if (!material) return;
    const dimmed = opacity < 1;
    material.transparent = dimmed;
    material.opacity = opacity;
    material.depthWrite = !dimmed;
    borderMaterial.transparent = dimmed;
    borderMaterial.opacity = opacity;
    borderMaterial.depthWrite = !dimmed;
  }, [material, borderMaterial, opacity]);

  const fitBox = useMemo(() => {
    const source = borderGeometry ?? geometry;
    if (!source) return null;
    source.computeBoundingBox();
    const bounds = source.boundingBox;
    if (!bounds) return null;
    if (Math.abs(bounds.max.y) > 1e-6) {
      source.translate(0, -bounds.max.y, 0);
      source.computeBoundingBox();
    }
    // Keep the fill top aligned with the rim after the shared snap.
    if (geometry && geometry !== source) {
      geometry.computeBoundingBox();
      const bodyBounds = geometry.boundingBox;
      if (bodyBounds && Math.abs(bodyBounds.max.y) > 1e-6) {
        geometry.translate(0, -bodyBounds.max.y, 0);
        geometry.computeBoundingBox();
      }
    }
    return source.boundingBox;
  }, [geometry, borderGeometry]);

  // Unit bake: longer side = 1. Outer scale fills the footprint; fill shrinks by
  // SQUIRCLE_BORDER on each side so the rim matches platform pads in world units.
  const baseW = fitBox ? Math.max(fitBox.max.x - fitBox.min.x, 0.01) : 1;
  const baseD = fitBox ? Math.max(fitBox.max.z - fitBox.min.z, 0.01) : 0.49;
  const outerScale = Math.min(width / baseW, depth / baseD);
  const innerScale = Math.max(outerScale - 2 * SQUIRCLE_BORDER, outerScale * 0.5);
  const fontSize = Math.max(TITLE_FONT, 0.28 * outerScale);

  if (!geometry || !material) return null;

  const rimGeometry = borderGeometry ?? geometry;

  return (
    <group position={[centerX, CLOUD_Y, centerZ]}>
      {/* Solid underlay rim — full silhouette, larger scale. */}
      <mesh
        geometry={rimGeometry}
        material={borderMaterial}
        scale={[outerScale, 1, outerScale]}
      />
      {/* Gradient fill — inset by SQUIRCLE_BORDER; sit above so it isn't buried. */}
      <mesh
        geometry={geometry}
        material={material}
        scale={[innerScale, 1, innerScale]}
        position={[0, 0.001, 0]}
      />

      <group position={[0, 0.02, 0]} rotation={FLAT_ON_GROUND}>
        <Text
          fontSize={fontSize}
          color="#F8FAFC"
          fillOpacity={opacity}
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
