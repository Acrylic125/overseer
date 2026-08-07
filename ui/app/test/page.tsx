"use client";

import { Html, OrthographicCamera } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { loadPlatformGradient } from "@/lib/platform-assets";
import { createPlatformGeometries } from "@/lib/platform-mesh";

const ICONS_URL = "/icons.glb";
const ICON_GAP_X = 1.55;
const ICON_GAP_Y = 1.85;
const ICON_HALF = 0.5;
const LABEL_GAP = 0.72;

const BG = "#0A0A0A";
/** Fine graph-paper grid (major every 1, sub every 0.25). */
const GRID_MAJOR = 1;
const GRID_MINOR = 0.25;
/** Outer padding from content AABB to platform edge. */
const PAD_TOP = 0.4;
const PAD_SIDE = 0.2;
const LABEL_FONT = 0.2;
const TITLE_FONT = 0.18;
const CLUSTER_TITLE = "Cluster 1";

function collectMeshes(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    // Node name often lives on the object; mesh resource name may be empty.
    if (!mesh.name && obj.parent?.name) mesh.name = obj.parent.name;
    meshes.push(mesh);
  });
  meshes.sort((a, b) => a.name.localeCompare(b.name));
  return meshes;
}

function displayName(meshName: string) {
  return meshName.replace(/^cf-/, "").replace(/-/g, " ").trim() || "icon";
}

function forceUnlitMaterial(source: THREE.Material | THREE.Material[]) {
  const sources = Array.isArray(source) ? source : [source];
  const next = sources.map(
    () =>
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
  );
  return next.length === 1 ? next[0]! : next;
}

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  center: THREE.Vector3;
  width: number;
  height: number;
};

