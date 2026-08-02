import * as THREE from "three";

import { serviceWorldCenter } from "@/lib/graph/pack-layout";
import { CELL_SIZE } from "@/lib/infrastructure-styles";
import type { InfrastructureService } from "@/server/routers/infrastructure";

/** Extra margin around footprints so edges stay easy to click. */
const HIT_PAD = 0.2;

const _ndc = new THREE.Vector2();
const _hit = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
/** Ground plane (XZ), y = 0 — matches block bases. */
const _ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Pick the nearest service under the cursor.
 * Projects the ray onto the ground plane, then hits footprints (more reliable
 * than AABB tests from an oblique fly camera).
 */
export function pickServiceAt(
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  domElement: HTMLElement,
  services: InfrastructureService[],
): string | null {
  const rect = domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  _ndc.set(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  _raycaster.setFromCamera(_ndc, camera);

  if (!_raycaster.ray.intersectPlane(_ground, _hit)) return null;

  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const service of services) {
    const [cx, , cz] = serviceWorldCenter(service);
    const halfW = (service.width * CELL_SIZE) / 2 + HIT_PAD;
    const halfD = (service.depth * CELL_SIZE) / 2 + HIT_PAD;
    if (
      _hit.x < cx - halfW ||
      _hit.x > cx + halfW ||
      _hit.z < cz - halfD ||
      _hit.z > cz + halfD
    ) {
      continue;
    }
    const dist = (_hit.x - cx) ** 2 + (_hit.z - cz) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      bestId = service.id;
    }
  }

  return bestId;
}
