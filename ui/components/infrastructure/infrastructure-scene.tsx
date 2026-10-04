"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { GroupOverview } from "@/components/infrastructure/group-overview";
import { TraceFlow } from "@/components/infrastructure/trace-flow";
import { CameraBridge } from "@/components/infrastructure/camera-bridge";
import {
  CameraModeSync,
  TOP_DOWN_QUATERNION,
  type ViewMode,
} from "@/components/infrastructure/infrastructure-camera-sync";
import { FlyControls } from "@/components/infrastructure/fly-controls";
import {
  FrostedPlatform,
  WorldGrid,
} from "@/components/infrastructure/frosted-platform";
import { PublicInternetCloud } from "@/components/infrastructure/public-internet-cloud";
import { ConnectorInteraction } from "@/components/infrastructure/connector-interaction";
import { InstancedServiceBlocks } from "@/components/infrastructure/instanced-service-blocks";
import { ServiceConnectors } from "@/components/infrastructure/service-connectors";
import { TopViewControls } from "@/components/infrastructure/top-view-controls";
import { useStreamedScene } from "@/components/infrastructure/use-streamed-scene";
import { cssToThreeColor } from "@/lib/css-color";
import type { ConnectorFocus } from "@/components/infrastructure/connector-callout";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import { pickServiceAt } from "@/lib/graph/pick-service";
import {
  pickConnectorAlongRay,
  pickConnectorAt,
  pickableConnectorPaths,
} from "@/lib/graph/pick-connector";
import { RENDER_HALF, tracedServiceIds } from "@/lib/graph/service-streaming";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { CameraFrame } from "@/lib/layout-from-db";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import { INTERNET_ID, isInternetService } from "@/lib/internet";
import { composeFocusIds } from "@/lib/search-ql";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type SceneProps = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  connectorPaths: ConnectorPath[] | null;
  cameraFrame: CameraFrame;
  viewMode: ViewMode;
  selectedServiceId: string | null;
  searchMatchIds: Set<string> | null;
  onSelectedServiceIdChange: (id: string | null) => void;
  onLookLockChange: (locked: boolean) => void;
  connectorFocus: ConnectorFocus | null;
  pinnedConnector: ConnectorFocus | null;
  hoverConnector: ConnectorFocus | null;
  onPinnedConnectorChange: (focus: ConnectorFocus | null) => void;
  onHoverConnectorChange: (focus: ConnectorFocus | null) => void;
  onCameraReady: (camera: THREE.Camera) => void;
  /** Dim everything except resources changed since the previous scrape. */
  showChanges: boolean;
};

function resolveCameraFrame(
  bounds: PackLayoutResult["bounds"],
  baked: CameraFrame | null,
): CameraFrame {
  if (baked) return baked;
  const height = Math.min(42, Math.max(20, RENDER_HALF * 0.65));
  return {
    position: [bounds.centerX, height, bounds.centerZ],
    span: 100,
    far: Math.hypot(RENDER_HALF * 1.6, height) * 1.35,
  };
}

/** Synthetic hub footprint for raycasting / selection. */
export function internetPickTarget(
  platform: PackLayoutResult["publicInternet"],
): InfrastructureService {
  const width = platform.width / CELL_SIZE;
  const depth = platform.depth / CELL_SIZE;
  return {
    id: platform.id ?? "internet",
    type: "cloud",
    name: "Public Internet",
    x: platform.centerX / CELL_SIZE - width / 2,
    y: platform.centerZ / CELL_SIZE - depth / 2,
    width,
    depth,
    group: "internet",
    connections: [],
    dependsOn: [],
    species: "cdn_edge",
    category: "compute",
    health: "healthy",
    zone: "edge",
    color: SCENE.publicInternet,
    fields: {},
  };
}

