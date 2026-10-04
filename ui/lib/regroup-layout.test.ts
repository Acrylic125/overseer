import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ResourceLayoutResult } from "./layout-from-db";
import { regroupLayout } from "./regroup-layout";
import type { InfrastructureService } from "@/server/routers/infrastructure";

function service(id: string, type: string, group: string): InfrastructureService {
  return {
    id, type, group, name: id, x: 100, y: 100, width: 2, depth: 1,
    connections: [], species: "microservice", category: "compute",
    health: "healthy", zone: "compute", metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
    color: "#111827", fields: { details: { region: "Singapore" } },
  };
}

function fixture(): ResourceLayoutResult {
  const services = [
    service("test:a", "cf-worker", "production/api"),
    service("test:b", "cf-worker", "staging/api"),
    service("test:c", "cf-d1", "production/data"),
  ];
  services[1].width = 3;
  services[1].depth = 4;
  services[2].width = 6;
  services[2].depth = 2;
  services[0].connections = [services[2].id, "internet"];
  services[2].connections = [services[0].id];
  return {
    services,
    platforms: [{ group: "production", centerX: 50, centerZ: 50, width: 200, depth: 200 }],
    publicInternet: { id: "internet", group: null, centerX: 0, centerZ: 0, width: 4, depth: 2 },
    bounds: { centerX: 50, centerZ: 50, width: 200, depth: 200 },
    camera: { position: [0, 30, 0], span: 100, far: 150 },
    connectorPaths: [
      { id: "reverse", sourceId: "test:c", targetId: "test:a", points: [{ x: 100, z: 100 }, { x: 101, z: 100 }], variant: "warning", labels: ["database", "worker"] },
      { id: "internet", sourceId: "test:a", targetId: "internet", points: [{ x: 100, z: 100 }, { x: 0, z: 0 }], labels: ["public", null] },
    ],
  };
}

describe("layout grouping", () => {
  it("preserves the exact scanned layout by default", () => {
    const source = fixture();
    assert.equal(regroupLayout(source, "scanned"), source);
  });

  for (const mode of ["service-type", "ungrouped"] as const) {
    it(`${mode} repacks without overlaps or changes to scanned metadata`, () => {
      const source = fixture();
      const before = structuredClone(source);
      const result = regroupLayout(source, mode);
      assert.deepEqual(source, before);
      assert.deepEqual(result.services.map((s) => s.id).sort(), source.services.map((s) => s.id).sort());
      for (const placed of result.services) {
        const original = source.services.find((s) => s.id === placed.id)!;
        assert.deepEqual({ ...placed, x: original.x, y: original.y }, original);
        for (const other of result.services) {
          if (placed.id === other.id) continue;
          assert.ok(placed.x + placed.width <= other.x || other.x + other.width <= placed.x || placed.y + placed.depth <= other.y || other.y + other.depth <= placed.y);
        }
        if (mode === "service-type") {
          const platform = result.platforms.find((p) => p.group === placed.type)!;
          assert.ok(platform);
          assert.ok(placed.x >= platform.centerX - platform.width / 2);
          assert.ok(placed.x + placed.width <= platform.centerX + platform.width / 2);
          assert.ok(placed.y >= platform.centerZ - platform.depth / 2);
          assert.ok(placed.y + placed.depth <= platform.centerZ + platform.depth / 2);
        }
      }
      assert.equal(result.platforms.length, mode === "service-type" ? 2 : 0);
      assert.equal(result.connectorPaths.length, source.connectorPaths.length);
      for (const path of result.connectorPaths) {
        const original = source.connectorPaths.find((p) => p.id === path.id)!;
        assert.deepEqual({ ...path, points: original.points }, original);
        assert.notDeepEqual(path.points, original.points);
        const origin = result.services.find((s) => s.id === path.sourceId)!;
        const start = path.points[0];
        assert.ok(start.x >= origin.x && start.x <= origin.x + origin.width);
        assert.ok(start.z >= origin.y && start.z <= origin.y + origin.depth);
      }
      assert.ok(result.publicInternet.centerX + result.publicInternet.width / 2 < Math.min(...result.services.map((s) => s.x)));
      assert.equal(result.camera.position[0], result.bounds.centerX);
    });
  }

  it("handles empty scenes and hidden internet hubs", () => {
    const source = fixture();
    source.services = [];
    assert.equal(regroupLayout(source, "ungrouped"), source);
    const hidden = fixture();
    hidden.publicInternet.width = 0;
    hidden.publicInternet.depth = 0;
    hidden.connectorPaths = hidden.connectorPaths.filter((p) => p.id !== "internet");
    const result = regroupLayout(hidden, "service-type");
    assert.equal(result.bounds.centerX, 0);
    assert.equal(result.connectorPaths.length, 1);
  });
});
