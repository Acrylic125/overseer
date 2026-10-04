import { fileCache, overseer } from "@acrylic125/overseer-sdk";
import { config as loadEnv } from "dotenv";

import { log } from "../cli/log.js";
import { cacheDir, envPath, resolveOutDir } from "../paths.js";
import { writeGraphSnapshot } from "../pipeline/output.js";
import { precomputeAssets } from "../pipeline/precompute.js";
import { envToProviders } from "../providers.js";

export type ScanPipelineOptions = {
  outDir?: string;
  skipPrecompute?: boolean;
  /** Scope filters: `cloudflare`, `cloudflare:prod`, `cloudflare:prod/worker`. */
  only?: string[];
  force?: boolean;
  /** Skip the network entirely and rebuild `graph.json` from the cache. */
  offline?: boolean;
};

/**
 * Overseer pipeline:
 *   1. Precompute → assets.glb
 *   2. Sync stale scopes into the cache
 *   3. Link cached scopes → graph.json
 */
export async function runScanPipeline(options: ScanPipelineOptions = {}) {
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

    loadEnv({ path: envPath, quiet: true });
    const client = overseer({
      providers: envToProviders(process.env),
      cache: fileCache(cacheDir),
    });
    const warnings: string[] = [];

    if (!options.offline) {
      log.section("Sync");
      const result = await client.sync({
        only: options.only,
        force: options.force,
        onStep: (step) => log.step(step.message),
      });
      log.step(
        `${result.scraped.length} scraped · ${result.fresh.length} fresh (cached) · ${result.failed.length} failed`,
      );
      for (const failure of result.failed) {
        warnings.push(`${failure.scope}: ${failure.error}`);
      }
    }

    log.section("Link");
    const snapshot = await client.snapshot();
    log.step(
      `${snapshot.resources.length} resources · ${snapshot.edges.length} edges · ${Object.keys(snapshot.changes).length} changed · ${snapshot.removed.length} removed`,
    );
    await writeGraphSnapshot(
      { ...snapshot, warnings: [...snapshot.warnings, ...warnings] },
      outDir,
    );

    log.done("Scan Complete!");
  } catch (error) {
    log.stop();
    throw error;
  }
}
