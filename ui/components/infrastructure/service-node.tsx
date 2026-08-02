"use client";

import { Billboard, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { useScene } from "@/components/infrastructure/scene-context";
import {
  ACCENT,
  CELL_SIZE,
  HEALTH_GLOW,
  SPECIES_STYLE,
} from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type ServiceNodeProps = {
  service: InfrastructureService;
};

function useDimFactor(serviceId: string) {
  const { related } = useScene();
  if (!related) return 1;
  return related.has(serviceId) ? 1 : 0.3;
}

function DatabaseMesh({ accent, dim }: { accent: string; dim: number }) {
  return (
    <mesh>
      <cylinderGeometry args={[0.45, 0.5, 0.55, 6]} />
      <meshStandardMaterial
        color="#1a1f28"
        metalness={0.7}
        roughness={0.6}
        emissive={accent}
        emissiveIntensity={0.15 * dim}
        opacity={dim}
        transparent={dim < 1}
      />
    </mesh>
  );
}

function ApiGatewayMesh({ accent, dim }: { accent: string; dim: number }) {
  return (
    <mesh rotation={[0, Math.PI / 4, 0]}>
      <octahedronGeometry args={[0.55, 0]} />
      <meshStandardMaterial
        color={accent}
        metalness={0.35}
        roughness={0.2}
        emissive={accent}
        emissiveIntensity={0.3 * dim}
        opacity={dim}
        transparent={dim < 1}
      />
    </mesh>
  );
}

function MicroserviceMesh({ accent, dim }: { accent: string; dim: number }) {
  return (
    <mesh>
      <boxGeometry args={[0.7, 0.55, 0.7]} />
      <meshStandardMaterial
        color={accent}
        roughness={0.55}
        metalness={0.1}
        emissive={accent}
        emissiveIntensity={0.12 * dim}
        opacity={dim}
        transparent={dim < 1}
      />
    </mesh>
  );
}

function QueueMesh({ accent, dim }: { accent: string; dim: number }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    mat.current.emissiveIntensity =
      0.25 * dim + Math.sin(clock.elapsedTime * 1.4) * 0.1 * dim;
  });
  return (
    <mesh>
      <boxGeometry args={[0.35, 1.15, 0.35]} />
      <meshStandardMaterial
        ref={mat}
        color="#9fd4cf"
        transparent
        opacity={0.55 * dim}
        roughness={0.25}
        metalness={0.05}
        emissive={accent}
        emissiveIntensity={0.25 * dim}
      />
    </mesh>
  );
}

function CdnEdgeMesh({ accent, dim }: { accent: string; dim: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.35;
  });
  return (
    <group ref={group}>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.55, 0.08, 8, 24]} />
        <meshStandardMaterial
          color={accent}
          transparent
          opacity={0.7 * dim}
          roughness={0.25}
          metalness={0.2}
          emissive={accent}
          emissiveIntensity={0.35 * dim}
        />
      </mesh>
    </group>
  );
}

function LoadBalancerMesh({ accent, dim }: { accent: string; dim: number }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (!mat.current) return;
    mat.current.emissiveIntensity =
      0.35 * dim + Math.sin(clock.elapsedTime * 2.8) * 0.2 * dim;
  });
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.5, 0.14, 8, 24]} />
      <meshStandardMaterial
        ref={mat}
        color={accent}
        emissive={ACCENT.healthyGlow}
        emissiveIntensity={0.4 * dim}
        roughness={0.3}
        metalness={0.35}
        opacity={dim}
        transparent={dim < 1}
      />
    </mesh>
  );
}

function SpeciesMesh({
  species,
  accent,
  dim,
}: {
  species: InfrastructureService["species"];
  accent: string;
  dim: number;
}) {
  switch (species) {
    case "database":
      return <DatabaseMesh accent={accent} dim={dim} />;
    case "api_gateway":
      return <ApiGatewayMesh accent={accent} dim={dim} />;
    case "queue":
      return <QueueMesh accent={accent} dim={dim} />;
    case "cdn_edge":
      return <CdnEdgeMesh accent={accent} dim={dim} />;
    case "load_balancer":
      return <LoadBalancerMesh accent={accent} dim={dim} />;
    default:
      return <MicroserviceMesh accent={accent} dim={dim} />;
  }
}

