"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense, useMemo } from "react";
import * as THREE from "three";

import { CameraRig } from "@/components/infrastructure/camera-rig";
import { DataVeins } from "@/components/infrastructure/data-veins";
import { SceneEffects } from "@/components/infrastructure/scene-effects";
import { SceneProvider, useScene } from "@/components/infrastructure/scene-context";
import { ServiceNode } from "@/components/infrastructure/service-node";
import { WarRoomGround } from "@/components/infrastructure/war-room-ground";
import { CELL_SIZE, SCENE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

type InfrastructureCanvasProps = {
  services: InfrastructureService[];
};

function getLayoutFrame(services: InfrastructureService[]) {
  if (services.length === 0) {
    return {
      center: new THREE.Vector3(0, 0, 0),
      radius: 8,
      cameraPosition: [10, 9, 12] as [number, number, number],
    };
  }

  let cx = 0;
  let cz = 0;
  for (const service of services) {
    cx += service.x * CELL_SIZE;
    cz += service.y * CELL_SIZE;
  }
  cx /= services.length;
  cz /= services.length;

  let radius = 0;
  for (const service of services) {
    const x = service.x * CELL_SIZE;
    const z = service.y * CELL_SIZE;
    radius = Math.max(radius, Math.hypot(x - cx, z - cz));
  }
  radius = Math.max(radius, 6);

  const distance = radius * 1.55;
  const elevation = Math.tan((30 * Math.PI) / 180);
  return {
    center: new THREE.Vector3(cx, 0, cz),
    radius,
    cameraPosition: [
      cx + distance * 0.85,
      Math.max(8, distance * elevation),
      cz + distance * 0.85,
    ] as [number, number, number],
  };
}

function Scene({ services }: { services: InfrastructureService[] }) {
  const frame = useMemo(() => getLayoutFrame(services), [services]);
  const { setSelectedId } = useScene();

  return (
    <>
      <color attach="background" args={[SCENE.background]} />
      <fog attach="fog" args={[SCENE.background, frame.radius * 2.4, frame.radius * 6]} />

      <ambientLight color={SCENE.ambient} intensity={0.35} />
      <directionalLight
        color={SCENE.moonlight}
        position={[-40, 55, 25]}
        intensity={1.15}
      />

      <WarRoomGround center={frame.center} radius={frame.radius} />
      <DataVeins />

      {services.map((service) => (
        <ServiceNode key={service.id} service={service} />
      ))}

      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[frame.center.x, -0.02, frame.center.z]}
        onClick={() => setSelectedId(null)}
      >
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <CameraRig
        center={frame.center}
        radius={frame.radius}
        cameraPosition={frame.cameraPosition}
      />
      <SceneEffects />
    </>
  );
}

function HudChrome() {
  const { flyMode, setFlyMode, selectedId, setSelectedId } = useScene();

  return (
    <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="rounded-md bg-black/55 px-3 py-1.5 font-mono text-[11px] tracking-wide text-white/75 backdrop-blur-sm">
        {flyMode
          ? "Free-fly · WASD move · Space/Shift up/down · click to look"
          : "Orbit drag · scroll zoom · click node to focus path · Esc clears"}
      </div>
      <div className="pointer-events-auto flex gap-2">
        <button
          type="button"
          className="rounded-md border border-white/15 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-white/85 backdrop-blur-sm hover:bg-black/75"
          onClick={() => setFlyMode(!flyMode)}
        >
          {flyMode ? "Exit free-fly" : "Enter free-fly"}
        </button>
        {selectedId ? (
          <button
            type="button"
            className="rounded-md border border-white/15 bg-black/60 px-3 py-1.5 font-mono text-[11px] text-white/85 backdrop-blur-sm hover:bg-black/75"
            onClick={() => setSelectedId(null)}
          >
            Clear selection
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function InfrastructureCanvas({ services }: InfrastructureCanvasProps) {
  const frame = useMemo(() => getLayoutFrame(services), [services]);

  return (
    <SceneProvider services={services}>
      <div
        className="absolute inset-0 touch-none"
        style={{ background: SCENE.background }}
      >
        <Canvas
          dpr={[1, 1.5]}
          camera={{
            position: frame.cameraPosition,
            fov: 40,
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
            camera.lookAt(frame.center);
            gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
          }}
        >
          <Suspense fallback={null}>
            <Scene services={services} />
          </Suspense>
        </Canvas>
        <HudChrome />
      </div>
    </SceneProvider>
  );
}
