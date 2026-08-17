import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LayoutOutput } from "@acrylic125/overseer-sdk";

import { log } from "../cli/log.js";
import {
  ARTIFACT_INFRASTRUCTURE_JSON,
  artifactPath,
} from "../paths.js";

export type WriteDbInput = {
  layout: LayoutOutput;
  warnings: string[];
  outDir: string;
};

/** Write SDK layout output to `infrastructure.json`. */
export async function writeInfrastructureDb(
  input: WriteDbInput,
): Promise<LayoutOutput> {
  const outPath = artifactPath(input.outDir, ARTIFACT_INFRASTRUCTURE_JSON);
  log.section("Writing output");
  log.start("Writing output...");
  log.step(path.relative(process.cwd(), outPath) || ARTIFACT_INFRASTRUCTURE_JSON);

  await mkdir(input.outDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(input.layout, null, 2)}\n`, "utf8");

  for (const warning of input.warnings) {
    log.warn(warning);
  }

  return input.layout;
}
