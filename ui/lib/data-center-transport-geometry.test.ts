import assert from "node:assert/strict";
import { it } from "node:test";
import * as THREE from "three";
import { conveyorPacketRoute, DATA_CENTER } from "./data-center";
import { buildConveyorBelts, tintConveyorBelts } from "./data-center-transport-geometry";

it("hover and selection recolor resident conveyor buffers without replacing geometry", () => {
  const paths = [0, 2].map(z => ({ id: `belt-${z}`, sourceId: "a", targetId: "b", points: [{ x: 0, z }, { x: 3, z }] }));
  const belts = buildConveyorBelts(paths.map(path => ({ path, motion: conveyorPacketRoute(path) })))!;
  const geometry = belts.mesh.geometry;
  const positions = geometry.getAttribute("position");
  const positionCopy = Array.from(positions.array);
  const colors = geometry.getAttribute("color");
  const edges = belts.lines.geometry.getAttribute("instanceColorStart");
  const starts = belts.lines.geometry.getAttribute("instanceStart");
  const originalColorArray = colors.array;
  const originalEdgeArray = edges.array;
  const orange = new THREE.Color("#ff7f25");
  try {
    for (let i = 0; i < 20; i++) {
      tintConveyorBelts(belts, new Map([
        ["belt-0", { edge: "#ff7f25", dimmed: false }],
        ["belt-2", { edge: "#ff9237", dimmed: true }],
      ]));
      assert.equal(belts.mesh.geometry, geometry);
      assert.equal(geometry.getAttribute("position"), positions);
      assert.equal(belts.lines.geometry.getAttribute("instanceStart"), starts);
      assert.equal(colors.array, originalColorArray);
      assert.equal(edges.array, originalEdgeArray);
    }
    assert.deepEqual(Array.from(positions.array), positionCopy);
    assert.ok(Math.abs(edges.getX(0) - orange.r) < 1e-6);
    assert.ok(Math.abs(edges.getY(0) - orange.g) < 1e-6);
    const dimmedRange = belts.ranges.find(range => range.id === "belt-2")!;
    const dimmed = new THREE.Color(dimmedRange.fill).lerp(new THREE.Color(DATA_CENTER.background), 0.8);
    assert.ok(Math.abs(colors.getY(dimmedRange.start) - dimmed.g) < 1e-6);
    tintConveyorBelts(belts, new Map(paths.map(path => [path.id, { edge: "#ff9237", dimmed: false }])));
    assert.ok(Math.abs(colors.getY(dimmedRange.start) - new THREE.Color(dimmedRange.fill).g) < 1e-6);
  } finally {
    geometry.dispose();
    (belts.mesh.material as THREE.Material).dispose();
    belts.lines.geometry.dispose();
    belts.lines.material.dispose();
  }
});
