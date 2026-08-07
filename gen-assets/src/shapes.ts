import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMaterialsUnlit,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { DOMParser, parseHTML } from "linkedom";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

import {
  compressMeshopt,
  ensureGlbNodeShims,
  exportSceneGlb,
} from "./glb-node.js";
import { encodePngRgba } from "./png.js";
import {
  createGradientRgba,
  GRADIENT_FROM_HEX,
  SQUIRCLE_DEPTH,
} from "./platform-mesh.js";

// Browser APIs required by SVGLoader + GLTFExporter in Node.
const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
globalThis.document = document as unknown as Document;
ensureGlbNodeShims();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SHAPES_DIR = path.join(ROOT, "shapes");
const OUT_DIR = path.join(ROOT, "_generated");
const OUT_GLB = path.join(OUT_DIR, "shapes.glb");
const OUT_PNG = path.join(OUT_DIR, "platform-gradient.png");

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
 */
function svgToShapeMesh(svgText: string, name: string): THREE.Mesh {
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

/** Attach the platform gradient PNG as baseColorTexture on every shape mesh. */
async function embedGradientTexture(
  glb: ArrayBuffer,
  png: Buffer,
): Promise<Uint8Array> {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions([
      EXTMeshoptCompression,
      KHRMaterialsUnlit,
      KHRMeshQuantization,
    ])
    .registerDependencies({
      "meshopt.decoder": MeshoptDecoder,
      "meshopt.encoder": MeshoptEncoder,
    });

  const document = await io.readBinary(new Uint8Array(glb));
  const root = document.getRoot();
  const texture = document
    .createTexture("platform-gradient")
    .setImage(new Uint8Array(png))
    .setMimeType("image/png");

  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (!material) continue;
      material.setBaseColorTexture(texture);
      material.setBaseColorFactor([1, 1, 1, 1]);
    }
  }

  return await io.writeBinary(document);
}

async function main(): Promise<void> {
  const entries = await readdir(SHAPES_DIR);
  const svgFiles = entries
    .filter((file) => file.toLowerCase().endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found in ${SHAPES_DIR}`);
  }

  const { data, size } = createGradientRgba();
  const png = encodePngRgba(data, size, size);

  const scene = new THREE.Scene();
  scene.name = "shapes";

  for (const file of svgFiles) {
    const name = path.basename(file, path.extname(file));
    const svgText = await readFile(path.join(SHAPES_DIR, file), "utf8");
    const mesh = svgToShapeMesh(svgText, name);
    scene.add(mesh);
    const box = mesh.geometry.boundingBox;
    const dims = box
      ? `${(box.max.x - box.min.x).toFixed(2)}×${(box.max.z - box.min.z).toFixed(2)}`
      : "?";
    console.log(`  + ${name} (${dims})`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_PNG, png);

  const rawGlb = await exportSceneGlb(scene);
  const withTexture = await embedGradientTexture(rawGlb, png);
  const compressed = await compressMeshopt(
    withTexture.buffer.slice(
      withTexture.byteOffset,
      withTexture.byteOffset + withTexture.byteLength,
    ) as ArrayBuffer,
  );
  await writeFile(OUT_GLB, compressed);

  const ratio = ((compressed.byteLength / rawGlb.byteLength) * 100).toFixed(0);
  console.log(`\nWrote ${svgFiles.length} shapes → ${path.relative(ROOT, OUT_GLB)}`);
  console.log(
    `  gradient ${path.relative(ROOT, OUT_PNG)} (${png.byteLength} bytes)`,
  );
  console.log(
    `  raw ${rawGlb.byteLength} bytes → meshopt ${compressed.byteLength} bytes (${ratio}%)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
