"use client";

import type { LayoutLens } from "@acrylic125/overseer-sdk/layout";
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
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cssToThreeColor } from "@/lib/css-color";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { CameraFrame } from "@/lib/layout-from-db";
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

type InfrastructureCanvasProps = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  connectorPaths?: ConnectorPath[] | null;
  cameraFrame?: CameraFrame | null;
  lens: LayoutLens;
  onLensChange: (lens: LayoutLens) => void;
  changes: {
    added: number;
    modified: number;
    removed: Array<{ id: string; name: string }>;
  };
};

const LENS_OPTIONS: Array<{ value: LayoutLens; label: string }> = [
  { value: "application", label: "Apps" },
  { value: "traffic", label: "Traffic" },
  { value: "ownership", label: "Accounts" },
];

export function InfrastructureCanvas({
  services,
  platforms,
  publicInternet,
  bounds,
  connectorPaths = null,
  cameraFrame = null,
  lens,
  onLensChange,
  changes,
}: InfrastructureCanvasProps) {
  const [showChanges, setShowChanges] = useState(false);
  const changeCount = changes.added + changes.modified + changes.removed.length;
  const frame = useMemo(
    () => resolveCameraFrame(bounds, cameraFrame),
    [bounds, cameraFrame],
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
  const alertCounts = useMemo(
    () => countsFromAlerts(alerts ?? []),
    [alerts],
  );
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
      void canvasRef.current?.requestPointerLock();
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
      ? "WASD move · drag to pan · scroll to zoom · Tab to explore"
      : lookLocked
        ? "WASD move · look with mouse · Esc unlock · Tab for top view"
        : "WASD move · click to look · Tab for top view";

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{ background: SCENE.background }}
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
            services={services}
            platforms={platforms}
            publicInternet={publicInternet}
            connectorPaths={connectorPaths}
            cameraFrame={frame}
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
            showChanges={showChanges}
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
            <Tabs
              value={lens}
              onValueChange={(value) => {
                const next = LENS_OPTIONS.find((option) => option.value === value);
                if (next) onLensChange(next.value);
              }}
            >
              <TabsList className={overlayTabsListClass}>
                {LENS_OPTIONS.map((option) => (
                  <TabsTrigger
                    key={option.value}
                    value={option.value}
                    className={overlayTabTriggerClass}
                  >
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {changeCount > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                aria-pressed={showChanges}
                aria-label={`Show changes: ${changes.added} added, ${changes.modified} modified, ${changes.removed.length} removed`}
                title={
                  changes.removed.length > 0
                    ? `Removed: ${changes.removed.map((row) => row.name).join(", ")}`
                    : undefined
                }
                onClick={() => setShowChanges((prev) => !prev)}
                className="h-8 border-white/10 bg-black/55 px-3 font-mono text-white backdrop-blur-sm hover:bg-white/15 hover:text-white aria-pressed:bg-white/20"
              >
                <span className="text-emerald-300">+{changes.added}</span>
                <span className="text-amber-300">~{changes.modified}</span>
                <span className="text-rose-300">−{changes.removed.length}</span>
              </Button>
            ) : null}
          </div>
        }
      />

      {showChanges && changes.removed.length > 0 ? (
        <aside aria-label="Removed resources" className="absolute bottom-16 left-4 z-10 max-h-48 max-w-xs overflow-auto rounded-lg border border-white/10 bg-black/85 p-3 text-sm text-white">
          <h2 className="mb-2 font-medium">Removed since last sync</h2>
          <ul className="space-y-1 text-rose-200">{changes.removed.map((row) => <li key={row.id}>{row.name}</li>)}</ul>
        </aside>
      ) : null}
      <LookCrosshair visible={viewMode === "explore" && lookLocked} />

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1.5 font-mono text-[11px] text-white/75 backdrop-blur-sm">
        {helpText}
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
