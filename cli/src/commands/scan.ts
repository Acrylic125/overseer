import { runLayout } from "../pipeline/layout/index.js";
import { writeInfrastructureDb } from "../pipeline/output.js";
import { precomputeAssets } from "../pipeline/precompute.js";
import { runServiceScan } from "../pipeline/service-scan.js";
import { log } from "../cli/log.js";
import { resolveOutDir } from "../paths.js";

export type ScanPipelineOptions = {
  /** Artifact directory (`./_generated` or `--dir`). */
  outDir?: string;
  /** Skip asset bake when iterating on scan/layout only. */
  skipPrecompute?: boolean;
};

/**
 * Full Overseer pipeline:
 *   1. Precompute → assets.glb (+ gradient) in outDir
 *   2. Service scan
 *   3. Layout
 *   4. Output infrastructure.json in outDir
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

    const { services, warnings } = await runServiceScan();
    const layout = await runLayout(services);
    await writeInfrastructureDb({ layout, warnings, outDir });

    log.done("Scan Complete!");
  } catch (error) {
    log.stop();
    throw error;
  }
}
