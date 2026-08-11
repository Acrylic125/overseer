"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type * as THREE from "three";

export function CameraBridge({
  onCamera,
}: {
  onCamera: (camera: THREE.Camera) => void;
}) {
  const { camera } = useThree();
  useEffect(() => {
    onCamera(camera);
  }, [camera, onCamera]);
  return null;
}
