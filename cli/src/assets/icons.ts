import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Per SVG child: z = Z_PER_INDEX * index */
const Z_PER_INDEX = 0.001;
/** Low curve tessellation — icons stay readable at instance scale. */
const CURVE_SEGMENTS = 5;

function bakeVertexColors(
  geometry: THREE.BufferGeometry,
  color: THREE.Color,
): void {
  const count = geometry.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  // SVGLoader already stores path.color in the linear working space
  // (setStyle with SRGBColorSpace + ColorManagement). Do not convert again.
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function shouldSkipPath(pathItem: THREE.ShapePath): boolean {
  const style = pathItem.userData?.style as { fill?: string } | undefined;
  const fill = style?.fill;
  if (fill === "none" || fill?.startsWith("url")) return true;
  return false;
}

function swapVertexAttribute(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  a: number,
  b: number,
): void {
  const size = attribute.itemSize;
  const tmp = new Array<number>(size);
  for (let c = 0; c < size; c++) tmp[c] = attribute.getComponent(a, c);
  for (let c = 0; c < size; c++) {
    attribute.setComponent(a, c, attribute.getComponent(b, c));
  }
  for (let c = 0; c < size; c++) attribute.setComponent(b, c, tmp[c]!);
}

/**
 * Convert one SVG into a single centered flat mesh
 * with baked vertex colors (one mesh / one geometry per icon).
 *
 * Each SVG child at index i is a ShapeGeometry at z = Z_PER_INDEX * i.
 * Caller must install DOM / FileReader shims first.
 */
export function createIconMesh(svgText: string, name: string): THREE.Mesh {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const parts: THREE.BufferGeometry[] = [];

  for (let index = 0; index < data.paths.length; index++) {
    const svgPath = data.paths[index];
    if (!svgPath || shouldSkipPath(svgPath)) continue;

    const z = Z_PER_INDEX * index;
    const shapes = svgPath.toShapes();

    for (const shape of shapes) {
      const geometry = new THREE.ShapeGeometry(shape, CURVE_SEGMENTS);
      geometry.translate(0, 0, z);
      bakeVertexColors(geometry, svgPath.color);
      parts.push(geometry);
    }
  }

  if (parts.length === 0) {
    throw new Error(`SVG "${name}" produced no shapes`);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    throw new Error(`Failed to merge geometries for "${name}"`);
  }

  // InstancedMesh uses vertex colors only — UVs add weight and block welding.
  merged.deleteAttribute("uv");
  merged.deleteAttribute("normal");

  // SVG Y grows downward; flip so glyphs read upright in Three.js.
  merged.scale(1, -1, 1);
  // Negative Y scale flips winding — restore front faces toward +Z.
  const index = merged.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    index.needsUpdate = true;
  } else {
    const pos = merged.getAttribute("position");
    const color = merged.getAttribute("color");
    for (let i = 0; i < pos.count; i += 3) {
      swapVertexAttribute(pos, i, i + 2);
      if (color) swapVertexAttribute(color, i, i + 2);
    }
    pos.needsUpdate = true;
    if (color) color.needsUpdate = true;
  }

  merged.computeBoundingBox();
  const box = merged.boundingBox;
  if (!box) {
    merged.dispose();
    throw new Error(`SVG "${name}" has no bounding box`);
  }

  // Center first so scale is around the origin.
  const center = new THREE.Vector3();
  box.getCenter(center);
  merged.translate(-center.x, -center.y, -center.z);

  // Normalize XY so the longer side is 1; keep Z offsets.
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const span = Math.max(width, height) || 1;
  merged.scale(1 / span, 1 / span, 1);

  const welded = mergeVertices(merged);
  merged.dispose();

  welded.deleteAttribute("normal");
  welded.computeBoundingBox();
  welded.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const mesh = new THREE.Mesh(welded, material);
  mesh.name = name;
  return mesh;
}
