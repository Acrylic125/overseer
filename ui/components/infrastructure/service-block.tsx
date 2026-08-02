"use client";

import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { memo, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  createChamferRectShape,
  createCornerChamferedBoxGeometry,
  createDelayedTaperChamferBoxGeometry,
  createDelayedTaperCylinderGeometry,
  createHexPrismGeometry,
  createPolygonPrismGeometry,
  createRegularPolygonShape,
  getBlockMaterials,
  getPooledGeometry,
  POLYGON_Y_ALIGN,
  rimMaterialForCategory,
} from "@/components/infrastructure/block-geometry";
import {
  CPU_ICON_NODES,
  CYLINDER_ICON_NODES,
  DATABASE_ICON_NODES,
  LAYERS_ICON_NODES,
  useLucideIconTexture,
} from "@/components/infrastructure/lucide-icon-texture";
import { useSvgIconTexture } from "@/components/infrastructure/svg-icon-texture";
import { cssToThreeColor } from "@/lib/css-color";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { resolveServiceIcon } from "@/lib/service-types";
import type {
  InfrastructureCategory,
  InfrastructureService,
} from "@/server/routers/infrastructure";

type IconNode = [string, Record<string, string | number>];

/** Prefer CF SVG on the white face; fall back to category Lucide glyph. */
function useBlockIconTexture(serviceType: string, fallbackNodes: IconNode[]) {
  const iconUrl = resolveServiceIcon(serviceType);
  const svgTexture = useSvgIconTexture(iconUrl);
  const lucideTexture = useLucideIconTexture(fallbackNodes, "#111827");
  // Only treat as CF icon once the texture has actually loaded.
  if (iconUrl && svgTexture) {
    return { texture: svgTexture, fullBleed: true };
  }
  return { texture: lucideTexture, fullBleed: false };
}

function BlockIconDecal({
  serviceType,
  fallbackNodes,
  y,
  maskGeometry,
  lucideSize,
}: {
  serviceType: string;
  fallbackNodes: IconNode[];
  y: number;
  maskGeometry: THREE.BufferGeometry;
  lucideSize: number;
}) {
  const { texture, fullBleed } = useBlockIconTexture(serviceType, fallbackNodes);
  return (
    <MaskedIconBadge
      texture={texture}
      y={y}
      opaque={fullBleed}
      maskGeometry={maskGeometry}
      lucideSize={lucideSize}
    />
  );
}

type ServiceBlockProps = {
  service: InfrastructureService;
};

const PAD_HEIGHT = 0.02;
const RIM_HEIGHT = 0.035;
/** Visible accent rim width between block edge and white icon face. */
const ICON_RIM = 0.05;
/** Baseplate footprint relative to the block silhouette (~10% larger). */
const BASE_SCALE = 1.1;
const BASE_HEIGHT = 0.12;

/** Squared distance for labels + chrome (icons stay visible at overview). */
const LOD_DETAIL_D2 = 22 * 22;

const CATEGORY_ACCENT = {
  compute: SCENE.computeIcon,
  storage: SCENE.storageIcon,
  database: SCENE.databaseIcon,
  integration: SCENE.integrationIcon,
} as const;

const CATEGORY_BASE = {
  compute: SCENE.computeBase,
  storage: SCENE.storageBase,
  database: SCENE.databaseBase,
  integration: SCENE.integrationBase,
} as const;

/** Pedestal matching the block silhouette — full width to mid-height, then tapers in. */
const baseplateMaterials = new Map<string, THREE.MeshStandardMaterial>();

function getBaseplateMaterial(cssColor: string) {
  let mat = baseplateMaterials.get(cssColor);
  if (!mat) {
    const color = cssToThreeColor(cssColor);
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.22,
      roughness: 0.45,
      metalness: 0.12,
      flatShading: true,
    });
    baseplateMaterials.set(cssColor, mat);
  }
  return mat;
}

