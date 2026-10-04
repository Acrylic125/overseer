import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";

import {
  buildingKind,
  conveyorPacketRoute,
  dataCenterLotFootprints,
  dataCenterPickHeight,
  packetPosition,
  packetRoute,
} from "./data-center";
import { pickServiceAt } from "./graph/pick-service";
import type { InfrastructureService } from "@/server/routers/infrastructure";

const service = (type: string) =>
  ({ type, category: "compute", species: "microservice" }) as const;

describe("Data Center service silhouettes", () => {
  it("recognizes provider identifiers even with the legacy compute fallback", () => {
    for (const [type, expected] of [
      ["aws-s3", "warehouse"],
      ["r2", "warehouse"],
      ["aws-rds", "database"],
      ["cf-d1", "database"],
      ["aws-sqs", "gantry"],
      ["aws-eventbridge", "watchtower"],
      ["cf-worker", "rack"],
      ["cloud", "gateway"],
    ]) {
      assert.equal(buildingKind(service(type!)), expected);
    }
    assert.equal(
      buildingKind({ ...service("custom"), category: "storage" }),
      "warehouse",
    );
  });
});

it("fits fences around variable service footprints and nested group members", () => {
  const platforms = [{ group: "Events", centerX: 0, centerZ: 0, width: 30, depth: 30 }];
  const services = [
    { id: "a", group: "Events", x: 3, y: -3.5, width: 2, depth: 1.5 },
    { id: "b", group: "Events/Workers", x: 6, y: -3.5, width: 1, depth: 3 },
    { id: "c", group: "Events", x: 3, y: 2, width: 1.5, depth: 1.5 },
    { id: "outside", group: "Other", x: 100, y: 100, width: 1, depth: 1 },
  ] as InfrastructureService[];
  const lot = dataCenterLotFootprints(platforms, services)[0]!;
  assert.ok(lot.width < 6 && lot.depth < 9);
  for (const s of services.slice(0, 3)) {
    assert.ok(s.x > lot.centerX - lot.width / 2 && s.x + s.width < lot.centerX + lot.width / 2);
    assert.ok(s.y > lot.centerZ - lot.depth / 2 && s.y + s.depth < lot.centerZ + lot.depth / 2);
  }
  assert.deepEqual(dataCenterLotFootprints(platforms, []), platforms);
});

describe("packet movement", () => {
  const route = packetRoute({
    id: "test",
    sourceId: "a",
    targetId: "b",
    points: [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 0 },
      { x: 3, z: 4 },
    ],
  });
  it("moves at constant world distance through a turn and wraps at the destination", () => {
    assert.equal(route.length, 7);
    assert.deepEqual(packetPosition(route, 2), {
      x: 2,
      z: 0,
      angle: Math.PI / 2,
    });
    assert.deepEqual(packetPosition(route, 5), { x: 3, z: 2, angle: 0 });
    assert.deepEqual(packetPosition(route, 9), packetPosition(route, 2));
    assert.deepEqual(packetPosition(route, -2), packetPosition(route, 5));
  });
  it("ignores degenerate segments and safely handles an empty route", () => {
    assert.equal(route.segments.length, 2);
    assert.equal(
      packetPosition(
        packetRoute({
          ...route.path,
          points: [
            { x: 0, z: 0 },
            { x: 0, z: 0 },
          ],
        }),
        1,
      ),
      null,
    );
  });
});

it("rounds a conveyor turn without moving its service ports or overshooting the junction", () => {
  const path = { id: "bend", sourceId: "a", targetId: "b", points: [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 4 }] };
  const route = conveyorPacketRoute(path);
  assert.deepEqual(route.path.points[0], path.points[0]);
  assert.deepEqual(route.path.points.at(-1), path.points.at(-1));
  assert.ok(route.length < 7 && route.length > 6.8);
  const curved = route.segments.filter(s => s.dx > 0.01 && s.dz > 0.01);
  assert.ok(curved.length > 2);
  for (const s of curved) {
    assert.ok(s.x <= 3 && s.z >= 0);
    assert.ok(Math.hypot(s.x - 3, s.z) < 0.42);
  }
  assert.deepEqual(packetPosition(route, route.length + 1), packetPosition(route, 1));
});

it("keeps short conveyor bends finite and tolerates duplicate or collinear points", () => {
  const path = { id: "short", sourceId: "a", targetId: "b", points: [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0.01, z: 0 }, { x: 0.02, z: 0 }, { x: 0.02, z: 0.01 }] };
  const route = conveyorPacketRoute(path);
  assert.ok(route.length > 0 && route.length <= 0.03);
  assert.ok(route.segments.every(s => Number.isFinite(s.dx) && Number.isFinite(s.dz) && s.length > 0));
  assert.equal(conveyorPacketRoute({ ...path, points: [] }).length, 0);
});

it("picks the raised building when its ground projection misses a non-square lot", () => {
  const building = {
    ...service("aws-eventbridge"),
    id: "tower",
    x: 0,
    y: 0,
    width: 3,
    depth: 1,
  } as InfrastructureService;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(1.5, 4, 6);
  camera.lookAt(1.5, 1.8, 0.5);
  camera.updateMatrixWorld();
  const element = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
  } as HTMLElement;
  assert.equal(pickServiceAt(100, 100, camera, element, [building]), null);
  assert.equal(
    pickServiceAt(100, 100, camera, element, [building], dataCenterPickHeight),
    "tower",
  );
});
