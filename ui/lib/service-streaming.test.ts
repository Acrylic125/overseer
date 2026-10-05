import assert from "node:assert/strict";
import { it } from "node:test";
import { buildServiceSpatialIndex, createServiceWindowSelector } from "./graph/service-streaming";
import type { InfrastructureService } from "@/server/routers/infrastructure";

const service = (id: string, x: number) => ({
  id, x, y: 0, width: 1, depth: 1,
}) as InfrastructureService;

it("retains the visible service array when camera movement crosses cells without changing membership", () => {
  const a = service("a", 0);
  const b = service("b", 12);
  const select = createServiceWindowSelector(buildServiceSpatialIndex([a, b]));
  const initial = select(4, 4);
  assert.deepEqual(initial, [a, b]);
  for (const x of [12, 20, 12, 4, -4, 4]) {
    assert.equal(select(x, 4), initial, "unchanged services must not invalidate resident geometry");
  }
});

it("updates the visible service array as resources enter and leave the window", () => {
  const a = service("a", 0);
  const b = service("b", 60);
  const select = createServiceWindowSelector(buildServiceSpatialIndex([a, b]));
  const initial = select(4, 4);
  assert.deepEqual(initial, [a]);
  const expanded = select(20, 4);
  assert.notEqual(expanded, initial);
  assert.deepEqual(expanded, [a, b]);
  assert.equal(select(28, 4), expanded);
  const moved = select(60, 4);
  assert.deepEqual(moved, [b]);
  assert.notEqual(moved, expanded);
  assert.deepEqual(select(4, 4), [a]);
});
