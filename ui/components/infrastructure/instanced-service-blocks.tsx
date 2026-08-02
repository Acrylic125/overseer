"use client";

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";

import {
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
  loadLucideIconTexture,
} from "@/components/infrastructure/lucide-icon-texture";
import { ServiceLabels } from "@/components/infrastructure/service-labels";
import { loadSvgIconGeometry } from "@/components/infrastructure/svg-icon-geometry";
import { cssToThreeColor } from "@/lib/css-color";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import { resolveServiceIcon } from "@/lib/service-types";
import type {
  InfrastructureCategory,
  InfrastructureService,
} from "@/server/routers/infrastructure";

const PAD_HEIGHT = 0.02;
const RIM_HEIGHT = 0.035;
const ICON_RIM = 0.05;
const BASE_SCALE = 1.1;
const BASE_HEIGHT = 0.12;
/** Max instances per layer inside the streaming window. */
const INSTANCE_LIMIT = 2500;
/** CF glyph orange — matches product SVG fills. */
const CF_GLYPH_COLOR = "#F6821F";

const _dummy = new THREE.Object3D();
const _iconQuat = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
);

const baseplateMaterials = new Map<string, THREE.MeshStandardMaterial>();
const iconMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
const glyphMaterialCache = new Map<string, THREE.MeshBasicMaterial>();
const shellMaterials = new Map<string, THREE.MeshStandardMaterial>();

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

function getShellMaterial(doubleSided: boolean) {
  const key = doubleSided ? "d" : "s";
  let mat = shellMaterials.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: cssToThreeColor(SCENE.block),
      roughness: 0.4,
      metalness: 0.04,
      flatShading: true,
      side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    });
    shellMaterials.set(key, mat);
  }
  return mat;
}

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

function getGlyphMaterial(cssColor: string) {
  let mat = glyphMaterialCache.get(cssColor);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color: cssToThreeColor(cssColor),
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: true,
    });
    glyphMaterialCache.set(cssColor, mat);
  }
  return mat;
}

type InstancePose = {
  x: number;
  y: number;
  z: number;
  /** Uniform scale (SVG glyphs are unit-sized). */
  scale?: number;
};

function InstancedLayer({
  geometry,
  material,
  poses,
  iconBillboard = false,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  poses: InstancePose[];
  iconBillboard?: boolean;
}) {
  const mesh = useMemo(() => {
    const next = new THREE.InstancedMesh(
      geometry,
      material,
      INSTANCE_LIMIT,
    );
    next.frustumCulled = true;
    next.castShadow = false;
    next.receiveShadow = false;
    return next;
  }, [geometry, material]);

  useLayoutEffect(() => {
    const count = Math.min(poses.length, INSTANCE_LIMIT);
    for (let i = 0; i < count; i += 1) {
      const pose = poses[i]!;
      const s = pose.scale ?? 1;
      _dummy.position.set(pose.x, pose.y, pose.z);
      if (iconBillboard) _dummy.quaternion.copy(_iconQuat);
      else _dummy.quaternion.identity();
      _dummy.scale.set(s, s, s);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (count > 0) mesh.computeBoundingSphere();
  }, [mesh, poses, iconBillboard]);

  useLayoutEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );

  if (poses.length === 0) return null;
  return <primitive object={mesh} />;
}

function footprintOf(service: InfrastructureService) {
  return Math.min(service.width, service.depth) * CELL_SIZE;
}

function sizeKey(service: InfrastructureService) {
  return `${service.width}x${service.depth}`;
}

function groupBySize(services: InfrastructureService[]) {
  const map = new Map<string, InfrastructureService[]>();
  for (const service of services) {
    const key = sizeKey(service);
    const list = map.get(key);
    if (list) list.push(service);
    else map.set(key, [service]);
  }
  return map;
}

function posesAt(
  services: InfrastructureService[],
  localY: number,
): InstancePose[] {
  return services.map((service) => {
    const [x, , z] = serviceWorldCenter(service);
    return { x, y: localY, z };
  });
}

