import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  GRADIENT_FROM_HEX,
  SQUIRCLE_DEPTH,
} from "./platform-mesh.js";

/** Low curve tessellation — shapes stay readable at instance scale. */
const CURVE_SEGMENTS = 8;

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

/** Planar UVs from XY before the mesh is laid onto XZ. */
function mapXyUvs(geometry: THREE.BufferGeometry): void {
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
 * Convert one SVG into a unit mesh on the XZ ground plane with UVs for the
 * shared platform gradient. Longer side normalizes to 1 (aspect preserved).
 * Caller must install DOM / FileReader shims first.
 */
export function createShapeMesh(svgText: string, name: string): THREE.Mesh {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const parts: THREE.BufferGeometry[] = [];

  for (const svgPath of data.paths) {
    if (shouldSkipPath(svgPath)) continue;
    const shapes = svgPath.toShapes();
    for (const shape of shapes) {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: SQUIRCLE_DEPTH,
        bevelEnabled: false,
        curveSegments: CURVE_SEGMENTS,
        steps: 1,
      });
      parts.push(geometry);
    }
  }

  if (parts.length === 0) {
    throw new Error(`SVG shape "${name}" produced no geometry`);
  }

  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    throw new Error(`Failed to merge geometries for shape "${name}"`);
  }

  merged.deleteAttribute("normal");

  // SVG Y grows downward; flip so the silhouette reads upright in XY.
  merged.scale(1, -1, 1);
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
    for (let i = 0; i < pos.count; i += 3) {
      swapVertexAttribute(pos, i, i + 2);
    }
    pos.needsUpdate = true;
  }

  merged.computeBoundingBox();
  const box = merged.boundingBox;
  if (!box) {
    merged.dispose();
    throw new Error(`Shape "${name}" has no bounding box`);
  }

  const center = new THREE.Vector3();
  box.getCenter(center);
  merged.translate(-center.x, -center.y, -center.z);

  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const span = Math.max(width, height) || 1;
  merged.scale(1 / span, 1 / span, 1);

  // UVs in XY before laying flat on the ground.
  mapXyUvs(merged);

  // Extrude +Z → +Y; top face at y = 0.
  merged.rotateX(-Math.PI / 2);
  merged.translate(0, -SQUIRCLE_DEPTH, 0);

  const welded = mergeVertices(merged);
  merged.dispose();
  welded.deleteAttribute("normal");
  welded.deleteAttribute("color");
  welded.computeBoundingBox();
  welded.computeBoundingSphere();

  // Placeholder solid — gradient PNG is injected after export (no canvas).
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GRADIENT_FROM_HEX),
    toneMapped: false,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  const mesh = new THREE.Mesh(welded, material);
  mesh.name = name;
  return mesh;
}