function BlockBaseplate({
  category,
  width,
  depth,
}: {
  category: InfrastructureCategory;
  width: number;
  depth: number;
}) {
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const topScale = 1 / BASE_SCALE;
  const material = getBaseplateMaterial(CATEGORY_BASE[category]);
  const geometry = useMemo(
    () =>
      getPooledGeometry(
        `base:${category}:${width}:${depth}`,
        () => {
          switch (category) {
            case "database": {
              const topRadius = footprint * 0.45;
              return createDelayedTaperCylinderGeometry(
                6,
                topRadius * BASE_SCALE,
                topRadius,
                BASE_HEIGHT,
              );
            }
            case "storage": {
              const apothem = footprint * 0.5 * 0.9 * BASE_SCALE;
              const bottomRadius = apothem / Math.cos(Math.PI / 8);
              return createDelayedTaperCylinderGeometry(
                8,
                bottomRadius,
                bottomRadius * topScale,
                BASE_HEIGHT,
              );
            }
            case "integration": {
              const topRadius = footprint * 0.48;
              return createDelayedTaperCylinderGeometry(
                16,
                topRadius * BASE_SCALE,
                topRadius,
                BASE_HEIGHT,
              );
            }
            default: {
              const cornerInset = 0.16 * BASE_SCALE;
              return createDelayedTaperChamferBoxGeometry(
                width * CELL_SIZE * BASE_SCALE,
                depth * CELL_SIZE * BASE_SCALE,
                BASE_HEIGHT,
                cornerInset,
                topScale,
              );
            }
          }
        },
      ),
    [category, width, depth, footprint, topScale],
  );

  return <mesh geometry={geometry} material={material} />;
}

const iconMaterialCache = new Map<string, THREE.MeshBasicMaterial>();

function getIconMaterial(texture: THREE.Texture, opaque: boolean) {
  const key = `${texture.uuid}:${opaque ? "o" : "t"}`;
  let mat = iconMaterialCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: !opaque,
      depthWrite: opaque,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    iconMaterialCache.set(key, mat);
  }
  return mat;
}

/**
 * CF SVG masked to the white pad silhouette (circle / n-gon / chamfer).
 * Lucide fallback stays a small centered square glyph.
 */
