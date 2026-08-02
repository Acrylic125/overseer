import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";

/** Cream plate fills in CF product SVGs — not part of the glyph. */
const CREAM_HEX = new Set([0xffeed8, 0xffe8cc, 0xffffff]);

/** Curve tessellation for ShapeGeometry — keep modest for instance count. */
const CURVE_SEGMENTS = 8;

const geometryCache = new Map<string, Promise<THREE.BufferGeometry>>();
const geometrySync = new Map<string, THREE.BufferGeometry>();

function isCreamFill(color: THREE.Color) {
  return CREAM_HEX.has(color.getHex());
}

/**
 * Parse a CF product SVG into a unit-sized flat glyph BufferGeometry
 * (longest axis = 1, centered at origin, XY plane, Y flipped for SVG coords).
 * Cream background rects are stripped; orange path fills are kept.
 */
function bakeSvgGlyph(svgText: string): THREE.BufferGeometry {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const parts: THREE.BufferGeometry[] = [];

  for (const path of data.paths) {
    if (isCreamFill(path.color)) continue;
    const style = path.userData?.style as { fill?: string } | undefined;
    if (style?.fill === "none" || style?.fill?.startsWith("url")) continue;

    const shapes = path.toShapes();
    for (const shape of shapes) {
      parts.push(new THREE.ShapeGeometry(shape, CURVE_SEGMENTS));
    }
  }

  if (parts.length === 0) {
    throw new Error("SVG produced no glyph shapes");
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("Failed to merge SVG glyph geometries");

  // SVG Y grows downward; flip so the glyph reads upright in Three XY.
  merged.scale(1, -1, 1);
  merged.computeBoundingBox();
  const bb = merged.boundingBox;
  if (!bb) {
    merged.dispose();
    throw new Error("SVG glyph has no bounds");
  }

  const width = bb.max.x - bb.min.x || 1;
  const height = bb.max.y - bb.min.y || 1;
  const span = Math.max(width, height);
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  merged.translate(-cx, -cy, 0);
  merged.scale(1 / span, 1 / span, 1);
  merged.computeBoundingBox();
  merged.computeVertexNormals();

  return merged;
}

function loadSvgGlyph(iconUrl: string): Promise<THREE.BufferGeometry> {
  const existing = geometryCache.get(iconUrl);
  if (existing) return existing;

  const promise = (async () => {
    const response = await fetch(encodeURI(iconUrl));
    if (!response.ok) throw new Error(`Failed to load ${iconUrl}`);
    const text = await response.text();
    const geometry = bakeSvgGlyph(text);
    geometrySync.set(iconUrl, geometry);
    return geometry;
  })().catch((error) => {
    geometryCache.delete(iconUrl);
    throw error;
  });

  geometryCache.set(iconUrl, promise);
  return promise;
}

/** Imperative loader — geometries are cached and shared; do not dispose. */
export function loadSvgIconGeometry(iconUrl: string) {
  return loadSvgGlyph(iconUrl);
}

export function getSvgIconGeometrySync(iconUrl: string) {
  return geometrySync.get(iconUrl) ?? null;
}
