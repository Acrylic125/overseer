import * as THREE from "three";

/** One closed ribbon follows the entire centerline, including its curved bends. */
export function conveyorRibbon(
  points: readonly { x: number; z: number }[],
  side: number,
  width: number,
  bottom: number,
  top: number,
) {
  if (points.length < 2) return new THREE.BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const before = points[Math.max(0, i - 1)]!;
    const after = points[Math.min(points.length - 1, i + 1)]!;
    let ax = p.x - before.x;
    let az = p.z - before.z;
    let bx = after.x - p.x;
    let bz = after.z - p.z;
    const al = Math.hypot(ax, az);
    const bl = Math.hypot(bx, bz);
    if (al > 0) { ax /= al; az /= al; } else { ax = bx / bl; az = bz / bl; }
    if (bl > 0) { bx /= bl; bz /= bl; } else { bx = ax; bz = az; }
    const nx = az + bz;
    const nz = -ax - bx;
    const nl = Math.hypot(nx, nz);
    const ux = nl > 1e-6 ? nx / nl : az;
    const uz = nl > 1e-6 ? nz / nl : -ax;
    const miter = 1 / Math.max(0.25, ux * bz - uz * bx);
    for (const y of [bottom, top]) for (const edge of [-1, 1]) {
      const offset = (side + edge * width / 2) * miter;
      positions.push(p.x + ux * offset, y, p.z + uz * offset);
    }
    if (i > 0) {
      const a = (i - 1) * 4;
      const b = i * 4;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
      indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
      indices.push(a, a + 2, b, a + 2, b + 2, b);
      indices.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3);
    }
  }
  const last = (points.length - 1) * 4;
  if (points.length > 1) indices.push(0, 1, 2, 1, 3, 2, last, last + 2, last + 1, last + 1, last + 2, last + 3);
  for (let i = 0; i < indices.length; i += 3) {
    const second = indices[i + 1]!;
    indices[i + 1] = indices[i + 2]!;
    indices[i + 2] = second;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
