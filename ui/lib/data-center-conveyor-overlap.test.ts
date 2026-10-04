import assert from "node:assert/strict";
import { it } from "node:test";
import * as THREE from "three";
import { conveyorPacketRoute, DATA_CENTER } from "./data-center";
import { BELT_Y, buildConveyorBelts, tintConveyorBelts } from "./data-center-transport-geometry";
import type { ConnectorPath } from "./graph/connector-paths";

const route = (id: string, points: ConnectorPath["points"]) => {
  const path = { id, sourceId: `${id}-source`, targetId: `${id}-target`, points };
  return { path, motion: conveyorPacketRoute(path) };
};

function verticalHits(routes: ReturnType<typeof route>[], x: number, z: number) {
  const belts = buildConveyorBelts(routes)!;
  try {
    belts.mesh.updateMatrixWorld();
    return new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0))
      .intersectObject(belts.mesh).map(hit => hit.point.y);
  } finally {
    belts.mesh.geometry.dispose();
    (belts.mesh.material as THREE.Material).dispose();
    belts.lines.geometry.dispose();
    belts.lines.material.dispose();
  }
}

function disposeBelts(belts: NonNullable<ReturnType<typeof buildConveyorBelts>>) {
  belts.mesh.geometry.dispose();
  (belts.mesh.material as THREE.Material).dispose();
  belts.lines.geometry.dispose();
  belts.lines.material.dispose();
}

it("renders one deck where duplicate conveyors share the same lane", () => {
  const points = [{ x: 0, z: 0 }, { x: 4, z: 0 }];
  const hits = verticalHits([route("a", points), route("b", [...points].reverse())], 1.13, 0.04);
  assert.equal(hits.filter(y => Math.abs(y - (BELT_Y + 0.028)) < 1e-5).length, 1);
});

it("renders one deck and no blocking guardrail inside a crossing", () => {
  const routes = [
    route("horizontal", [{ x: -2, z: 0 }, { x: 2, z: 0 }]),
    route("vertical", [{ x: 0, z: -2 }, { x: 0, z: 2 }]),
  ];
  const center = verticalHits(routes, 0.04, 0.03);
  assert.equal(center.filter(y => Math.abs(y - (BELT_Y + 0.028)) < 1e-5).length, 1);
  const rail = verticalHits(routes, 0.03, 0.16);
  assert.ok(rail.every(y => y <= BELT_Y + 0.047 + 1e-5), "no guardrail across the other conveyor's lane");
});

it("deduplicates a partial overlap while preserving both routes' unique sections", () => {
  const routes = [
    route("a", [{ x: 0, z: 0 }, { x: 3, z: 0 }]),
    route("b", [{ x: 1, z: 0 }, { x: 4, z: 0 }]),
  ];
  for (const x of [0.37, 1.37, 3.37]) {
    const hits = verticalHits(routes, x, 0.04);
    assert.equal(hits.filter(y => Math.abs(y - (BELT_Y + 0.028)) < 1e-5).length, 1);
  }
});

it("merges curved branches into a shared straight lane without interior rails", () => {
  const routes = [
    route("straight", [{ x: -3, z: 0 }, { x: 3, z: 0 }]),
    route("bend", [{ x: -1, z: -2 }, { x: -1, z: 0 }, { x: 3, z: 0 }]),
  ];
  for (const [x, z] of [[-1.03, -0.16], [-0.75, 0.04], [0.73, 0.04]]) {
    const hits = verticalHits(routes, x!, z!);
    assert.equal(hits.filter(y => Math.abs(y - (BELT_Y + 0.028)) < 1e-5).length, 1);
    assert.ok(hits.every(y => y <= BELT_Y + 0.047 + 1e-5));
  }
});

it("duplicate routes add no rollers or outlines and either connection can highlight the shared lane", () => {
  const points = [{ x: 0, z: 0 }, { x: 4, z: 0 }];
  const single = buildConveyorBelts([route("a", points)])!;
  const shared = buildConveyorBelts([route("a", points), route("b", [...points].reverse())])!;
  try {
    assert.equal(single.mesh.geometry.getAttribute("position").count, shared.mesh.geometry.getAttribute("position").count);
    assert.equal(single.lines.geometry.getAttribute("instanceStart").count, shared.lines.geometry.getAttribute("instanceStart").count);
    const deck = shared.ranges.find(range => range.count > 0 && range.fill === DATA_CENTER.surface)!;
    const outline = shared.ranges.find(range => range.edgeCount > 0)!;
    assert.deepEqual(deck.ids, ["a", "b"]);
    for (const active of ["a", "b"]) {
      tintConveyorBelts(shared, new Map(["a", "b"].map(id => [id, { edge: id === active ? "#ff7f25" : "#ff9237", dimmed: id !== active }])));
      const colors = shared.mesh.geometry.getAttribute("color");
      assert.ok(Math.abs(colors.getY(deck.start) - new THREE.Color(deck.fill).g) < 1e-6);
      const edges = shared.lines.geometry.getAttribute("instanceColorStart");
      assert.ok(Math.abs(edges.getY(outline.edgeStart) - new THREE.Color("#ff7f25").g) < 1e-6);
    }
  } finally {
    disposeBelts(single);
    disposeBelts(shared);
  }
});

it("nearby parallel conveyors have one deck across their overlap and retain their outside rails", () => {
  const routes = [0, 0.0833].map((z, i) => route(String(i), [{ x: 0, z }, { x: 3, z }]));
  for (const z of [-0.08, 0.04, 0.19]) {
    const hits = verticalHits(routes, 1.13, z);
    assert.equal(hits.filter(y => Math.abs(y - (BELT_Y + 0.028)) < 1e-5).length, 1);
    assert.ok(hits.every(y => y <= BELT_Y + 0.047 + 1e-5));
  }
  assert.ok(verticalHits(routes, 1.13, -0.16).some(y => Math.abs(y - (BELT_Y + 0.09)) < 1e-5));
});
