"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

import { FlyControls } from "@/components/infrastructure/fly-controls";
import {
  FrostedPlatform,
  WorldGrid,
} from "@/components/infrastructure/frosted-platform";
import { ServiceBlock } from "@/components/infrastructure/service-block";
import { ServiceConnectors } from "@/components/infrastructure/service-connectors";
import { cssToThreeColor } from "@/lib/css-color";
import { SCENE } from "@/lib/infrastructure-styles";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type InfrastructureCanvasProps = {
  services: InfrastructureService[];
  platforms: PackLayoutResult["platforms"];
  bounds: PackLayoutResult["bounds"];
};

function getCameraFrame(bounds: PackLayoutResult["bounds"]) {
  const span = Math.max(bounds.width, bounds.depth, 8);
  const distance = span * 1.15;
  const position: [number, number, number] = [
    bounds.centerX + distance * 0.75,
    Math.max(6, distance * 0.65),
    bounds.centerZ + distance * 0.75,
  ];
  const target = new THREE.Vector3(bounds.centerX, 0, bounds.centerZ);
  return { position, target, span };
}

function Scene({
  services,
  platforms,
  bounds,
}: InfrastructureCanvasProps) {
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);
  const ambient = useMemo(() => cssToThreeColor(SCENE.ambient), []);
  const keyLight = useMemo(() => cssToThreeColor(SCENE.keyLight), []);
  const hemiSky = useMemo(() => cssToThreeColor(SCENE.hemiSky), []);
  const hemiGround = useMemo(() => cssToThreeColor(SCENE.hemiGround), []);
  const frame = useMemo(() => getCameraFrame(bounds), [bounds]);

  return (
    <>
      <color attach="background" args={[background]} />
      <fog
        attach="fog"
        args={[background, frame.span * 2.2, frame.span * 5.5]}
      />

      <ambientLight color={ambient} intensity={0.35} />
      <directionalLight
        color={keyLight}
        position={[40, 45, 40]}
        intensity={1.35}
      />
      <hemisphereLight
        color={hemiSky}
        groundColor={hemiGround}
        intensity={0.35}
      />

      <WorldGrid />

      {platforms.map((platform) => (
        <FrostedPlatform
          key={platform.group}
          centerX={platform.centerX}
          centerZ={platform.centerZ}
          width={platform.width}
          depth={platform.depth}
        />
      ))}

      {services.map((service) => (
        <ServiceBlock key={service.id} service={service} />
      ))}

      <ServiceConnectors services={services} />

      <FlyControls />
    </>
  );
}

export function InfrastructureCanvas({
  services,
  platforms,
  bounds,
}: InfrastructureCanvasProps) {
  const frame = useMemo(() => getCameraFrame(bounds), [bounds]);
  const background = useMemo(() => cssToThreeColor(SCENE.background), []);

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{ background: SCENE.background }}
    >
      <Canvas
        dpr={[1, 1.5]}
        camera={{
          position: frame.position,
          fov: 42,
          near: 0.1,
          far: 500,
        }}
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
        onCreated={({ camera, gl }) => {
          camera.lookAt(frame.target);
          gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
          gl.setClearColor(background, 1);
        }}
      >
        <Suspense fallback={null}>
          <Scene
            services={services}
            platforms={platforms}
            bounds={bounds}
          />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-md bg-black/50 px-3 py-1.5 font-mono text-[11px] tracking-wide text-white/75 backdrop-blur-sm">
        WASD move · Space/Shift up/down · mouse look · Alt/Win+drag pan
      </div>
    </div>
  );
}
