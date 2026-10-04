"use client";

import { Canvas } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import * as THREE from "three";

import {
  TOP_DOWN_QUATERNION,
  type ViewMode,
} from "@/components/infrastructure/infrastructure-camera-sync";
import {
  InfrastructureScene,
  internetPickTarget,
  resolveCameraFrame,
} from "@/components/infrastructure/infrastructure-scene";
import {
  ConnectorCallout,
  type ConnectorFocus,
} from "@/components/infrastructure/connector-callout";
import { LookCrosshair } from "@/components/infrastructure/fly-controls";
import { ServiceDetailSheet } from "@/components/infrastructure/service-detail-sheet";
import {
  overlayTabTriggerClass,
  overlayTabsListClass,
  PageNav,
} from "@/components/page-nav";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cssToThreeColor } from "@/lib/css-color";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { CameraFrame } from "@/lib/layout-from-db";
import { DATA_CENTER } from "@/lib/data-center";
import { useVisualizationStyle } from "@/lib/visualization-preference";
import { SCENE } from "@/lib/infrastructure-styles";
import { INTERNET_ID } from "@/lib/internet";
import { isTypingTarget } from "@/lib/is-typing-target";
import {
  buildSearchCatalog,
  countsFromAlerts,
  evaluateSearch,
} from "@/lib/search-ql";
import { useTRPC } from "@/lib/trpc/client";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type { ViewMode };

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}
function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type InfrastructureCanvasProps = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  connectorPaths?: ConnectorPath[] | null;
  cameraFrame?: CameraFrame | null;
};

