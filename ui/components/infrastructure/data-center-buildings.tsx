"use client";

import { Billboard, Line, Text } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useState } from "react";

import * as THREE from "three";

import { loadAssetsGlb } from "@/lib/platform-assets";
import {
  CampusGeometry,
  type CampusPart,
} from "@/components/infrastructure/data-center-geometry";
import { clampServiceLabelLines } from "@/components/infrastructure/service-labels";
import {
  buildingAccent,
  buildingHeight,
  buildingKind,
  dataCenterLotFootprints,
  hologramLift,
  DATA_CENTER,
} from "@/lib/data-center";
import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import type { PackLayoutResult } from "@/lib/graph/pack-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

function serviceParts(
  service: InfrastructureService,
  dimmed: boolean,
): CampusPart[] {
  const kind = buildingKind(service);
  const accent = buildingAccent(kind);
  const [cx, , cz] = serviceWorldCenter(service);
  const w = service.width;
  const d = service.depth;
  const parts: CampusPart[] = [];
  const add = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: string = DATA_CENTER.surface,
    shape: CampusPart["shape"] = "box",
    rotation?: CampusPart["rotation"],
  ) => {
    parts.push({
      position: [cx + x * w, y, cz + z * d],
      size: [width * w, height, depth * d],
      color,
      edge: accent,
      shape,
      rotation,
      dimmed,
    });
  };
  const beam = (a: [number, number, number], b: [number, number, number], thickness = 0.025, fill: string = DATA_CENTER.surface) => {
    const start = new THREE.Vector3(a[0] * w, a[1], a[2] * d);
    const end = new THREE.Vector3(b[0] * w, b[1], b[2] * d);
    const direction = end.clone().sub(start);
    const rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()));
    const center = start.add(end).multiplyScalar(0.5);
    parts.push({ position: [cx + center.x, center.y, cz + center.z], size: [thickness, direction.length(), thickness], rotation: [rotation.x, rotation.y, rotation.z], color: fill, edge: accent, dimmed });
  };
  // Warm volumes, orange plinths and pale blue fittings share uniform part colors.
  add(0, 0.1, 0, 0.96, 0.18, 0.96, DATA_CENTER.surface);
  if (kind === "gateway") {
    add(0, 0.23, 0, 0.64, 0.14, 0.64, "#ffac36", "cylinder");
    add(0, 0.34, 0, 0.43, 0.08, 0.43, DATA_CENTER.surface, "cylinder");
    add(0, 0.42, 0, 0.14, 0.12, 0.14, "#ffac36", "cylinder");
  } else if (kind === "warehouse") {
    // A shallow pitched roof, loading bays and a sheltered raised dock.
    add(-0.08, 0.28, -0.04, 0.76, 0.2, 0.76, "#ffac36");
    add(-0.08, 0.89, -0.06, 0.68, 1.02, 0.62);
    add(-0.08, 1.55, -0.06, 0.8, 0.34, 0.75, "#fff7eb", "roof");
    for (const x of [-0.48, 0.32])
      add(x, 1.385, -0.06, 0.025, 0.045, 0.76, "#ffac36");
    add(-0.08, 1.735, -0.06, 0.02, 0.025, 0.76, "#ffac36");
    add(-0.08, 0.38, 0.34, 0.68, 0.14, 0.26, "#fff7eb");
    add(-0.08, 1.16, 0.34, 0.69, 0.06, 0.28, "#ffac36");
    for (const x of [-0.39, 0.23])
      add(x, 0.79, 0.45, 0.018, 0.71, 0.018);
    const bays = w >= 1.8 ? 2 : 1;
    for (let i = 0; i < bays; i++) {
      const x = -0.08 + ((i + 0.5) / bays - 0.5) * 0.54;
      const bayWidth = 0.44 / bays;
      add(x, 0.75, 0.257, bayWidth + 0.04, 0.65, 0.022, "#edf3ff");
      add(x, 0.75, 0.274, bayWidth, 0.59, 0.018, "#fff7eb");
      for (let slat = 0; slat < 5; slat++)
        add(x, 0.5 + slat * 0.115, 0.288, bayWidth, 0.012, 0.008, "#ffbc61");
      add(x, 0.71, 0.296, bayWidth * 0.28, 0.026, 0.01, "#ff852b");
      add(x, 0.44, 0.3, bayWidth + 0.06, 0.045, 0.06, "#ffac36");
    }
    // Clerestory windows and a small side vent keep the wall readable at distance.
    for (let i = 0; i < 4; i++)
      add(-0.32 + i * 0.16, 1.29, 0.258, 0.11, 0.12, 0.018, "#edf3ff");
    add(0.27, 0.89, -0.15, 0.02, 0.3, 0.25, "#edf3ff");
    for (let i = 0; i < 3; i++)
      add(0.284, 0.79 + i * 0.1, -0.15, 0.01, 0.012, 0.2, DATA_CENTER.surface);
    add(-0.08, 0.23, 0.465, 0.25, 0.1, 0.08);
    add(-0.08, 0.16, 0.515, 0.29, 0.055, 0.04);
    const parcel = (x: number, y: number, z: number, size: number) => {
      add(x, y, z, size, size, size, "#ffc36a");
      add(x, y + size / 2 + 0.003, z, size * 0.18, 0.006, size, "#fff7e7");
      add(x, y, z + size / 2 + 0.003, size * 0.18, size, 0.006, "#fff7e7");
      add(x + size * 0.22, y, z + size / 2 + 0.007, size * 0.25, size * 0.3, 0.004);
    };
    add(0.365, 0.24, 0.23, 0.22, 0.06, 0.26, "#fff7eb");
    parcel(0.34, 0.37, 0.23, 0.2);
    parcel(0.34, 0.55, 0.23, 0.16);
    parcel(0.33, 0.3, -0.18, 0.18);
  } else if (kind === "database") {
    add(0, 0.26, 0, 0.83, 0.32, 0.83, "#ff982d");
    add(0, 1.06, 0, 0.72, 1.34, 0.72, DATA_CENTER.surface, "cylinder");
    for (let i = 0; i < 3; i++) {
      add(0, 0.7 + i * 0.34, 0, 0.73, 0.035, 0.73, "#edf3ff", "cylinder");
      parts[parts.length - 1]!.edge = DATA_CENTER.blue;
      add(-0.18, 0.54 + i * 0.34, 0.334, 0.06, 0.085, 0.04, "#ff852b");
    }
    add(0, 1.75, 0, 0.73, 0.08, 0.73, "#ffae38", "cylinder");
    add(0.38, 0.39, -0.3, 0.17, 0.5, 0.17, DATA_CENTER.surface, "cylinder");
    parts[parts.length - 1]!.edge = DATA_CENTER.blue;
    add(0, 1.81, 0, 0.32, 0.035, 0.32, "#ffc36a", "cylinder");
    add(0, 1.84, 0, 0.14, 0.025, 0.14, DATA_CENTER.surface, "cylinder");
    for (const side of [-1, 1]) {
      add(side * 0.27, 0.38, 0.27, 0.1, 0.06, 0.1, "#ffad38");
      add(side * 0.27, 0.58, 0.285, 0.025, 0.35, 0.025, "#ffad38", "cylinder");
      add(side * 0.27, 0.76, 0.285, 0.085, 0.025, 0.085, DATA_CENTER.surface, "cylinder");
    }
    add(0.1, 0.48, 0.365, 0.18, 0.18, 0.045, "#ffad38");
    add(0.1, 0.5, 0.392, 0.13, 0.095, 0.018, DATA_CENTER.paleBlue);
    for (let i = 0; i < 3; i++)
      add(0.05 + i * 0.05, 0.42, 0.394, 0.02, 0.02, 0.012, "#ff852b");
    beam([0.35, 0.3, -0.2], [0.35, 0.92, -0.2], 0.035, "#ffad38");
    beam([0.35, 0.92, -0.2], [0.24, 0.92, -0.2], 0.035, "#ffad38");
  } else if (kind === "rack") {
    const columns = Math.min(6, Math.max(1, Math.floor(w)));
    const rows = Math.min(4, Math.max(1, Math.ceil(d / 1.6)));
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const x = ((col + 0.5) / columns - 0.5) * 0.84;
      const z = ((row + 0.5) / rows - 0.5) * 0.8;
      const cw = 0.72 / columns;
      const cd = 0.7 / rows;
      add(x, 0.24, z, cw + 0.035, 0.12, cd + 0.03, "#ffad38");
      add(x, 0.94, z, cw, 1.36, cd);
      add(x, 1.65, z, cw + 0.025, 0.06, cd + 0.025, "#ffad38");
      // A recessed front with rails, removable trays and status lights.
      add(x, 0.94, z + cd / 2 + 0.004, cw * 0.89, 1.25, 0.018, DATA_CENTER.recessed);
      for (const side of [-1, 1])
        add(x + side * cw * 0.44, 0.94, z + cd / 2 + 0.025, cw * 0.045, 1.29, 0.025, "#ffad38");
      for (let slot = 0; slot < 5; slot++) {
        const y = 0.44 + slot * 0.24;
        add(x, y, z + cd / 2 + 0.025, cw * 0.78, 0.18, 0.035);
        add(x - cw * 0.22, y, z + cd / 2 + 0.048, cw * 0.2, 0.027, 0.025, "#ffad38");
        for (let vent = 0; vent < 4; vent++)
          add(x + cw * (0.02 + vent * 0.055), y, z + cd / 2 + 0.045, cw * 0.022, 0.09, 0.009, "#ffbe6b");
        add(x + cw * 0.31, y + 0.035, z + cd / 2 + 0.046, cw * 0.05, 0.026, 0.009, DATA_CENTER.blue);
        add(x + cw * 0.31, y - 0.025, z + cd / 2 + 0.046, cw * 0.05, 0.026, 0.009, "#ff852b");
      }
      // Both cabinet sides have bordered access panels and cooling louvers.
      for (const side of [-1, 1]) {
        add(x + side * (cw / 2 + 0.006), 0.99, z, 0.018, 1.07, cd * 0.78, DATA_CENTER.recessed);
        add(x + side * (cw / 2 + 0.019), 0.99, z, 0.015, 0.98, cd * 0.7);
        for (let vent = 0; vent < 7; vent++)
          add(x + side * (cw / 2 + 0.03), 0.58 + vent * 0.12, z, 0.012, 0.025, cd * 0.54, "#ffbe6b");
        for (const hinge of [-0.23, 0.23])
          add(x + side * (cw / 2 + 0.03), 0.99 + hinge, z - cd * 0.29, 0.017, 0.075, cd * 0.045, "#ffad38");
      }
      add(x, 0.95, z - cd / 2 - 0.007, cw * 0.84, 1.17, 0.018, DATA_CENTER.recessed);
      for (let vent = 0; vent < 6; vent++)
        add(x, 0.58 + vent * 0.13, z - cd / 2 - 0.022, cw * 0.62, 0.024, 0.012, "#ffbe6b");
      // A roof fan housing and cooling grille break up the long top surface.
      add(x, 1.72, z, cw * 0.55, 0.08, cd * 0.62);
      for (let vent = 0; vent < 4; vent++)
        add(x, 1.765, z + (vent - 1.5) * cd * 0.11, cw * 0.43, 0.012, cd * 0.05, "#ffbe6b");
    }
    add(0.3, 0.29, 0.43, 0.15, 0.24, 0.11, "#ffba47");
  } else if (kind === "gantry") {
    add(0, 0.32, 0, 0.9, 0.18, 0.46, DATA_CENTER.surface);
    for (const x of [-0.36, 0.36]) {
      add(x, 1.02, 0, 0.075, 1.7, 0.18, DATA_CENTER.surface);
      add(x, 0.2, 0, 0.21, 0.1, 0.64, "#edf3ff");
    }
    add(0, 1.88, 0, 0.93, 0.14, 0.23, "#ffac36");
    add(0.1, 1.49, 0, 0.022, 0.66, 0.024, "#ff852b");
    add(0.1, 1.03, 0, 0.22, 0.28, 0.24, "#ffba47");
    for (let i = 0; i < 3; i++)
      add(-0.27 + i * 0.27, 0.62, 0.03, 0.19, 0.3, 0.26, i === 1 ? "#ffac36" : DATA_CENTER.surface);
    for (const x of [-0.36, 0.36]) {
      add(x, 0.25, 0, 0.15, 0.06, 0.32, "#ffad38");
      for (const z of [-0.11, 0.11])
        add(x, 0.29, z, 0.03, 0.025, 0.03, DATA_CENTER.surface, "cylinder");
      add(x, 1.07, 0.105, 0.1, 1.55, 0.025, "#ffad38");
    }
    add(0, 1.68, 0.02, 0.9, 0.055, 0.065, "#ffad38");
    for (let i = 0; i < 4; i++) {
      const a = -0.4 + i * 0.2;
      beam([a, 1.7, 0.05], [a + 0.1, 1.84, 0.05], 0.018, "#ffad38");
      beam([a + 0.1, 1.84, 0.05], [a + 0.2, 1.7, 0.05], 0.018, "#ffad38");
    }
    add(0.1, 1.75, 0, 0.17, 0.09, 0.2);
    add(0.1, 1.04, 0, 0.1, 0.035, 0.31, "#fff5df");
    add(-0.31, 0.82, 0.14, 0.15, 0.21, 0.07);
    add(-0.31, 0.85, 0.182, 0.1, 0.09, 0.015, DATA_CENTER.paleBlue);
    add(-0.29, 0.75, 0.185, 0.025, 0.025, 0.018, "#ff852b");
  } else {
    for (const x of [-0.23, 0.23])
      for (const z of [-0.23, 0.23])
        add(x, 1.06, z, 0.052, 1.85, 0.052, DATA_CENTER.surface);
    add(0, 1.98, 0, 0.73, 0.11, 0.73, "#ffac36");
    add(0, 2.25, 0, 0.53, 0.44, 0.53, DATA_CENTER.surface);
    add(0, 2.27, 0.274, 0.39, 0.23, 0.015, "#edf3ff");
    parts[parts.length - 1]!.edge = DATA_CENTER.blue;
    add(0, 2.52, 0, 0.71, 0.09, 0.71, "#fff5e5");
    add(0, 2.7, 0, 0.022, 0.27, 0.022, "#ff852b");
    add(0, 2.85, 0, 0.13, 0.07, 0.13, "#ffae38", "cylinder");
    for (let i = 0; i < 6; i++)
      add(0, 0.35 + i * 0.24, 0.254, 0.26, 0.02, 0.026, DATA_CENTER.surface);
    for (const side of [-1, 1]) {
      add(side * 0.14, 1.0, 0.26, 0.024, 1.52, 0.024, "#ffad38");
      for (const z of [-0.23, 0.23])
        add(side * 0.23, 0.24, z, 0.13, 0.08, 0.13, "#ffad38");
      beam([-0.23, 0.45, side * 0.23], [0.23, 1.8, side * 0.23], 0.025, "#ffad38");
      add(side * 0.274, 2.27, 0, 0.018, 0.23, 0.39, DATA_CENTER.paleBlue);
      add(0, 2.27, side * 0.28, 0.02, 0.24, 0.025, "#ffad38");
      add(side * 0.28, 2.27, 0, 0.025, 0.24, 0.02, "#ffad38");
      for (const z of [-0.34, 0.34])
        add(side * 0.34, 2.14, z, 0.018, 0.24, 0.018);
      add(0, 2.26, side * 0.34, 0.7, 0.022, 0.022);
      add(side * 0.34, 2.26, 0, 0.022, 0.022, 0.7);
    }
    add(0, 2.27, -0.275, 0.39, 0.23, 0.018, DATA_CENTER.paleBlue);
    add(0.14, 2.59, -0.09, 0.16, 0.06, 0.25, "#ffad38");
    for (let i = 0; i < 3; i++)
      add(0.14, 2.625, -0.16 + i * 0.07, 0.13, 0.012, 0.025, DATA_CENTER.surface);

  }
  return parts;
}

