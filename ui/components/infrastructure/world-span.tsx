"use client";

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useState } from "react";
import * as THREE from "three";

type WorldSpanProps = {
  position: [number, number, number];
  text: string;
  fontWorld: number;
  color: string;
  align?: "center" | "left" | "right";
};

/**
 * HTML `<span>` label projected into the scene — same approach as `/test`.
 * Never set `transform` on `<Html>` itself; drei owns that for projection.
 */
export function WorldSpan({
  position,
  text,
  fontWorld,
  color,
  align = "center",
}: WorldSpanProps) {
  const { camera, size } = useThree();
  const [zoom, setZoom] = useState(70);

  useFrame(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      if (camera.zoom !== zoom) setZoom(camera.zoom);
      return;
    }
    // Perspective: pixels per world unit on the ground under the camera.
    const persp = camera as THREE.PerspectiveCamera;
    const dist = Math.max(Math.abs(persp.position.y), 1e-3);
    const next =
      size.height /
      (2 * dist * Math.tan(THREE.MathUtils.degToRad(persp.fov / 2)));
    if (Number.isFinite(next) && Math.abs(next - zoom) > 0.25) setZoom(next);
  });

  const anchor =
    align === "center"
      ? "translate(-50%, -50%)"
      : align === "right"
        ? "translate(-100%, -50%)"
        : "translate(0, -50%)";

  return (
    <Html position={position} style={{ pointerEvents: "none" }}>
      <span
        style={{
          display: "block",
          transform: anchor,
          fontSize: `${Math.max(fontWorld * zoom, 1)}px`,
          lineHeight: 1,
          color,
          whiteSpace: "nowrap",
          letterSpacing: align === "center" ? undefined : "0.01em",
          userSelect: "none",
        }}
      >
        {text}
      </span>
    </Html>
  );
}
