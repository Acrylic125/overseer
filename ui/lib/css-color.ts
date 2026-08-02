import * as THREE from "three";

const cache = new Map<string, THREE.Color>();

/** Resolve any CSS color (including oklch) to a Three.js Color via the browser. */
export function cssToThreeColor(cssColor: string): THREE.Color {
  const hit = cache.get(cssColor);
  if (hit) return hit.clone();

  const color = new THREE.Color();
  if (typeof document === "undefined") {
    color.set(cssColor);
    cache.set(cssColor, color.clone());
    return color;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
  if (!ctx) {
    color.set(cssColor);
    cache.set(cssColor, color.clone());
    return color;
  }

  ctx.fillStyle = "#000";
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
  // Canvas bytes are sRGB — tell Three so it converts into the linear working space.
  color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  cache.set(cssColor, color.clone());
  return color;
}
