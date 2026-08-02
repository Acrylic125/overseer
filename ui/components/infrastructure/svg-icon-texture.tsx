"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";

/** Shared across all blocks so many workers don't fetch Worker.svg N times. */
const textureCache = new Map<string, Promise<THREE.CanvasTexture>>();
const textureSync = new Map<string, THREE.CanvasTexture>();

function loadSvgTexture(iconUrl: string, size: number): Promise<THREE.CanvasTexture> {
  const cacheKey = `${iconUrl}@${size}`;
  const existing = textureCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(encodeURI(iconUrl));
    if (!response.ok) throw new Error(`Failed to load ${iconUrl}`);
    const raw = await response.text();
    const blob = new Blob([raw], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Image decode failed: ${iconUrl}`));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("2d context unavailable");

      // Cream plate matches CF icons — fully covers the white pad.
      ctx.fillStyle = "#FFEED8";
      ctx.fillRect(0, 0, size, size);
      // Keep original orange (#F6821F) glyphs.
      ctx.drawImage(image, 0, 0, size, size);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      textureSync.set(cacheKey, texture);
      return texture;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().catch((error) => {
    textureCache.delete(cacheKey);
    throw error;
  });

  textureCache.set(cacheKey, promise);
  return promise;
}

/** Imperative loader for instanced icon batches — uses the shared cache. */
export function loadSvgIconTexture(iconUrl: string, size = 128) {
  return loadSvgTexture(iconUrl, size);
}

export function getSvgIconTextureSync(iconUrl: string, size = 128) {
  return textureSync.get(`${iconUrl}@${size}`) ?? null;
}

/**
 * Rasterize a CF product SVG from `/cf-icons` into a CanvasTexture.
 * Keeps original cream + orange branding and fills the square so it
 * completely covers the white icon pad.
 */
export function useSvgIconTexture(iconUrl: string | undefined, size = 128) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    if (!iconUrl) {
      setTexture(null);
      return;
    }

    let cancelled = false;

    void loadSvgTexture(iconUrl, size)
      .then((next) => {
        if (!cancelled) setTexture(next);
      })
      .catch(() => {
        if (!cancelled) setTexture(null);
      });

    return () => {
      cancelled = true;
    };
  }, [iconUrl, size]);

  // Cached textures are shared — do not dispose on unmount.
  return texture;
}
