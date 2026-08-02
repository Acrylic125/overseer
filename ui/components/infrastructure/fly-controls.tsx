"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const MOVE_SPEED = 8;
const LOOK_SENSITIVITY = 0.0022;
const DRAG_MOVE_SENSITIVITY = 0.012;
const VERTICAL_SPEED = 6;
const BOOST_MULTIPLIER = 3;
const CLICK_MOVE_TOLERANCE = 5;

type FlyControlsProps = {
  /**
   * Called on left-click. When locked, coords are the canvas center (crosshair).
   * Return true if a service was selected / toggled.
   */
  onPick?: (clientX: number, clientY: number) => boolean;
  /** Fires when pointer-lock look mode starts/stops (for crosshair UI). */
  onLookLockChange?: (locked: boolean) => void;
};

/**
 * Free-fly navigation:
 * - WASD / Space / Shift to move
 * - Click-drag (or click empty space) enters pointer-lock look
 * - While locked: click selects the service under the crosshair
 * - Esc exits look mode
 * - Alt/Meta + drag pans without locking
 */
export function FlyControls({ onPick, onLookLockChange }: FlyControlsProps) {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const look = useRef({ locked: false });
  const drag = useRef({
    active: false,
    altOrMeta: false,
    startX: 0,
    startY: 0,
    moved: false,
  });
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onLockRef = useRef(onLookLockChange);
  onLockRef.current = onLookLockChange;

  const _forward = useRef(new THREE.Vector3());
  const _right = useRef(new THREE.Vector3());
  const _direction = useRef(new THREE.Vector3());

  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion);
  }, [camera]);

  useEffect(() => {
    const el = gl.domElement;

    const onKeyDown = (event: KeyboardEvent) => {
      // Ignore OS key-repeat; Set already holds the code.
      if (event.repeat) {
        if (
          [
            "KeyW",
            "KeyA",
            "KeyS",
            "KeyD",
            "KeyR",
            "Space",
            "ShiftLeft",
            "ShiftRight",
          ].includes(event.code)
        ) {
          event.preventDefault();
        }
        return;
      }
      keys.current.add(event.code);
      if (
        [
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "KeyR",
          "Space",
          "ShiftLeft",
          "ShiftRight",
        ].includes(event.code)
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

    const pickAt = (clientX: number, clientY: number) => {
      return onPickRef.current?.(clientX, clientY) ?? false;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const modifier = event.altKey || event.metaKey;

      // Already in look mode → click selects under the crosshair (screen center).
      if (look.current.locked && !modifier) {
        const rect = el.getBoundingClientRect();
        pickAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return;
      }

      drag.current.active = true;
      drag.current.altOrMeta = modifier;
      drag.current.startX = event.clientX;
      drag.current.startY = event.clientY;
      drag.current.moved = false;
      el.setPointerCapture(event.pointerId);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag.current.active) return;

      const wasClick =
        !drag.current.moved &&
        !drag.current.altOrMeta &&
        event.button === 0;

      drag.current.active = false;
      drag.current.altOrMeta = false;

      if (el.hasPointerCapture(event.pointerId)) {
        el.releasePointerCapture(event.pointerId);
      }

      if (!wasClick || look.current.locked) return;

      // Soft click while unlocked: pick under cursor, else enter look mode.
      const hit = pickAt(event.clientX, event.clientY);
      if (!hit) {
        void el.requestPointerLock();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (look.current.locked) {
        euler.current.y -= event.movementX * LOOK_SENSITIVITY;
        euler.current.x -= event.movementY * LOOK_SENSITIVITY;
        const limit = Math.PI / 2 - 0.05;
        euler.current.x = Math.max(-limit, Math.min(limit, euler.current.x));
        camera.quaternion.setFromEuler(euler.current);
        return;
      }

      if (!drag.current.active) return;

      const dx = event.clientX - drag.current.startX;
      const dy = event.clientY - drag.current.startY;
      if (
        !drag.current.moved &&
        dx * dx + dy * dy > CLICK_MOVE_TOLERANCE * CLICK_MOVE_TOLERANCE
      ) {
        drag.current.moved = true;
      }

      const modifierDrag =
        event.altKey || event.metaKey || drag.current.altOrMeta;

      if (modifierDrag) {
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        camera.getWorldDirection(forward);
        forward.y = 0;
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        camera.position.addScaledVector(
          right,
          -event.movementX * DRAG_MOVE_SENSITIVITY,
        );
        camera.position.addScaledVector(
          forward,
          event.movementY * DRAG_MOVE_SENSITIVITY,
        );
        return;
      }

      // Drag without modifier → enter pointer-lock look for smooth control.
      if (drag.current.moved && !look.current.locked) {
        void el.requestPointerLock();
      }
    };

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === el;
      look.current.locked = locked;
      onLockRef.current?.(locked);
      if (locked) {
        drag.current.active = false;
      }
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
    el.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === el) {
        document.exitPointerLock();
      }
    };
  }, [camera, gl]);

  useFrame((_, delta) => {
    const pressed = keys.current;
    if (pressed.size === 0) return;
    const boosted = pressed.has("KeyR");
    const moveSpeed = MOVE_SPEED * (boosted ? BOOST_MULTIPLIER : 1);
    const verticalSpeed = VERTICAL_SPEED * (boosted ? BOOST_MULTIPLIER : 1);

    // Clamp so a hitch (streaming rebuild, etc.) doesn't become a teleport.
    const dt = Math.min(delta, 1 / 30);

    const forward = _forward.current;
    const right = _right.current;
    const direction = _direction.current;
    direction.set(0, 0, 0);

    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    else forward.normalize();
    right.crossVectors(forward, camera.up).normalize();

    if (pressed.has("KeyW")) direction.add(forward);
    if (pressed.has("KeyS")) direction.sub(forward);
    if (pressed.has("KeyD")) direction.add(right);
    if (pressed.has("KeyA")) direction.sub(right);

    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(moveSpeed * dt);
      camera.position.add(direction);
    }

    if (pressed.has("Space")) {
      camera.position.y += verticalSpeed * dt;
    }
    if (pressed.has("ShiftLeft") || pressed.has("ShiftRight")) {
      camera.position.y -= verticalSpeed * dt;
    }
  });

  return null;
}

/** Screen-center reticle shown while pointer-lock look is active. */
export function LookCrosshair({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="relative size-5">
        <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-white/80" />
        <div className="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-white/80" />
        <div className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#8ec7ff]" />
      </div>
    </div>
  );
}
