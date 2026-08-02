"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

const MOVE_SPEED = 8;
const LOOK_SENSITIVITY = 0.0022;
const VERTICAL_SPEED = 6;

/**
 * FPS-style navigation:
 * - WASD strafe / forward
 * - Space up, Shift down
 * - Mouse look (pointer lock)
 */
export function FlyControls() {
  const { camera, gl } = useThree();
  const keys = useRef(new Set<string>());
  const euler = useRef(new THREE.Euler(0, 0, 0, "YXZ"));
  const look = useRef({
    locked: false,
  });

  useEffect(() => {
    euler.current.setFromQuaternion(camera.quaternion);
  }, [camera]);

  useEffect(() => {
    const el = gl.domElement;

    const onKeyDown = (event: KeyboardEvent) => {
      keys.current.add(event.code);
      if (
        ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft", "ShiftRight"].includes(
          event.code,
        )
      ) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keys.current.delete(event.code);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!look.current.locked) {
        void el.requestPointerLock();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!look.current.locked) return;
      euler.current.y -= event.movementX * LOOK_SENSITIVITY;
      euler.current.x -= event.movementY * LOOK_SENSITIVITY;
      const limit = Math.PI / 2 - 0.05;
      euler.current.x = Math.max(-limit, Math.min(limit, euler.current.x));
      camera.quaternion.setFromEuler(euler.current);
    };

    const onPointerLockChange = () => {
      look.current.locked = document.pointerLockElement === el;
    };

    const onContextMenu = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("pointerlockchange", onPointerLockChange);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      el.removeEventListener("pointerdown", onPointerDown);
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

    const direction = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    if (pressed.has("KeyW")) direction.add(forward);
    if (pressed.has("KeyS")) direction.sub(forward);
    if (pressed.has("KeyD")) direction.add(right);
    if (pressed.has("KeyA")) direction.sub(right);

    if (direction.lengthSq() > 0) {
      direction.normalize().multiplyScalar(MOVE_SPEED * delta);
      camera.position.add(direction);
    }

    if (pressed.has("Space")) {
      camera.position.y += VERTICAL_SPEED * delta;
    }
    if (pressed.has("ShiftLeft") || pressed.has("ShiftRight")) {
      camera.position.y -= VERTICAL_SPEED * delta;
    }
  });

  return null;
}