function MaskedIconBadge({
  texture,
  y,
  opaque,
  /** Shape-matched geometry for CF full-bleed; omit for Lucide square. */
  maskGeometry,
  lucideSize,
}: {
  texture: THREE.Texture | null;
  y: number;
  opaque: boolean;
  maskGeometry?: THREE.BufferGeometry;
  lucideSize?: number;
}) {
  if (!texture) return null;
  const material = getIconMaterial(texture, opaque);

  if (opaque && maskGeometry) {
    return (
      <mesh
        geometry={maskGeometry}
        position={[0, y + 0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      />
    );
  }

  const size = lucideSize ?? 0.5;
  return (
    <mesh
      position={[0, y + 0.001, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
    >
      <planeGeometry args={[size, size]} />
    </mesh>
  );
}

/**
 * ShapeGeometry writes raw vertex x/y as UVs (often ±0.5), which ClampToEdge
 * maps to the cream border of the SVG. Remap to 0–1 over the shape bounds.
 */
function withNormalizedShapeUVs(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return geometry;

  const pos = geometry.getAttribute("position");
  const width = bb.max.x - bb.min.x || 1;
  const height = bb.max.y - bb.min.y || 1;
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    uvs[i * 2] = (pos.getX(i) - bb.min.x) / width;
    uvs[i * 2 + 1] = (pos.getY(i) - bb.min.y) / height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return geometry;
}

/** Chamfered-rect top: accent rim 0.1 from edge, white icon face inside. */
function ComputeTopFace({
  width,
  depth,
  y,
  serviceType,
}: {
  width: number;
  depth: number;
  y: number;
  serviceType: string;
}) {
  const { iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("compute");
  const cornerInset = 0.16;
  const iconW = Math.max(width - ICON_RIM * 2, width * 0.35);
  const iconD = Math.max(depth - ICON_RIM * 2, depth * 0.35);
  const iconCorner = cornerInset * (iconW / width);

  const rimGeometry = useMemo(
    () =>
      getPooledGeometry(
        `compute-rim:${width}:${depth}`,
        () =>
          createCornerChamferedBoxGeometry(width, depth, RIM_HEIGHT, cornerInset),
      ),
    [width, depth],
  );
  const iconGeometry = useMemo(
    () =>
      getPooledGeometry(
        `compute-icon:${iconW}:${iconD}:${iconCorner}`,
        () =>
          createCornerChamferedBoxGeometry(iconW, iconD, PAD_HEIGHT, iconCorner),
      ),
    [iconW, iconD, iconCorner],
  );
  const maskGeometry = useMemo(
    () =>
      getPooledGeometry(`compute-mask:${iconW}:${iconD}:${iconCorner}`, () =>
        withNormalizedShapeUVs(
          new THREE.ShapeGeometry(
            createChamferRectShape(iconW, iconD, iconCorner),
          ),
        ),
      ),
    [iconW, iconD, iconCorner],
  );

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={rimGeometry} material={rim} />
      <mesh
        geometry={iconGeometry}
        position={[0, RIM_HEIGHT, 0]}
        material={iconFace}
      />
      <BlockIconDecal
        serviceType={serviceType}
        fallbackNodes={CPU_ICON_NODES}
        y={RIM_HEIGHT + PAD_HEIGHT}
        maskGeometry={maskGeometry}
        lucideSize={Math.min(iconW, iconD) * 0.72}
      />
    </group>
  );
}

/** Octagon top: accent rim 0.1 from edge, white icon face inside. */
function StorageTopFace({
  apothem,
  y,
  serviceType,
}: {
  apothem: number;
  y: number;
  serviceType: string;
}) {
  const { iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("storage");
  const iconApothem = Math.max(apothem - ICON_RIM, apothem * 0.35);
  const rimGeometry = useMemo(
    () =>
      getPooledGeometry(`storage-rim:${apothem}`, () =>
        createPolygonPrismGeometry(8, apothem, RIM_HEIGHT),
      ),
    [apothem],
  );
  const iconGeometry = useMemo(
    () =>
      getPooledGeometry(`storage-icon:${iconApothem}`, () =>
        createPolygonPrismGeometry(8, iconApothem, PAD_HEIGHT),
      ),
    [iconApothem],
  );
  const maskGeometry = useMemo(
    () =>
      getPooledGeometry(`storage-mask:${iconApothem}`, () => {
        const geo = new THREE.ShapeGeometry(
          createRegularPolygonShape(8, iconApothem),
        );
        geo.rotateZ(POLYGON_Y_ALIGN);
        return withNormalizedShapeUVs(geo);
      }),
    [iconApothem],
  );

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={rimGeometry} material={rim} />
      <mesh
        geometry={iconGeometry}
        position={[0, RIM_HEIGHT, 0]}
        material={iconFace}
      />
      <BlockIconDecal
        serviceType={serviceType}
        fallbackNodes={CYLINDER_ICON_NODES}
        y={RIM_HEIGHT + PAD_HEIGHT}
        maskGeometry={maskGeometry}
        lucideSize={iconApothem * 1.45}
      />
    </group>
  );
}

/** Hex top: accent rim 0.1 from edge, white icon face inside. */
function DatabaseTopFace({
  apothem,
  y,
  serviceType,
}: {
  apothem: number;
  y: number;
  serviceType: string;
}) {
  const { iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("database");
  const iconApothem = Math.max(apothem - ICON_RIM, apothem * 0.35);
  const rimGeometry = useMemo(
    () =>
      getPooledGeometry(`db-rim:${apothem}`, () =>
        createPolygonPrismGeometry(6, apothem, RIM_HEIGHT),
      ),
    [apothem],
  );
  const iconGeometry = useMemo(
    () =>
      getPooledGeometry(`db-icon:${iconApothem}`, () =>
        createPolygonPrismGeometry(6, iconApothem, PAD_HEIGHT),
      ),
    [iconApothem],
  );
  const maskGeometry = useMemo(
    () =>
      getPooledGeometry(`db-mask:${iconApothem}`, () => {
        const geo = new THREE.ShapeGeometry(
          createRegularPolygonShape(6, iconApothem),
        );
        geo.rotateZ(POLYGON_Y_ALIGN);
        return withNormalizedShapeUVs(geo);
      }),
    [iconApothem],
  );

  return (
    <group position={[0, y, 0]}>
      <mesh geometry={rimGeometry} material={rim} />
      <mesh
        geometry={iconGeometry}
        position={[0, RIM_HEIGHT, 0]}
        material={iconFace}
      />
      <BlockIconDecal
        serviceType={serviceType}
        fallbackNodes={DATABASE_ICON_NODES}
        y={RIM_HEIGHT + PAD_HEIGHT}
        maskGeometry={maskGeometry}
        lucideSize={iconApothem * 1.45}
      />
    </group>
  );
}

/** Circular top: accent rim, white icon face — matches disc stack silhouette. */
function IntegrationTopFace({
  radius,
  y,
  serviceType,
}: {
  radius: number;
  y: number;
  serviceType: string;
}) {
  const { iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("integration");
  const iconRadius = Math.max(radius - ICON_RIM, radius * 0.35);
  const maskGeometry = useMemo(
    () =>
      getPooledGeometry(`int-mask:${iconRadius}`, () =>
        new THREE.CircleGeometry(iconRadius, 16),
      ),
    [iconRadius],
  );

  return (
    <group position={[0, y, 0]}>
      <mesh position={[0, RIM_HEIGHT / 2, 0]} material={rim}>
        <cylinderGeometry args={[radius, radius, RIM_HEIGHT, 16]} />
      </mesh>
      <mesh position={[0, RIM_HEIGHT + PAD_HEIGHT / 2, 0]} material={iconFace}>
        <cylinderGeometry args={[iconRadius, iconRadius, PAD_HEIGHT, 16]} />
      </mesh>
      <BlockIconDecal
        serviceType={serviceType}
        fallbackNodes={LAYERS_ICON_NODES}
        y={RIM_HEIGHT + PAD_HEIGHT}
        maskGeometry={maskGeometry}
        lucideSize={iconRadius * 1.55}
      />
    </group>
  );
}

const ventMaterial = new THREE.MeshStandardMaterial({
  color: "#1a2333",
  roughness: 0.55,
  metalness: 0.2,
});

const lampDimMaterial = new THREE.MeshBasicMaterial({
  color: "#607087",
  toneMapped: false,
});

const lampAccentMaterials = new Map<string, THREE.MeshBasicMaterial>();

function getLampAccentMaterial(cssColor: string) {
  let mat = lampAccentMaterials.get(cssColor);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color: cssToThreeColor(cssColor),
      toneMapped: false,
    });
    lampAccentMaterials.set(cssColor, mat);
  }
  return mat;
}

const blockShellMaterials = new Map<string, THREE.MeshStandardMaterial>();

function getBlockShellMaterial(doubleSided = false) {
  const key = doubleSided ? "dbl" : "sgl";
  let mat = blockShellMaterials.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: cssToThreeColor(SCENE.block),
      roughness: 0.4,
      metalness: 0.04,
      flatShading: true,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    blockShellMaterials.set(key, mat);
  }
  return mat;
}

const accentBandMaterials = new Map<string, THREE.MeshStandardMaterial>();

function getAccentBandMaterial(cssColor: string, doubleSided = false) {
  const key = `${cssColor}:${doubleSided ? "d" : "s"}`;
  let mat = accentBandMaterials.get(key);
  if (!mat) {
    const color = cssToThreeColor(cssColor);
    mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.18,
      roughness: 0.35,
      metalness: 0.22,
      flatShading: true,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    accentBandMaterials.set(key, mat);
  }
  return mat;
}

function ComputeBlock({
  width,
  depth,
  accent,
  serviceType,
  showDecor,
}: {
  width: number;
  depth: number;
  accent: string;
  serviceType: string;
  showDecor: boolean;
}) {
  const { block } = getBlockMaterials();
  const height = 0.34;
  const cornerInset = 0.16;
  const w = width * CELL_SIZE;
  const d = depth * CELL_SIZE;
  const geometry = useMemo(
    () =>
      getPooledGeometry(`compute-body:${w}:${d}`, () =>
        createCornerChamferedBoxGeometry(w, d, height, cornerInset),
      ),
    [w, d],
  );

  const ventCount = 3;
  const ventW = w * 0.48;
  const ventH = 0.025;
  const ventDepth = 0.014;
  const ventStartY = height * 0.25;
  const ventSpan = height * 0.32;

  return (
    <group>
      <mesh geometry={geometry} material={block} />
      {showDecor
        ? Array.from({ length: ventCount }, (_, i) => {
            const t = i / (ventCount - 1);
            const y = ventStartY + t * ventSpan;
            return (
              <mesh
                key={i}
                position={[0, y, d / 2 - ventDepth / 2 + 0.001]}
                material={ventMaterial}
              >
                <boxGeometry args={[ventW, ventH, ventDepth]} />
              </mesh>
            );
          })
        : null}
      {showDecor
        ? ([-0.025, 0.025] as const).map((x, index) => (
            <mesh
              key={x}
              position={[w * 0.34 + x, height * 0.72, d / 2 + 0.002]}
              material={
                index === 0 ? getLampAccentMaterial(accent) : lampDimMaterial
              }
            >
              <circleGeometry args={[0.012, 8]} />
            </mesh>
          ))
        : null}
      <ComputeTopFace
        width={w}
        depth={d}
        y={height}
        serviceType={serviceType}
      />
    </group>
  );
}

function StorageBlock({
  width,
  depth,
  accent,
  serviceType,
  showDecor,
}: {
  width: number;
  depth: number;
  accent: string;
  serviceType: string;
  showDecor: boolean;
}) {
  const { block } = getBlockMaterials();
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const topApothem = footprint * 0.43;
  const bottomApothem = topApothem * 0.76;
  const topRadius = topApothem / Math.cos(Math.PI / 8);
  const bottomRadius = bottomApothem / Math.cos(Math.PI / 8);
  const height = 0.56;
  const lipHeight = 0.055;
  const wallThickness = 0.04;
  const innerApothem = topApothem - wallThickness;
  const cavityFloor = height - 0.13;
  const shell = getBlockShellMaterial(true);
  const foot = getBlockShellMaterial(false);
  const band = getAccentBandMaterial(accent, true);

  const lipGeometry = useMemo(
    () =>
      getPooledGeometry(`storage-lip:${topApothem}:${innerApothem}`, () => {
        const shape = new THREE.Shape();
        const outerRadius = (topApothem + 0.02) / Math.cos(Math.PI / 8);
        const innerRadius = innerApothem / Math.cos(Math.PI / 8);
        for (let i = 0; i < 8; i += 1) {
          const angle = Math.PI / 2 + (i * Math.PI) / 4;
          const x = Math.cos(angle) * outerRadius;
          const y = Math.sin(angle) * outerRadius;
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        }
        shape.closePath();
        const hole = new THREE.Path();
        for (let i = 7; i >= 0; i -= 1) {
          const angle = Math.PI / 2 + (i * Math.PI) / 4;
          const x = Math.cos(angle) * innerRadius;
          const y = Math.sin(angle) * innerRadius;
          if (i === 7) hole.moveTo(x, y);
          else hole.lineTo(x, y);
        }
        hole.closePath();
        shape.holes.push(hole);
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth: lipHeight,
          bevelEnabled: false,
        });
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(Math.PI / 2);
        return geometry;
      }),
    [topApothem, innerApothem],
  );

  const bandY = height * 0.7;
  const bandRadius = bottomRadius + (topRadius - bottomRadius) * 0.7 + 0.008;

  return (
    <group>
      <mesh position={[0, height / 2, 0]} material={shell}>
        <cylinderGeometry
          args={[topRadius, bottomRadius, height, 8, 1, true]}
        />
      </mesh>
      <mesh geometry={lipGeometry} position={[0, height, 0]} material={block} />
      <mesh position={[0, 0.025, 0]} material={foot}>
        <cylinderGeometry args={[bottomRadius * 1.04, bottomRadius, 0.05, 8]} />
      </mesh>
      {showDecor ? (
        <mesh position={[0, bandY, 0]} material={band}>
          <cylinderGeometry
            args={[bandRadius, bandRadius, 0.028, 8, 1, true]}
          />
        </mesh>
      ) : null}
      <StorageTopFace
        apothem={innerApothem}
        y={cavityFloor}
        serviceType={serviceType}
      />
    </group>
  );
}

