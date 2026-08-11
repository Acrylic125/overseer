"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";

import { loadGlbIconGeometry } from "@/components/infrastructure/glb-icon-geometry";
import { ServiceLabels } from "@/components/infrastructure/service-labels";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE } from "@/lib/infrastructure-styles";
import { resolveServiceIcon } from "@/lib/service-types";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Max instances per icon batch inside the streaming window. */
const INSTANCE_LIMIT = 2500;
/** Icons sit above connectors (connector y = 0). */
const ICON_Y = 0.01;
/** Icons are unit-sized in the GLB; fill most of the service cell. */
const ICON_SCALE = 0.72;

const _dummy = new THREE.Object3D();
/** Lay XY icon meshes flat onto the XZ ground plane. */
const _iconQuat = new THREE.Quaternion().setFromEuler(
  new THREE.Euler(-Math.PI / 2, 0, 0),
);

const glbIconMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  toneMapped: false,
  depthWrite: true,
});

const glbIconMaterialDimmed = new THREE.MeshBasicMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  toneMapped: false,
  transparent: true,
  opacity: 0.2,
  depthWrite: false,
});

type InstancePose = {
  x: number;
  y: number;
  z: number;
  scale: number;
};

function InstancedLayer({
  geometry,
  material,
  poses,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  poses: InstancePose[];
}) {
  const mesh = useMemo(() => {
    const next = new THREE.InstancedMesh(geometry, material, INSTANCE_LIMIT);
    next.frustumCulled = true;
    next.castShadow = false;
    next.receiveShadow = false;
    return next;
  }, [geometry, material]);

  useLayoutEffect(() => {
    const count = Math.min(poses.length, INSTANCE_LIMIT);
    for (let i = 0; i < count; i += 1) {
      const pose = poses[i]!;
      _dummy.position.set(pose.x, pose.y, pose.z);
      _dummy.quaternion.copy(_iconQuat);
      _dummy.scale.set(pose.scale, pose.scale, pose.scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (count > 0) mesh.computeBoundingSphere();
  }, [mesh, poses]);

  useLayoutEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );

  if (poses.length === 0) return null;
  return <primitive object={mesh} />;
}

function iconCacheKey(service: InfrastructureService) {
  return resolveServiceIcon(service.type);
}

function iconScale(service: InfrastructureService) {
  const footprint = Math.min(service.width, service.depth) * CELL_SIZE;
  return footprint * ICON_SCALE;
}

function useIconAssetMap(services: InfrastructureService[]) {
  const keys = useMemo(() => {
    const set = new Set<string>();
    for (const service of services) set.add(iconCacheKey(service));
    return [...set].sort();
  }, [services]);

  const keysSig = keys.join("|");
  const [assets, setAssets] = useState(
    () => new Map<string, THREE.BufferGeometry>(),
  );
  const assetsRef = useRef(assets);
  assetsRef.current = assets;

  useEffect(() => {
    let cancelled = false;
    const wanted = keysSig.split("|").filter(Boolean);
    const missing = wanted.filter((key) => !assetsRef.current.has(key));
    if (missing.length === 0) return;

    void (async () => {
      const loaded = new Map<string, THREE.BufferGeometry>();
      await Promise.all(
        missing.map(async (key) => {
          try {
            loaded.set(key, await loadGlbIconGeometry(key));
          } catch {
            // Skip failed icons.
          }
        }),
      );
      if (cancelled || loaded.size === 0) return;
      setAssets((prev) => {
        const next = new Map(prev);
        for (const [key, asset] of loaded) next.set(key, asset);
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [keysSig]);

  return assets;
}

function InstancedIcons({
  services,
  relevantIds,
}: {
  services: InfrastructureService[];
  relevantIds: Set<string> | null;
}) {
  const assets = useIconAssetMap(services);

  const batches = useMemo(() => {
    const map = new Map<
      string,
      {
        geometry: THREE.BufferGeometry;
        services: InfrastructureService[];
      }
    >();
    for (const service of services) {
      const key = iconCacheKey(service);
      const geometry = assets.get(key);
      if (!geometry) continue;
      const existing = map.get(key);
      if (existing) existing.services.push(service);
      else map.set(key, { geometry, services: [service] });
    }
    return [...map.entries()];
  }, [services, assets]);

  return batches.flatMap(([iconName, batch]) => {
    const relevantServices =
      relevantIds == null
        ? batch.services
        : batch.services.filter((service) => relevantIds.has(service.id));
    const dimmedServices =
      relevantIds == null
        ? []
        : batch.services.filter((service) => !relevantIds.has(service.id));

    const layers: ReactNode[] = [];

    if (relevantServices.length > 0) {
      layers.push(
        <InstancedLayer
          key={`${iconName}:relevant`}
          geometry={batch.geometry}
          material={glbIconMaterial}
          poses={relevantServices.map((service) => {
            const [x, , z] = serviceWorldCenter(service);
            return {
              x,
              y: ICON_Y,
              z,
              scale: iconScale(service),
            };
          })}
        />,
      );
    }

    if (dimmedServices.length > 0) {
      layers.push(
        <InstancedLayer
          key={`${iconName}:dimmed`}
          geometry={batch.geometry}
          material={glbIconMaterialDimmed}
          poses={dimmedServices.map((service) => {
            const [x, , z] = serviceWorldCenter(service);
            return {
              x,
              y: ICON_Y,
              z,
              scale: iconScale(service),
            };
          })}
        />,
      );
    }

    return layers;
  });
}

/**
 * Draw visible services as GLB icon meshes only (no category block shells).
 * Labels use a pooled canvas-texture mesh path (see ServiceLabels).
 */
export function InstancedServiceBlocks({
  services,
  relevantIds = null,
}: {
  services: InfrastructureService[];
  relevantIds?: Set<string> | null;
}) {
  return (
    <group>
      <InstancedIcons services={services} relevantIds={relevantIds} />
      <ServiceLabels
        services={services}
        relevantIds={relevantIds}
      />
    </group>
  );
}
