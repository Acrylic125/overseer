import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { graphSnapshotSchema, type GraphSnapshot } from "@acrylic125/overseer-sdk";

import { log } from "../cli/log.js";
import { ARTIFACT_GRAPH_JSON, artifactPath } from "../paths.js";

/** Write the linked graph to `graph.json`. Layout happens in the UI per lens. */
export async function writeGraphSnapshot(snapshot: GraphSnapshot, outDir: string) {
  const validated = graphSnapshotSchema.parse(snapshot);
  const outPath = artifactPath(outDir, ARTIFACT_GRAPH_JSON);
  log.section("Writing output");
  log.step(path.relative(process.cwd(), outPath) || ARTIFACT_GRAPH_JSON);

  await mkdir(outDir, { recursive: true });
  const temporaryPath = `${outPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(validated)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, outPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  for (const warning of snapshot.warnings) {
    log.warn(warning);
  }
}
