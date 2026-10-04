import assert from "node:assert/strict";
import { it } from "node:test";
import { fenceSpans } from "./data-center-fences";

const path = (points: { x: number; z: number }[]) => ({ id: "belt", sourceId: "a", targetId: "b", points });

it("leaves a full-width opening where a conveyor crosses a fence", () => {
  assert.deepEqual(fenceSpans(-2, 2, 0, "x", [path([{ x: 0, z: -1 }, { x: 0, z: 1 }])]), [[-2, -0.27], [0.27, 2]]);
});
it("clears conveyors running along the fence and merges overlapping openings", () => {
  assert.deepEqual(fenceSpans(-2, 2, 0, "x", [path([{ x: -3, z: 0.1 }, { x: 3, z: 0.1 }])]), []);
  const paths = [0, 0.2].map(x => path([{ x, z: -1 }, { x, z: 1 }]));
  assert.deepEqual(fenceSpans(-2, 2, 0, "x", paths), [[-2, -0.27], [0.2 + 0.27, 2]]);
});
it("preserves fences away from belts and handles crossings on the other axis", () => {
  assert.deepEqual(fenceSpans(-2, 2, 4, "x", [path([{ x: 0, z: -1 }, { x: 0, z: 1 }])]), [[-2, 2]]);
  assert.deepEqual(fenceSpans(-2, 2, 0, "z", [path([{ x: -1, z: 0 }, { x: 1, z: 0 }])]), [[-2, -0.27], [0.27, 2]]);
});
