import path from "node:path";

import { buildAssets } from "../assets/index.js";
import { log } from "../cli/log.js";
import {
  ARTIFACT_ASSETS_GLB,
  ARTIFACT_GRADIENT_PNG,
  resolveOutDir,
} from "../paths.js";

export type PrecomputeOptions = {
  /** Output directory (`./_generated` or `--dir`). */
  outDir?: string;
};

/**
 * Bake icons + platform + shapes into a single `assets.glb` (and gradient PNG)
 * under the artifact directory.
 */
export async function precomputeAssets(
  options: PrecomputeOptions = {},
): Promise<{ outDir: string }> {
  const outDir = resolveOutDir(options.outDir);

  log.section("Building assets");
  log.step("Icons · platform · shapes → assets.glb");

  const result = await buildAssets(outDir);

  log.step(
    `${result.iconCount} icons · ${result.shapeCount} shapes`,
  );
  log.info(`  → ${path.relative(process.cwd(), result.glbFile) || ARTIFACT_ASSETS_GLB}`);
  log.info(
    `  → ${path.relative(process.cwd(), result.pngFile) || ARTIFACT_GRADIENT_PNG}`,
  );

  return { outDir };
}
