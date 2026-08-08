"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

import { FlyControls, LookCrosshair } from "@/components/infrastructure/fly-controls";
import {
  FrostedPlatform,
  WorldGrid,
} from "@/components/infrastructure/frosted-platform";
import {
  PUBLIC_INTERNET_ID,
  PublicInternetCloud,
} from "@/components/infrastructure/public-internet-cloud";
import { ServiceConnectors } from "@/components/infrastructure/service-connectors";
import { InstancedServiceBlocks } from "@/components/infrastructure/instanced-service-blocks";
import { ServiceDetailSheet } from "@/components/infrastructure/service-detail-sheet";
import { TopViewControls } from "@/components/infrastructure/top-view-controls";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cssToThreeColor } from "@/lib/css-color";
import { pickServiceAt } from "@/lib/graph/pick-service";
import {
  buildServiceSpatialIndex,
  queryServicesInWindow,
  RENDER_HALF,
  RENDER_WINDOW,
  windowAround,
} from "@/lib/graph/service-streaming";
import { isOpenToInternet } from "@/lib/infrastructure-schema";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { SceneBake } from "@/lib/infrastructure-schema";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type ViewMode = "top" | "explore";

type InfrastructureCanvasProps = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  publicInternet: PackLayoutResult["publicInternet"];
  bounds: PackLayoutResult["bounds"];
  /** Pre-routed connectors from scan layout resources (optional). */
  connectorPaths?: ConnectorPath[] | null;
  /** Baked camera framing from scan scene (optional). */
  cameraFrame?: SceneBake["camera"] | null;
  /** Baked connector instances from scan scene (optional). */
  connectorSegments?: SceneBake["connectorSegments"] | null;
  connectorJoints?: SceneBake["connectorJoints"] | null;
};

type SceneProps = InfrastructureCanvasProps & {
  viewMode: ViewMode;
  selectedServiceId: string | null;
  onSelectedServiceIdChange: (id: string | null) => void;
  onLookLockChange: (locked: boolean) => void;
};

const TOP_DOWN_EULER = new THREE.Euler(-Math.PI / 2, 0, 0, "YXZ");
const EXPLORE_BACK = 22;
const EXPLORE_EYE_HEIGHT = 14;
const TOP_STREAM_HALF = RENDER_HALF * 2.2;
const EXPLORE_STREAM_HALF = RENDER_HALF * 1.6;
const TOP_STREAM_MARGIN = RENDER_HALF * 0.8;
const EXPLORE_STREAM_MARGIN = RENDER_HALF * 0.45;

