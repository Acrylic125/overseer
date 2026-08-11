"use client";

import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { SCENE } from "@/lib/infrastructure-styles";
import { INTERNET_ID } from "@/lib/internet";
import type { InfrastructureService } from "@/server/routers/infrastructure";

export type ConnectorFocus = {
  pathId: string;
  sourceId: string;
  targetId: string;
  labels?: [string | null, string | null];
  variant?: "default" | "warning";
  clientX: number;
  clientY: number;
  worldX: number;
  worldZ: number;
  pinned: boolean;
};

type ConnectorCalloutProps = {
  focus: ConnectorFocus;
  servicesById: Map<string, InfrastructureService>;
  hubService: InfrastructureService;
  camera: THREE.Camera;
  canvas: HTMLCanvasElement;
};

type ScreenPt = { x: number; y: number };

const PERP_OFFSET = 56;
const ALONG_OFFSET = 36;
const MIN_LABEL_SEPARATION = 140;

const _world = new THREE.Vector3();

/** Project world XZ into canvas-local pixel coordinates (0…width, 0…height). */
function projectWorldLocal(
  x: number,
  z: number,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenPt | null {
  _world.set(x, 0, z);
  _world.project(camera);
  if (_world.z > 1) return null;
  return {
    x: ((_world.x + 1) / 2) * width,
    y: ((1 - _world.y) / 2) * height,
  };
}


/** Place a label beside the connector, offset perpendicular to the line. */
function labelBesideConnector(
  anchor: ScreenPt,
  toward: ScreenPt,
  sourceScreen: ScreenPt,
  targetScreen: ScreenPt,
  side: 1 | -1,
): ScreenPt {
  const cdx = targetScreen.x - sourceScreen.x;
  const cdy = targetScreen.y - sourceScreen.y;
  const clen = Math.hypot(cdx, cdy) || 1;
  const px = (-cdy / clen) * side;
  const py = (cdx / clen) * side;

  const tdx = toward.x - anchor.x;
  const tdy = toward.y - anchor.y;
  const tlen = Math.hypot(tdx, tdy) || 1;

  return {
    x: anchor.x + px * PERP_OFFSET + (tdx / tlen) * ALONG_OFFSET,
    y: anchor.y + py * PERP_OFFSET + (tdy / tlen) * ALONG_OFFSET,
  };
}

function separateLabels(a: ScreenPt, b: ScreenPt): [ScreenPt, ScreenPt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= MIN_LABEL_SEPARATION) return [a, b];

  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if (dist < 1e-3) {
    return [
      { x: mx - MIN_LABEL_SEPARATION / 2, y: my },
      { x: mx + MIN_LABEL_SEPARATION / 2, y: my },
    ];
  }

  const ux = dx / dist;
  const uy = dy / dist;
  return [
    {
      x: mx - (ux * MIN_LABEL_SEPARATION) / 2,
      y: my - (uy * MIN_LABEL_SEPARATION) / 2,
    },
    {
      x: mx + (ux * MIN_LABEL_SEPARATION) / 2,
      y: my + (uy * MIN_LABEL_SEPARATION) / 2,
    },
  ];
}

function elbowPath(label: ScreenPt, anchor: ScreenPt): string {
  const dx = Math.abs(anchor.x - label.x);
  const dy = Math.abs(anchor.y - label.y);
  if (dx >= dy) {
    return `M ${label.x} ${label.y} L ${anchor.x} ${label.y} L ${anchor.x} ${anchor.y}`;
  }
  return `M ${label.x} ${label.y} L ${label.x} ${anchor.y} L ${anchor.x} ${anchor.y}`;
}

function serviceForEndpoint(
  id: string,
  servicesById: Map<string, InfrastructureService>,
  hubService: InfrastructureService,
): InfrastructureService {
  if (id === INTERNET_ID) return hubService;
  const found = servicesById.get(id);
  if (found) return found;
  return {
    id,
    type: "unknown",
    name: id,
    x: 0,
    y: 0,
    width: 1,
    depth: 1,
    group: "",
    connections: [],
    species: "microservice",
    category: "compute",
    health: "healthy",
    zone: "compute",
    metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
    color: "#111827",
    fields: {},
  };
}

function serviceName(
  id: string,
  servicesById: Map<string, InfrastructureService>,
  hubService: InfrastructureService,
): string {
  if (id === INTERNET_ID) return hubService.name;
  return servicesById.get(id)?.name ?? id;
}

