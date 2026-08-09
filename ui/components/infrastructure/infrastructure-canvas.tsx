"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { isInternetService } from "@/lib/internet";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import type { ConnectorPath } from "@/lib/graph/connector-paths";
import {
  serviceWorldCenter,
  type PackLayoutResult,
} from "@/lib/graph/pack-layout";
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
const TOP_DOWN_QUAT = new THREE.Quaternion().setFromEuler(TOP_DOWN_EULER);
/** Fixed eye height when entering explore from top-down. */
const EXPLORE_EYE_HEIGHT = 4;
/** Fallback top-down height when no previous top Y was recorded. */
const DEFAULT_TOP_HEIGHT = 10;
const VIEW_TRANSITION_DURATION = 0.55;
const TOP_STREAM_HALF = RENDER_HALF * 2.2;
const EXPLORE_STREAM_HALF = RENDER_HALF * 1.6;
const TOP_STREAM_MARGIN = RENDER_HALF * 0.8;
const EXPLORE_STREAM_MARGIN = RENDER_HALF * 0.45;

const _lerpPos = new THREE.Vector3();
const _slerpQ = new THREE.Quaternion();
const _ndc = new THREE.Vector3();
const _exploreLookRig = new THREE.Object3D();

/**
 * Hub service used for connector routing / picking.
 * Prefer the placed scan service when present; otherwise synthesize from the pad.
 */