/** Synthetic hub so open-to-internet services can route connectors to the cloud. */
function publicInternetHub(
  platform: PackLayoutResult["publicInternet"],
): InfrastructureService {
  const width = platform.width / CELL_SIZE;
  const depth = platform.depth / CELL_SIZE;
  return {
    id: PUBLIC_INTERNET_ID,
    type: "PublicInternet",
    name: "Public Internet",
    x: platform.centerX / CELL_SIZE - width / 2,
    y: platform.centerZ / CELL_SIZE - depth / 2,
    width,
    depth,
    group: platform.group,
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

function withPublicInternetLink(
  service: InfrastructureService,
): InfrastructureService {
  if (!isOpenToInternet(service.fields)) return service;
  if (service.connections.includes(PUBLIC_INTERNET_ID)) return service;
  return {
    ...service,
    connections: [...service.connections, PUBLIC_INTERNET_ID],
  };
}

function sameServiceIds(
  a: InfrastructureService[],
  b: InfrastructureService[],
) {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((service) => service.id));
  for (const service of b) {
    if (!ids.has(service.id)) return false;
  }
  return true;
}

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

function getCameraFrame(
  bounds: PackLayoutResult["bounds"],
  baked: SceneBake["camera"] | null | undefined = null,
) {
  if (baked) return baked;
  // Spawn over the map so the camera-centered 100×100 window has content.
  // (Previously the camera sat far outside the cluster → empty black void.)
  const height = Math.min(42, Math.max(20, RENDER_HALF * 0.65));
  const position: [number, number, number] = [
    bounds.centerX,
    height,
    bounds.centerZ,
  ];
  const far = Math.hypot(RENDER_HALF * 1.6, height) * 1.35;
  return { position, span: RENDER_WINDOW, far };
}

function streamWindowHalf(viewMode: ViewMode) {
  return viewMode === "top" ? TOP_STREAM_HALF : EXPLORE_STREAM_HALF;
}

function streamMargin(viewMode: ViewMode) {
  return viewMode === "top" ? TOP_STREAM_MARGIN : EXPLORE_STREAM_MARGIN;
}

/** Drop into free-fly looking at the ground the top-down camera was focused on. */
function applyExploreFraming(camera: THREE.Camera) {
  const focusX = camera.position.x;
  const focusZ = camera.position.z;
  camera.up.set(0, 1, 0);
  camera.position.set(
    focusX + EXPLORE_BACK,
    EXPLORE_EYE_HEIGHT,
    focusZ + EXPLORE_BACK,
  );
  camera.lookAt(focusX, 0, focusZ);
}

function platformInWindow(
  platform: PackLayoutResult["platforms"][number],
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
) {
  const halfW = platform.width / 2;
  const halfD = platform.depth / 2;
  return !(
    platform.centerX + halfW < minX ||
    platform.centerX - halfW > maxX ||
    platform.centerZ + halfD < minZ ||
    platform.centerZ - halfD > maxZ
  );
}

function CameraModeSync({ viewMode }: { viewMode: ViewMode }) {
  const { camera, gl } = useThree();
  const prevMode = useRef<ViewMode | null>(null);
  const lastExplorePose = useRef<{
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
  } | null>(null);

  useFrame(() => {
    if (viewMode !== "explore") return;
    if (!lastExplorePose.current) {
      lastExplorePose.current = {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
      };
    }
    lastExplorePose.current.position.copy(camera.position);
    lastExplorePose.current.quaternion.copy(camera.quaternion);
  });

  useEffect(() => {
    if (prevMode.current === viewMode) return;
    const previous = prevMode.current;
    prevMode.current = viewMode;

    if (document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }

    if (viewMode === "top") {
      // Look straight down at the point explore was facing toward.
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      const focusX = camera.position.x + forward.x * camera.position.y;
      const focusZ = camera.position.z + forward.z * camera.position.y;
      camera.position.set(
        Number.isFinite(focusX) ? focusX : camera.position.x,
        Math.max(20, Math.min(camera.position.y, 48)),
        Number.isFinite(focusZ) ? focusZ : camera.position.z,
      );
      camera.up.set(0, 1, 0);
      camera.quaternion.setFromEuler(TOP_DOWN_EULER);
      return;
    }

    // Entering explore from top: stand off the focus and look at it.
    if (previous === "top") {
      if (lastExplorePose.current) {
        camera.up.set(0, 1, 0);
        camera.position.copy(lastExplorePose.current.position);
        camera.quaternion.copy(lastExplorePose.current.quaternion);
      } else {
        applyExploreFraming(camera);
      }
    }
  }, [viewMode, camera, gl]);

  return null;
}

function Scene({
  services,
  platforms,
  publicInternet,
  bounds,
  connectorPaths = null,
  cameraFrame: bakedCamera = null,
  connectorSegments = null,
  connectorJoints = null,
  viewMode,
  selectedServiceId,
  onSelectedServiceIdChange,
  onLookLockChange,
}: SceneProps) {
  const { camera, gl } = useThree();
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);
  const frame = useMemo(
    () => getCameraFrame(bounds, bakedCamera),
    [bounds, bakedCamera],
  );
  const index = useMemo(() => buildServiceSpatialIndex(services), [services]);
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const inboundByTarget = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const service of services) {
      const linked = withPublicInternetLink(service);
      for (const targetId of linked.connections) {
        const list = map.get(targetId);
        if (list) list.push(service.id);
        else map.set(targetId, [service.id]);
      }
    }
    return map;
  }, [services]);
  const internetHub = useMemo(
    () => publicInternetHub(publicInternet),
    [publicInternet],
  );
  const windowHalf = streamWindowHalf(viewMode);
  const margin = streamMargin(viewMode);

  const initialWindow = useMemo(
    () => windowAround(frame.position[0], frame.position[2], windowHalf),
    [frame.position, windowHalf],
  );

  const [visibleServices, setVisibleServices] = useState(() =>
    queryServicesInWindow(
      index,
      initialWindow.minX,
      initialWindow.minZ,
      initialWindow.maxX,
      initialWindow.maxZ,
    ),
  );
  const [viewWindow, setViewWindow] = useState(initialWindow);
  const fogRef = useRef<THREE.Fog>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const visibleRef = useRef(visibleServices);
  visibleRef.current = visibleServices;
  const selectedRef = useRef(selectedServiceId);
  selectedRef.current = selectedServiceId;
  const onSelectRef = useRef(onSelectedServiceIdChange);
  onSelectRef.current = onSelectedServiceIdChange;

  // Re-center the buffered window when the mode or dataset changes.
  useEffect(() => {
    const next = windowAround(camera.position.x, camera.position.z, windowHalf);
    setViewWindow(next);
    setVisibleServices(
      queryServicesInWindow(
        index,
        next.minX,
        next.minZ,
        next.maxX,
        next.maxZ,
      ),
    );
  }, [camera, index, viewMode, windowHalf]);

  const handlePick = useCallback(
    (clientX: number, clientY: number) => {
      // Prefer the streamed window; fall back to full graph if empty.
      const pool =
        visibleRef.current.length > 0 ? visibleRef.current : services;
      const hitId = pickServiceAt(
        clientX,
        clientY,
        camera,
        gl.domElement,
        pool,
      );
      if (!hitId) {
        if (selectedRef.current) {
          onSelectRef.current(null);
          return true;
        }
        return false;
      }
      onSelectRef.current(
        selectedRef.current === hitId ? null : hitId,
      );
      return true;
    },
    [camera, gl, services],
  );

  useFrame(({ camera }) => {
    const px = camera.position.x;
    const pz = camera.position.z;

    // Fog is Euclidean from the camera — scale with height so the ground
    // under you isn't fully fogged to the background color.
    if (fogRef.current) {
      const y = Math.max(1, camera.position.y);
      fogRef.current.near = Math.hypot(RENDER_HALF * 0.35, y) * 0.9;
      fogRef.current.far = Math.hypot(RENDER_HALF * 1.35, y) * 1.1;
    }

    const insideBufferedWindow =
      px >= viewWindow.minX + margin &&
      px <= viewWindow.maxX - margin &&
      pz >= viewWindow.minZ + margin &&
      pz <= viewWindow.maxZ - margin;
    if (insideBufferedWindow) return;

    const next = windowAround(px, pz, windowHalf);
    const nextServices = queryServicesInWindow(
      indexRef.current,
      next.minX,
      next.minZ,
      next.maxX,
      next.maxZ,
    );
    // Skip React work when the streamed set didn't actually change.
    if (
      next.minX === viewWindow.minX &&
      next.maxX === viewWindow.maxX &&
      next.minZ === viewWindow.minZ &&
      next.maxZ === viewWindow.maxZ &&
      sameServiceIds(nextServices, visibleRef.current)
    ) {
      return;
    }

    startTransition(() => {
      setViewWindow(next);
      setVisibleServices(nextServices);
    });
  });

  const visiblePlatforms = useMemo(
    () =>
      platforms.filter((platform) =>
        platformInWindow(
          platform,
          viewWindow.minX,
          viewWindow.maxX,
          viewWindow.minZ,
          viewWindow.maxZ,
        ),
      ),
    [platforms, viewWindow],
  );

  // Keep one-hop neighbors so connectors at the window edge stay intact.
  // Open-to-internet services also link to the synthetic public-internet hub.
  // The hub is always present so unrelated connectors route around the cloud.
  const connectorServices = useMemo(() => {
    if (visibleServices.length === 0) return visibleServices;
    const extra = new Map<string, InfrastructureService>();

    for (const service of visibleServices) {
      const linked = withPublicInternetLink(service);
      extra.set(linked.id, linked);

      for (const targetId of linked.connections) {
        if (targetId === PUBLIC_INTERNET_ID) continue;
        if (extra.has(targetId)) continue;
        const target = servicesById.get(targetId);
        if (target) extra.set(target.id, withPublicInternetLink(target));
      }
      const inbound = inboundByTarget.get(service.id);
      if (!inbound) continue;
      for (const sourceId of inbound) {
        if (extra.has(sourceId)) continue;
        const source = servicesById.get(sourceId);
        if (source) extra.set(source.id, withPublicInternetLink(source));
      }
    }

    // Always include the hub AABB so paths treat it like a service block,
    // except when the path's source/target is the hub itself.
    // (Do not pull every internet-open service on the map — that forced a
    // full connector rebuild across the whole graph whenever the cloud was
    // in view and froze the main thread.)
    extra.set(internetHub.id, internetHub);
    return [...extra.values()];
  }, [servicesById, inboundByTarget, internetHub, visibleServices]);

  return (
    <>
      <color attach="background" args={[background]} />
      <fog
        ref={fogRef}
        attach="fog"
        args={[background, 28, 90]}
      />

      <WorldGrid />

      {visiblePlatforms.map((platform) => (
        <FrostedPlatform
          key={platform.id ?? platform.group}
          group={platform.group}
          centerX={platform.centerX}
          centerZ={platform.centerZ}
          width={platform.width}
          depth={platform.depth}
        />
      ))}

      <PublicInternetCloud
        centerX={publicInternet.centerX}
        centerZ={publicInternet.centerZ}
        width={publicInternet.width}
        depth={publicInternet.depth}
        shape={publicInternet.shape ?? "cloud"}
      />

      <InstancedServiceBlocks services={visibleServices} />

      <ServiceConnectors
        services={connectorServices}
        selectedServiceId={selectedServiceId}
        precomputedPaths={connectorPaths}
        precomputedSegments={connectorSegments}
        precomputedJoints={connectorJoints}
      />

      <CameraModeSync viewMode={viewMode} />
      {viewMode === "top" ? (
        <TopViewControls onPick={handlePick} />
      ) : (
        <FlyControls
          onPick={handlePick}
          onLookLockChange={onLookLockChange}
        />
      )}
    </>
  );
}