export function InfrastructureCanvas({
  services,
  platforms,
  publicInternet,
  bounds,
  connectorPaths = null,
  cameraFrame = null,
}: InfrastructureCanvasProps) {
  const frame = useMemo(
    () => resolveCameraFrame(bounds, cameraFrame),
    [bounds, cameraFrame],
  );
  const [visualizationStyle, setVisualizationStyle] = useVisualizationStyle();
  const [packetsPaused, setPacketsPaused] = useState(false);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    () => true,
  );
  const overviewCenter = useMemo<[number, number, number]>(
    () => [bounds.centerX, 0, bounds.centerZ],
    [bounds],
  );
  const overviewSize = useMemo<[number, number]>(
    () => [bounds.width, bounds.depth],
    [bounds],
  );
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);
  const largeScene = services.length >= 80;
  const maxDpr = largeScene ? 1 : 1.5;

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const trpc = useTRPC();
  const { data: alerts } = useQuery(
    trpc.infrastructure.alerts.queryOptions(undefined, {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    }),
  );
  const alertCounts = useMemo(() => countsFromAlerts(alerts ?? []), [alerts]);
  const searchCatalog = useMemo(
    () => buildSearchCatalog(services, alertCounts),
    [services, alertCounts],
  );
  const searchMatchIds = useMemo(() => {
    const result = evaluateSearch(deferredSearchQuery, searchCatalog);
    if (!result.ok) {
      return null;
    }
    return result.matchIds;
  }, [deferredSearchQuery, searchCatalog]);
  const [lookLocked, setLookLocked] = useState(false);
  const [pinnedConnector, setPinnedConnector] = useState<ConnectorFocus | null>(
    null,
  );
  const [hoverConnector, setHoverConnector] = useState<ConnectorFocus | null>(
    null,
  );
  const connectorFocus = hoverConnector ?? pinnedConnector;
  const [sceneCamera, setSceneCamera] = useState<THREE.Camera | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("top");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(
    null,
  );
  const viewModeRef = useRef(viewMode);
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const hub = useMemo(
    () => ({ ...internetPickTarget(publicInternet), id: INTERNET_ID }),
    [publicInternet],
  );

  const selectedService =
    selectedServiceId == null
      ? null
      : (servicesById.get(selectedServiceId) ??
        (selectedServiceId === INTERNET_ID ? hub : null));

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const handleSelectedServiceIdChange = useCallback((id: string | null) => {
    setSelectedServiceId(id);
    if (!id) return;
    setPinnedConnector((prev) =>
      prev && prev.sourceId !== id && prev.targetId !== id ? null : prev,
    );
    setHoverConnector((prev) =>
      prev && prev.sourceId !== id && prev.targetId !== id ? null : prev,
    );
  }, []);

  const setViewModeFromUi = useCallback((next: ViewMode) => {
    if (next === "explore") {
      // Embedded previews can decline pointer lock; keep Explore usable unlocked.
      void canvasRef.current?.requestPointerLock()?.catch(() => {});
    } else {
      setLookLocked(false);
    }
    setViewMode(next);
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.style.cursor = viewMode === "explore" ? "none" : "";
    return () => {
      el.style.cursor = "";
    };
  }, [viewMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== "Tab" ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button, a, [role='tab'], [role='combobox']")
      )
        return;
      event.preventDefault();
      setViewModeFromUi(viewModeRef.current === "top" ? "explore" : "top");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setViewModeFromUi]);

  const handleCameraReady = useCallback((camera: THREE.Camera) => {
    setSceneCamera(camera);
  }, []);

  const helpText =
    viewMode === "top"
      ? visualizationStyle === "data-center"
        ? "Drag to orbit · right-drag to pan · scroll to zoom · Tab to explore"
        : "WASD move · drag to pan · scroll to zoom · Tab to explore"
      : lookLocked
        ? "WASD move · look with mouse · Esc unlock · Tab for top view"
        : "WASD move · click to look · Tab for top view";

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{
        background:
          visualizationStyle === "data-center"
            ? DATA_CENTER.background
            : SCENE.background,
      }}
    >
      <div className="absolute inset-0">
        <Canvas
          className="block h-full w-full"
          dpr={[1, maxDpr]}
          performance={{ min: 0.5 }}
          camera={{
            position: frame.position,
            fov: 42,
            near: 0.1,
            far: frame.far,
          }}
          gl={{
            antialias: !largeScene,
            powerPreference: "high-performance",
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.12,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          onCreated={({ camera, gl }) => {
            canvasRef.current = gl.domElement;
            setCanvasElement(gl.domElement);
            camera.up.set(0, 1, 0);
            camera.position.set(...frame.position);
            camera.quaternion.copy(TOP_DOWN_QUATERNION);
            gl.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
            gl.setClearColor(background, 1);
          }}
        >
          <Suspense fallback={null}>
            <InfrastructureScene
              visualizationStyle={visualizationStyle}
              animatePackets={!packetsPaused && !reducedMotion}
              overviewCenter={overviewCenter}
              overviewSize={overviewSize}
              services={services}
              platforms={platforms}
              publicInternet={publicInternet}
              connectorPaths={connectorPaths}
              viewMode={viewMode}
              selectedServiceId={selectedServiceId}
              searchMatchIds={searchMatchIds}
              onSelectedServiceIdChange={handleSelectedServiceIdChange}
              onLookLockChange={setLookLocked}
              connectorFocus={connectorFocus}
              pinnedConnector={pinnedConnector}
              hoverConnector={hoverConnector}
              onPinnedConnectorChange={setPinnedConnector}
              onHoverConnectorChange={setHoverConnector}
              onCameraReady={handleCameraReady}
            />
          </Suspense>
        </Canvas>

        {sceneCamera && canvasElement && connectorFocus ? (
          <ConnectorCallout
            focus={connectorFocus}
            servicesById={servicesById}
            hubService={hub}
            camera={sceneCamera}
            canvas={canvasElement}
          />
        ) : null}
      </div>

      <PageNav
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchCatalog={searchCatalog}
        left={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs
              value={visualizationStyle}
              onValueChange={(value) => {
                if (value === "default" || value === "data-center")
                  setVisualizationStyle(value);
              }}
            >
              <TabsList
                className={`${overlayTabsListClass} h-10 sm:h-8 ring-1 ring-white/20`}
                aria-label="Visualization style"
              >
                <TabsTrigger value="default" className={overlayTabTriggerClass}>
                  Default
                </TabsTrigger>
                <TabsTrigger value="data-center" className={overlayTabTriggerClass}>
                  Data Center
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Tabs
              value={viewMode}
              onValueChange={(value) => {
                if (value === "top" || value === "explore") {
                  setViewModeFromUi(value);
                }
              }}
            >
              <TabsList className={overlayTabsListClass}>
                <TabsTrigger value="top" className={overlayTabTriggerClass}>
                  Top View
                </TabsTrigger>
                <TabsTrigger value="explore" className={overlayTabTriggerClass}>
                  Explore
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        }
      />

      <div
        className="pointer-events-auto absolute bottom-16 left-4 z-20 flex flex-wrap items-center gap-2 sm:bottom-4"
        aria-label="Visualization settings"
      >
        {visualizationStyle === "data-center" && (
          <button
            type="button"
            className="h-11 rounded-md bg-black/55 px-3 text-xs text-white backdrop-blur-sm hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 sm:h-8"
            onClick={() => setPacketsPaused((paused) => !paused)}
            aria-pressed={packetsPaused || reducedMotion}
            disabled={reducedMotion}
            title={
              reducedMotion
                ? "Packet movement is off because reduced motion is enabled"
                : undefined
            }
          >
            {reducedMotion
              ? "Motion reduced"
              : packetsPaused
                ? "Resume packets"
                : "Pause packets"}
          </button>
        )}
      </div>

      <LookCrosshair visible={viewMode === "explore" && lookLocked} />

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 text-center sm:bottom-14 rounded-md bg-black/50 px-3 py-1.5 font-mono text-[11px] text-white/75 backdrop-blur-sm">
        <span className="hidden sm:inline">{helpText}</span>
        <span className="sm:hidden">
          {viewMode === "top"
            ? visualizationStyle === "data-center"
              ? "Drag to orbit · pinch to zoom"
              : "Drag to pan · pinch to zoom"
            : "WASD move · click to look"}
        </span>
      </div>

      <ServiceDetailSheet
        service={selectedService}
        onOpenChange={(open) => {
          if (!open) setSelectedServiceId(null);
        }}
      />
    </div>
  );
}
