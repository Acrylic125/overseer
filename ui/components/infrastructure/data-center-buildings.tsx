"use client";

import { Billboard, Line, Text } from "@react-three/drei";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import * as THREE from "three";

import { ACCESS_ROTATION, ACCESS_SIDES, serviceAccessPorts, type AccessSide } from "@/lib/data-center-access";
import { fenceSpans } from "@/lib/data-center-fences";
import type { ConnectorPath } from "@/lib/graph/connector-paths";

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
  paths: ConnectorPath[],
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
  const access = serviceAccessPorts(service, paths);
  const faceDimensions = (side: AccessSide) => side === "north" || side === "south"
    ? { span: w, depth: d } : { span: d, depth: w };
  // Local x runs across the wall; local z points into the building.
  const facePart = (side: AccessSide, u: number, y: number, inset: number, width: number, height: number, depth: number, color: string = DATA_CENTER.surface, yaw = 0) => {
    const angle = ACCESS_ROTATION[side];
    const v = inset - faceDimensions(side).depth / 2;
    parts.push({
      position: [cx + Math.cos(angle) * u + Math.sin(angle) * v, y, cz - Math.sin(angle) * u + Math.cos(angle) * v],
      size: [width, height, depth], rotation: [0, angle + yaw, 0],
      color, edge: accent, dimmed,
    });
  };
  // Unlit ivory housings and amber fittings keep the equipment silhouettes clear.
  add(0, 0.045, 0, 0.96, 0.08, 0.96, DATA_CENTER.surface);
  if (kind === "gateway") {
    add(0, 0.23, 0, 0.64, 0.14, 0.64, DATA_CENTER.amber, "cylinder");
    add(0, 0.34, 0, 0.43, 0.08, 0.43, DATA_CENTER.surface, "cylinder");
    add(0, 0.42, 0, 0.14, 0.12, 0.14, DATA_CENTER.amber, "cylinder");
  } else if (kind === "gate") {
    // Complete swing leaves fold inward beside each connected access lane.
    const entrances = access.size ? access : new Map<AccessSide, number[]>([["south", [0]]]);
    for (const [side, offsets] of entrances) {
      const { span } = faceDimensions(side);
      const center = (Math.min(...offsets) + Math.max(...offsets)) / 2;
      const half = Math.max(0.32, (Math.max(...offsets) - Math.min(...offsets)) / 2 + 0.27);
      const left = Math.max(-span / 2 + 0.045, center - half);
      const right = Math.min(span / 2 - 0.045, center + half);
      for (const [u, sign] of [[left, 1], [right, -1]]) {
        facePart(side, u, 0.59, 0.08, 0.07, 1.0, 0.09, "#ffffff");
        facePart(side, u, 1.11, 0.08, 0.09, 0.045, 0.11, DATA_CENTER.amber);
        // Near-90-degree opening keeps even narrow conveyor lanes unobstructed.
        const angle = -sign * Math.PI / 2;
        const leafWidth = Math.min(0.34, (right - left) * 0.44);
        const centerInset = 0.08 + leafWidth / 2;
        facePart(side, u, 0.58, centerInset, leafWidth, 0.78, 0.035, DATA_CENTER.panel, angle);
        for (const y of [0.19, 0.97])
          facePart(side, u, y, centerInset, leafWidth + 0.035, 0.04, 0.05, DATA_CENTER.amber, angle);
        for (const inset of [0.08, 0.08 + leafWidth])
          facePart(side, u, 0.58, inset, 0.035, 0.8, 0.05, DATA_CENTER.surface, angle);
        for (let i = 1; i < 4; i++)
          facePart(side, u, 0.58, 0.08 + leafWidth * i / 4, 0.018, 0.69, 0.045, DATA_CENTER.surface, angle);
      }
      facePart(side, left, 0.74, 0.015, 0.095, 0.17, 0.045, "#ffffff");
      facePart(side, left, 0.77, -0.011, 0.045, 0.06, 0.012, DATA_CENTER.integration);
    }
  } else if (kind === "warehouse") {
    // Hollow walls and raised shutters let conveyors enter from every connected side.
    add(0, 1.54, 0, 1.02, 0.32, 1.02, DATA_CENTER.surface, "roof");
    add(0, 1.715, 0, 0.025, 0.03, 1.04, DATA_CENTER.amber);
    for (const side of ACCESS_SIDES) {
      const { span } = faceDimensions(side);
      const ports = access.get(side);
      if (!ports?.length) {
        facePart(side, 0, 0.73, 0.025, span, 1.28, 0.05);
        facePart(side, 0, 1.1, -0.005, span * 0.54, 0.16, 0.012, DATA_CENTER.panel);
        continue;
      }
      const left = Math.max(-span / 2, Math.min(...ports) - 0.24);
      const right = Math.min(span / 2, Math.max(...ports) + 0.24);
      // Only build masonry beside the opening, never a solid box behind the door.
      for (const [a, b] of [[-span / 2, left], [right, span / 2]]) {
        if (b - a > 0.015) facePart(side, (a + b) / 2, 0.73, 0.025, b - a, 1.28, 0.05);
      }
      const center = (left + right) / 2;
      const width = right - left;
      facePart(side, center, 1.29, 0.025, width, 0.16, 0.05);
      // The roller shutter is gathered above the clear doorway.
      facePart(side, center, 1.17, -0.005, width, 0.2, 0.075, DATA_CENTER.panel);
      for (let i = 0; i < 4; i++)
        facePart(side, center, 1.095 + i * 0.045, -0.047, width, 0.01, 0.008, DATA_CENTER.amber);
      facePart(side, center, 1.32, 0.015, width + 0.025, 0.055, 0.13, DATA_CENTER.amber);
      facePart(side, center, 0.11, 0.025, width, 0.025, 0.13, DATA_CENTER.panel);
    }
  } else if (kind === "database") {
    add(0, 0.27, 0, 0.84, 0.16, 0.84, DATA_CENTER.amber);
    // Three broad drums give the database its familiar stacked silhouette.
    for (let i = 0; i < 3; i++) {
      const y = 0.58 + i * 0.43;
      add(0, y, 0, 0.72, 0.37, 0.72, "#ffffff", "cylinder");
      add(0, y - 0.18, 0, 0.75, 0.045, 0.75, DATA_CENTER.panel, "cylinder");
      add(-0.16, y, 0.325, 0.055, 0.065, 0.035, DATA_CENTER.integration);
      add(0.09, y, 0.36, 0.16, 0.025, 0.012, DATA_CENTER.amber);
    }
    add(0, 1.66, 0, 0.75, 0.07, 0.75, DATA_CENTER.amber, "cylinder");
    add(0, 1.702, 0, 0.61, 0.018, 0.61, DATA_CENTER.surface, "cylinder");
  } else if (kind === "rack") {
    const columns = Math.min(6, Math.max(1, Math.floor(w)));
    const rows = Math.min(4, Math.max(1, Math.ceil(d / 1.6)));
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const x = ((col + 0.5) / columns - 0.5) * 0.84;
      const z = ((row + 0.5) / rows - 0.5) * 0.8;
      const cw = 0.72 / columns;
      const cd = 0.7 / rows;
      add(x, 0.25, z, cw + 0.04, 0.12, cd + 0.04, DATA_CENTER.amber);
      add(x, 0.99, z, cw, 1.36, cd, "#ffffff");
      add(x, 1.7, z, cw + 0.04, 0.08, cd + 0.04, DATA_CENTER.amber);
      add(x, 0.99, z + cd / 2 + 0.008, cw * 0.84, 1.17, 0.025, DATA_CENTER.recessed);
      // Four generous trays remain legible at overview scale.
      for (let slot = 0; slot < 4; slot++) {
        const y = 0.55 + slot * 0.29;
        add(x, y, z + cd / 2 + 0.03, cw * 0.72, 0.22, 0.035);
        add(x - cw * 0.12, y, z + cd / 2 + 0.05, cw * 0.33, 0.026, 0.012, DATA_CENTER.amber);
        add(x + cw * 0.24, y, z + cd / 2 + 0.052, cw * 0.06, 0.045, 0.014, DATA_CENTER.integration);
      }
      for (const side of [-1, 1]) {
        add(x + side * (cw / 2 + 0.005), 1.0, z, 0.012, 0.96, cd * 0.7, DATA_CENTER.surface);
        for (let vent = 0; vent < 3; vent++)
          add(x + side * (cw / 2 + 0.015), 1.13 + vent * 0.12, z, 0.009, 0.026, cd * 0.43, DATA_CENTER.amber);
      }
      add(x, 1.755, z, cw * 0.6, 0.03, cd * 0.6, DATA_CENTER.surface);
    }
  } else if (kind === "gantry") {
    add(0, 0.32, 0, 0.9, 0.18, 0.46, DATA_CENTER.surface);
    for (const x of [-0.36, 0.36]) {
      add(x, 1.02, 0, 0.075, 1.7, 0.18, DATA_CENTER.surface);
      add(x, 0.2, 0, 0.21, 0.1, 0.64, DATA_CENTER.panel);
    }
    add(0, 1.88, 0, 0.93, 0.14, 0.23, DATA_CENTER.amber);
    add(0.1, 1.49, 0, 0.022, 0.66, 0.024, "#ff852b");
    add(0.1, 1.03, 0, 0.22, 0.28, 0.24, DATA_CENTER.amber);
    for (let i = 0; i < 3; i++)
      add(-0.27 + i * 0.27, 0.62, 0.03, 0.19, 0.3, 0.26, i === 1 ? DATA_CENTER.amber : DATA_CENTER.surface);
    for (const x of [-0.36, 0.36]) {
      add(x, 0.25, 0, 0.15, 0.06, 0.32, DATA_CENTER.amber);
      for (const z of [-0.11, 0.11])
        add(x, 0.29, z, 0.03, 0.025, 0.03, DATA_CENTER.surface, "cylinder");
      add(x, 1.07, 0.105, 0.1, 1.55, 0.025, DATA_CENTER.amber);
    }
    add(0, 1.68, 0.02, 0.9, 0.055, 0.065, DATA_CENTER.amber);
    for (let i = 0; i < 4; i++) {
      const a = -0.4 + i * 0.2;
      beam([a, 1.7, 0.05], [a + 0.1, 1.84, 0.05], 0.018, DATA_CENTER.amber);
      beam([a + 0.1, 1.84, 0.05], [a + 0.2, 1.7, 0.05], 0.018, DATA_CENTER.amber);
    }
    add(0.1, 1.75, 0, 0.17, 0.09, 0.2);
    add(0.1, 1.04, 0, 0.1, 0.035, 0.31, "#fff5df");
    add(-0.31, 0.82, 0.14, 0.15, 0.21, 0.07);
    add(-0.31, 0.85, 0.182, 0.1, 0.09, 0.015, DATA_CENTER.panel);
    add(-0.29, 0.75, 0.185, 0.025, 0.025, 0.018, "#ff852b");
  } else {
    for (const x of [-0.23, 0.23])
      for (const z of [-0.23, 0.23])
        add(x, 1.06, z, 0.052, 1.85, 0.052, DATA_CENTER.surface);
    add(0, 1.98, 0, 0.73, 0.11, 0.73, DATA_CENTER.amber);
    add(0, 2.25, 0, 0.53, 0.44, 0.53, DATA_CENTER.surface);
    add(0, 2.27, 0.274, 0.39, 0.23, 0.015, DATA_CENTER.panel);
    parts[parts.length - 1]!.edge = DATA_CENTER.fitting;
    add(0, 2.52, 0, 0.71, 0.09, 0.71, "#fff5e5");
    add(0, 2.7, 0, 0.022, 0.27, 0.022, "#ff852b");
    add(0, 2.85, 0, 0.13, 0.07, 0.13, DATA_CENTER.amber, "cylinder");
    for (let i = 0; i < 6; i++)
      add(0, 0.35 + i * 0.24, 0.254, 0.26, 0.02, 0.026, DATA_CENTER.surface);
    for (const side of [-1, 1]) {
      add(side * 0.14, 1.0, 0.26, 0.024, 1.52, 0.024, DATA_CENTER.amber);
      for (const z of [-0.23, 0.23])
        add(side * 0.23, 0.24, z, 0.13, 0.08, 0.13, DATA_CENTER.amber);
      beam([-0.23, 0.45, side * 0.23], [0.23, 1.8, side * 0.23], 0.025, DATA_CENTER.amber);
      add(side * 0.274, 2.27, 0, 0.018, 0.23, 0.39, DATA_CENTER.panel);
      add(0, 2.27, side * 0.28, 0.02, 0.24, 0.025, DATA_CENTER.amber);
      add(side * 0.28, 2.27, 0, 0.025, 0.24, 0.02, DATA_CENTER.amber);
      for (const z of [-0.34, 0.34])
        add(side * 0.34, 2.14, z, 0.018, 0.24, 0.018);
      add(0, 2.26, side * 0.34, 0.7, 0.022, 0.022);
      add(side * 0.34, 2.26, 0, 0.022, 0.022, 0.7);
    }
    add(0, 2.27, -0.275, 0.39, 0.23, 0.018, DATA_CENTER.panel);
    add(0.14, 2.59, -0.09, 0.16, 0.06, 0.25, DATA_CENTER.amber);
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
    return out.flatMap(ring => ring.slice(1).flatMap((point, i) => [ring[i]!, point]));
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
      <Line segments points={rings} scale={1.006} color={dimmed ? "#ffe6d5" : DATA_CENTER.integration} lineWidth={1.65} toneMapped={false} />
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

export const ServiceHologram = memo(function ServiceHologram({
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
  const border = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-width / 2, -0.4415);
    shape.lineTo(width / 2, -0.4415);
    shape.lineTo(width / 2, 0.4415);
    shape.lineTo(-width / 2, 0.4415);
    shape.closePath();
    const hole = new THREE.Path();
    hole.moveTo(-width / 2 + 0.0315, -0.4185);
    hole.lineTo(-width / 2 + 0.0315, 0.4185);
    hole.lineTo(width / 2 - 0.0315, 0.4185);
    hole.lineTo(width / 2 - 0.0315, -0.4185);
    hole.closePath();
    shape.holes.push(hole);
    return new THREE.ShapeGeometry(shape);
  }, [width]);
  useEffect(() => () => border.dispose(), [border]);
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
        <mesh geometry={border} position={[0, 0, 0.002]}>
          <meshBasicMaterial color={accent} transparent opacity={dimmed ? 0.2 : 1} toneMapped={false} />
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
});

