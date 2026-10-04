"use client";

import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, type ComponentRef } from "react";
import * as THREE from "three";

export function DataCenterControls({
  onPick,
}: {
  onPick: (x: number, y: number) => boolean;
}) {
  const { camera, gl } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  useLayoutEffect(() => {
    const ray = new THREE.Ray();
    ray.origin.copy(camera.position);
    camera.getWorldDirection(ray.direction);
    const point = new THREE.Vector3();
    ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point);
    controls.current?.target.copy(point);
    controls.current?.update();
  }, [camera]);
  useEffect(() => {
    const el = gl.domElement;
    let start: { x: number; y: number } | null = null;
    let moved = false;
    const down = (event: PointerEvent) => {
      if (event.button === 0) {
        start = { x: event.clientX, y: event.clientY };
        moved = false;
      }
    };
    const move = (event: PointerEvent) => {
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5
      )
        moved = true;
    };
    const up = (event: PointerEvent) => {
      if (start && !moved) onPick(event.clientX, event.clientY);
      start = null;
    };
    const cancel = () => {
      start = null;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
  }, [gl, onPick]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      minDistance={4}
      maxDistance={110}
      maxPolarAngle={Math.PI / 2 - 0.08}
      enableDamping
      dampingFactor={0.12}
    />
  );
}
