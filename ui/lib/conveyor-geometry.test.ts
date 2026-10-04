import assert from "node:assert/strict";
import { it } from "node:test";
import * as THREE from "three";
import { conveyorPacketRoute } from "./data-center";
import { conveyorRibbon } from "./conveyor-geometry";

it("makes a continuous, closed conveyor through a bend with upward-facing belt surfaces", () => {
  const route = conveyorPacketRoute({ id: "turn", sourceId: "a", targetId: "b", points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 2 }] });
  const geometry = conveyorRibbon(route.path.points, 0, 0.34, 0.15, 0.21);
  const positions = geometry.getAttribute("position");
  const indices = geometry.getIndex()!;
  const edges = new Map<string, number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const normal = new THREE.Vector3();
  for (let i = 0; i < indices.count; i += 3) {
    const tri = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    for (let j = 0; j < 3; j++) {
      const pair = [tri[j]!, tri[(j + 1) % 3]!].sort((x, y) => x - y).join(":");
      edges.set(pair, (edges.get(pair) ?? 0) + 1);
    }
    a.fromBufferAttribute(positions, tri[0]!);
    b.fromBufferAttribute(positions, tri[1]!);
    c.fromBufferAttribute(positions, tri[2]!);
    if ([a, b, c].every(p => Math.abs(p.y - 0.21) < 1e-6)) {
      THREE.Triangle.getNormal(a, b, c, normal);
      assert.ok(normal.y > 0.99);
    }
  }
  assert.ok([...edges.values()].every(count => count === 2), "no open seams or unmatched edges at the bend");
  assert.ok(Array.from(positions.array).every(Number.isFinite));
  geometry.dispose();
});

it("keeps the guard rails the same distance apart through the curve", () => {
  const route = conveyorPacketRoute({ id: "curve", sourceId: "a", targetId: "b", points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: -2 }] });
  const left = conveyorRibbon(route.path.points, -0.18, 0.025, 0.2, 0.27);
  const right = conveyorRibbon(route.path.points, 0.18, 0.025, 0.2, 0.27);
  const a = left.getAttribute("position");
  const b = right.getAttribute("position");
  for (let i = 0; i < route.path.points.length; i++) {
    const j = i * 4;
    const separation = Math.hypot((b.getX(j) + b.getX(j + 1) - a.getX(j) - a.getX(j + 1)) / 2, (b.getZ(j) + b.getZ(j + 1) - a.getZ(j) - a.getZ(j + 1)) / 2);
    assert.ok(separation >= 0.359 && separation < 0.365);
  }
  left.dispose();
  right.dispose();
});