export const DataCenterBuildings = memo(function DataCenterBuildings({
  services,
  paths,
  relevantIds,
  onSelect,
}: {
  services: InfrastructureService[];
  paths: ConnectorPath[];
  relevantIds: Set<string> | null;
  onSelect: (id: string) => void;
}) {
  const parts = useMemo(
    () =>
      services.flatMap((service) =>
        serviceParts(
          service,
          relevantIds != null && !relevantIds.has(service.id),
          paths,
        ),
      ),
    [services, relevantIds, paths],
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
});

export const DataCenterLots = memo(function DataCenterLots({
  platforms,
  services,
  paths,
}: {
  paths: ConnectorPath[];
  platforms: PackLayoutResult["platforms"];
  services: InfrastructureService[];
}) {
  const lots = useMemo(() => dataCenterLotFootprints(platforms, services), [platforms, services]);
  const parts = useMemo(
    () =>
      lots.flatMap((lot): CampusPart[] => {
        const { centerX: x, centerZ: z, width: w, depth: d } = lot;
        const out: CampusPart[] = [
          // A sand-colored plinth separates the ivory campus floor from the white world.
          {
            position: [x, -0.22, z],
            size: [w, 0.34, d],
            color: DATA_CENTER.platformSide,
            edge: DATA_CENTER.compute,
          },
          {
            position: [x, -0.045, z],
            size: [w - 0.12, 0.01, d - 0.12],
            color: DATA_CENTER.platform,
            edge: DATA_CENTER.platformEdge,
          },
        ];
        // Split both rails and their posts at actual conveyor crossings.
        for (const side of [-1, 1]) {
          for (const axis of ["x", "z"] as const) {
            const fixed = axis === "x" ? z + side * d / 2 : x + side * w / 2;
            const center = axis === "x" ? x : z;
            const length = axis === "x" ? w : d;
            for (const [a, b] of fenceSpans(center - length / 2, center + length / 2, fixed, axis, paths)) {
              for (const y of [0.13, 0.34])
                out.push({ position: axis === "x" ? [(a + b) / 2, y, fixed] : [fixed, y, (a + b) / 2], size: axis === "x" ? [b - a, 0.035, 0.035] : [0.035, 0.035, b - a], color: "#ffffff", edge: DATA_CENTER.platformEdge });
              const count = Math.min(20, Math.max(1, Math.ceil((b - a) / 1.8)));
              for (let i = 0; i <= count; i++) {
                const along = a + (b - a) * i / count;
                out.push({ position: axis === "x" ? [along, 0.18, fixed] : [fixed, 0.18, along], size: [0.055, 0.44, 0.055], color: "#ffffff", edge: DATA_CENTER.platformEdge });
              }
            }
          }
        }
        return out;
      }),
    [lots, paths],
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
            fontSize={0.23}
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
});
