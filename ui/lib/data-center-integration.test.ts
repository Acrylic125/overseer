import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { graphSnapshotSchema } from "../../packages/overseer-sdk/src/core/schemas";
import { layout, layoutLenses } from "../../packages/overseer-sdk/src/layout";
import { layoutOutputSchema, layoutOutputToDb } from "./layout-output-to-db";

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