const glyphCircle = (rx: number, ry: number) =>
  Array.from({ length: 65 }, (_, i): [number, number, number] => {
    const angle = i / 64 * Math.PI * 2;
    return [Math.cos(angle) * rx, Math.sin(angle) * ry, 0.018];
  });
const globeGlyph = [glyphCircle(0.25, 0.25), glyphCircle(0.11, 0.25), glyphCircle(0.25, 0.085)];

function InternetGlobe({ service, dimmed }: { service: InfrastructureService; dimmed: boolean }) {
  const [x, , z] = serviceWorldCenter(service);
  const radius = Math.min(0.6, Math.min(service.width, service.depth) * 0.36);
  const rings = useMemo(() => {
    const out: [number, number, number][][] = [];
    for (const latitude of [-Math.PI / 6, 0, Math.PI / 6]) {
      out.push(Array.from({ length: 65 }, (_, i) => {
        const angle = i / 64 * Math.PI * 2;
        return [Math.cos(angle) * Math.cos(latitude), Math.sin(latitude), Math.sin(angle) * Math.cos(latitude)];
      }));
    }
    for (let meridian = 0; meridian < 4; meridian++) {
      const longitude = meridian / 4 * Math.PI;
      out.push(Array.from({ length: 65 }, (_, i) => {
        const angle = i / 64 * Math.PI * 2;
        return [Math.cos(angle) * Math.cos(longitude), Math.sin(angle), Math.cos(angle) * Math.sin(longitude)];
      }));
    }
    return out;
  }, []);
  return (
    <group position={[x, 0.46 + radius, z]} rotation={[0, 0, Math.PI / 12]} scale={radius}>
      <mesh scale={1.012}>
        <sphereGeometry args={[1, 40, 24]} />
        <meshBasicMaterial color={dimmed ? "#ffe6d5" : DATA_CENTER.integration} side={THREE.BackSide} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1, 40, 24]} />
        <meshBasicMaterial color={DATA_CENTER.surface} toneMapped={false} />
      </mesh>
      {rings.map((points, i) => (
        <Line key={i} points={points} scale={1.006} color={dimmed ? "#ffe6d5" : DATA_CENTER.integration} lineWidth={1.65} toneMapped={false} />
      ))}
    </group>
  );
}

