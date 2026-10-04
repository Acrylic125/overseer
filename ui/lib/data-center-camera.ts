import * as THREE from "three";

export function cameraGroundPoint(camera: THREE.Camera, out: THREE.Vector3) {
  camera.getWorldDirection(out);
  if (out.y < -0.01 && camera.position.y > 0) {
    out.multiplyScalar(-camera.position.y / out.y).add(camera.position);
  } else {
    out.copy(camera.position);
  }
  return out;
}

/** Fit the campus and raised holograms inside an isometric perspective. */
export function dataCenterCameraPosition(
  center: [number, number, number],
  width: number,
  depth: number,
  aspect: number,
  fov: number,
): [number, number, number] {
  const outward = new THREE.Vector3(1, 1, 1).normalize();
  const right = new THREE.Vector3(outward.z, 0, -outward.x).normalize();
  const up = new THREE.Vector3().crossVectors(outward, right);
  const vertical = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.96;
  const horizontal = vertical * Math.max(0.1, aspect);
  let distance = 8;
  for (const x of [-width / 2 - 0.8, width / 2 + 0.8])
    for (const z of [-depth / 2 - 0.8, depth / 2 + 0.8])
      for (const y of [0, 5]) {
        const corner = new THREE.Vector3(x, y, z);
        const along = corner.dot(outward);
        distance = Math.max(
          distance,
          along + Math.abs(corner.dot(right)) / horizontal,
          along + Math.abs(corner.dot(up)) / vertical,
        );
      }
  // Large scans use the scene's streamed neighborhood rather than zooming
  // outside its draw distance to fit the entire infrastructure at once.
  distance = Math.min(distance, 85);
  return [
    center[0] + outward.x * distance,
    center[1] + outward.y * distance,
    center[2] + outward.z * distance,
  ];
}
