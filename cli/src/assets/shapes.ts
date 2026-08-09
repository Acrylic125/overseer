import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  BORDER_HEX,
  GRADIENT_FROM_HEX,
  SQUIRCLE_DEPTH,
} from "./platform-mesh.js";

/** Low curve tessellation — shapes stay readable at instance scale. */
const CURVE_SEGMENTS = 8;

const BORDER_COLOR = new THREE.Color(BORDER_HEX);

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

function extrudeShapes(shapes: THREE.Shape[]): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const shape of shapes) {
    parts.push(
      new THREE.ExtrudeGeometry(shape, {
        depth: SQUIRCLE_DEPTH,
        bevelEnabled: false,
        curveSegments: CURVE_SEGMENTS,
        steps: 1,
      }),
    );
  }
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) {
    throw new Error("Failed to merge extruded shape geometries");
  }
  return merged;
}

/**
 * Center, unit-normalize (longer side = 1), UV, and lay onto XZ (top at y = 0).
 */
function finalizeGroundGeometry(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  geometry.deleteAttribute("normal");

  // SVG Y grows downward; flip so the silhouette reads upright in XY.
  geometry.scale(1, -1, 1);
  const index = geometry.getIndex();
  if (index) {
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
    index.needsUpdate = true;
  } else {
    const pos = geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += 3) {
      swapVertexAttribute(pos, i, i + 2);
    }
    pos.needsUpdate = true;
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) {
    geometry.dispose();
    throw new Error("Shape geometry has no bounding box");
  }

  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);

  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const span = Math.max(width, height) || 1;
  geometry.scale(1 / span, 1 / span, 1);

  mapXyUvs(geometry);

  // Extrude +Z → +Y; top face at y = 0.
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -SQUIRCLE_DEPTH, 0);

  const welded = mergeVertices(geometry);
  geometry.dispose();
  welded.deleteAttribute("normal");
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

export type ShapeMeshes = {
  body: THREE.Mesh;
  /** Same silhouette as body; tinted for runtime rim (scaled separately). */
  border: THREE.Mesh;
};

/**
 * Convert one SVG into a unit silhouette on the XZ ground plane.
 *
 * Body + border share the full outline — the UI scales the fill down by
 * {@link SQUIRCLE_BORDER} world units so the rim matches platform pads.
 */
export function createShapeMeshes(svgText: string, name: string): ShapeMeshes {
  const loader = new SVGLoader();
  const data = loader.parse(svgText);
  const shapes: THREE.Shape[] = [];

  for (const svgPath of data.paths) {
    if (shouldSkipPath(svgPath)) continue;
    shapes.push(...svgPath.toShapes());
  }

  if (shapes.length === 0) {
    throw new Error(`SVG shape "${name}" produced no geometry`);
  }

  let bodyGeo = extrudeShapes(shapes);
  bodyGeo = finalizeGroundGeometry(bodyGeo);

  const borderGeo = bodyGeo.clone();
  borderGeo.deleteAttribute("uv");
  borderGeo.deleteAttribute("color");
  bakeSolidColor(borderGeo, BORDER_COLOR);

  const bodyMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GRADIENT_FROM_HEX),
    toneMapped: false,
    side: THREE.FrontSide,
    depthWrite: true,
  });
  const borderMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false,
    side: THREE.FrontSide,
    depthWrite: true,
  });

  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.name = name;
  const border = new THREE.Mesh(borderGeo, borderMat);
  border.name = `${name}-border`;

  return { body, border };
}

/** @deprecated Prefer {@link createShapeMeshes}. */
export function createShapeMesh(svgText: string, name: string): THREE.Mesh {
  return createShapeMeshes(svgText, name).body;
}
