"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";
import {
  CELL_SIZE,
  GRID_EXTENT,
  GRID_MAJOR_EVERY,
  PLATFORM_THICKNESS,
  SCENE,
} from "@/lib/infrastructure-styles";

type PlatformProps = {
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

  const minorColor = useMemo(() => cssToThreeColor(SCENE.gridMinor), []);
  const majorColor = useMemo(() => cssToThreeColor(SCENE.gridMajor), []);

  return (
    <group position={[0, 0.001, 0]}>
      <lineSegments geometry={minorGeo}>
        <lineBasicMaterial
          color={minorColor}
          transparent
          opacity={0.28}
          depthWrite={false}
        />
      </lineSegments>
      <lineSegments geometry={majorGeo}>
        <lineBasicMaterial
          color={majorColor}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

/** Frosted glass slab under one group's blocks. */
export function FrostedPlatform({
  centerX,
  centerZ,
  width,
  depth,
}: PlatformProps) {
  const platformColor = useMemo(() => cssToThreeColor(SCENE.platform), []);

  return (
    <mesh position={[centerX, -PLATFORM_THICKNESS / 2, centerZ]}>
      <boxGeometry args={[width, PLATFORM_THICKNESS, depth]} />
      <meshPhysicalMaterial
        color={platformColor}
        roughness={0.35}
        metalness={0}
        transmission={0.55}
        thickness={PLATFORM_THICKNESS}
        ior={1.45}
        transparent
        opacity={0.3}
        attenuationColor={platformColor}
        attenuationDistance={1.2}
      />
    </mesh>
  );
}
