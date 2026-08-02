"use client";

import { CameraControls } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";

import { FlyControls } from "@/components/infrastructure/fly-controls";
import { useScene } from "@/components/infrastructure/scene-context";
import { CELL_SIZE } from "@/lib/infrastructure-styles";

type CameraRigProps = {
  center: THREE.Vector3;
  radius: number;
  cameraPosition: [number, number, number];
};

/**
 * Cinematic orbit/dolly by default; WASD free-fly when flyMode is on.
 * Arc-focuses the selected node when focusToken changes.
 */
export function CameraRig({ center, radius, cameraPosition }: CameraRigProps) {
  const { flyMode, selectedId, focusToken, services } = useScene();
  const controls = useRef<CameraControls>(null);

  useEffect(() => {
    if (flyMode || !controls.current) return;
    void controls.current.setLookAt(
      cameraPosition[0],
      cameraPosition[1],
      cameraPosition[2],
      center.x,
      0.4,
      center.z,
      false,
    );
  }, [flyMode, cameraPosition, center]);

  useEffect(() => {
    if (flyMode || !controls.current || !selectedId) return;
    const service = services.find((item) => item.id === selectedId);
    if (!service) return;
    const tx = service.x * CELL_SIZE;
    const tz = service.y * CELL_SIZE;
    const dist = Math.max(4.5, radius * 0.22);
    void controls.current.setLookAt(
      tx + dist * 0.7,
      3.2 + dist * 0.15,
      tz + dist * 0.9,
      tx,
      0.6,
      tz,
      true,
    );
  }, [focusToken, selectedId, services, flyMode, radius]);

  if (flyMode) {
    return <FlyControls />;
  }

  return (
    <CameraControls
      ref={controls}
      makeDefault
      dollyToCursor
      minDistance={3}
      maxDistance={Math.max(40, radius * 3.5)}
      maxPolarAngle={Math.PI * 0.48}
      smoothTime={0.35}
      draggingSmoothTime={0.2}
    />
  );
}