function publicInternetHub(
  platform: PackLayoutResult["publicInternet"],
  fromScan?: InfrastructureService | null,
): InfrastructureService {
  if (fromScan) return fromScan;
  const width = platform.width / CELL_SIZE;
  const depth = platform.depth / CELL_SIZE;
  return {
    id: PUBLIC_INTERNET_ID,
    type: "cloud",
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

/**
 * Fallback for older scans that only set the networking bool — new scans already
 * include `internet` in `connections`.
 */
function withPublicInternetLink(
  service: InfrastructureService,
): InfrastructureService {
  if (isInternetService(service)) return service;
  if (service.connections.includes(PUBLIC_INTERNET_ID)) return service;
  if (!isOpenToInternet(service.fields)) return service;
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

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

/**
 * Service whose world center projects closest to a screen point (client coords).
 * `clientX`/`clientY` default to the viewport middle when omitted.
 */
function closestServiceToScreenPoint(
  camera: THREE.Camera,
  domElement: HTMLElement,
  services: InfrastructureService[],
  clientX: number,
  clientY: number,
): InfrastructureService | null {
  camera.updateMatrixWorld();
  if (services.length === 0) return null;

  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const targetNdcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const targetNdcY = -((clientY - rect.top) / rect.height) * 2 + 1;

  let best: InfrastructureService | null = null;
  let bestDist = Infinity;

  for (const service of services) {
    const [x, y, z] = serviceWorldCenter(service);
    _ndc.set(x, y, z).project(camera);
    // Skip points behind the near plane / camera.
    if (_ndc.z < -1 || _ndc.z > 1) continue;
    const dx = _ndc.x - targetNdcX;
    const dy = _ndc.y - targetNdcY;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = service;
    }
  }

  return best;
}

/**
 * Service under the cursor (or screen center) if there is a footprint hit;
 * otherwise whichever service center projects closest to that screen point.
 */
function transitionTargetService(
  camera: THREE.Camera,
  domElement: HTMLCanvasElement,
  services: InfrastructureService[],
  clientX: number | null,
  clientY: number | null,
): InfrastructureService | null {
  const rect = domElement.getBoundingClientRect();
  const x = clientX ?? rect.left + rect.width / 2;
  const y = clientY ?? rect.top + rect.height / 2;
  const hitId = pickServiceAt(x, y, camera, domElement, services);
  if (hitId) {
    return services.find((service) => service.id === hitId) ?? null;
  }
  return closestServiceToScreenPoint(camera, domElement, services, x, y);
}

/**
 * Same ground XZ; only height + orientation change.
 * Target = service under cursor (screen center if none). Facing toward the
 * target uses the flipped look direction (toPos − serviceCenter).
 */
function exploreQuatTowardTarget(
  camera: THREE.Camera,
  domElement: HTMLCanvasElement,
  toPos: THREE.Vector3,
  services: InfrastructureService[],
  clientX: number | null,
  clientY: number | null,
  out: THREE.Quaternion,
): THREE.Quaternion {
  const target = transitionTargetService(
    camera,
    domElement,
    services,
    clientX,
    clientY,
  );

  _exploreLookRig.position.copy(toPos);
  _exploreLookRig.up.set(0, 1, 0);

  if (!target) {
    _exploreLookRig.lookAt(toPos.x + 1, toPos.y + 1, toPos.z + 1);
  } else {
    const [sx, sy, sz] = serviceWorldCenter(target);
    // Flipped: aim along toPos − serviceCenter (facing toward the target).
    _exploreLookRig.lookAt(
      toPos.x * 2 - sx,
      toPos.y * 2 - sy,
      toPos.z * 2 - sz,
    );
  }

  return out.copy(_exploreLookRig.quaternion);
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

type ViewTransition = {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  /** performance.now() when the blend started — wall-clock, not frame-delta. */
  startMs: number;
  durationMs: number;
};

/**
 * Interpolates top ↔ explore. Ground XZ stays fixed; height + orientation blend.
 * Top→explore: Y=4, face the service under the cursor (screen center if none).
 * Explore→top: restore previous top Y (default 10).
 */
function CameraModeSync({
  viewMode,
  services,
  onSettled,
}: {
  viewMode: ViewMode;
  services: InfrastructureService[];
  onSettled: (mode: ViewMode | null) => void;
}) {
  const { camera, gl } = useThree();
  const prevMode = useRef<ViewMode | null>(null);
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const transition = useRef<ViewTransition | null>(null);
  const lastTopY = useRef(DEFAULT_TOP_HEIGHT);
  /** Last pointer over the canvas; null → treat as viewport center. */
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const _toExploreQ = useRef(new THREE.Quaternion());

  useEffect(() => {
    const el = gl.domElement;
    const onPointerMove = (event: PointerEvent) => {
      lastPointer.current = { x: event.clientX, y: event.clientY };
    };
    el.addEventListener("pointermove", onPointerMove);
    return () => el.removeEventListener("pointermove", onPointerMove);
  }, [gl]);

  useLayoutEffect(() => {
    if (prevMode.current === null) {
      prevMode.current = viewMode;
      if (viewMode === "top") {
        lastTopY.current = camera.position.y;
      }
      onSettledRef.current(viewMode);
      return;
    }
    if (prevMode.current === viewMode) return;
    prevMode.current = viewMode;

    // Only release look-lock when leaving explore. Entering explore keeps a
    // lock acquired from the Tab/click user gesture through the blend.
    if (
      viewMode === "top" &&
      document.pointerLockElement === gl.domElement
    ) {
      document.exitPointerLock();
    }

    // Unmount controls for the entire blend (including toggles mid-transition).
    onSettledRef.current(null);

    camera.up.set(0, 1, 0);

    const fromPos = camera.position.clone();
    const fromQ = camera.quaternion.clone();
    const x = camera.position.x;
    const z = camera.position.z;

    let toPos: THREE.Vector3;
    let toQ: THREE.Quaternion;

    if (viewMode === "top") {
      // Keep current XZ; restore previous top-down height (default 10).
      toPos = new THREE.Vector3(x, lastTopY.current || DEFAULT_TOP_HEIGHT, z);
      toQ = TOP_DOWN_QUAT.clone();
    } else {
      // Keep current XZ; drop to fixed explore eye height.
      toPos = new THREE.Vector3(x, EXPLORE_EYE_HEIGHT, z);
      const pointer = lastPointer.current;
      toQ = exploreQuatTowardTarget(
        camera,
        gl.domElement,
        toPos,
        services,
        pointer?.x ?? null,
        pointer?.y ?? null,
        _toExploreQ.current,
      ).clone();
    }

    transition.current = {
      fromPos,
      toPos,
      fromQ,
      toQ,
      startMs: performance.now(),
      durationMs: VIEW_TRANSITION_DURATION * 1000,
    };
  }, [viewMode, camera, gl, services]);

  useFrame(() => {
    const t = transition.current;
    if (t) {
      const uLinear = Math.min(
        1,
        (performance.now() - t.startMs) / t.durationMs,
      );
      const u = easeOutCubic(uLinear);

      _lerpPos.lerpVectors(t.fromPos, t.toPos, u);
      camera.position.copy(_lerpPos);
      _slerpQ.slerpQuaternions(t.fromQ, t.toQ, u);
      camera.quaternion.copy(_slerpQ);

      if (uLinear >= 1) {
        camera.position.copy(t.toPos);
        camera.quaternion.copy(t.toQ);
        transition.current = null;
        onSettledRef.current(viewModeRef.current);
      }
      return;
    }

    if (viewModeRef.current === "top") {
      lastTopY.current = camera.position.y;
    }
  });

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
  const internetFromScan = useMemo(
    () => services.find(isInternetService) ?? null,
    [services],
  );
  const internetHub = useMemo(
    () => publicInternetHub(publicInternet, internetFromScan),
    [publicInternet, internetFromScan],
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
  // Lags `viewMode` until the camera blend finishes — keeps controls unmounted
  // for the whole transition (including the first frame after a mode change).
  const [settledMode, setSettledMode] = useState<ViewMode | null>(null);
  const controlsActive = settledMode === viewMode;

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
      // Always include the internet hub so the cloud is clickable.
      const base =
        visibleRef.current.length > 0 ? visibleRef.current : services;
      const pool = base.some(isInternetService)
        ? base
        : [...base, internetHub];
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
    [camera, gl, internetHub, services],
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

      {visiblePlatforms
        .filter(
          (platform): platform is typeof platform & { group: string } =>
            platform.group != null,
        )
        .map((platform) => (
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

      <InstancedServiceBlocks
        services={visibleServices.filter((service) => !isInternetService(service))}
      />

      <ServiceConnectors
        services={connectorServices}
        selectedServiceId={selectedServiceId}
        precomputedPaths={connectorPaths}
        precomputedSegments={connectorSegments}
        precomputedJoints={connectorJoints}
      />

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
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const servicesById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const internetHub = useMemo(
    () =>
      publicInternetHub(
        publicInternet,
        services.find(isInternetService) ?? null,
      ),
    [publicInternet, services],
  );
  const selectedService = selectedServiceId
    ? (servicesById.get(selectedServiceId) ??
      (selectedServiceId === PUBLIC_INTERNET_ID ? internetHub : null))
    : null;
  const selectedName = selectedService?.name ?? null;

  const setViewModeFromUi = useCallback((next: ViewMode) => {
    if (next === "explore") {
      // Must run inside the user gesture (Tab / click) so the browser allows it.
      void canvasElRef.current?.requestPointerLock();
    }
    setViewMode(next);
  }, []);

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    // Hide the OS cursor for the whole explore session (incl. transition).
    el.style.cursor = viewMode === "explore" ? "none" : "";
    return () => {
      el.style.cursor = "";
    };
  }, [viewMode]);

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
      const next = viewModeRef.current === "top" ? "explore" : "top";
      setViewModeFromUi(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setViewModeFromUi]);

  const helpText =
    viewMode === "top"
      ? "WASD move · drag to pan · scroll to zoom · orientation locked · Tab to explore"
      : lookLocked
        ? "WASD move · look with mouse · click crosshair to select · Esc unlock · Tab for top view"
        : "WASD move · click to look · Alt/Win+drag pan · Tab for top view";

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
          canvasElRef.current = gl.domElement;
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
            if (value === "top" || value === "explore") setViewModeFromUi(value);
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
