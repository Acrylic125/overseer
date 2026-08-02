"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useScene } from "@/components/infrastructure/scene-context";
import { buildVeinSegments, type VeinSegment } from "@/lib/graph/trunk-edges";
import { ACCENT } from "@/lib/infrastructure-styles";

const PARTICLE_BUDGET = 48;
const CURVE_POINTS = 16;

function heatColor(heat: number, target: THREE.Color) {
  target.set(ACCENT.data).lerp(new THREE.Color(ACCENT.alertCritical), heat);
  return target;
}

function VeinLine({
  segment,
  dim,
}: {
  segment: VeinSegment;
  dim: number;
}) {
  const { positions, color } = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3(
      segment.points.map((p) => new THREE.Vector3(...p)),
    );
    const pts = curve.getPoints(CURVE_POINTS);
    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i += 1) {
      positions[i * 3] = pts[i]!.x;
      positions[i * 3 + 1] = pts[i]!.y;
      positions[i * 3 + 2] = pts[i]!.z;
    }
    return {
      positions,
      color: heatColor(segment.heat, new THREE.Color()),
    };
  }, [segment]);

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={(segment.radius > 0.05 ? 0.75 : 0.4) * dim}
      />
    </line>
  );
}

/** Single points system for all visible veins — one useFrame, hard particle budget. */
function VeinParticleField({
  segments,
}: {
  segments: { segment: VeinSegment; dim: number }[];
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const scratch = useMemo(() => new THREE.Vector3(), []);

  const { curves, count } = useMemo(() => {
    const active = segments.filter((s) => s.dim > 0.5).slice(0, 24);
    const curves = active.map(({ segment }) => ({
      curve: new THREE.CatmullRomCurve3(
        segment.points.map((p) => new THREE.Vector3(...p)),
      ),
      heat: segment.heat,
      particles: Math.max(1, Math.round(PARTICLE_BUDGET / Math.max(active.length, 1))),
    }));
    const count = curves.reduce((sum, c) => sum + c.particles, 0);
    return { curves, count: Math.min(count, PARTICLE_BUDGET) };
  }, [segments]);

  const positions = useMemo(() => new Float32Array(PARTICLE_BUDGET * 3), []);

  useFrame(({ clock }) => {
    if (!pointsRef.current || curves.length === 0) return;
    const attr = pointsRef.current.geometry.getAttribute(
      "position",
    ) as THREE.BufferAttribute;
    let cursor = 0;
    for (const entry of curves) {
      const speed = 0.07 + (1 - entry.heat) * 0.04;
      for (let i = 0; i < entry.particles && cursor < PARTICLE_BUDGET; i += 1) {
        const t = (clock.elapsedTime * speed + i / entry.particles) % 1;
        entry.curve.getPointAt(t, scratch);
        attr.setXYZ(cursor, scratch.x, scratch.y, scratch.z);
        cursor += 1;
      }
    }
    // Park unused particles underground
    for (; cursor < PARTICLE_BUDGET; cursor += 1) {
      attr.setXYZ(cursor, 0, -10, 0);
    }
    attr.needsUpdate = true;
    pointsRef.current.geometry.setDrawRange(0, count);
  });

  if (curves.length === 0) return null;

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={ACCENT.data}
        size={0.08}
        transparent
        opacity={0.85}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

export function DataVeins() {
  const { services, related } = useScene();
  const segments = useMemo(() => buildVeinSegments(services), [services]);

  const prepared = useMemo(
    () =>
      segments.map((segment) => {
        const involved =
          !related ||
          related.has(segment.targetId) ||
          segment.sourceIds.some((id) => related.has(id));
        return { segment, dim: involved ? 1 : 0.18 };
      }),
    [segments, related],
  );

  return (
    <group>
      {prepared.map(({ segment, dim }) => (
        <VeinLine key={segment.id} segment={segment} dim={dim} />
      ))}
      <VeinParticleField segments={prepared} />
    </group>
  );
}
