import { readFile } from "node:fs/promises";

import { layout } from "@acrylic125/overseer-sdk";

import { elapsed, log } from "../cli/log.js";
import {
  ARTIFACT_ASSETS_GLB,
  artifactPath,
  resolveOutDir,
} from "../paths.js";
import { writeInfrastructureDb } from "../pipeline/output.js";
import { precomputeAssets } from "../pipeline/precompute.js";
import { runServiceScan } from "../pipeline/service-scan.js";

export type ScanPipelineOptions = {
  outDir?: string;
  skipPrecompute?: boolean;
};

/**
 * Full Overseer pipeline:
 *   1. Precompute → assets.glb
 *   2. SDK scrape + transform + link
 *   3. SDK layout
 *   4. infrastructure.json
 */
export async function runScanPipeline(
  options: ScanPipelineOptions = {},
): Promise<void> {
  const outDir = resolveOutDir(options.outDir);

  log.banner();
  log.start("Scanning...");

  try {
    if (options.skipPrecompute) {
      log.section("Building assets");
      log.step("Skipped");
    } else {
      await precomputeAssets({ outDir });
    }

    const { resources, connections, warnings } = await runServiceScan();
    const glbPath = artifactPath(outDir, ARTIFACT_ASSETS_GLB);
    log.section("Layout");
    log.start("Packing layout...");
    const start = Date.now();
    const packed = layout({
      resources,
      connections,
      glb: await readFile(glbPath),
    });
    log.step(
      `${packed.resources.length} resources · ${packed.layout.length} layout items (${elapsed(start)})`,
    );
    await writeInfrastructureDb({ layout: packed, warnings, outDir });

    log.done("Scan Complete!");
  } catch (error) {
    log.stop();
    throw error;
  }
}