function DatabaseBlock({
  width,
  depth,
  accent,
  serviceType,
  showDecor,
}: {
  width: number;
  depth: number;
  accent: string;
  serviceType: string;
  showDecor: boolean;
}) {
  const { block } = getBlockMaterials();
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const radius = footprint * 0.45;
  const apothem = radius * Math.cos(Math.PI / 6);
  const cellHeight = 0.3;
  const gap = 0.05;
  const totalHeight = cellHeight * 3 + gap * 2;
  const spacer = getAccentBandMaterial(accent);

  const geometries = useMemo(
    () =>
      [0, 1, 2].map((index) =>
        getPooledGeometry(`db-cell:${radius}:${index}`, () => {
          const geo = createHexPrismGeometry(radius, cellHeight);
          geo.translate(0, index * (cellHeight + gap), 0);
          return geo;
        }),
      ),
    [radius],
  );

  return (
    <group>
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} material={block} />
      ))}
      {showDecor
        ? [cellHeight + gap * 0.5, cellHeight * 2 + gap * 1.5].map((y) => (
            <mesh key={y} position={[0, y, 0]} material={spacer}>
              <cylinderGeometry args={[radius * 0.94, radius * 0.94, gap, 6]} />
            </mesh>
          ))
        : null}
      <DatabaseTopFace
        apothem={apothem}
        y={totalHeight}
        serviceType={serviceType}
      />
    </group>
  );
}

