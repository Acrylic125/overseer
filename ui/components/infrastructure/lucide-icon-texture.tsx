"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

import { cssToThreeColor } from "@/lib/css-color";

type IconNode = [string, Record<string, string | number>];

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

/**
 * Rasterize Lucide icon nodes into a transparent CanvasTexture for mesh decals.
 */
export function useLucideIconTexture(
  nodes: IconNode[],
  strokeCss: string,
  size = 256,
  strokeWidth = 2,
) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const stroke = cssToHex(strokeCss);
  const nodesKey = JSON.stringify(nodes);

  useEffect(() => {
    let cancelled = false;
    const svg = iconNodesToSvg(
      JSON.parse(nodesKey) as IconNode[],
      stroke,
      size,
      strokeWidth,
    );
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(image, 0, 0, size, size);
      URL.revokeObjectURL(url);

      const next = new THREE.CanvasTexture(canvas);
      next.colorSpace = THREE.SRGBColorSpace;
      next.anisotropy = 8;
      next.premultiplyAlpha = true;
      next.needsUpdate = true;
      setTexture((prev) => {
        prev?.dispose();
        return next;
      });
    };

    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;

    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [nodesKey, stroke, size, strokeWidth]);

  useEffect(() => () => texture?.dispose(), [texture]);

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