export function InfrastructureCanvas({
  services,
  platforms,
  publicInternet,
  bounds,
  connectorPaths = null,
  cameraFrame: bakedCamera = null,
  connectorSegments = null,
  connectorJoints = null,
}: InfrastructureCanvasProps) {
  const frame = useMemo(
    () => getCameraFrame(bounds, bakedCamera),
    [bounds, bakedCamera],
  );
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);
  const largeScene = services.length >= 80;
  const maxDpr = largeScene ? 1 : 1.5;
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(
    null,
  );
  const [lookLocked, setLookLocked] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("top");
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const selectedService = selectedServiceId
    ? (servicesById.get(selectedServiceId) ?? null)
    : null;
  const selectedName = selectedService?.name ?? null;

  useEffect(() => {
    if (viewMode !== "explore" && lookLocked) {
      setLookLocked(false);
    }
  }, [viewMode, lookLocked]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Tab" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setViewMode((mode) => (mode === "top" ? "explore" : "top"));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const helpText =
    viewMode === "top"
      ? "WASD move · drag to pan · scroll to zoom · orientation locked · Tab to explore"
      : lookLocked
        ? "WASD move · look with mouse · click crosshair to select · Esc unlock · Tab for top view"
        : "WASD move · drag/click empty to look · Alt/Win+drag pan · Tab for top view";

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{ background: SCENE.background }}
    >
      <Canvas
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
          camera.up.set(0, 1, 0);
          camera.position.set(...frame.position);
          // Default spawn is top-down over the map.
          camera.quaternion.setFromEuler(TOP_DOWN_EULER);
          gl.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));
          gl.setClearColor(background, 1);
        }}
      >
        <Suspense fallback={null}>
          <Scene
            services={services}
            platforms={platforms}
            publicInternet={publicInternet}
            bounds={bounds}
            connectorPaths={connectorPaths}
            cameraFrame={bakedCamera}
            connectorSegments={connectorSegments}
            connectorJoints={connectorJoints}
            viewMode={viewMode}
            selectedServiceId={selectedServiceId}
            onSelectedServiceIdChange={setSelectedServiceId}
            onLookLockChange={setLookLocked}
          />
        </Suspense>
      </Canvas>

      <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2">
        <Tabs
          value={viewMode}
          onValueChange={(value) => {
            if (value === "top" || value === "explore") setViewMode(value);
          }}
        >
          <TabsList className="bg-black/55 text-white/55 backdrop-blur-sm">
            <TabsTrigger
              value="top"
              className="px-3 text-white/55 hover:text-white data-active:bg-white/15 data-active:text-white data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-white/15"
            >
              Top View
            </TabsTrigger>
            <TabsTrigger
              value="explore"
              className="px-3 text-white/55 hover:text-white data-active:bg-white/15 data-active:text-white data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-white/15"
            >
              Explore
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <LookCrosshair visible={viewMode === "explore" && lookLocked} />
      {selectedName ? (
        <div className="pointer-events-none absolute top-16 left-1/2 z-10 -translate-x-1/2 rounded-md bg-black/55 px-3 py-1.5 font-mono text-[11px] tracking-wide text-[#8ec7ff] backdrop-blur-sm">
          Linked connectors · {selectedName}
          <span className="text-white/45">
            {viewMode === "explore" && lookLocked
              ? " · click to toggle under crosshair"
              : " · click again to clear"}
          </span>
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1.5 font-mono text-[11px] tracking-wide text-white/75 backdrop-blur-sm">
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
