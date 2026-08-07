import * as THREE from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Same asset previewed by `/test` — mesh names match `gen-assets/icons/*.svg`. */
const ICONS_URL = "/icons.glb";
export const UNKNOWN_ICON = "all-unknown";

let iconLibrary: Promise<Map<string, THREE.BufferGeometry>> | null = null;

function collectNamedGeometries(
  root: THREE.Object3D,
): Map<string, THREE.BufferGeometry> {
  const geometries = new Map<string, THREE.BufferGeometry>();
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    // Node name often lives on the object; mesh resource name may be empty.
    const name = mesh.name || mesh.parent?.name;
    if (!name) return;
    geometries.set(name, mesh.geometry);
  });
  return geometries;
}

function loadIconLibrary(): Promise<Map<string, THREE.BufferGeometry>> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  return loader.loadAsync(ICONS_URL).then((gltf) => collectNamedGeometries(gltf.scene));
}

/**
 * Load a named icon mesh from `/icons.glb`, falling back to `all-unknown`.
 * Returns a cloned geometry safe for InstancedMesh use.
 */
export async function loadGlbIconGeometry(
  service: string,
): Promise<THREE.BufferGeometry> {
  iconLibrary ??= loadIconLibrary();
  const geometries = await iconLibrary;
  const geometry =
    geometries.get(service) ?? geometries.get(UNKNOWN_ICON);
  if (!geometry) {
    throw new Error(
      `Neither "${service}" nor "${UNKNOWN_ICON}" exists in ${ICONS_URL}`,
    );
  }
  return geometry.clone();
}
