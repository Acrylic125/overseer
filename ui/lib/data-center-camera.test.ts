import assert from "node:assert/strict";
import { it } from "node:test";
import * as THREE from "three";
import { cameraGroundPoint, dataCenterCameraPosition } from "./data-center-camera";
import { buildServiceSpatialIndex, quantizeFocus, streamServicesInWindow } from "./graph/service-streaming";
import type { InfrastructureService } from "@/server/routers/infrastructure";

it("frames every campus corner and hologram on wide and portrait screens", () => {
  for (const aspect of [16 / 10, 390 / 844]) {
    const center: [number, number, number] = [2, 0, -1];
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 1000);
    camera.position.set(...dataCenterCameraPosition(center, 22, 12, aspect, 42));
    camera.lookAt(...center);
    camera.updateMatrixWorld();
    for (const x of [-11, 11])
      for (const z of [-6, 6])
        for (const y of [0, 5]) {
          const projected = new THREE.Vector3(center[0] + x, y, center[2] + z).project(camera);
          assert.ok(Math.abs(projected.x) <= 0.96, `Horizontal clipping at aspect ${aspect}`);
          assert.ok(Math.abs(projected.y) <= 0.96, `Vertical clipping at aspect ${aspect}`);
          assert.ok(projected.z > -1 && projected.z < 1);
        }
  }
});

it("keeps services in the portrait overview's ground target within the stream window", () => {
  const camera = new THREE.PerspectiveCamera(42, 390 / 844, 0.1, 150);
  const center: [number, number, number] = [2, 0, -1];
  camera.position.set(...dataCenterCameraPosition(center, 22, 12, camera.aspect, 42));
  camera.lookAt(...center);
  camera.updateMatrixWorld();
  const service = { id: "warehouse", x: -8, y: 2, width: 3, depth: 2 } as InfrastructureService;
  const index = buildServiceSpatialIndex([service]);
  const behindCamera = quantizeFocus(camera.position.x, camera.position.z);
  assert.equal(streamServicesInWindow(index, behindCamera.focusX, behindCamera.focusZ).length, 0);
  const point = cameraGroundPoint(camera, new THREE.Vector3());
  const focus = quantizeFocus(point.x, point.z);
  assert.deepEqual(streamServicesInWindow(index, focus.focusX, focus.focusZ).map(s => s.id), ["warehouse"]);
});