function baseplateGeometry(category: InfrastructureCategory, width: number, depth: number) {
  const footprint = Math.min(width, depth) * CELL_SIZE;
  const topScale = 1 / BASE_SCALE;
  return getPooledGeometry(`inst-base:${category}:${width}:${depth}`, () => {
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
        return createDelayedTaperChamferBoxGeometry(
          width * CELL_SIZE * BASE_SCALE,
          depth * CELL_SIZE * BASE_SCALE,
          BASE_HEIGHT,
          0.16 * BASE_SCALE,
          topScale,
        );
      }
    }
  });
}

const CATEGORY_BASE = {
  compute: SCENE.computeBase,
  storage: SCENE.storageBase,
  database: SCENE.databaseBase,
  integration: SCENE.integrationBase,
} as const;

function CategoryBaseplates({
  category,
  services,
}: {
  category: InfrastructureCategory;
  services: InfrastructureService[];
}) {
  const material = getBaseplateMaterial(CATEGORY_BASE[category]);
  return [...groupBySize(services)].map(([key, group]) => {
    const sample = group[0]!;
    return (
      <InstancedLayer
        key={`base-${category}-${key}`}
        geometry={baseplateGeometry(category, sample.width, sample.depth)}
        material={material}
        poses={posesAt(group, 0)}
      />
    );
  });
}