/**
 * Application Integration — stacked circular discs with side ports.
 * Reads as a queue / event bus, distinct from hex DB, octagon bucket, and chassis.
 */
function IntegrationBlock({
  width,
  depth,
  accent,
  serviceType,
  showDecor,
}: {
  width: number;
  depth: number;
  accent: string;
  serviceType: string;
  showDecor: boolean;
}) {
  const { block } = getBlockMaterials();
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const plateCount = 3;
  const plateH = 0.1;
  const gap = 0.045;
  const baseRadius = footprint * 0.48;
  const totalHeight = plateCount * plateH + (plateCount - 1) * gap;
  const spacer = getAccentBandMaterial(accent);
  const port = getAccentBandMaterial(accent);

  const midY = plateH + gap + plateH / 2;
  const portRadius = 0.04;
  const portLength = 0.08;
  const midRadius = baseRadius * (1 - 0.07);
  const portX = midRadius + portLength / 2 - 0.01;
  const topRadius = baseRadius * (1 - (plateCount - 1) * 0.07);

  return (
    <group>
      {Array.from({ length: plateCount }, (_, index) => {
        const scale = 1 - index * 0.07;
        const radius = baseRadius * scale;
        const y = index * (plateH + gap) + plateH / 2;
        return (
          <mesh key={`plate-${index}`} position={[0, y, 0]} material={block}>
            <cylinderGeometry args={[radius, radius, plateH, 16]} />
          </mesh>
        );
      })}
      {showDecor
        ? [0, 1].map((index) => {
            const scale = 1 - index * 0.07;
            const radius = baseRadius * scale * 0.92;
            const y = plateH + index * (plateH + gap) + gap / 2;
            return (
              <mesh key={`spacer-${index}`} position={[0, y, 0]} material={spacer}>
                <cylinderGeometry args={[radius, radius, gap, 16]} />
              </mesh>
            );
          })
        : null}
      {showDecor
        ? ([-1, 1] as const).map((side) => (
            <mesh
              key={side}
              position={[side * portX, midY, 0]}
              rotation={[0, 0, Math.PI / 2]}
              material={port}
            >
              <cylinderGeometry args={[portRadius, portRadius, portLength, 8]} />
            </mesh>
          ))
        : null}
      <IntegrationTopFace
        radius={topRadius}
        y={totalHeight}
        serviceType={serviceType}
      />
    </group>
  );
}

