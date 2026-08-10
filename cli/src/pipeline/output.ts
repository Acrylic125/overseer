import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LayoutResult } from "./layout/index.js";
import { log } from "../cli/log.js";
import {
  ARTIFACT_INFRASTRUCTURE_JSON,
  artifactPath,
} from "../paths.js";
import {
  infrastructureDbSchema,
  type InfrastructureDb,
} from "../schema.js";

export type WriteDbInput = {
  layout: LayoutResult;
  warnings: string[];
  /** Artifact directory (`_generated` or `--dir`). */
  outDir: string;
};

/**
 * Step 4 — Validate and write `infrastructure.json` into the artifact dir.
 */
export async function writeInfrastructureDb(
  input: WriteDbInput,
): Promise<InfrastructureDb> {
  const outPath = artifactPath(input.outDir, ARTIFACT_INFRASTRUCTURE_JSON);
  log.section("Writing output");
  log.start("Writing output...");
  log.step(path.relative(process.cwd(), outPath) || ARTIFACT_INFRASTRUCTURE_JSON);

  const db: InfrastructureDb = infrastructureDbSchema.parse({
    resources: input.layout.resources,
    groups: input.layout.groups,
    static: input.layout.static,
    connectors: input.layout.connectors,
  });

  await mkdir(input.outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");

  for (const warning of input.warnings) {
    log.warn(warning);
  }

  return db;
}