function ComputeBodies({ services }: { services: InfrastructureService[] }) {
  const { block, iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("compute");
  const height = 0.34;

  return [...groupBySize(services)].map(([key, group]) => {
    const sample = group[0]!;
    const w = sample.width * CELL_SIZE;
    const d = sample.depth * CELL_SIZE;
    const body = getPooledGeometry(`inst-compute-body:${w}:${d}`, () =>
      createCornerChamferedBoxGeometry(w, d, height, 0.16),
    );
    const iconW = Math.max(w - ICON_RIM * 2, w * 0.35);
    const iconD = Math.max(d - ICON_RIM * 2, d * 0.35);
    const iconCorner = 0.16 * (iconW / w);
    const rimGeo = getPooledGeometry(`inst-compute-rim:${w}:${d}`, () =>
      createCornerChamferedBoxGeometry(w, d, RIM_HEIGHT, 0.16),
    );
    const faceGeo = getPooledGeometry(
      `inst-compute-face:${iconW}:${iconD}:${iconCorner}`,
      () =>
        createCornerChamferedBoxGeometry(iconW, iconD, PAD_HEIGHT, iconCorner),
    );

    return (
      <group key={`compute-${key}`}>
        <InstancedLayer
          geometry={body}
          material={block}
          poses={posesAt(group, BASE_HEIGHT)}
        />
        <InstancedLayer
          geometry={rimGeo}
          material={rim}
          poses={posesAt(group, BASE_HEIGHT + height)}
        />
        <InstancedLayer
          geometry={faceGeo}
          material={iconFace}
          poses={posesAt(group, BASE_HEIGHT + height + RIM_HEIGHT)}
        />
      </group>
    );
  });
}

function StorageBodies({ services }: { services: InfrastructureService[] }) {
  const { block, iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("storage");
  const shell = getShellMaterial(true);
  const foot = getShellMaterial(false);

  return [...groupBySize(services)].map(([key, group]) => {
    const sample = group[0]!;
    const footprint = footprintOf(sample);
    const topApothem = footprint * 0.43;
    const bottomApothem = topApothem * 0.76;
    const topRadius = topApothem / Math.cos(Math.PI / 8);
    const bottomRadius = bottomApothem / Math.cos(Math.PI / 8);
    const height = 0.56;
    const wallThickness = 0.04;
    const innerApothem = topApothem - wallThickness;
    const cavityFloor = height - 0.13;
    const lipHeight = 0.055;

    const shellGeo = getPooledGeometry(
      `inst-storage-shell:${topRadius}:${bottomRadius}`,
      () => {
        const geo = new THREE.CylinderGeometry(
          topRadius,
          bottomRadius,
          height,
          8,
          1,
          true,
        );
        geo.translate(0, height / 2, 0);
        return geo;
      },
    );
    const footGeo = getPooledGeometry(
      `inst-storage-foot:${bottomRadius}`,
      () => {
        const geo = new THREE.CylinderGeometry(
          bottomRadius * 1.04,
          bottomRadius,
          0.05,
          8,
        );
        geo.translate(0, 0.025, 0);
        return geo;
      },
    );
    const lipGeo = getPooledGeometry(
      `inst-storage-lip:${topApothem}:${innerApothem}`,
      () => {
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
      },
    );
    const iconApothem = Math.max(innerApothem - ICON_RIM, innerApothem * 0.35);
    const rimGeo = getPooledGeometry(
      `inst-storage-rim-ring:${innerApothem}:${iconApothem}`,
      () => createPolygonRingGeometry(8, innerApothem, iconApothem, RIM_HEIGHT),
    );
    const faceGeo = getPooledGeometry(`inst-storage-face:${iconApothem}`, () =>
      createPolygonPrismGeometry(8, iconApothem, PAD_HEIGHT),
    );
    const bandY = height * 0.7;
    const bandRadius =
      bottomRadius + (topRadius - bottomRadius) * 0.7 + 0.008;
    const bandGeo = getPooledGeometry(
      `inst-storage-band:${bandRadius}`,
      () => {
        const geo = new THREE.CylinderGeometry(
          bandRadius,
          bandRadius,
          0.028,
          8,
          1,
          true,
        );
        geo.translate(0, bandY, 0);
        return geo;
      },
    );

    return (
      <group key={`storage-${key}`}>
        <InstancedLayer
          geometry={shellGeo}
          material={shell}
          poses={posesAt(group, BASE_HEIGHT)}
        />
        <InstancedLayer
          geometry={footGeo}
          material={foot}
          poses={posesAt(group, BASE_HEIGHT)}
        />
        <InstancedLayer
          geometry={lipGeo}
          material={block}
          poses={posesAt(group, BASE_HEIGHT + height)}
        />
        <InstancedLayer
          geometry={bandGeo}
          material={rim}
          poses={posesAt(group, BASE_HEIGHT)}
        />
        <InstancedLayer
          geometry={rimGeo}
          material={rim}
          poses={posesAt(group, BASE_HEIGHT + cavityFloor)}
        />
        <InstancedLayer
          geometry={faceGeo}
          material={iconFace}
          poses={posesAt(group, BASE_HEIGHT + cavityFloor + RIM_HEIGHT)}
        />
      </group>
    );
  });
}

function createPolygonRingGeometry(
  sides: number,
  outerApothem: number,
  innerApothem: number,
  height: number,
) {
  const outer = createRegularPolygonShape(sides, outerApothem);
  const innerRadius = innerApothem / Math.cos(Math.PI / sides);
  const hole = new THREE.Path();
  // Opposite winding to outer so ExtrudeGeometry cuts a hole.
  for (let i = sides - 1; i >= 0; i -= 1) {
    const angle = (i * 2 * Math.PI) / sides;
    const x = Math.cos(angle) * innerRadius;
    const y = Math.sin(angle) * innerRadius;
    if (i === sides - 1) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  hole.closePath();
  outer.holes.push(hole);

  const geometry = new THREE.ExtrudeGeometry(outer, {
    depth: height,
    bevelEnabled: false,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.rotateY(POLYGON_Y_ALIGN);
  return geometry;
}

function DatabaseBodies({ services }: { services: InfrastructureService[] }) {
  const { block, iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("database");
  const cellHeight = 0.3;
  const gap = 0.05;
  const totalHeight = cellHeight * 3 + gap * 2;

  return [...groupBySize(services)].map(([key, group]) => {
    const sample = group[0]!;
    const footprint = footprintOf(sample);
    const radius = footprint * 0.45;
    const apothem = radius * Math.cos(Math.PI / 6);
    const iconApothem = Math.max(apothem - ICON_RIM, apothem * 0.35);

    const cells = [0, 1, 2].map((index) =>
      getPooledGeometry(`inst-db-cell:${radius}:${index}`, () => {
        const geo = createHexPrismGeometry(radius, cellHeight);
        geo.translate(0, index * (cellHeight + gap), 0);
        return geo;
      }),
    );
    const rimGeo = getPooledGeometry(
      `inst-db-rim-ring:${apothem}:${iconApothem}`,
      () => createPolygonRingGeometry(6, apothem, iconApothem, RIM_HEIGHT),
    );
    const faceGeo = getPooledGeometry(`inst-db-face:${iconApothem}`, () =>
      createPolygonPrismGeometry(6, iconApothem, PAD_HEIGHT),
    );
    const spacers = [
      cellHeight + gap * 0.5,
      cellHeight * 2 + gap * 1.5,
    ].map((y, index) =>
      getPooledGeometry(`inst-db-spacer:${radius}:${index}`, () => {
        const geo = new THREE.CylinderGeometry(
          radius * 0.94,
          radius * 0.94,
          gap,
          6,
        );
        geo.translate(0, y, 0);
        return geo;
      }),
    );

    return (
      <group key={`db-${key}`}>
        {cells.map((geometry, index) => (
          <InstancedLayer
            key={index}
            geometry={geometry}
            material={block}
            poses={posesAt(group, BASE_HEIGHT)}
          />
        ))}
        {spacers.map((geometry, index) => (
          <InstancedLayer
            key={`spacer-${index}`}
            geometry={geometry}
            material={rim}
            poses={posesAt(group, BASE_HEIGHT)}
          />
        ))}
        <InstancedLayer
          geometry={rimGeo}
          material={rim}
          poses={posesAt(group, BASE_HEIGHT + totalHeight)}
        />
        <InstancedLayer
          geometry={faceGeo}
          material={iconFace}
          poses={posesAt(group, BASE_HEIGHT + totalHeight + RIM_HEIGHT)}
        />
      </group>
    );
  });
}

function createCircleRingGeometry(
  outerRadius: number,
  innerRadius: number,
  height: number,
) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function IntegrationBodies({ services }: { services: InfrastructureService[] }) {
  const { block, iconFace } = getBlockMaterials();
  const rim = rimMaterialForCategory("integration");
  const plateCount = 3;
  const plateH = 0.1;
  const gap = 0.045;
  const totalHeight = plateCount * plateH + (plateCount - 1) * gap;

  return [...groupBySize(services)].map(([key, group]) => {
    const sample = group[0]!;
    const footprint = footprintOf(sample);
    const baseRadius = footprint * 0.48;
    const topRadius = baseRadius * (1 - (plateCount - 1) * 0.07);
    const iconRadius = Math.max(topRadius - ICON_RIM, topRadius * 0.35);

    const plates = Array.from({ length: plateCount }, (_, index) => {
      const scale = 1 - index * 0.07;
      const radius = baseRadius * scale;
      const y = index * (plateH + gap) + plateH / 2;
      return getPooledGeometry(`inst-int-plate:${radius}:${index}`, () => {
        const geo = new THREE.CylinderGeometry(radius, radius, plateH, 16);
        geo.translate(0, y, 0);
        return geo;
      });
    });
    const spacers = [0, 1].map((index) => {
      const scale = 1 - index * 0.07;
      const radius = baseRadius * scale * 0.92;
      const y = plateH + index * (plateH + gap) + gap / 2;
      return getPooledGeometry(`inst-int-spacer:${radius}:${index}`, () => {
        const geo = new THREE.CylinderGeometry(radius, radius, gap, 16);
        geo.translate(0, y, 0);
        return geo;
      });
    });
    const rimGeo = getPooledGeometry(
      `inst-int-rim-ring:${topRadius}:${iconRadius}`,
      () => createCircleRingGeometry(topRadius, iconRadius, RIM_HEIGHT),
    );
    const faceGeo = getPooledGeometry(`inst-int-face:${iconRadius}`, () => {
      const geo = new THREE.CylinderGeometry(
        iconRadius,
        iconRadius,
        PAD_HEIGHT,
        16,
      );
      geo.translate(0, PAD_HEIGHT / 2, 0);
      return geo;
    });

    return (
      <group key={`int-${key}`}>
        {plates.map((geometry, index) => (
          <InstancedLayer
            key={index}
            geometry={geometry}
            material={block}
            poses={posesAt(group, BASE_HEIGHT)}
          />
        ))}
        {spacers.map((geometry, index) => (
          <InstancedLayer
            key={`spacer-${index}`}
            geometry={geometry}
            material={rim}
            poses={posesAt(group, BASE_HEIGHT)}
          />
        ))}
        <InstancedLayer
          geometry={rimGeo}
          material={rim}
          poses={posesAt(group, BASE_HEIGHT + totalHeight)}
        />
        <InstancedLayer
          geometry={faceGeo}
          material={iconFace}
          poses={posesAt(group, BASE_HEIGHT + totalHeight + RIM_HEIGHT)}
        />
      </group>
    );
  });
}

function iconY(service: InfrastructureService) {
  switch (service.category) {
    case "storage": {
      const footprint = footprintOf(service);
      const topApothem = footprint * 0.43;
      const height = 0.56;
      const cavityFloor = height - 0.13;
      return BASE_HEIGHT + cavityFloor + RIM_HEIGHT + PAD_HEIGHT;
    }
    case "database": {
      const cellHeight = 0.3;
      const gap = 0.05;
      const totalHeight = cellHeight * 3 + gap * 2;
      return BASE_HEIGHT + totalHeight + RIM_HEIGHT + PAD_HEIGHT;
    }
    case "integration": {
      const plateCount = 3;
      const plateH = 0.1;
      const gap = 0.045;
      const totalHeight = plateCount * plateH + (plateCount - 1) * gap;
      return BASE_HEIGHT + totalHeight + RIM_HEIGHT + PAD_HEIGHT;
    }
    default:
      return BASE_HEIGHT + 0.34 + RIM_HEIGHT + PAD_HEIGHT;
  }
}

function iconFitSize(service: InfrastructureService) {
  const w = service.width * CELL_SIZE;
  const d = service.depth * CELL_SIZE;
  const footprint = Math.min(w, d);
  switch (service.category) {
    case "storage": {
      const topApothem = footprint * 0.43;
      const innerApothem = topApothem - 0.04;
      const iconApothem = Math.max(innerApothem - ICON_RIM, innerApothem * 0.35);
      return iconApothem * 1.45;
    }
    case "database": {
      const radius = footprint * 0.45;
      const apothem = radius * Math.cos(Math.PI / 6);
      const iconApothem = Math.max(apothem - ICON_RIM, apothem * 0.35);
      return iconApothem * 1.45;
    }
    case "integration": {
      const baseRadius = footprint * 0.48;
      const topRadius = baseRadius * (1 - 2 * 0.07);
      const iconRadius = Math.max(topRadius - ICON_RIM, topRadius * 0.35);
      return iconRadius * 1.55;
    }
    default: {
      const iconW = Math.max(w - ICON_RIM * 2, w * 0.35);
      const iconD = Math.max(d - ICON_RIM * 2, d * 0.35);
      return Math.min(iconW, iconD) * 0.72;
    }
  }
}

function lucidePlaneGeometry(service: InfrastructureService) {
  const size = iconFitSize(service);
  return getPooledGeometry(`inst-lucide-plane:${size}`, () =>
    new THREE.PlaneGeometry(size, size),
  );
}

function lucideNodesFor(category: InfrastructureCategory) {
  switch (category) {
    case "storage":
      return CYLINDER_ICON_NODES;
    case "database":
      return DATABASE_ICON_NODES;
    case "integration":
      return LAYERS_ICON_NODES;
    default:
      return CPU_ICON_NODES;
  }
}

function iconCacheKey(service: InfrastructureService) {
  const url = resolveServiceIcon(service.type);
  if (url) return `svg:${url}`;
  return `lucide:${service.category}`;
}

type IconAsset =
  | { kind: "svg"; geometry: THREE.BufferGeometry }
  | { kind: "lucide"; texture: THREE.Texture };

function useIconAssetMap(services: InfrastructureService[]) {
  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const service of services) set.add(iconCacheKey(service));
    return [...set].sort();
  }, [services]);

  const keysSig = keys.join("|");
  const [assets, setAssets] = useState(() => new Map<string, IconAsset>());

  useEffect(() => {
    let cancelled = false;
    const wanted = keysSig.split("|").filter(Boolean);

    void (async () => {
      const next = new Map<string, IconAsset>();
      await Promise.all(
        wanted.map(async (key) => {
          try {
            if (key.startsWith("svg:")) {
              const geometry = await loadSvgIconGeometry(key.slice(4));
              next.set(key, { kind: "svg", geometry });
            } else {
              const category = key.slice(7) as InfrastructureCategory;
              const texture = await loadLucideIconTexture(
                lucideNodesFor(category),
                "#111827",
              );
              next.set(key, { kind: "lucide", texture });
            }
          } catch {
            // Skip failed icons.
          }
        }),
      );
      if (!cancelled) setAssets(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [keysSig]);

  return assets;
}

function InstancedIcons({ services }: { services: InfrastructureService[] }) {
  const assets = useIconAssetMap(services);
  const glyphMat = getGlyphMaterial(CF_GLYPH_COLOR);

  const batches = useMemo(() => {
    const map = new Map<
      string,
      {
        asset: IconAsset;
        services: InfrastructureService[];
      }
    >();
    for (const service of services) {
      const key = iconCacheKey(service);
      const asset = assets.get(key);
      if (!asset) continue;
      // SVG glyphs are unit-sized and scaled per instance — batch by icon only.
      // Lucide planes are pre-sized — batch by icon + footprint.
      const shapeKey =
        asset.kind === "svg"
          ? key
          : `${key}|${service.category}|${sizeKey(service)}`;
      const existing = map.get(shapeKey);
      if (existing) existing.services.push(service);
      else map.set(shapeKey, { asset, services: [service] });
    }
    return [...map.entries()];
  }, [services, assets]);

  return batches.map(([shapeKey, batch]) => {
    if (batch.asset.kind === "svg") {
      const poses = batch.services.map((service) => {
        const [x, , z] = serviceWorldCenter(service);
        return {
          x,
          y: iconY(service) + 0.001,
          z,
          scale: iconFitSize(service),
        };
      });
      return (
        <InstancedLayer
          key={shapeKey}
          geometry={batch.asset.geometry}
          material={glyphMat}
          poses={poses}
          iconBillboard
        />
      );
    }

    const sample = batch.services[0]!;
    const geometry = lucidePlaneGeometry(sample);
    const material = getIconMaterial(batch.asset.texture, false);
    const poses = batch.services.map((service) => {
      const [x, , z] = serviceWorldCenter(service);
      return { x, y: iconY(service) + 0.001, z };
    });

    return (
      <InstancedLayer
        key={shapeKey}
        geometry={geometry}
        material={material}
        poses={poses}
        iconBillboard
      />
    );
  });
}

/**
 * Draw all visible services with shared InstancedMeshes (bodies / baseplates /
 * icons). Labels use a pooled canvas-texture mesh path (see ServiceLabels).
 */
export function InstancedServiceBlocks({
  services,
}: {
  services: InfrastructureService[];
}) {
  const byCategory = useMemo(() => {
    const map: Record<InfrastructureCategory, InfrastructureService[]> = {
      compute: [],
      storage: [],
      database: [],
      integration: [],
    };
    for (const service of services) {
      map[service.category].push(service);
    }
    return map;
  }, [services]);

  return (
    <group>
      {(Object.keys(byCategory) as InfrastructureCategory[]).map((category) => {
        const list = byCategory[category];
        if (list.length === 0) return null;
        return (
          <group key={category}>
            <CategoryBaseplates category={category} services={list} />
            {category === "compute" ? <ComputeBodies services={list} /> : null}
            {category === "storage" ? <StorageBodies services={list} /> : null}
            {category === "database" ? (
              <DatabaseBodies services={list} />
            ) : null}
            {category === "integration" ? (
              <IntegrationBodies services={list} />
            ) : null}
          </group>
        );
      })}
      <InstancedIcons services={services} />
      <ServiceLabels services={services} />
    </group>
  );
}
