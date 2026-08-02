"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";

type IconNode = [string, Record<string, string | number>];

/** Shared across all blocks — category glyphs must not duplicate 256² uploads. */
const textureCache = new Map<string, Promise<THREE.CanvasTexture>>();
const textureSync = new Map<string, THREE.CanvasTexture>();

function cssToHex(cssColor: string): string {
  return `#${cssToThreeColor(cssColor).getHexString()}`;
}

function attrsToString(attrs: Record<string, string | number>) {
  return Object.entries(attrs)
    .filter(([key]) => key !== "key")
    .map(([key, value]) => `${key}="${value}"`)
    .join(" ");
}

function iconNodesToSvg(
  nodes: IconNode[],
  stroke: string,
  size: number,
  strokeWidth: number,
) {
  const inner = nodes
    .map(([tag, attrs]) => `<${tag} ${attrsToString(attrs)} />`)
    .join("");
  const pad = size * 0.18;
  const innerSize = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${pad},${pad}) scale(${innerSize / 24})" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">
    ${inner}
  </g>
</svg>`;
}

function cacheKey(
  nodesKey: string,
  stroke: string,
  size: number,
  strokeWidth: number,
) {
  return `${nodesKey}|${stroke}|${size}|${strokeWidth}`;
}

function loadLucideTexture(
  nodesKey: string,
  stroke: string,
  size: number,
  strokeWidth: number,
): Promise<THREE.CanvasTexture> {
  const key = cacheKey(nodesKey, stroke, size, strokeWidth);
  const existing = textureCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const svg = iconNodesToSvg(
      JSON.parse(nodesKey) as IconNode[],
      stroke,
      size,
      strokeWidth,
    );
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Lucide icon decode failed"));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");

      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(image, 0, 0, size, size);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.premultiplyAlpha = true;
      texture.needsUpdate = true;
      textureSync.set(key, texture);
      return texture;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch((error) => {
    textureCache.delete(key);
    throw error;
  });

  textureCache.set(key, promise);
  return promise;
}

/**
 * Rasterize Lucide icon nodes into a transparent CanvasTexture for mesh decals.
 * Textures are cached and shared — do not dispose on unmount.
 */
export function loadLucideIconTexture(
  nodes: IconNode[],
  strokeCss: string,
  size = 128,
  strokeWidth = 2,
) {
  const stroke = cssToHex(strokeCss);
  const nodesKey = JSON.stringify(nodes);
  return loadLucideTexture(nodesKey, stroke, size, strokeWidth);
}

export function getLucideIconTextureSync(
  nodes: IconNode[],
  strokeCss: string,
  size = 128,
  strokeWidth = 2,
) {
  const key = cacheKey(JSON.stringify(nodes), cssToHex(strokeCss), size, strokeWidth);
  return textureSync.get(key) ?? null;
}

export function useLucideIconTexture(
  nodes: IconNode[],
  strokeCss: string,
  size = 128,
  strokeWidth = 2,
) {
  const stroke = cssToHex(strokeCss);
  const nodesKey = JSON.stringify(nodes);
  const key = cacheKey(nodesKey, stroke, size, strokeWidth);

  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(
    () => textureSync.get(key) ?? null,
  );

  useEffect(() => {
    const synced = textureSync.get(key);
    if (synced) {
      setTexture(synced);
      return;
    }

    let cancelled = false;
    void loadLucideTexture(nodesKey, stroke, size, strokeWidth)
      .then((next) => {
        if (!cancelled) setTexture(next);
      })
      .catch(() => {
        if (!cancelled) setTexture(null);
      });

    return () => {
      cancelled = true;
    };
  }, [key, nodesKey, stroke, size, strokeWidth]);

  return texture;
}

/** Lucide path nodes (viewBox 0 0 24 24). */
export const CPU_ICON_NODES: IconNode[] = [
  ["path", { d: "M12 20v2" }],
  ["path", { d: "M12 2v2" }],
  ["path", { d: "M17 20v2" }],
  ["path", { d: "M17 2v2" }],
  ["path", { d: "M2 12h2" }],
  ["path", { d: "M2 17h2" }],
  ["path", { d: "M2 7h2" }],
  ["path", { d: "M20 12h2" }],
  ["path", { d: "M20 17h2" }],
  ["path", { d: "M20 7h2" }],
  ["path", { d: "M7 20v2" }],
  ["path", { d: "M7 2v2" }],
  ["rect", { x: "4", y: "4", width: "16", height: "16", rx: "2" }],
  ["rect", { x: "8", y: "8", width: "8", height: "8", rx: "1" }],
];

export const CYLINDER_ICON_NODES: IconNode[] = [
  ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }],
  ["path", { d: "M3 5v14a9 3 0 0 0 18 0V5" }],
];

export const DATABASE_ICON_NODES: IconNode[] = [
  ["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }],
  ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }],
  ["path", { d: "M3 12A9 3 0 0 0 21 12" }],
];

/** Lucide `layers` — stacked messages / event bus. */
export const LAYERS_ICON_NODES: IconNode[] = [
  ["path", { d: "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" }],
  ["path", { d: "M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" }],
  ["path", { d: "M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" }],
];
