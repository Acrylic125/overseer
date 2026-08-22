import { readFile } from "node:fs/promises";

import {
  azureScanners,
  cloudflareScanners,
  layout,
  linkByReferences,
  vercelScanners,
  type LinkEntry,
  type ScrapeStepFn,
} from "@acrylic125/overseer-sdk";
import Cloudflare from "cloudflare";
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

async function listCloudflareAccountIds(client: Cloudflare) {
  const accountIds: string[] = [];
  for await (const account of client.accounts.list()) {
    if (account.id) accountIds.push(account.id);
  }
  if (accountIds.length === 0) {
    throw new Error("Cloudflare token has no accessible accounts");
  }
  return accountIds;
}

async function scrapeProviders() {
  loadEnv({ path: envPath, quiet: true });

  const providers = envToProvider(process.env);
  const warnings: string[] = [];
  const entries: LinkEntry[] = [];

  const onStep =
    (namespace: string): ScrapeStepFn =>
    (step) => {
      log.step(`${namespace}: ${step.message}`);
    };

  log.section("Scrape");

  for (const provider of providers.cloudflare) {
    try {
      const client = new Cloudflare({ apiToken: provider.apiKey });
      onStep(provider.namespace)({ message: "Listing accounts" });
      const accountIds = await listCloudflareAccountIds(client);

      for (const accountId of accountIds) {
        try {
          const accountStep: ScrapeStepFn = (step) => {
            log.step(`${provider.namespace}/${accountId}: ${step.message}`);
          };
          const account = {
            client,
            accountId,
            account: { account_id: accountId },
            fn: accountStep,
          };
          for (const scanner of cloudflareScanners) {
            const items = await scanner.scrape(account);
            entries.push(...scanner.link(items, provider.namespace));
          }
        } catch (error) {
          warnings.push(
            `provider:${provider.namespace}/account:${accountId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      warnings.push(
        `provider:${provider.namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const provider of providers.vercel) {
    try {
      const step = onStep(provider.namespace);
      for (const scanner of vercelScanners) {
        const items = await scanner.scrape(
          provider.apiKey,
          provider.teamId,
          step,
        );
        entries.push(...scanner.link(items, provider.namespace));
      }
    } catch (error) {
      warnings.push(
        `provider:${provider.namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const provider of providers.azure) {
    try {
      const step = onStep(provider.namespace);
      for (const scanner of azureScanners) {
        const items = await scanner.scrape(
          provider.tenantId,
          provider.clientId,
          provider.clientSecret,
          step,
        );
        entries.push(...scanner.link(items, provider.namespace));
      }
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
