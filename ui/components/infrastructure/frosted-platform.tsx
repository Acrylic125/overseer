"use client";

import { Text } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  CELL_SIZE,
  GRID_EXTENT,
  GRID_MAJOR_EVERY,
} from "@/lib/infrastructure-styles";
import { loadPlatformGradient } from "@/lib/platform-assets";
import { createPlatformGeometries } from "@/lib/platform-mesh";

/** Matches scan `GROUP_TITLE_HEIGHT`. */
const TITLE_FONT = 0.35;
/** Label at (0.5, 0.5) from the platform's top-left (scan layout contract). */
const LABEL_INSET = 0.5;
/** Lie flat on XZ (facing +Y). Parent group owns this so troika can't reset it. */
const FLAT_ON_GROUND: [number, number, number] = [-Math.PI / 2, 0, 0];

type PlatformProps = {
  group: string;
  centerX: number;
  centerZ: number;
  width: number;
  depth: number;
};

function buildGridLines(
  extent: number,
  majorEvery: number,
): { minor: Float32Array; major: Float32Array } {
  const half = extent / 2;
  const min = Math.floor(-half / CELL_SIZE) * CELL_SIZE;
  const max = Math.ceil(half / CELL_SIZE) * CELL_SIZE;

  const minor: number[] = [];
  const major: number[] = [];

  const pushLine = (
    target: number[],
    x1: number,
    z1: number,
    x2: number,
    z2: number,
  ) => {
    target.push(x1, 0, z1, x2, 0, z2);
  };

  for (let x = min; x <= max + 1e-6; x += CELL_SIZE) {
    const cell = Math.round(x / CELL_SIZE);
    const target = cell % majorEvery === 0 ? major : minor;
    pushLine(target, x, min, x, max);
  }
  for (let z = min; z <= max + 1e-6; z += CELL_SIZE) {
    const cell = Math.round(z / CELL_SIZE);
    const target = cell % majorEvery === 0 ? major : minor;
    pushLine(target, min, z, max, z);
  }

  return {
    minor: new Float32Array(minor),
    major: new Float32Array(major),
  };
}

/** Floor grid spanning the whole scene (independent of platforms). */
export function WorldGrid({ extent = GRID_EXTENT }: { extent?: number }) {
  const { minor, major } = useMemo(
    () => buildGridLines(extent, GRID_MAJOR_EVERY),
    [extent],
  );

  const minorGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(minor, 3));
    return geo;
  }, [minor]);

  const majorGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(major, 3));
    return geo;
  }, [major]);

  const minorColor = useMemo(() => cssToThreeColor("#2A3344"), []);
  const majorColor = useMemo(() => cssToThreeColor("#3B4556"), []);

  return (
    <group position={[0, -0.04, 0]}>
      <lineSegments geometry={minorGeo}>
        <lineBasicMaterial
          color={minorColor}
          transparent
          opacity={0.35}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments geometry={majorGeo}>
        <lineBasicMaterial
          color={majorColor}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

/**
 * Squircle group platform — shape + gradient from scan assets
 * (parametric ExtrudeGeometry sized per pad, baked gradient map).
 */
export function FrostedPlatform({
  group,
  centerX,
  centerZ,
  width,
  depth,
}: PlatformProps) {
  const [gradient, setGradient] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPlatformGradient().then((texture) => {
      if (!cancelled) setGradient(texture);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { body, border, bodyMaterial, borderMaterial } = useMemo(() => {
    const { body: bodyGeo, border: borderGeo } = createPlatformGeometries(
      width,
      depth,
      "xz",
    );

    const bodyMat = new THREE.MeshBasicMaterial({
      map: gradient,
      toneMapped: false,
      side: THREE.FrontSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const borderMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      side: THREE.FrontSide,
      depthWrite: true,
    });

    return {
      body: bodyGeo,
      border: borderGeo,
      bodyMaterial: bodyMat,
      borderMaterial: borderMat,
    };
  }, [width, depth, gradient]);

  useEffect(() => {
    return () => {
      body.dispose();
      border.dispose();
      // Shared gradient map — do not dispose.
      bodyMaterial.dispose();
      borderMaterial.dispose();
    };
  }, [body, border, bodyMaterial, borderMaterial]);

  // (0.5, 0.5) from top-left: scan y → world z; top = −Z edge of the platform.
  const titlePos: [number, number, number] = [
    -width / 2 + LABEL_INSET,
    0.02,
    -depth / 2 + LABEL_INSET,
  ];

  if (!gradient) return null;

  return (
    <group position={[centerX, 0, centerZ]}>
      <mesh geometry={body} material={bodyMaterial} />
      <mesh geometry={border} material={borderMaterial} />
      <group position={titlePos} rotation={FLAT_ON_GROUND}>
        <Text
          fontSize={TITLE_FONT}
          color="#F8FAFC"
          anchorX="left"
          anchorY="top"
          maxWidth={Math.max(width - LABEL_INSET * 2, TITLE_FONT)}
          overflowWrap="normal"
          whiteSpace="nowrap"
          renderOrder={2}
        >
          {group.includes("/") ? group.slice(group.lastIndexOf("/") + 1) : group}
        </Text>
      </group>
    </group>
  );
}