function BlockMesh({
  service,
  showDecor,
}: {
  service: InfrastructureService;
  showDecor: boolean;
}) {
  const accent = CATEGORY_ACCENT[service.category];
  switch (service.category) {
    case "storage":
      return (
        <StorageBlock
          width={service.width}
          depth={service.depth}
          accent={accent}
          serviceType={service.type}
          showDecor={showDecor}
        />
      );
    case "database":
      return (
        <DatabaseBlock
          width={service.width}
          depth={service.depth}
          accent={accent}
          serviceType={service.type}
          showDecor={showDecor}
        />
      );
    case "integration":
      return (
        <IntegrationBlock
          width={service.width}
          depth={service.depth}
          accent={accent}
          serviceType={service.type}
          showDecor={showDecor}
        />
      );
    default:
      return (
        <ComputeBlock
          width={service.width}
          depth={service.depth}
          accent={accent}
          serviceType={service.type}
          showDecor={showDecor}
        />
      );
  }
}

function ServiceBlockInner({ service }: ServiceBlockProps) {
  const [x, , z] = serviceWorldCenter(service);
  const labelZ = (service.depth * CELL_SIZE) / 2 + 0.15;
  const [near, setNear] = useState(false);
  const nearRef = useRef(false);

  useFrame(({ camera }) => {
    const dx = camera.position.x - x;
    const dy = camera.position.y;
    const dz = camera.position.z - z;
    const next = dx * dx + dy * dy + dz * dz < LOD_DETAIL_D2;
    if (next !== nearRef.current) {
      nearRef.current = next;
      setNear(next);
    }
  });

  return (
    <group position={[x, 0, z]}>
      <BlockBaseplate
        category={service.category}
        width={service.width}
        depth={service.depth}
      />
      <group position={[0, BASE_HEIGHT, 0]}>
        <BlockMesh service={service} showDecor={near} />
      </group>
      <Text
        position={[0, BASE_HEIGHT + 0.02, labelZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.2}
        fontWeight="medium"
        color="#d7dde5"
        anchorX="center"
        anchorY="top"
        renderOrder={2}
        frustumCulled
      >
        {service.name}
      </Text>
    </group>
  );
}

export const ServiceBlock = memo(ServiceBlockInner);
