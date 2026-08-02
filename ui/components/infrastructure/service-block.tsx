"use client";

import { Text } from "@react-three/drei";
import { useLayoutEffect, useMemo } from "react";
import * as THREE from "three";

import {
  EDGE_BORDER,
  createCornerChamferedBoxGeometry,
  createHexPrismGeometry,
  createPolygonBucketGeometry,
  createPolygonPrismGeometry,
  extractEdgeSegments,
  filterVerticalAndTopEdges,
  getBlockMaterials,
} from "@/components/infrastructure/block-geometry";
import {
  CPU_ICON_NODES,
  CYLINDER_ICON_NODES,
  DATABASE_ICON_NODES,
  useLucideIconTexture,
} from "@/components/infrastructure/lucide-icon-texture";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type ServiceBlockProps = {
  service: InfrastructureService;
};

const PAD_HEIGHT = 0.02;

function EdgeBorders({
  geometry,
  material,
  mode = "all",
  topY = 0,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  mode?: "all" | "vertical-and-top";
  topY?: number;
}) {
  const segments = useMemo(() => {
    const all = extractEdgeSegments(geometry);
    if (mode === "vertical-and-top") {
      return filterVerticalAndTopEdges(all, topY);
    }
    return all;
  }, [geometry, mode, topY]);

  const barGeometry = useMemo(
    () => new THREE.BoxGeometry(EDGE_BORDER, 1, EDGE_BORDER),
    [],
  );

  useLayoutEffect(
    () => () => {
      barGeometry.dispose();
    },
    [barGeometry],
  );

  return (
    <group>
      {segments.map((segment, index) => (
        <mesh
          key={index}
          geometry={barGeometry}
          material={material}
          position={segment.mid}
          quaternion={segment.quaternion}
          scale={[1, segment.length, 1]}
        />
      ))}
    </group>
  );
}

/** Lucide glyph laid flat on the badge pad (parallel to the top face). */
function BadgeIconFlat({
  texture,
  size,
  y,
}: {
  texture: THREE.Texture | null;
  size: number;
  y: number;
}) {
  if (!texture) return null;

  return (
    <mesh position={[0, y + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}

function ComputeBadge({ y, scale = 1 }: { y: number; scale?: number }) {
  const { computePad } = getBlockMaterials();
  const texture = useLucideIconTexture(CPU_ICON_NODES, SCENE.computeIcon);

  const padSize = 0.55 * scale;
  const padCorner = 0.2 * padSize;
  const padGeometry = useMemo(
    () =>
      createCornerChamferedBoxGeometry(padSize, padSize, PAD_HEIGHT, padCorner),
    [padSize, padCorner],
  );

  useLayoutEffect(() => () => padGeometry.dispose(), [padGeometry]);

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={padGeometry} material={computePad} />
      <BadgeIconFlat texture={texture} size={padSize * 0.78} y={PAD_HEIGHT} />
    </group>
  );
}

function StorageBadge({ y, scale = 1 }: { y: number; scale?: number }) {
  const { storagePad } = getBlockMaterials();
  const texture = useLucideIconTexture(CYLINDER_ICON_NODES, SCENE.storageIcon);

  const padApothem = 0.22 * scale;
  const padGeometry = useMemo(
    () => createPolygonPrismGeometry(8, padApothem, PAD_HEIGHT),
    [padApothem],
  );

  useLayoutEffect(() => () => padGeometry.dispose(), [padGeometry]);

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={padGeometry} material={storagePad} />
      <BadgeIconFlat
        texture={texture}
        size={padApothem * 1.45}
        y={PAD_HEIGHT}
      />
    </group>
  );
}

function DatabaseBadge({ y, scale = 1 }: { y: number; scale?: number }) {
  const { databasePad } = getBlockMaterials();
  const texture = useLucideIconTexture(
    DATABASE_ICON_NODES,
    SCENE.databaseIcon,
  );

  const padApothem = 0.28 * scale;
  const padGeometry = useMemo(
    () => createPolygonPrismGeometry(6, padApothem, PAD_HEIGHT),
    [padApothem],
  );

  useLayoutEffect(() => () => padGeometry.dispose(), [padGeometry]);

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={padGeometry} material={databasePad} />
      <BadgeIconFlat
        texture={texture}
        size={padApothem * 1.45}
        y={PAD_HEIGHT}
      />
    </group>
  );
}

function ComputeBlock({
  width,
  depth,
}: {
  width: number;
  depth: number;
}) {
  const { block, border } = getBlockMaterials();
  const height = 0.5;
  const cornerInset = 0.2;
  const geometry = useMemo(
    () =>
      createCornerChamferedBoxGeometry(
        width * CELL_SIZE,
        depth * CELL_SIZE,
        height,
        cornerInset,
      ),
    [width, depth],
  );

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group>
      <mesh geometry={geometry} material={block} />
      <EdgeBorders geometry={geometry} material={border} />
      <ComputeBadge y={height} scale={Math.min(width, depth)} />
    </group>
  );
}

function StorageBlock({
  width,
  depth,
}: {
  width: number;
  depth: number;
}) {
  const { block, border } = getBlockMaterials();
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const apothem = footprint * 0.5;
  const height = 1;
  const rim = 0.1;
  const intrusion = 0.2;
  const geometry = useMemo(
    () => createPolygonBucketGeometry(8, apothem, height, rim, intrusion),
    [apothem],
  );

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  const cavityFloor = height - intrusion;

  return (
    <group>
      <mesh geometry={geometry} material={block} />
      <EdgeBorders
        geometry={geometry}
        material={border}
        mode="vertical-and-top"
        topY={height}
      />
      <StorageBadge y={cavityFloor} scale={Math.min(width, depth)} />
    </group>
  );
}

function DatabaseBlock({
  width,
  depth,
}: {
  width: number;
  depth: number;
}) {
  const { block, border } = getBlockMaterials();
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const radius = footprint * 0.45;
  const cellHeight = 0.3;
  const gap = 0.05;
  const totalHeight = cellHeight * 3 + gap * 2;

  const geometries = useMemo(
    () =>
      [0, 1, 2].map((index) => {
        const geo = createHexPrismGeometry(radius, cellHeight);
        geo.translate(0, index * (cellHeight + gap), 0);
        return geo;
      }),
    [radius],
  );

  useLayoutEffect(
    () => () => {
      for (const geo of geometries) geo.dispose();
    },
    [geometries],
  );

  return (
    <group>
      {geometries.map((geometry, index) => (
        <group key={index}>
          <mesh geometry={geometry} material={block} />
          <EdgeBorders geometry={geometry} material={border} />
        </group>
      ))}
      <DatabaseBadge y={totalHeight} scale={Math.min(width, depth)} />
    </group>
  );
}

function BlockMesh({ service }: { service: InfrastructureService }) {
  switch (service.category) {
    case "storage":
      return <StorageBlock width={service.width} depth={service.depth} />;
    case "database":
      return <DatabaseBlock width={service.width} depth={service.depth} />;
    default:
      return <ComputeBlock width={service.width} depth={service.depth} />;
  }
}

export function ServiceBlock({ service }: ServiceBlockProps) {
  const [x, , z] = serviceWorldCenter(service);
  // Grid +y maps to world +Z — place label on that side, flat on the platform.
  const labelZ = (service.depth * CELL_SIZE) / 2 + 0.15;

  return (
    <group position={[x, 0, z]}>
      <BlockMesh service={service} />
      <Text
        position={[0, 0.01, labelZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.2}
        color="#ffffff"
        anchorX="center"
        anchorY="top"
      >
        {service.name}
      </Text>
    </group>
  );
}
