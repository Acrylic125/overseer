import assert from "node:assert/strict";
import { it } from "node:test";
import { dataCenterTransportPaths } from "./data-center";
import type { InfrastructureService } from "@/server/routers/infrastructure";
import { serviceAccessPorts } from "./data-center-access";
import type { ConnectorPath } from "./graph/connector-paths";

const service = { id: "warehouse", x: 0, y: 0, width: 4, depth: 2 };
const path = (sourceId: string, targetId: string, points: ConnectorPath["points"]): ConnectorPath => ({ id: "path", sourceId, targetId, points });
it("opens every connected warehouse side for incoming and outgoing conveyors", () => {
  const ports = serviceAccessPorts(service, [
    path("warehouse", "a", [{ x: 4, z: 0.7 }, { x: 5, z: 0.7 }]),
    path("b", "warehouse", [{ x: 1, z: -1 }, { x: 1, z: 0 }]),
    path("warehouse", "c", [{ x: 3, z: 2 }, { x: 3, z: 3 }]),
    path("d", "warehouse", [{ x: -1, z: 0.5 }, { x: 0, z: 0.5 }]),
  ]);
  assert.deepEqual([...ports.keys()].sort(), ["east", "north", "south", "west"]);
  assert.deepEqual(ports.get("north"), [-1]);
  assert.deepEqual(ports.get("south"), [-1]);
  assert.deepEqual(ports.get("west"), [0.5]);
});
it("keeps distinct ports, deduplicates shared ports, and ignores unrelated or degenerate routes", () => {
  const routes = [1, 2, 1].map(x => path("warehouse", "a", [{ x, z: 0 }, { x, z: 0 }, { x, z: -1 }]));
  routes.push(path("a", "b", [{ x: 4, z: 1 }, { x: 5, z: 1 }]));
  routes.push(path("warehouse", "b", [{ x: 0, z: 0 }]));
  assert.deepEqual([...serviceAccessPorts(service, routes)], [["north", [-1, 0]]]);
});

it("extends belts through open thresholds without changing the side or lateral port", () => {
  const warehouse = { ...service, type: "r2", category: "storage", species: "object_storage" } as InfrastructureService;
  const gate = { ...service, id: "gate", x: 6, type: "azure-entra", category: "integration" } as InfrastructureService;
  const original = path("warehouse", "gate", [{ x: 4, z: 1 }, { x: 6, z: 1 }]);
  const [extended] = dataCenterTransportPaths([original], [warehouse, gate]);
  assert.equal(extended!.points[0]!.x, 3.68);
  assert.equal(extended!.points.at(-1)!.x, 6.32);
  assert.deepEqual(serviceAccessPorts(warehouse, [extended!]), serviceAccessPorts(warehouse, [original]));
  assert.deepEqual(serviceAccessPorts(gate, [extended!]), serviceAccessPorts(gate, [original]));
  assert.equal(original.points.length, 2);
});