function EndpointLabel({
  fromName,
  toName,
  label,
  side,
  x,
  y,
}: {
  fromName: string;
  toName: string;
  label: string;
  side: "source" | "target";
  x: number;
  y: number;
}) {
  return (
    <div
      className="absolute w-max max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-white/20 bg-black/85 px-2.5 py-1.5 shadow-lg backdrop-blur-sm"
      style={{ left: x, top: y }}
    >
      <div className="flex w-max max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] leading-snug">
        {side === "source" ? (
          <>
            <span className="font-medium text-foreground">{fromName}</span>
            <ChevronRight
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-muted-foreground">{toName}</span>
          </>
        ) : (
          <>
            <span className="text-muted-foreground">{fromName}</span>
            <ChevronRight
              className="size-3 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="font-medium text-foreground">{toName}</span>
          </>
        )}
      </div>
      <div className="mt-1 w-max max-w-full font-mono text-[11px] leading-snug wrap-break-word text-foreground">
        {label}
      </div>
    </div>
  );
}

export function ConnectorCallout({
  focus,
  servicesById,
  hubService,
  camera,
  canvas,
}: ConnectorCalloutProps) {
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const sync = () => {
      const rect = canvas.getBoundingClientRect();
      setCanvasSize({ width: rect.width, height: rect.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvas]);

  // Re-project labels every frame while the callout is visible (camera moves).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setFrame((n) => n + 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sourceLabelText = focus.labels?.[0] ?? null;
  const targetLabelText = focus.labels?.[1] ?? null;
  const duplicateLabels =
    sourceLabelText != null &&
    targetLabelText != null &&
    sourceLabelText === targetLabelText;
  const showSourceLabel = sourceLabelText != null && !duplicateLabels;
  const showTargetLabel = targetLabelText != null;

  const layout = useMemo(() => {
    if (!showSourceLabel && !showTargetLabel) return null;
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;

    const { width, height } = canvasSize;

    const connectorPoint = projectWorldLocal(
      focus.worldX,
      focus.worldZ,
      camera,
      width,
      height,
    );
    if (!connectorPoint) return null;

    // Anchor on the connector path in canvas space (not service centers).
    const anchor = connectorPoint;

    const [sx, , sz] = serviceWorldCenter(
      serviceForEndpoint(focus.sourceId, servicesById, hubService),
    );
    const [tx, , tz] = serviceWorldCenter(
      serviceForEndpoint(focus.targetId, servicesById, hubService),
    );

    const sourceScreen = projectWorldLocal(sx, sz, camera, width, height);
    const targetScreen = projectWorldLocal(tx, tz, camera, width, height);
    if (!sourceScreen || !targetScreen) return null;

    const fromName = serviceName(focus.sourceId, servicesById, hubService);
    const toName = serviceName(focus.targetId, servicesById, hubService);

    const accent =
      focus.variant === "warning"
        ? SCENE.connectorWarning
        : SCENE.connectorHighlight;

    let sourcePos = showSourceLabel
      ? labelBesideConnector(
          anchor,
          sourceScreen,
          sourceScreen,
          targetScreen,
          -1,
        )
      : null;
    let targetPos = showTargetLabel
      ? labelBesideConnector(
          anchor,
          targetScreen,
          sourceScreen,
          targetScreen,
          duplicateLabels ? -1 : 1,
        )
      : null;

    if (sourcePos && targetPos) {
      [sourcePos, targetPos] = separateLabels(sourcePos, targetPos);
    }

    return {
      width,
      height,
      connectorPoint,
      fromName,
      toName,
      accent,
      sourcePos,
      targetPos,
      sourcePath:
        sourcePos != null ? elbowPath(sourcePos, connectorPoint) : null,
      targetPath:
        targetPos != null ? elbowPath(targetPos, connectorPoint) : null,
    };
  }, [
    focus,
    camera,
    canvas,
    canvasSize,
    frame,
    servicesById,
    hubService,
    showSourceLabel,
    showTargetLabel,
    duplicateLabels,
  ]);

  if (!layout) return null;

  const {
    width,
    height,
    connectorPoint,
    fromName,
    toName,
    accent,
    sourcePos,
    targetPos,
    sourcePath,
    targetPath,
  } = layout;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-30 overflow-visible"
      aria-hidden
    >
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {sourcePath ? (
          <path
            d={sourcePath}
            fill="none"
            stroke={accent}
            strokeWidth={1.5}
            strokeOpacity={0.9}
          />
        ) : null}
        {targetPath ? (
          <path
            d={targetPath}
            fill="none"
            stroke={accent}
            strokeWidth={1.5}
            strokeOpacity={0.9}
          />
        ) : null}
        <circle
          cx={connectorPoint.x}
          cy={connectorPoint.y}
          r={4}
          fill={accent}
          fillOpacity={0.95}
        />
      </svg>

      {showSourceLabel && sourcePos && sourceLabelText ? (
        <EndpointLabel
          fromName={fromName}
          toName={toName}
          label={sourceLabelText}
          side="source"
          x={sourcePos.x}
          y={sourcePos.y}
        />
      ) : null}

      {showTargetLabel && targetPos && targetLabelText ? (
        <EndpointLabel
          fromName={fromName}
          toName={toName}
          label={targetLabelText}
          side="target"
          x={targetPos.x}
          y={targetPos.y}
        />
      ) : null}
    </div>
  );
}
