"use client";

import { useMemo } from "react";
import * as THREE from "three";

import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

const BASE_HEIGHT = 0.12;
const FONT_SIZE_PX = 64;
const PAD_X = 6;
const PAD_Y = 4;
const MAX_LINES = 2;
/** World height of one text line — sized for readability from top-down. */
const WORLD_FONT = 0.4;

const textureCache = new Map<string, THREE.CanvasTexture>();
const materialCache = new Map<string, THREE.MeshBasicMaterial>();
const planeGeometry = new THREE.PlaneGeometry(1, 1);

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= MAX_LINES) break;
    }
  }
  if (current && lines.length < MAX_LINES) lines.push(current);
  if (lines.length === MAX_LINES) {
    const last = lines[MAX_LINES - 1]!;
    if (ctx.measureText(last).width > maxWidth) {
      let clipped = last;
      while (clipped.length > 1 && ctx.measureText(`${clipped}…`).width > maxWidth) {
        clipped = clipped.slice(0, -1);
      }
      lines[MAX_LINES - 1] = `${clipped}…`;
    }
  }
  return lines;
}

/** Rasterize a service name once; reuse across stream window updates. */
function getLabelMaterial(name: string, maxWorldWidth: number) {
  const key = `${name}|${maxWorldWidth.toFixed(2)}`;
  const hit = materialCache.get(key);
  if (hit) return hit;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    materialCache.set(key, mat);
    return mat;
  }

  ctx.font = `600 ${FONT_SIZE_PX}px ui-sans-serif, system-ui, sans-serif`;
  const maxPx = Math.max(64, (maxWorldWidth / WORLD_FONT) * FONT_SIZE_PX);
  const lines = wrapLines(ctx, name, maxPx);
  const lineHeight = FONT_SIZE_PX * 1.15;
  let textW = 0;
  for (const line of lines) {
    textW = Math.max(textW, ctx.measureText(line).width);
  }
  canvas.width = Math.ceil(textW + PAD_X * 2);
  canvas.height = Math.ceil(lines.length * lineHeight + PAD_Y * 2);

  ctx.font = `600 ${FONT_SIZE_PX}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#d7dde5";
  const cx = canvas.width / 2;
  const startY = PAD_Y + lineHeight / 2;
  for (let i = 0; i < lines.length; i += 1) {
    ctx.fillText(lines[i]!, cx, startY + i * lineHeight);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  textureCache.set(key, texture);

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  materialCache.set(key, mat);
  return mat;
}

type LabelPose = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  maxWidth: number;
};

/**
 * Service name labels as cached canvas-texture planes.
 * Avoids mounting Troika `<Text>` per stream update (main-thread freezes).
 */
export function ServiceLabels({
  services,
}: {
  services: InfrastructureService[];
}) {
  const poses = useMemo(() => {
    const out: LabelPose[] = [];
    for (const service of services) {
      const [x, , z] = serviceWorldCenter(service);
      const labelZ = (service.depth * CELL_SIZE) / 2 + 0.15;
      out.push({
        id: service.id,
        name: service.name,
        x,
        y: BASE_HEIGHT + 0.02,
        z: z + labelZ,
        maxWidth: Math.max(service.width * CELL_SIZE * 1.35, 1.1),
      });
    }
    return out;
  }, [services]);

  return (
    <group>
      {poses.map((pose) => {
        const material = getLabelMaterial(pose.name, pose.maxWidth);
        const img = material.map?.image as HTMLCanvasElement | undefined;
        // Map canvas px → world so FONT_SIZE_PX ≈ WORLD_FONT (same as old Troika size).
        const pxH = img?.height || FONT_SIZE_PX;
        const pxW = img?.width || FONT_SIZE_PX * 4;
        let height = WORLD_FONT * (pxH / FONT_SIZE_PX);
        let width = height * (pxW / pxH);
        if (width > pose.maxWidth) {
          const s = pose.maxWidth / width;
          width *= s;
          height *= s;
        }
        return (
          <mesh
            key={pose.id}
            geometry={planeGeometry}
            material={material}
            position={[pose.x, pose.y, pose.z]}
            rotation={[-Math.PI / 2, 0, 0]}
            scale={[width, height, 1]}
            renderOrder={2}
            frustumCulled
          />
        );
      })}
    </group>
  );
}