function GridPlane({ bounds }: { bounds: Bounds }) {
  const { minor, major } = useMemo(() => {
    const pad = 8;
    const minX = Math.floor((bounds.minX - pad) / GRID_MINOR) * GRID_MINOR;
    const maxX = Math.ceil((bounds.maxX + pad) / GRID_MINOR) * GRID_MINOR;
    const minY = Math.floor((bounds.minY - pad) / GRID_MINOR) * GRID_MINOR;
    const maxY = Math.ceil((bounds.maxY + pad) / GRID_MINOR) * GRID_MINOR;

    const minorPts: number[] = [];
    const majorPts: number[] = [];
    const push = (
      target: number[],
      x1: number,
      y1: number,
      x2: number,
      y2: number,
    ) => {
      target.push(x1, y1, 0, x2, y2, 0);
    };

    const majorEvery = Math.round(GRID_MAJOR / GRID_MINOR);
    for (let x = minX; x <= maxX + 1e-6; x += GRID_MINOR) {
      const cell = Math.round(x / GRID_MINOR);
      push(cell % majorEvery === 0 ? majorPts : minorPts, x, minY, x, maxY);
    }
    for (let y = minY; y <= maxY + 1e-6; y += GRID_MINOR) {
      const cell = Math.round(y / GRID_MINOR);
      push(cell % majorEvery === 0 ? majorPts : minorPts, minX, y, maxX, y);
    }

    return {
      minor: new Float32Array(minorPts),
      major: new Float32Array(majorPts),
    };
  }, [bounds]);

  const minorGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(minor, 3));
    return geo;
  }, [minor]);

  const majorGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(major, 3));
    return geo;
  }, [major]);

  return (
    <group position={[0, 0, -0.04]}>
      <lineSegments geometry={minorGeo}>
        <lineBasicMaterial
          color="#2A3344"
          transparent
          opacity={0.35}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
      <lineSegments geometry={majorGeo}>
        <lineBasicMaterial
          color="#3B4556"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

function WorldSpan({
  position,
  text,
  fontWorld,
  zoom,
  color,
  align = "center",
}: {
  position: [number, number, number];
  text: string;
  fontWorld: number;
  zoom: number;
  color: string;
  align?: "center" | "left";
}) {
  // Never set `transform` on <Html> itself — drei writes translate3d there
  // every frame for world→screen projection. Anchor via the inner span.
  return (
    <Html position={position} style={{ pointerEvents: "none" }}>
      <span
        style={{
          display: "block",
          transform:
            align === "center" ? "translate(-50%, -50%)" : "translate(0, -50%)",
          fontSize: `${Math.max(fontWorld * zoom, 1)}px`,
          lineHeight: 1,
          color,
          whiteSpace: "nowrap",
          letterSpacing: align === "left" ? "0.01em" : undefined,
          userSelect: "none",
        }}
      >
        {text}
      </span>
    </Html>
  );
}

function SquirclePlatform({ bounds }: { bounds: Bounds }) {
  const [gradient, setGradient] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadPlatformGradient().then((texture) => {
      if (!cancelled) setGradient(texture);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { body, border, bodyMaterial, borderMaterial, cx, cy } = useMemo(() => {
    const minX = bounds.minX - PAD_SIDE;
    const maxX = bounds.maxX + PAD_SIDE;
    const minY = bounds.minY - PAD_SIDE;
    const maxY = bounds.maxY + PAD_TOP;
    const width = maxX - minX;
    const height = maxY - minY;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const { body: bodyGeo, border: borderGeo } = createPlatformGeometries(
      width,
      height,
      "xy",
    );

    const bodyMat = new THREE.MeshBasicMaterial({
      map: gradient,
      toneMapped: false,
      side: THREE.FrontSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const borderMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      toneMapped: false,
      side: THREE.FrontSide,
      depthWrite: true,
    });

    return {
      body: bodyGeo,
      border: borderGeo,
      bodyMaterial: bodyMat,
      borderMaterial: borderMat,
      cx: centerX,
      cy: centerY,
    };
  }, [bounds, gradient]);

  useEffect(() => {
    return () => {
      body.dispose();
      border.dispose();
      bodyMaterial.dispose();
      borderMaterial.dispose();
    };
  }, [body, border, bodyMaterial, borderMaterial]);

  if (!gradient) return null;

  return (
    <group position={[cx, cy, 0]}>
      <mesh geometry={body} material={bodyMaterial} />
      <mesh geometry={border} material={borderMaterial} />
    </group>
  );
}

function IconScene() {
  const { size } = useThree();
  const [meshes, setMeshes] = useState<THREE.Mesh[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);

    void loader.loadAsync(ICONS_URL).then((gltf) => {
      if (cancelled) return;
      const clones = collectMeshes(gltf.scene).map((mesh) => {
        const clone = mesh.clone(true);
        if (!clone.name) clone.name = mesh.name;
        clone.material = forceUnlitMaterial(mesh.material);
        clone.rotation.set(0, 0, 0);
        return clone;
      });
      setMeshes(clones);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Prefer a wider card: more columns than rows when possible.
  const cols = Math.max(1, Math.ceil(Math.sqrt(meshes.length * 1.35)));
  const rows = Math.max(1, Math.ceil(meshes.length / cols));

  const layout = useMemo(() => {
    const positions = meshes.map((mesh, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      return {
        name: mesh.name || `icon-${index}`,
        x: col * ICON_GAP_X,
        y: (rows - 1 - row) * ICON_GAP_Y,
      };
    });

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of positions) {
      minX = Math.min(minX, p.x - ICON_HALF);
      maxX = Math.max(maxX, p.x + ICON_HALF);
      // Label sits at y - LABEL_GAP; only extend bounds to the glyph, not
      // another ICON_HALF below it (that was inventing extra bottom pad).
      minY = Math.min(minY, p.y - LABEL_GAP - LABEL_FONT / 2);
      maxY = Math.max(maxY, p.y + ICON_HALF);
    }
    if (!Number.isFinite(minX)) {
      minX = -0.5;
      maxX = 0.5;
      minY = -0.5;
      maxY = 0.5;
    }

    // Platform padding applied in SquirclePlatform (PAD_SIDE / PAD_TOP).
    const width = maxX - minX;
    const height = maxY - minY;
    const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, 0);

    return {
      cols,
      rows,
      positions,
      bounds: {
        minX,
        maxX,
        minY,
        maxY,
        center,
        width,
        height,
      } satisfies Bounds,
    };
  }, [cols, meshes, rows]);

  const cameraView = useMemo(() => {
    const { bounds } = layout;
    const cardW = bounds.width + PAD_SIDE * 2;
    const cardH = bounds.height + PAD_SIDE + PAD_TOP;
    const margin = 1.35;
    const zoom = Math.min(
      size.width / Math.max(cardW * margin, 1e-6),
      size.height / Math.max(cardH * margin, 1e-6),
    );
    const focusX = (bounds.minX - PAD_SIDE + bounds.maxX + PAD_SIDE) / 2;
    const focusY = (bounds.minY - PAD_SIDE + bounds.maxY + PAD_TOP) / 2;
    return {
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : 70,
      position: [focusX, focusY, 10] as [number, number, number],
      target: [focusX, focusY, 0] as [number, number, number],
    };
  }, [layout.bounds, size.height, size.width]);

  if (meshes.length === 0) {
    return <OrthographicCamera makeDefault position={[0, 0, 10]} zoom={70} />;
  }

  const titlePos: [number, number, number] = [
    layout.bounds.minX,
    // Vertically center the title in the top pad band.
    layout.bounds.maxY + PAD_TOP / 2,
    0.05,
  ];

  return (
    <>
      <OrthographicCamera
        makeDefault
        position={cameraView.position}
        zoom={cameraView.zoom}
        near={0.1}
        far={100}
      />
      <CameraLookAt target={cameraView.target} />
      <group>
        <GridPlane bounds={layout.bounds} />
        <SquirclePlatform bounds={layout.bounds} />
        <WorldSpan
          position={titlePos}
          text={CLUSTER_TITLE}
          fontWorld={TITLE_FONT}
          zoom={cameraView.zoom}
          color="#F8FAFC"
          align="left"
        />
        {meshes.map((mesh, index) => {
          const pos = layout.positions[index];
          if (!pos) return null;
          return (
            <group key={mesh.name || String(index)}>
              <primitive object={mesh} position={[pos.x, pos.y, 0.05]} />
              <WorldSpan
                position={[pos.x, pos.y - LABEL_GAP, 0.05]}
                text={displayName(pos.name)}
                fontWorld={LABEL_FONT}
                zoom={cameraView.zoom}
                color="#E2E8F0"
              />
            </group>
          );
        })}
      </group>
    </>
  );
}

function CameraLookAt({ target }: { target: [number, number, number] }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.up.set(0, 1, 0);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
  }, [camera, target]);
  return null;
}

export default function TestPage() {
  return (
    <div className="absolute inset-0" style={{ background: BG }}>
      <Canvas
        orthographic
        dpr={[1, 2]}
        gl={{
          antialias: true,
          toneMapping: THREE.NoToneMapping,
          outputColorSpace: THREE.SRGBColorSpace,
        }}
      >
        <color attach="background" args={[BG]} />
        <IconScene />
      </Canvas>
    </div>
  );
}
