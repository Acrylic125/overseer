import { mkdir, writeFile } from "node:fs/promises";
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

import {
  compressMeshopt,
  ensureGlbNodeShims,
  exportSceneGlb,
} from "./glb-node.js";
import { encodePngRgba } from "./png.js";
import {
  createGradientRgba,
  createPlatformGeometries,
  GRADIENT_FROM_HEX,
} from "./platform-mesh.js";

// Browser APIs required by GLTFExporter in Node.
const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
globalThis.document = document as unknown as Document;
ensureGlbNodeShims();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "_generated");
const OUT_GLB = path.join(OUT_DIR, "platform.glb");
const OUT_PNG = path.join(OUT_DIR, "platform-gradient.png");

/** Attach the baked PNG as baseColorTexture on platform-body (pre-compression). */
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
    if (mesh.getName() !== "platform-body") continue;
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (!material) continue;
      material.setName("platform-body");
      material.setBaseColorTexture(texture);
      material.setBaseColorFactor([1, 1, 1, 1]);
    }
  }

  return await io.writeBinary(document);
}

async function main(): Promise<void> {
  const { body, border } = createPlatformGeometries(1, 1, "xz");
  const { data, size } = createGradientRgba();
  const png = encodePngRgba(data, size, size);

  // Export shapes without a canvas-backed map; texture is injected after.
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

  const bodyMesh = new THREE.Mesh(body, bodyMat);
  bodyMesh.name = "platform-body";
  const borderMesh = new THREE.Mesh(border, borderMat);
  borderMesh.name = "platform-border";

  const scene = new THREE.Scene();
  scene.name = "platform";
  scene.add(bodyMesh);
  scene.add(borderMesh);

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

  body.dispose();
  border.dispose();
  bodyMat.dispose();
  borderMat.dispose();

  const ratio = ((compressed.byteLength / rawGlb.byteLength) * 100).toFixed(0);
  console.log(`Wrote unit platform → ${path.relative(ROOT, OUT_GLB)}`);
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
