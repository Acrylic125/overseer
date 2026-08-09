import * as THREE from "three";

/** Extruded slab depth (world Y after laying on XZ). */
export const SQUIRCLE_DEPTH = 0.2;
export const SQUIRCLE_BORDER = 0.02;
/** Corner radius capped so pads don't look empty. */
export const SQUIRCLE_RADIUS = 0.12;
export const BORDER_HEX = "#364153";
/** Diagonal gradient: top-left → bottom-right. */
export const GRADIENT_FROM_HEX = "#1E2939";
export const GRADIENT_TO_HEX = "#030712";
export const GRADIENT_SIZE = 512;

const BORDER_COLOR = new THREE.Color(BORDER_HEX);

function hexToSrgbBytes(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function roundedRectShape(
  width: number,
  height: number,
  radius: number,
): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const shape = new THREE.Shape();
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  return shape;
}

function bakeSolidColor(geometry: THREE.BufferGeometry, hex: THREE.Color) {
  const pos = geometry.getAttribute("position");
  if (!pos) return;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = hex.r;
    colors[i * 3 + 1] = hex.g;
    colors[i * 3 + 2] = hex.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

/** UVs from XZ after the shape has been rotated onto the ground plane. */
export function mapXzUvs(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const pos = geometry.getAttribute("position");
  if (!pos) return;
  const uvs = new Float32Array(pos.count * 2);
  const w = box.max.x - box.min.x || 1;
  const d = box.max.z - box.min.z || 1;
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = THREE.MathUtils.clamp((pos.getX(i) - box.min.x) / w, 0, 1);
    uvs[i * 2 + 1] = THREE.MathUtils.clamp(
      (pos.getZ(i) - box.min.z) / d,
      0,
      1,
    );
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/** UVs from XY (test page / orthographic icon board). */
export function mapXyUvs(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return;
  const pos = geometry.getAttribute("position");
  if (!pos) return;
  const uvs = new Float32Array(pos.count * 2);
  const w = box.max.x - box.min.x || 1;
  const h = box.max.y - box.min.y || 1;
  for (let i = 0; i < pos.count; i++) {
    uvs[i * 2] = THREE.MathUtils.clamp((pos.getX(i) - box.min.x) / w, 0, 1);
    uvs[i * 2 + 1] = THREE.MathUtils.clamp(
      (pos.getY(i) - box.min.y) / h,
      0,
      1,
    );
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/**
 * RGBA8 sRGB pixels for the diagonal platform gradient.
 * Used by the bake script (PNG/GLB) — no DOM canvas required.
 * Lerps in sRGB byte space to match the previous canvas gradient.
 */
export function createGradientRgba(): {
  data: Uint8Array;
  size: number;
} {
  const size = GRADIENT_SIZE;
  const data = new Uint8Array(size * size * 4);
  const from = hexToSrgbBytes(GRADIENT_FROM_HEX);
  const to = hexToSrgbBytes(GRADIENT_TO_HEX);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x / (size - 1) + y / (size - 1)) / 2;
      const i = (y * size + x) * 4;
      data[i] = Math.round(from[0] + (to[0] - from[0]) * t);
      data[i + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
      data[i + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

export type PlatformPlane = "xz" | "xy";

export type PlatformGeometries = {
  body: THREE.BufferGeometry;
  border: THREE.BufferGeometry;
};

/**
 * Build platform body (inset fill) + border frame geometries.
 *
 * - `xz`: ground plane (production) — top face at y = 0, extruded downward.
 * - `xy`: icon board (test page) — extruded along −Z; caller positions in XY.
 *
 * Keep in sync with `scan/src/assets` bake (`pnpm assets`).
 */
export function createPlatformGeometries(
  width: number,
  height: number,
  plane: PlatformPlane = "xz",
): PlatformGeometries {
  const radius = Math.min(SQUIRCLE_RADIUS, width / 2, height / 2);
  const seam = 0.001;
  const innerW = width - SQUIRCLE_BORDER * 2;
  const innerH = height - SQUIRCLE_BORDER * 2;
  const innerR = Math.max(radius - SQUIRCLE_BORDER, 0.04);

  const fill = roundedRectShape(
    Math.max(innerW - seam * 2, 0.02),
    Math.max(innerH - seam * 2, 0.02),
    Math.max(innerR - seam, 0.02),
  );
  const bodyGeo = new THREE.ExtrudeGeometry(fill, {
    depth: SQUIRCLE_DEPTH,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });

  const frame = roundedRectShape(width, height, radius);
  const hole = roundedRectShape(innerW, innerH, innerR);
  frame.holes.push(hole);
  const borderGeo = new THREE.ExtrudeGeometry(frame, {
    depth: SQUIRCLE_DEPTH,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });

  if (plane === "xz") {
    // UVs in XY before laying flat — same convention as `scan/assets/shapes`
    // (cloud). After rotateX(-π/2), former +Y → −Z.
    mapXyUvs(bodyGeo);
    // Extrude +Z → +Y after rotate; shift down so the top face sits at y = 0.
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.translate(0, -SQUIRCLE_DEPTH, 0);
    borderGeo.rotateX(-Math.PI / 2);
    borderGeo.translate(0, -SQUIRCLE_DEPTH, 0);
  } else {
    mapXyUvs(bodyGeo);
    bodyGeo.translate(0, 0, -SQUIRCLE_DEPTH);
    borderGeo.translate(0, 0, -SQUIRCLE_DEPTH);
  }

  // Border is vertex-colored only — drop ExtrudeGeometry UVs (often out of [0,1]).
  borderGeo.deleteAttribute("uv");
  bakeSolidColor(borderGeo, BORDER_COLOR);
  bodyGeo.computeBoundingBox();
  bodyGeo.computeBoundingSphere();
  borderGeo.computeBoundingBox();
  borderGeo.computeBoundingSphere();

  return { body: bodyGeo, border: borderGeo };
}
