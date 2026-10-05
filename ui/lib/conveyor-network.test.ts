import assert from "node:assert/strict";
import { it } from "node:test";
import { conveyorFootprint, containsPoint } from "./conveyor-network";

it("unions the overlapping offsets of a tight rounded conveyor bend", () => {
  // Captured from the database-to-queue route in the local Data Center fixture.
  const points = [
    { x: 1.97362475, z: 7.34968725 },
    { x: 1.969559, z: 7.348748999999999 },
    { x: 1.96611875, z: 7.34718525 },
    { x: 1.963304, z: 7.344995999999999 },
    { x: 1.96111475, z: 7.342181249999999 },
    { x: 1.959551, z: 7.338740999999999 },
    { x: 1.95861275, z: 7.33467525 },
    { x: 1.9583, z: 7.329984 },
    { x: 1.9833, z: 6.074999999999999 },
  ];
  const footprint = conveyorFootprint(points, 0.345);
  assert.equal(footprint.length, 1);
  for (const point of points) assert.ok(containsPoint(footprint, point.x, point.z));
  assert.ok(!containsPoint(footprint, 3, 7));
});
