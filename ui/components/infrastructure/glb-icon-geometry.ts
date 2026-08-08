import type { BufferGeometry } from "three";

import { loadAssetsGlb, UNKNOWN_ICON } from "@/lib/platform-assets";

export { UNKNOWN_ICON };

/**
 * Load a named icon mesh from `/assets.glb`, falling back to `all-unknown`.
 * Returns a cloned geometry safe for InstancedMesh use.
 */
export async function loadGlbIconGeometry(
  service: string,
): Promise<BufferGeometry> {
  const geometries = await loadAssetsGlb();
  const geometry = geometries.get(service) ?? geometries.get(UNKNOWN_ICON);
  if (!geometry) {
    throw new Error(
      `Neither "${service}" nor "${UNKNOWN_ICON}" exists in /assets.glb`,
    );
  }
  return geometry.clone();
}
