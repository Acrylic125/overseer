"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef } from "react";
import * as THREE from "three";

import { pickServiceAt } from "@/lib/graph/pick-service";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type ViewMode = "top" | "explore";

const TOP_DOWN_EULER = new THREE.Euler(-Math.PI / 2, 0, 0, "YXZ");
const TOP_DOWN_QUAT = new THREE.Quaternion().setFromEuler(TOP_DOWN_EULER);
const EXPLORE_EYE_HEIGHT = 4;
const DEFAULT_TOP_HEIGHT = 10;
const TRANSITION_MS = 550;

const _lerpPos = new THREE.Vector3();
const _slerpQ = new THREE.Quaternion();
const _ndc = new THREE.Vector3();
const _lookRig = new THREE.Object3D();

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3;
}

function closestServiceToScreenPoint(
  camera: THREE.Camera,
  domElement: HTMLElement,
  services: InfrastructureService[],
  clientX: number,
  clientY: number,
): InfrastructureService | null {
  camera.updateMatrixWorld();
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || services.length === 0) return null;

  const targetNdcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const targetNdcY = -((clientY - rect.top) / rect.height) * 2 + 1;

  let best: InfrastructureService | null = null;
  let bestDist = Infinity;

  for (const service of services) {
    const [x, y, z] = serviceWorldCenter(service);
    _ndc.set(x, y, z).project(camera);
    if (_ndc.z < -1 || _ndc.z > 1) continue;
    const dist =
      (_ndc.x - targetNdcX) ** 2 + (_ndc.y - targetNdcY) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = service;
    }
  }

  return best;
}

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

  _lookRig.position.copy(toPos);
  _lookRig.up.set(0, 1, 0);

  if (!target) {
    _lookRig.lookAt(toPos.x + 1, toPos.y + 1, toPos.z + 1);
  } else {
    const [sx, sy, sz] = serviceWorldCenter(target);
    _lookRig.lookAt(toPos.x * 2 - sx, toPos.y * 2 - sy, toPos.z * 2 - sz);
  }

  return out.copy(_lookRig.quaternion);
}

type ViewTransition = {
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromQ: THREE.Quaternion;
  toQ: THREE.Quaternion;
  startMs: number;
  durationMs: number;
};

/** Blends camera between top-down and first-person explore modes. */
export function CameraModeSync({
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
  const transition = useRef<ViewTransition | null>(null);
  const lastTopY = useRef(DEFAULT_TOP_HEIGHT);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const onSettledRef = useRef(onSettled);
  const exploreQ = useRef(new THREE.Quaternion());

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

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
      if (viewMode === "top") lastTopY.current = camera.position.y;
      onSettledRef.current(viewMode);
      return;
    }
    if (prevMode.current === viewMode) return;
    prevMode.current = viewMode;

    if (viewMode === "top" && document.pointerLockElement === gl.domElement) {
      document.exitPointerLock();
    }

    onSettledRef.current(null);
    camera.up.set(0, 1, 0);

    const fromPos = camera.position.clone();
    const fromQ = camera.quaternion.clone();
    const { x, z } = camera.position;

    let toPos: THREE.Vector3;
    let toQ: THREE.Quaternion;

    if (viewMode === "top") {
      toPos = new THREE.Vector3(x, lastTopY.current || DEFAULT_TOP_HEIGHT, z);
      toQ = TOP_DOWN_QUAT.clone();
    } else {
      toPos = new THREE.Vector3(x, EXPLORE_EYE_HEIGHT, z);
      const pointer = lastPointer.current;
      toQ = exploreQuatTowardTarget(
        camera,
        gl.domElement,
        toPos,
        services,
        pointer?.x ?? null,
        pointer?.y ?? null,
        exploreQ.current,
      ).clone();
    }

    transition.current = {
      fromPos,
      toPos,
      fromQ,
      toQ,
      startMs: performance.now(),
      durationMs: TRANSITION_MS,
    };
  }, [viewMode, camera, gl, services]);

  useFrame(() => {
    const t = transition.current;
    if (t) {
      const uLinear = Math.min(1, (performance.now() - t.startMs) / t.durationMs);
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

export const TOP_DOWN_QUATERNION = TOP_DOWN_QUAT;