function HealthPulse({
  health,
  dim,
}: {
  health: InfrastructureService["health"];
  dim: number;
}) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const glow = HEALTH_GLOW[health];
  // Skip per-frame work for healthy nodes — static soft glow is enough.
  useFrame(({ clock }) => {
    if (!mat.current || health === "healthy") return;
    const t = clock.elapsedTime;
    if (health === "warning") {
      mat.current.opacity =
        0.2 * dim + (Math.sin(t * glow.pulse) * 0.5 + 0.5) * 0.25 * dim;
    } else {
      mat.current.opacity =
        0.15 * dim + (Math.sin(t * glow.pulse) > 0 ? 0.45 : 0.08) * dim;
    }
  });

  return (
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[0.55, 16]} />
      <meshBasicMaterial
        ref={mat}
        color={glow.color}
        transparent
        opacity={health === "healthy" ? 0.12 * dim : 0.25 * dim}
        depthWrite={false}
      />
    </mesh>
  );
}

export function ServiceNode({ service }: ServiceNodeProps) {
  const { selectedId, requestFocus } = useScene();
  const dim = useDimFactor(service.id);
  const style = SPECIES_STYLE[service.species];
  const selected = selectedId === service.id;

  const position = useMemo(
    () =>
      [
        service.x * CELL_SIZE,
        speciesLift(service.species),
        service.y * CELL_SIZE,
      ] as [number, number, number],
    [service],
  );

  return (
    <group position={position}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          requestFocus(service.id);
        }}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "default";
        }}
      >
        <SpeciesMesh
          species={service.species}
          accent={style.accent}
          dim={dim}
        />
      </group>

      <HealthPulse health={service.health} dim={dim} />

      {selected ? (
        <>
          <Billboard position={[0, 1.15, 0]} follow>
            <Text
              fontSize={0.16}
              color="#ffffff"
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.012}
              outlineColor="#05070c"
            >
              {service.name}
            </Text>
          </Billboard>
          <Billboard position={[0, 1.7, 0]} follow>
            <group>
              <mesh position={[0, 0, -0.02]}>
                <planeGeometry args={[1.6, 0.85]} />
                <meshBasicMaterial
                  color="#0e1524"
                  transparent
                  opacity={0.82}
                  depthWrite={false}
                />
              </mesh>
              <Text
                position={[0, 0.22, 0]}
                fontSize={0.11}
                color={ACCENT.data}
                anchorX="center"
              >
                {`${style.label.toUpperCase()}  ·  ${service.health.toUpperCase()}`}
              </Text>
              <Text
                position={[0, 0.02, 0]}
                fontSize={0.13}
                color="#e8eef7"
                anchorX="center"
              >
                {`RPS ${service.metrics.rps}   err ${(service.metrics.errorRate * 100).toFixed(2)}%`}
              </Text>
              <Text
                position={[0, -0.2, 0]}
                fontSize={0.13}
                color="#e8eef7"
                anchorX="center"
              >
                {`p95 ${service.metrics.latencyMs}ms`}
              </Text>
            </group>
          </Billboard>
        </>
      ) : null}

      {selected && service.health === "critical" ? (
        <AlertSmoke service={service} />
      ) : null}
    </group>
  );
}

function AlertSmoke({ service }: { service: InfrastructureService }) {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.position.y = 1.4 + (clock.elapsedTime % 3) * 0.35;
  });

  return (
    <group ref={group}>
      <Billboard>
        <Text
          fontSize={0.14}
          color={ACCENT.alertCritical}
          anchorX="center"
          outlineWidth={0.01}
          outlineColor="#1a0505"
        >
          {`CRITICAL · ${service.metrics.latencyMs}ms`}
        </Text>
      </Billboard>
    </group>
  );
}

function speciesLift(species: InfrastructureService["species"]) {
  switch (species) {
    case "database":
      return 0.28;
    case "queue":
      return 0.58;
    case "cdn_edge":
      return 1.35;
    case "load_balancer":
      return 1.05;
    case "api_gateway":
      return 0.7;
    default:
      return 0.35;
  }
}
