import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  KHRMaterialsUnlit,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { DOMParser, parseHTML } from "linkedom";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";

import { assetsIconsDir, assetsShapesDir } from "../paths.js";
import {
  collectSceneFootprints,
  compressMeshopt,
  embedLayoutFootprints,
  ensureGlbNodeShims,
  exportSceneGlb,
} from "./glb-node.js";
import { createIconMesh } from "./icons.js";
import { encodePngRgba } from "./png.js";
import {
  createGradientRgba,
  createPlatformGeometries,
  GRADIENT_FROM_HEX,
} from "./platform-mesh.js";
import { createShapeMeshes } from "./shapes.js";

let shimsReady = false;

function ensureBrowserShims(): void {
  if (shimsReady) return;
  const { document } = parseHTML("<!DOCTYPE html><html><body></body></html>");
  globalThis.DOMParser = DOMParser as unknown as typeof globalThis.DOMParser;
  globalThis.document = document as unknown as Document;
  ensureGlbNodeShims();
  shimsReady = true;
}

/** Apply gradient PNG as baseColorTexture on named meshes only. */
async function embedGradientOnMeshes(
  glb: ArrayBuffer,
  png: Buffer,
  meshNames: Set<string>,
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
    if (!meshNames.has(mesh.getName())) continue;
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (!material) continue;
      material.setBaseColorTexture(texture);
      material.setBaseColorFactor([1, 1, 1, 1]);
    }
  }

  return await io.writeBinary(document);
}

async function loadIconMeshes(): Promise<THREE.Mesh[]> {
  const entries = await readdir(assetsIconsDir);
  const svgFiles = entries
    .filter((file) => file.toLowerCase().endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found in ${assetsIconsDir}`);
  }

  const meshes: THREE.Mesh[] = [];
  for (const file of svgFiles) {
    const name = path.basename(file, path.extname(file));
    const svgText = await readFile(path.join(assetsIconsDir, file), "utf8");
    meshes.push(createIconMesh(svgText, name));
  }
  return meshes;
}

function createPlatformMeshes(): {
  meshes: THREE.Mesh[];
  texturedNames: string[];
} {
  const { body, border } = createPlatformGeometries(1, 1, "xz");

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

  return {
    meshes: [bodyMesh, borderMesh],
    texturedNames: ["platform-body"],
  };
}

async function loadShapeMeshes(): Promise<{
  meshes: THREE.Mesh[];
  texturedNames: string[];
}> {
  const entries = await readdir(assetsShapesDir);
  const svgFiles = entries
    .filter((file) => file.toLowerCase().endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b));

  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found in ${assetsShapesDir}`);
  }

  const meshes: THREE.Mesh[] = [];
  const texturedNames: string[] = [];
  for (const file of svgFiles) {
    const name = path.basename(file, path.extname(file));
    const svgText = await readFile(path.join(assetsShapesDir, file), "utf8");
    const { body, border } = createShapeMeshes(svgText, name);
    meshes.push(body, border);
    texturedNames.push(name);
  }
  return { meshes, texturedNames };
}

export type BuildAssetsResult = {
  glbFile: string;
  pngFile: string;
  iconCount: number;
  shapeCount: number;
};

/**
 * Bake icons, platform, and shapes into a single `assets.glb` (+ gradient PNG)
 * under `outDir`.
 */
export async function buildAssets(outDir: string): Promise<BuildAssetsResult> {
  ensureBrowserShims();

  const { data, size } = createGradientRgba();
  const png = encodePngRgba(data, size, size);

  const icons = await loadIconMeshes();
  const platform = createPlatformMeshes();
  const shapes = await loadShapeMeshes();

  const scene = new THREE.Scene();
  scene.name = "assets";
  for (const mesh of icons) scene.add(mesh);
  for (const mesh of platform.meshes) scene.add(mesh);
  for (const mesh of shapes.meshes) scene.add(mesh);

  const texturedNames = new Set([
    ...platform.texturedNames,
    ...shapes.texturedNames,
  ]);

  await mkdir(outDir, { recursive: true });
  const glbFile = path.join(outDir, "assets.glb");
  const pngFile = path.join(outDir, "platform-gradient.png");
  await writeFile(pngFile, png);

  const footprints = collectSceneFootprints(scene);
  const rawGlb = await exportSceneGlb(scene);
  const withTexture = await embedGradientOnMeshes(rawGlb, png, texturedNames);
  const withFootprints = await embedLayoutFootprints(
    withTexture.buffer.slice(
      withTexture.byteOffset,
      withTexture.byteOffset + withTexture.byteLength,
    ) as ArrayBuffer,
    footprints,
  );
  const compressed = await compressMeshopt(
    withFootprints.buffer.slice(
      withFootprints.byteOffset,
      withFootprints.byteOffset + withFootprints.byteLength,
    ) as ArrayBuffer,
  );
  await writeFile(glbFile, compressed);

  return {
    glbFile,
    pngFile,
    iconCount: icons.length,
    shapeCount: shapes.meshes.length,
  };
}
