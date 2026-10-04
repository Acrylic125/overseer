"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  DataCenterBuildings,
  DataCenterLots,
} from "@/components/infrastructure/data-center-buildings";
import { DataCenterControls } from "@/components/infrastructure/data-center-controls";
import { DataCenterGround } from "@/components/infrastructure/data-center-geometry";
import { DataCenterTransport } from "@/components/infrastructure/data-center-transport";
import {
  DATA_CENTER,
  dataCenterPickHeight,
  type VisualizationStyle,
} from "@/lib/data-center";
import { buildAllConnectorPaths } from "@/lib/graph/connector-paths";
import { CameraBridge } from "@/components/infrastructure/camera-bridge";
import {
  CameraModeSync,
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
import { linkedServiceIds, RENDER_HALF } from "@/lib/graph/service-streaming";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { CameraFrame } from "@/lib/layout-from-db";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import { INTERNET_ID, isInternetService } from "@/lib/internet";
import { composeFocusIds } from "@/lib/search-ql";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type SceneProps = {
  visualizationStyle: VisualizationStyle;
  animatePackets: boolean;
  overviewCenter: [number, number, number];
  overviewSize: [number, number];
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  connectorPaths: ConnectorPath[] | null;
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
    species: "cdn_edge",
    category: "compute",
    health: "healthy",
    zone: "edge",
    metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
    color: SCENE.publicInternet,
    fields: {},
  };
}

export function InfrastructureScene({
  visualizationStyle,
  animatePackets,
  overviewCenter,
  overviewSize,
  services,
  platforms,
  publicInternet,
  connectorPaths,
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
}: SceneProps) {
  const { camera, gl } = useThree();
  const dataCenter = visualizationStyle === "data-center";
  const background = useMemo(
    () =>
      cssToThreeColor(dataCenter ? DATA_CENTER.background : SCENE.background),
    [dataCenter],
  );
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
    focusOnGround: dataCenter && viewMode === "top",
    services,
    renderServices,
    platforms,
    publicInternet,
    connectorPaths,
    selectedServiceId,
    internetHubService,
  });
  const transportPaths = useMemo(
    () =>
      streamedConnectorPaths ??
      (dataCenter ? buildAllConnectorPaths(connectorServices) : []),
    [streamedConnectorPaths, dataCenter, connectorServices],
  );
  const selectionIds = useMemo(
    () =>
      selectedServiceId ? linkedServiceIds(services, selectedServiceId) : null,
    [services, selectedServiceId],
  );
  const relevantIds = useMemo(
    () => composeFocusIds({ searchMatchIds, selectionIds }),
    [searchMatchIds, selectionIds],
  );
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
      const hitId = pickServiceAt(
        clientX,
        clientY,
        camera,
        gl.domElement,
        pickPool,
        dataCenter ? dataCenterPickHeight : undefined,
      );
      if (hitId) {
        onSelectedServiceIdChange(selectedServiceId === hitId ? null : hitId);
        return true;
      }

      // Connector clicks are handled by ConnectorInteraction — don't deselect.
      const pickable = pickableConnectorPaths(
        dataCenter ? transportPaths : streamedConnectorPaths,
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
      onSelectedServiceIdChange,
      pickPool,
      selectedServiceId,
      streamedConnectorPaths,
      transportPaths,
      viewMode,
      dataCenter,
    ],
  );

  useFrame(() => {
    if (!fogRef.current) return;
    const y = Math.max(1, camera.position.y);
    if (dataCenter) {
      // A portrait overview sits farther away; keep its buildings crisp.
      fogRef.current.near = Math.max(60, y * 2.2);
      fogRef.current.far = fogRef.current.near + RENDER_HALF * 2;
      return;
    }
    fogRef.current.near = Math.hypot(RENDER_HALF * 0.35, y) * 0.9;
    fogRef.current.far = Math.hypot(RENDER_HALF * 1.35, y) * 1.1;
  });

  return (
    <>
      <color attach="background" args={[background]} />
      <fog ref={fogRef} attach="fog" args={[background, 28, 90]} />

      {dataCenter ? (
        <>
          <DataCenterGround />
          <DataCenterLots platforms={visiblePlatforms} services={renderServices} />
          <DataCenterBuildings
            services={visibleRenderServices}
            relevantIds={relevantIds}
            onSelect={onSelectedServiceIdChange}
          />
          <DataCenterTransport
            paths={transportPaths}
            relevantIds={relevantIds}
            activeConnectorId={connectorFocus?.pathId ?? null}
            animate={animatePackets}
          />
        </>
      ) : (
        <>
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
        </>
      )}

      {showPublicInternet && !dataCenter ? (
        <PublicInternetCloud
          centerX={publicInternet.centerX}
          centerZ={publicInternet.centerZ}
          width={publicInternet.width}
          depth={publicInternet.depth}
          shape={publicInternet.shape ?? "cloud"}
          opacity={internetOpacity}
        />
      ) : null}

      {showPublicInternet && dataCenter ? (
        <DataCenterBuildings
          services={[internetHubService]}
          relevantIds={relevantIds}
          onSelect={onSelectedServiceIdChange}
        />
      ) : null}

      {!dataCenter && (
        <>
          <InstancedServiceBlocks
            services={visibleRenderServices}
            relevantIds={relevantIds}
          />

          <ServiceConnectors
            services={connectorServices}
            selectedServiceId={selectedServiceId}
            activeConnectorId={connectorFocus?.pathId ?? null}
            precomputedPaths={streamedConnectorPaths}
          />
        </>
      )}

      <ConnectorInteraction
        heightForService={dataCenter ? dataCenterPickHeight : undefined}
        paths={dataCenter ? transportPaths : streamedConnectorPaths}
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
        visualizationStyle={visualizationStyle}
        overviewCenter={overviewCenter}
        overviewSize={overviewSize}
        services={services}
        onSettled={setSettledMode}
      />

      {controlsActive && viewMode === "top" ? (
        dataCenter ? (
          <DataCenterControls onPick={handlePick} />
        ) : (
          <TopViewControls onPick={handlePick} />
        )
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
