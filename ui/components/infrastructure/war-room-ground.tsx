"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useScene } from "@/components/infrastructure/scene-context";
import { CELL_SIZE, SCENE, ZONE_META } from "@/lib/infrastructure-styles";
import type { InfrastructureZone } from "@/server/routers/infrastructure";

function zoneBounds(
  services: { x: number; y: number; zone: InfrastructureZone }[],
  zone: InfrastructureZone,
) {
  const members = services.filter((s) => s.zone === zone);
  if (members.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const s of members) {
    const x = s.x * CELL_SIZE;
    const z = s.y * CELL_SIZE;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const pad = CELL_SIZE * 1.6;
  return {
    x: (minX + maxX) / 2,
    z: (minZ + maxZ) / 2,
    w: maxX - minX + pad * 2,
    d: maxZ - minZ + pad * 2,
  };
}

function RadarSweep({ radius }: { radius: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    mesh.current.rotation.y = (clock.elapsedTime / 10) * Math.PI * 2;
  });

  return (
    <mesh ref={mesh} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.2, radius, 32, 1, 0, Math.PI * 0.18]} />
      <meshBasicMaterial
        color={SCENE.radar}
        transparent
        opacity={0.1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export function WarRoomGround({
  center,
  radius,
}: {
  center: THREE.Vector3;
  radius: number;
}) {
  const { services } = useScene();
  const zones = useMemo(() => {
    const result: {
      zone: InfrastructureZone;
      bounds: NonNullable<ReturnType<typeof zoneBounds>>;
    }[] = [];
    for (const zone of Object.keys(ZONE_META) as InfrastructureZone[]) {
      const bounds = zoneBounds(services, zone);
      if (bounds) result.push({ zone, bounds });
    }
    return result;
  }, [services]);

  const size = Math.max(80, radius * 4);

  return (
    <group position={[center.x, 0, center.z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial
          color={SCENE.table}
          roughness={0.92}
          metalness={SCENE.tableReflect}
        />
      </mesh>

      {zones.map(({ zone, bounds }) => (
        <mesh
          key={zone}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[bounds.x - center.x, 0.01, bounds.z - center.z]}
        >
          <planeGeometry args={[bounds.w, bounds.d]} />
          <meshBasicMaterial
            color={ZONE_META[zone].color}
            transparent
            opacity={0.12}
            depthWrite={false}
          />
        </mesh>
      ))}

      <RadarSweep radius={Math.max(18, radius * 1.8)} />
    </group>
  );
}
