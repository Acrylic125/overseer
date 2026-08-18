import { readFile } from "node:fs/promises";

import {
  layout,
  linkByReferences,
  newAzureProvider,
  newCloudflareProvider,
  newInternetProvider,
  newVercelProvider,
  type LinkEntry,
  type ScrapeStepFn,
} from "@acrylic125/overseer-sdk";
import { config as loadEnv } from "dotenv";

import { elapsed, log } from "../cli/log.js";
import {
  ARTIFACT_ASSETS_GLB,
  artifactPath,
  envPath,
  resolveOutDir,
} from "../paths.js";
import { writeInfrastructureDb } from "../pipeline/output.js";
import { precomputeAssets } from "../pipeline/precompute.js";
import { envToProvider } from "../providers.js";

export type ScanPipelineOptions = {
  outDir?: string;
  skipPrecompute?: boolean;
};

async function scrapeProviders() {
  loadEnv({ path: envPath, quiet: true });

  const providers = envToProvider(process.env);
  const cloudflareProvider = newCloudflareProvider();
  const vercelProvider = newVercelProvider();
  const azureProvider = newAzureProvider();
  const warnings: string[] = [];
  const entries: LinkEntry[] = [...newInternetProvider().scan()];

  const onStep =
    (namespace: string): ScrapeStepFn =>
    (step) => {
      log.step(`${namespace}: ${step.message}`);
    };

  log.section("Scrape");

  for (const provider of providers.cloudflare) {
    try {
      entries.push(
        ...(await cloudflareProvider.scan(provider, onStep(provider.namespace))),
      );
    } catch (error) {
      warnings.push(
        `provider:${provider.namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const provider of providers.vercel) {
    try {
      entries.push(
        ...(await vercelProvider.scan(provider, onStep(provider.namespace))),
      );
    } catch (error) {
      warnings.push(
        `provider:${provider.namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const provider of providers.azure) {
    try {
      entries.push(
        ...(await azureProvider.scan(provider, onStep(provider.namespace))),
      );
    } catch (error) {
      warnings.push(
        `provider:${provider.namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  log.section("Link");
  log.step("Matching claims to connection requirements");
  const connections = linkByReferences(entries);
  const resources = entries.map((entry) => entry.resource);

  log.step(`${resources.length} resources · ${connections.length} connections`);
  return { resources, connections, warnings };
}

/**
 * Full Overseer pipeline:
 *   1. Precompute → assets.glb
 *   2. SDK scrape + transform + link
 *   3. SDK layout
 *   4. infrastructure.json
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

    const { resources, connections, warnings } = await scrapeProviders();
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