function HologramIcon({ type, dimmed }: { type: string; dimmed: boolean }) {
  const [asset, setAsset] = useState<{
    type: string;
    geometry: THREE.BufferGeometry;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let loaded: THREE.BufferGeometry | null = null;
    void loadAssetsGlb()
      .then((library) => {
        const source = library.get(type);
        if (!source) return;
        const geometry = source.clone();
        if (cancelled) {
          geometry.dispose();
          return;
        }
        geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        geometry.boundingBox!.getSize(size);
        geometry.center();
        geometry.scale(
          1 / Math.max(size.x, size.y, 0.001),
          1 / Math.max(size.x, size.y, 0.001),
          1,
        );
        loaded = geometry;
        setAsset({ type, geometry });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loaded?.dispose();
    };
  }, [type]);
  if (type === "cloud" || /eventbridge|sqs|queue/.test(type)) {
    return (
      <group>
        <mesh position={[0, 0, 0.014]}>
          <planeGeometry args={[0.6, 0.6]} />
          <meshBasicMaterial color={DATA_CENTER.integration} transparent opacity={dimmed ? 0.2 : 1} toneMapped={false} />
        </mesh>
        {type === "cloud" ? globeGlyph.map((points, i) => (
          <Line key={i} points={points} color="#ffffff" lineWidth={1.7} transparent opacity={dimmed ? 0.2 : 1} toneMapped={false} />
        )) : /eventbridge/.test(type) ? (
          <>
            <Line points={[[-0.2, 0.18, 0.018], [0, 0, 0.018], [0.2, 0.18, 0.018]]} color="#ffffff" lineWidth={2} />
            <Line points={[[-0.2, -0.18, 0.018], [0, 0, 0.018], [0.2, -0.18, 0.018]]} color="#ffffff" lineWidth={2} />
            {[[0, 0], [-0.2, 0.18], [0.2, 0.18], [-0.2, -0.18], [0.2, -0.18]].map(([x, y], i) => (
              <mesh key={i} position={[x, y, 0.02]}>
                <planeGeometry args={[0.07, 0.07]} />
                <meshBasicMaterial color="#ffffff" toneMapped={false} />
              </mesh>
            ))}
          </>
        ) : [0.16, 0, -0.16].map((y, i) => (
          <Line key={i} points={[[-0.19, y + 0.05, 0.018], [0.19, y + 0.05, 0.018], [0.19, y - 0.05, 0.018], [-0.19, y - 0.05, 0.018], [-0.19, y + 0.05, 0.018]]} color="#ffffff" lineWidth={1.7} />
        ))}
      </group>
    );
  }
  if (!asset || asset.type !== type) {
    const label = /eventbridge/.test(type)
      ? "BUS"
      : type === "cloud"
        ? "NET"
        : type.split(/[-_]/).at(-1)!.slice(0, 4).toUpperCase();
    return (
      <Text fontSize={0.15} color={DATA_CENTER.ink} fillOpacity={dimmed ? 0.2 : 1} position={[0, 0, 0.014]}>
        {label}
      </Text>
    );
  }
  return (
    <mesh geometry={asset.geometry} scale={0.58} position={[0, 0, 0.014]}>
      <meshBasicMaterial
        vertexColors
        transparent
        opacity={dimmed ? 0.2 : 1}
        toneMapped={false}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

type TextMetrics = { height: number; center: number };
type SyncedText = { textRenderInfo?: { visibleBounds?: ArrayLike<number> } };

function HologramText({ name, type, width, accent, dimmed }: { name: string; type: string; width: number; accent: string; dimmed: boolean }) {
  const lines = clampServiceLabelLines(name, width, 0.24, 2);
  const [typeMetrics, setTypeMetrics] = useState<TextMetrics>({ height: 0.12, center: 0 });
  const [nameMetrics, setNameMetrics] = useState<TextMetrics>({ height: lines.length * 0.24, center: 0 });
  const measureType = useCallback((mesh: SyncedText) => {
    const bounds = mesh.textRenderInfo?.visibleBounds;
    if (!bounds) return;
    const height = bounds[3]! - bounds[1]!;
    const center = (bounds[3]! + bounds[1]!) / 2;
    setTypeMetrics(prev => prev.height === height && prev.center === center ? prev : { height, center });
  }, []);
  const measureName = useCallback((mesh: SyncedText) => {
    const bounds = mesh.textRenderInfo?.visibleBounds;
    if (!bounds) return;
    const height = bounds[3]! - bounds[1]!;
    const center = (bounds[3]! + bounds[1]!) / 2;
    setNameMetrics(prev => prev.height === height && prev.center === center ? prev : { height, center });
  }, []);
  const gap = 0.075;
  // Center the actual glyph bounds of the two-line block against the icon.
  return (
    <group>
      <Text position={[0, (nameMetrics.height + gap) / 2 - typeMetrics.center, 0]}
        fontSize={0.12} color={accent} fillOpacity={dimmed ? 0.2 : 1}
        anchorX="left" anchorY="middle" textAlign="left" whiteSpace="nowrap" onSync={measureType}>
        {clampServiceLabelLines(type === "cloud" ? "Network" : type, width, 0.12, 1)[0]}
      </Text>
      <Text position={[0, -(typeMetrics.height + gap) / 2 - nameMetrics.center, 0]}
        fontSize={0.24} lineHeight={1.18} color={DATA_CENTER.ink} fillOpacity={dimmed ? 0.2 : 1}
        anchorX="left" anchorY="middle" textAlign="left" whiteSpace="nowrap" onSync={measureName}>
        {lines.join("\n")}
      </Text>
    </group>
  );
}

export function ServiceHologram({
  service,
  dimmed = false,
  onSelect,
}: {
  service: InfrastructureService;
  dimmed?: boolean;
  onSelect: (id: string) => void;
}) {
  const kind = buildingKind(service);
  const accent = buildingAccent(kind);
  const [x, , z] = serviceWorldCenter(service);
  const width = Math.max(3.5, Math.min(4.1, service.width + 0.85));
  const textWidth = width - 1.08;
  return (
    <Billboard position={[x, buildingHeight(kind) + 1.15 + hologramLift(service), z]}>
      <group
        onClick={(event) => {
          event.stopPropagation();
          onSelect(service.id);
        }}
      >
        <mesh>
          <planeGeometry args={[width, 0.86]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={dimmed ? 0.2 : 0.88}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
        <mesh position={[0, 0.43, 0.002]}>
          <planeGeometry args={[width, 0.023]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={dimmed ? 0.2 : 1}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, -0.43, 0.002]}>
          <planeGeometry args={[width, 0.023]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={dimmed ? 0.2 : 1}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[-width / 2 + 0.02, 0, 0.002]}>
          <planeGeometry args={[0.023, 0.86]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={dimmed ? 0.2 : 1}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[width / 2 - 0.02, 0, 0.002]}>
          <planeGeometry args={[0.023, 0.86]} />
          <meshBasicMaterial
            color={accent}
            transparent
            opacity={dimmed ? 0.2 : 1}
            toneMapped={false}
          />
        </mesh>
        <group position={[-width / 2 + 0.47, 0, 0.012]}>
          <mesh>
            <planeGeometry args={[0.64, 0.64]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={dimmed ? 0.2 : 1}
              toneMapped={false}
            />
          </mesh>
          <HologramIcon type={service.type} dimmed={dimmed} />
        </group>
        <group position={[-width / 2 + 0.94, 0, 0.012]}>
          <HologramText key={`${service.type}:${service.name}`} name={service.name} type={service.type} width={textWidth} accent={accent} dimmed={dimmed} />
        </group>
      </group>
    </Billboard>
  );
}

export function DataCenterBuildings({
  services,
  relevantIds,
  onSelect,
}: {
  services: InfrastructureService[];
  relevantIds: Set<string> | null;
  onSelect: (id: string) => void;
}) {
  const parts = useMemo(
    () =>
      services.flatMap((service) =>
        serviceParts(
          service,
          relevantIds != null && !relevantIds.has(service.id),
        ),
      ),
    [services, relevantIds],
  );
  return (
    <group>
      <CampusGeometry parts={parts} />
      {services.map((service) => (
        <group key={service.id}>
          {buildingKind(service) === "gateway" && (
            <InternetGlobe service={service} dimmed={relevantIds != null && !relevantIds.has(service.id)} />
          )}
          <ServiceHologram
            service={service}
            dimmed={relevantIds != null && !relevantIds.has(service.id)}
            onSelect={onSelect}
          />
        </group>
      ))}
    </group>
  );
}

export function DataCenterLots({
  platforms,
  services,
}: {
  platforms: PackLayoutResult["platforms"];
  services: InfrastructureService[];
}) {
  const lots = useMemo(() => dataCenterLotFootprints(platforms, services), [platforms, services]);
  const parts = useMemo(
    () =>
      lots.flatMap((lot): CampusPart[] => {
        const { centerX: x, centerZ: z, width: w, depth: d } = lot;
        const out: CampusPart[] = [
          {
            position: [x, -0.07, z],
            size: [w, 0.04, d],
            color: "#ffffff",
            edge: "#c6d9ff",
          },
        ];
        // Sparse white fence rails and blue outlines keep the silhouette light.
        for (const side of [-1, 1]) {
          out.push({ position: [x, 0.25, z + side * d / 2], size: [w, 0.035, 0.035], color: "#ffffff", edge: DATA_CENTER.blue });
          out.push({ position: [x + side * w / 2, 0.25, z], size: [0.035, 0.035, d], color: "#ffffff", edge: DATA_CENTER.blue });
          const nx = Math.min(16, Math.max(2, Math.ceil(w / 2.5)));
          const nz = Math.min(16, Math.max(2, Math.ceil(d / 2.5)));
          for (let i = 0; i <= nx; i++)
            out.push({ position: [x - w / 2 + w * i / nx, 0.15, z + side * d / 2], size: [0.045, 0.32, 0.045], color: "#ffffff", edge: DATA_CENTER.blue });
          for (let i = 0; i <= nz; i++)
            out.push({ position: [x + side * w / 2, 0.15, z - d / 2 + d * i / nz], size: [0.045, 0.32, 0.045], color: "#ffffff", edge: DATA_CENTER.blue });
        }
        return out;
      }),
    [lots],
  );
  return (
    <group>
      <CampusGeometry parts={parts} />
      {lots.map((lot) => (
        <group
          key={lot.group ?? lot.id}
          position={[
            lot.centerX - lot.width / 2 + 0.2,
            0.015,
            lot.centerZ - lot.depth / 2 + 0.28,
          ]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <Text
            fontSize={0.18}
            color={DATA_CENTER.ink}
            anchorX="left"
            anchorY="top"
            maxWidth={Math.max(0.5, lot.width - 0.4)}
          >
            {lot.group}
          </Text>
        </group>
      ))}
    </group>
  );
}
