import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { graphSnapshotSchema } from "../../packages/overseer-sdk/src/core/schemas";
import { layout, layoutLenses } from "../../packages/overseer-sdk/src/layout";
import { layoutOutputSchema, layoutOutputToDb } from "./layout-output-to-db";
import { layoutFromDb } from "./layout-from-db";
import { conveyorPacketRoute, dataCenterTransportPaths } from "./data-center";
import { buildConveyorBelts } from "./data-center-transport-geometry";

it("keeps the Data Center fixture's rectangular footprints through every graph lens and UI conversion", () => {
  const snapshot = graphSnapshotSchema.parse(JSON.parse(readFileSync("../test-env/graph.json", "utf8")));
  const glb = readFileSync("public/assets.glb");
  for (const lens of layoutLenses) {
    const db = layoutOutputToDb(layoutOutputSchema.parse(layout({ resources: snapshot.resources, edges: snapshot.edges, lens, glb })));
    assert.equal(db.resources.length, 8);
    assert.equal(db.connectors.length, 9);
    assert.deepEqual(db.static.publicInternet.size, [4, 2]);
    assert.ok(db.connectors.some(connector => connector.nodes.includes("internet")));
    for (const resource of snapshot.resources.filter(r => r.size)) {
      assert.deepEqual(db.resources.find(r => r.id === resource.id)?.size, resource.size, `${lens}: ${resource.id}`);
    }
  }
});

it("builds finite conveyor geometry for the complete Data Center fixture in every lens", () => {
  const snapshot = graphSnapshotSchema.parse(JSON.parse(readFileSync("../test-env/graph.json", "utf8")));
  const glb = readFileSync("public/assets.glb");
  for (const lens of layoutLenses) {
    const db = layoutOutputToDb(layoutOutputSchema.parse(layout({ resources: snapshot.resources, edges: snapshot.edges, lens, glb })));
    const scene = layoutFromDb(db, (resource, connections) => ({
      id: resource.id, type: resource.service, name: resource.name, group: resource.group,
      connections, dependsOn: [], species: "microservice", category: "compute",
      health: "healthy", zone: "compute", color: "#111827", fields: resource.fields,
    }))!;
    const routes = dataCenterTransportPaths(scene.connectorPaths, scene.services)
      .map(path => ({ path, motion: conveyorPacketRoute(path) }));
    const belts = buildConveyorBelts(routes)!;
    try {
      assert.equal(routes.length, 9);
      const positions = belts.mesh.geometry.getAttribute("position");
      assert.ok(positions.count > 0, lens);
      assert.ok(Array.from(positions.array).every(Number.isFinite), lens);
      assert.ok(routes.every(route => belts.regions.some(region => region.ids.includes(route.path.id))), lens);
    } finally {
      belts.mesh.geometry.dispose();
      belts.mesh.material.dispose();
      belts.lines.geometry.dispose();
      belts.lines.material.dispose();
    }
  }
});
