import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Single baked GLB from `pnpm assets` / scan pipeline. */
export const ASSETS_GLB_URL = "/assets.glb";
export const PLATFORM_GRADIENT_URL = "/platform-gradient.png";

export const UNKNOWN_ICON = "all-unknown";

let assetLibrary: Promise<Map<string, THREE.BufferGeometry>> | null = null;
let gradientTexture: Promise<THREE.Texture> | null = null;

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

function loadAssetLibrary(): Promise<Map<string, THREE.BufferGeometry>> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader
    .loadAsync(ASSETS_GLB_URL)
    .then((gltf) => collectNamedGeometries(gltf.scene));
}

/** Shared mesh library from `/assets.glb` (icons, shapes, platform). */
export function loadAssetsGlb(): Promise<Map<string, THREE.BufferGeometry>> {
  assetLibrary ??= loadAssetLibrary();
  return assetLibrary;
}

/** Shared sRGB gradient map from the scan asset bake. */
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

/**
 * Load a named silhouette from `/assets.glb` (basename of `scan/assets/shapes/*.svg`).
 * Returns a cloned geometry safe for independent dispose.
 */
export async function loadShapeGeometry(
  shape: string,
): Promise<THREE.BufferGeometry> {
  const geometries = await loadAssetsGlb();
  const geometry = geometries.get(shape);
  if (!geometry) {
    throw new Error(`Shape "${shape}" not found in ${ASSETS_GLB_URL}`);
  }
  return geometry.clone();
}