export function InfrastructureScene({
  services,
  platforms,
  publicInternet,
  connectorPaths,
  cameraFrame,
  viewMode,
  selectedServiceId,
  searchMatchIds,
  onSelectedServiceIdChange,
  onLookLockChange,
  connectorFocus,
  pinnedConnector,
  hoverConnector,
  onPinnedConnectorChange,
  onHoverConnectorChange,
  onCameraReady,
  showChanges,
}: SceneProps) {
  const { camera, gl } = useThree();
  useLayoutEffect(() => {
    const topView = Math.abs(camera.quaternion.dot(TOP_DOWN_QUATERNION)) > 0.99;
    camera.position.set(
      cameraFrame.position[0],
      topView ? cameraFrame.position[1] : camera.position.y,
      cameraFrame.position[2],
    );
    camera.updateMatrixWorld();
  }, [camera, cameraFrame]);
  const [overview, setOverview] = useState(false);
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);
  const renderServices = useMemo(
    () => services.filter((service) => !isInternetService(service)),
    [services],
  );
  const internetHubService = useMemo(
    () => ({ ...internetPickTarget(publicInternet), id: INTERNET_ID }),
    [publicInternet],
  );
  const {
    visibleRenderServices,
    connectorServices,
    visiblePlatforms,
    showPublicInternet,
    streamedConnectorPaths,
  } = useStreamedScene({
    services,
    renderServices,
    platforms,
    publicInternet,
    connectorPaths,
    selectedServiceId,
    internetHubService,
  });
  const tracedIds = useMemo(() => {
    if (!selectedServiceId) return null;
    return tracedServiceIds(services, selectedServiceId);
  }, [services, selectedServiceId]);
  const changedIds = useMemo(() => {
    if (!showChanges) return null;
    return new Set(
      services.filter((service) => service.change).map((service) => service.id),
    );
  }, [services, showChanges]);
  const relevantIds = useMemo(() => composeFocusIds({
    searchMatchIds,
    selectionIds: composeFocusIds({ searchMatchIds: changedIds, selectionIds: tracedIds }),
  }), [searchMatchIds, changedIds, tracedIds]);
  const internetOpacity =
    relevantIds != null && !relevantIds.has(INTERNET_ID) ? 0.2 : 1;
  const pickPool = useMemo(() => {
    const pool = [...visibleRenderServices];
    if (showPublicInternet) {
      pool.push(internetPickTarget(publicInternet));
    }
    return pool;
  }, [visibleRenderServices, showPublicInternet, publicInternet]);
  const [settledMode, setSettledMode] = useState<ViewMode | null>(null);
  const controlsActive = settledMode === viewMode;
  const fogRef = useRef<THREE.Fog>(null);

  const handlePick = useCallback(
    (clientX: number, clientY: number) => {
      if (overview) return false;
      const hitId = pickServiceAt(
        clientX,
        clientY,
        camera,
        gl.domElement,
        pickPool,
      );
      if (hitId) {
        onSelectedServiceIdChange(
          selectedServiceId === hitId ? null : hitId,
        );
        return true;
      }

      // Connector clicks are handled by ConnectorInteraction — don't deselect.
      const pickable = pickableConnectorPaths(
        streamedConnectorPaths,
        selectedServiceId,
      );
      if (pickable.length > 0) {
        const connectorHit =
          viewMode === "explore"
            ? pickConnectorAlongRay(camera, pickable)
            : pickConnectorAt(
                clientX,
                clientY,
                camera,
                gl.domElement,
                pickable,
              );
        if (connectorHit) return false;
      }

      if (selectedServiceId) {
        onSelectedServiceIdChange(null);
        return true;
      }
      return false;
    },
    [
      camera,
      gl,
      overview,
      onSelectedServiceIdChange,
      pickPool,
      selectedServiceId,
      streamedConnectorPaths,
      viewMode,
    ],
  );

  useFrame(() => {
    const nextOverview = viewMode === "top" && camera.position.y > (overview ? 55 : 65) && relevantIds == null;
    if (nextOverview !== overview) setOverview(nextOverview);
    if (!fogRef.current) return;
    const y = Math.max(1, camera.position.y);
    fogRef.current.near = Math.hypot(RENDER_HALF * 0.35, y) * 0.9;
    fogRef.current.far = Math.hypot(RENDER_HALF * 1.35, y) * 1.1;
  });

  return (
    <>
      <color attach="background" args={[background]} />
      <fog ref={fogRef} attach="fog" args={[background, 28, 90]} />

      <WorldGrid />

      {visiblePlatforms.map((platform) => (
        <FrostedPlatform
          key={platform.group ?? platform.id}
          group={platform.group ?? ""}
          centerX={platform.centerX}
          centerZ={platform.centerZ}
          width={platform.width}
          depth={platform.depth}
        />
      ))}

      {showPublicInternet ? (
        <PublicInternetCloud
          centerX={publicInternet.centerX}
          centerZ={publicInternet.centerZ}
          width={publicInternet.width}
          depth={publicInternet.depth}
          shape={publicInternet.shape ?? "cloud"}
          opacity={internetOpacity}
        />
      ) : null}

      {overview ? <GroupOverview services={services} platforms={visiblePlatforms} /> : null}
      <group visible={!overview}>
      <InstancedServiceBlocks
        services={visibleRenderServices}
        relevantIds={relevantIds}
      />

      <ServiceConnectors
        services={connectorServices}
        selectedServiceId={selectedServiceId}
        tracedIds={tracedIds}
        activeConnectorId={connectorFocus?.pathId ?? null}
        precomputedPaths={streamedConnectorPaths}
      />
      {tracedIds && !overview ? <TraceFlow paths={streamedConnectorPaths ?? []} services={services} tracedIds={tracedIds} /> : null}
      </group>

      <ConnectorInteraction
        paths={streamedConnectorPaths}
        pickPool={pickPool}
        viewMode={viewMode}
        selectedServiceId={selectedServiceId}
        pinnedFocus={pinnedConnector}
        hoverFocus={hoverConnector}
        onPinnedFocusChange={onPinnedConnectorChange}
        onHoverFocusChange={onHoverConnectorChange}
      />

      <CameraBridge onCamera={onCameraReady} />

      <CameraModeSync
        viewMode={viewMode}
        services={services}
        onSettled={setSettledMode}
      />

      {controlsActive && viewMode === "top" ? (
        <TopViewControls onPick={handlePick} />
      ) : null}
      {controlsActive && viewMode === "explore" ? (
        <FlyControls
          onPick={handlePick}
          onLookLockChange={onLookLockChange}
          autoLock
        />
      ) : null}
    </>
  );
}

export { resolveCameraFrame };
