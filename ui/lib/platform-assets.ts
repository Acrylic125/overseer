import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Baked by `gen-assets` (`pnpm platform` / `pnpm shapes`). */
export const PLATFORM_GRADIENT_URL = "/platform-gradient.png";
export const PLATFORM_GLB_URL = "/platform.glb";
export const SHAPES_GLB_URL = "/shapes.glb";

let gradientTexture: Promise<THREE.Texture> | null = null;
let shapeLibrary: Promise<Map<string, THREE.BufferGeometry>> | null = null;

/** Shared sRGB gradient map from the gen-assets bake. */
export function loadPlatformGradient(): Promise<THREE.Texture> {
  gradientTexture ??= new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      PLATFORM_GRADIENT_URL,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      (err) => {
        reject(
          err instanceof Error
            ? err
            : new Error(`Failed to load ${PLATFORM_GRADIENT_URL}`),
        );
      },
    );
  });
  return gradientTexture;
}

function collectNamedGeometries(
  root: THREE.Object3D,
): Map<string, THREE.BufferGeometry> {
  const geometries = new Map<string, THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const name = mesh.name || mesh.parent?.name;
    if (!name) return;
    geometries.set(name, mesh.geometry);
  });
  return geometries;
}

function loadShapeLibrary(): Promise<Map<string, THREE.BufferGeometry>> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader
    .loadAsync(SHAPES_GLB_URL)
    .then((gltf) => collectNamedGeometries(gltf.scene));
}

/**
 * Load a named silhouette from `/shapes.glb` (basename of `gen-assets/shapes/*.svg`).
 * Returns a cloned geometry safe for independent dispose.
 */
export async function loadShapeGeometry(
  shape: string,
): Promise<THREE.BufferGeometry> {
  shapeLibrary ??= loadShapeLibrary();
  const geometries = await shapeLibrary;
  const geometry = geometries.get(shape);
  if (!geometry) {
    throw new Error(`Shape "${shape}" not found in ${SHAPES_GLB_URL}`);
  }
  return geometry.clone();
}
