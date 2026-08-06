import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { DOMParser, parseHTML } from "linkedom";
import { MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { SVGLoader } from "three/examples/jsm/loaders/SVGLoader.js";
import {
  mergeGeometries,
  mergeVertices,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Browser APIs required by SVGLoader + GLTFExporter in Node.
const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
globalThis.document = document as unknown as Document;

/** Minimal FileReader so GLTFExporter can build a binary GLB under Node. */
class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  readyState = 0;
  error: DOMException | null = null;
  onloadend:
    | ((this: FileReader, ev: ProgressEvent<FileReader>) => void)
    | null = null;
  onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => void) | null =
    null;

  private finish(
    result: string | ArrayBuffer,
    err: DOMException | null = null,
  ): void {
    this.result = result;
    this.error = err;
    this.readyState = 2;
    const ev = {} as ProgressEvent<FileReader>;
    if (err) this.onerror?.call(this as unknown as FileReader, ev);
    this.onloadend?.call(this as unknown as FileReader, ev);
  }

  readAsArrayBuffer(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => this.finish(buffer))
      .catch((err: unknown) => {
        this.finish(
          new ArrayBuffer(0),
          err instanceof DOMException
            ? err
            : new DOMException(String(err), "NotReadableError"),
        );
      });
  }

  readAsDataURL(blob: Blob): void {
    void blob
      .arrayBuffer()
      .then((buffer) => {
        const base64 = Buffer.from(buffer).toString("base64");
        const type = blob.type || "application/octet-stream";
        this.finish(`data:${type};base64,${base64}`);
      })
      .catch((err: unknown) => {
        this.finish(
          "",
          err instanceof DOMException
            ? err
            : new DOMException(String(err), "NotReadableError"),
        );
      });
  }
}

globalThis.FileReader =
  NodeFileReader as unknown as typeof globalThis.FileReader;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ICONS_DIR = path.join(ROOT, "icons");
const OUT_DIR = path.join(ROOT, "_generated");
const OUT_FILE = path.join(OUT_DIR, "icons.glb");

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
 */
function svgToMesh(svgText: string, name: string): THREE.Mesh {
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

async function exportSceneGlb(scene: THREE.Scene): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
  });

  if (!(result instanceof ArrayBuffer)) {
    throw new Error("GLTFExporter did not return a binary GLB ArrayBuffer");
  }
  return result;
}

/** Reorder + quantize + EXT_meshopt_compression via glTF Transform. */
async function compressMeshopt(glb: ArrayBuffer): Promise<Uint8Array> {
  await MeshoptEncoder.ready;

  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });

  const document = await io.readBinary(new Uint8Array(glb));
  await document.transform(
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );
  return await io.writeBinary(document);
}

async function main(): Promise<void> {
  const entries = await readdir(ICONS_DIR);
  const svgFiles = entries
    .filter((file) => file.toLowerCase().endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found in ${ICONS_DIR}`);
  }

  const scene = new THREE.Scene();
  scene.name = "icons";

  for (const file of svgFiles) {
    const name = path.basename(file, path.extname(file));
    const svgText = await readFile(path.join(ICONS_DIR, file), "utf8");
    const mesh = svgToMesh(svgText, name);
    scene.add(mesh);
    const box = mesh.geometry.boundingBox;
    const size = box
      ? `${(box.max.x - box.min.x).toFixed(1)}×${(box.max.y - box.min.y).toFixed(1)}×${(box.max.z - box.min.z).toFixed(2)}`
      : "?";
    console.log(`  + ${name} (${size})`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const rawGlb = await exportSceneGlb(scene);
  const compressed = await compressMeshopt(rawGlb);
  await writeFile(OUT_FILE, compressed);

  const ratio = ((compressed.byteLength / rawGlb.byteLength) * 100).toFixed(0);
  console.log(
    `\nWrote ${svgFiles.length} meshes → ${path.relative(ROOT, OUT_FILE)}`,
  );
  console.log(
    `  raw ${rawGlb.byteLength} bytes → meshopt ${compressed.byteLength} bytes (${ratio}%)`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
