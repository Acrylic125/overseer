"use client";

import { Canvas } from "@react-three/fiber";
import {
  Suspense,
  useCallback,
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cssToThreeColor } from "@/lib/css-color";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { CameraFrame } from "@/lib/layout-from-db";
import { SCENE } from "@/lib/infrastructure-styles";
import { INTERNET_ID } from "@/lib/internet";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type { ViewMode };

type InfrastructureCanvasProps = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  connectorPaths?: ConnectorPath[] | null;
  cameraFrame?: CameraFrame | null;
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

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
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);
  const largeScene = services.length >= 80;
  const maxDpr = largeScene ? 1 : 1.5;

  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
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
            viewMode={viewMode}
            selectedServiceId={selectedServiceId}
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
        center={
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
        }
      />

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
