"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/** World units / second at the reference height. */
const MOVE_SPEED = 28;
const BOOST_MULTIPLIER = 3;
const REF_HEIGHT = 24;
const ZOOM_SPEED = 0.12;
const MIN_HEIGHT = 6;
const MAX_HEIGHT = 120;
const CLICK_MOVE_TOLERANCE = 5;
const TOP_DOWN_EULER = new THREE.Euler(-Math.PI / 2, 0, 0, "YXZ");
const TOP_DOWN_QUAT = new THREE.Quaternion().setFromEuler(TOP_DOWN_EULER);

type TopViewControlsProps = {
  onPick?: (clientX: number, clientY: number) => boolean;
};

/**
 * Locked top-down navigation:
 * - WASD pans on the ground plane
 * - Drag pans with the mouse (1:1 with the ground under the cursor)
 * - Scroll wheel zooms (camera height)
 * - Orientation is fixed looking straight down
 */
export function TopViewControls({ onPick }: TopViewControlsProps) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const drag = useRef({
    active: false,
    startX: 0,
    startY: 0,
    moved: false,
  });
  // Accumulate pointer pan / zoom on the event thread; apply once per frame.
  const panDelta = useRef({ x: 0, z: 0 });
  const zoomFactor = useRef(1);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const _direction = useRef(new THREE.Vector3());

  useEffect(() => {
    const el = gl.domElement;

    const worldUnitsPerPixel = () => {
      const height = Math.max(1, camera.position.y);
      const fovDeg =
        camera instanceof THREE.PerspectiveCamera ? camera.fov : 42;
      const visibleHeight = 2 * height * Math.tan((fovDeg * Math.PI) / 360);
      return visibleHeight / Math.max(1, el.clientHeight);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        if (
          ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR"].includes(
            event.code,
          )
        ) {
          event.preventDefault();
        }
        return;
      }
      keys.current.add(event.code);
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "KeyR"].includes(
          event.code,
        )
      ) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
    };
    const onBlur = () => {
      keys.current.clear();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      drag.current.active = true;
      drag.current.startX = event.clientX;
      drag.current.startY = event.clientY;
      drag.current.moved = false;
      el.setPointerCapture(event.pointerId);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag.current.active) return;

      const wasClick = !drag.current.moved && event.button === 0;
      drag.current.active = false;

      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }

      if (wasClick) {
        onPickRef.current?.(event.clientX, event.clientY);
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag.current.active) return;

      const dx = event.clientX - drag.current.startX;
      const dy = event.clientY - drag.current.startY;
      if (
        !drag.current.moved &&
        dx * dx + dy * dy > CLICK_MOVE_TOLERANCE * CLICK_MOVE_TOLERANCE
      ) {
        drag.current.moved = true;
      }

      // 1:1 screen → ground pan (top-down perspective).
      const scale = worldUnitsPerPixel();
      panDelta.current.x -= event.movementX * scale;
      panDelta.current.z -= event.movementY * scale;
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomFactor.current *= Math.exp(event.deltaY * ZOOM_SPEED * 0.01);
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("contextmenu", onContextMenu);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 60);

    // Keep orientation locked without snapping on mount (mount snap fought
    // the view-mode transition).
    camera.up.set(0, 1, 0);
    camera.quaternion.copy(TOP_DOWN_QUAT);

    const pan = panDelta.current;
    if (pan.x !== 0 || pan.z !== 0) {
      camera.position.x += pan.x;
      camera.position.z += pan.z;
      pan.x = 0;
      pan.z = 0;
    }

    if (zoomFactor.current !== 1) {
      camera.position.y = THREE.MathUtils.clamp(
        camera.position.y * zoomFactor.current,
        MIN_HEIGHT,
        MAX_HEIGHT,
      );
      zoomFactor.current = 1;
    }

    const pressed = keys.current;
    if (pressed.size === 0) return;
    const boosted = pressed.has("KeyR");

    const direction = _direction.current;
    direction.set(0, 0, 0);

    // World-aligned WASD (camera yaw is fixed at 0).
    if (pressed.has("KeyW")) direction.z -= 1;
    if (pressed.has("KeyS")) direction.z += 1;
    if (pressed.has("KeyD")) direction.x += 1;
    if (pressed.has("KeyA")) direction.x -= 1;

    if (direction.lengthSq() > 0) {
      // Mild height scaling so zoomed-out travel stays usable without
      // sprinting across stream cells every frame.
      const speed =
        MOVE_SPEED *
        (boosted ? BOOST_MULTIPLIER : 1) *
        Math.sqrt(Math.max(1, camera.position.y) / REF_HEIGHT);
      direction.normalize().multiplyScalar(speed * dt);
      camera.position.x += direction.x;
      camera.position.z += direction.z;
    }
  });

  return null;
}
