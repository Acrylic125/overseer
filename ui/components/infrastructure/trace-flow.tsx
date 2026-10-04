"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";

import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { InfrastructureService } from "@/server/routers/infrastructure";

const motionQuery = "(prefers-reduced-motion: reduce)";
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function TraceFlow({ paths, services, tracedIds }: {
  paths: ConnectorPath[];
  services: InfrastructureService[];
  tracedIds: Set<string>;
}) {
  const reducedMotion = useSyncExternalStore(subscribeMotion,
    () => window.matchMedia(motionQuery).matches, () => true);
  const geometry = useRef<THREE.BufferGeometry>(null);
  const flows = useMemo(() => {
    const byId = new Map(services.map((service) => [service.id, service]));
    return paths.flatMap((path) => {
      if (!tracedIds.has(path.sourceId) || !tracedIds.has(path.targetId)) return [];
      const directions: number[] = [];
      if (byId.get(path.sourceId)?.dependsOn.includes(path.targetId)) directions.push(1);
      if (byId.get(path.targetId)?.dependsOn.includes(path.sourceId)) directions.push(-1);
      const curve = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 1; i < path.points.length; i += 1) {
        const a = path.points[i - 1]!;
        const b = path.points[i]!;
        curve.add(new THREE.LineCurve3(new THREE.Vector3(a.x, 0.08, a.z), new THREE.Vector3(b.x, 0.08, b.z)));
      }
      if (curve.getLength() === 0) return [];
      return directions.map((direction) => ({ curve, direction, length: curve.getLength() }));
    });
  }, [paths, services, tracedIds]);
  const positions = useMemo(() => new Float32Array(flows.length * 3), [flows]);
  useFrame(({ clock }) => {
    const attribute = geometry.current?.getAttribute("position");
    if (!attribute) return;
    for (let i = 0; i < flows.length; i += 1) {
      const flow = flows[i]!;
      let t = 0.5;
      if (!reducedMotion) t = (clock.elapsedTime * 3 / flow.length + i * 0.37) % 1;
      if (flow.direction < 0) t = 1 - t;
      const point = flow.curve.getPoint(t);
      attribute.setXYZ(i, point.x, point.y, point.z);
    }
    attribute.needsUpdate = true;
  });
  return (
    <points frustumCulled={false} renderOrder={2}>
      <bufferGeometry ref={geometry}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#b9ddff" size={0.22} toneMapped={false} depthWrite={false} />
    </points>
  );
}
