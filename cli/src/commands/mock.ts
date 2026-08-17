import { readFile } from "node:fs/promises";

import { layout } from "@acrylic125/overseer-sdk";

import { createMockServices } from "../mock.js";
import { writeInfrastructureDb } from "../pipeline/output.js";
import { elapsed, log } from "../cli/log.js";
import {
  ARTIFACT_ASSETS_GLB,
  artifactPath,
  resolveOutDir,
} from "../paths.js";

export type MockOptions = {
  outDir?: string;
};

/** Synthetic infrastructure.json — same layout/output path as live scan. */
export async function runMock(options: MockOptions = {}): Promise<void> {
  const outDir = resolveOutDir(options.outDir);

  log.banner();
  log.start("Generating mock...");

  try {
    log.section("Mock services");
    log.step("Generating");
    const start = Date.now();
    const { resources, connections } = createMockServices();
    log.step(`${resources.length} services (${elapsed(start)})`);

    const glbPath = artifactPath(outDir, ARTIFACT_ASSETS_GLB);
    log.section("Layout");
    const packed = layout({
      resources,
      connections,
      glb: await readFile(glbPath),
    });
    await writeInfrastructureDb({
      layout: packed,
      warnings: ["Generated from cli/src/mock.ts"],
      outDir,
    });

    log.done("Mock Complete!");
  } catch (error) {
    log.stop();
    throw error;
  }
}
