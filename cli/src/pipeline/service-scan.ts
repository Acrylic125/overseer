import {
  linkByReferences,
  newAzureProvider,
  newCloudflareProvider,
  newInternetProvider,
  newVercelProvider,
  type Resource,
  type ScrapeStepFn,
} from "@acrylic125/overseer-sdk";
import { config as loadEnv } from "dotenv";

import { log } from "../cli/log.js";
import { envPath } from "../paths.js";
import { envToProvider } from "../providers.js";

/** Load provider tokens from `cli/.env`. */
export function loadScanEnv(): void {
  loadEnv({ path: envPath, quiet: true });
}

export type ScanOutcome = {
  resources: Resource[];
  connections: ReturnType<typeof linkByReferences>;
  warnings: string[];
};

/**
 * Scrape each service scanner, then link by references / isExposedBy.
 */
export async function runServiceScan() {
  loadScanEnv();

  const providers = envToProvider(process.env);
  const cloudflareProvider = newCloudflareProvider();
  const vercelProvider = newVercelProvider();
  const azureProvider = newAzureProvider();
  const warnings: string[] = [];
  const entries = [...newInternetProvider().scan()];

  log.section("Scrape");

  for (const provider of providers.cloudflare) {
    try {
      entries.push(
        ...(await cloudflareProvider.scan(
          provider,
          (step: Parameters<ScrapeStepFn>[0]) =>
            log.step(`${provider.namespace}: ${step.message}`),
        )),
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
        ...(await vercelProvider.scan(
          provider,
          (step: Parameters<ScrapeStepFn>[0]) =>
            log.step(`${provider.namespace}: ${step.message}`),
        )),
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
        ...(await azureProvider.scan(
          provider,
          (step: Parameters<ScrapeStepFn>[0]) =>
            log.step(`${provider.namespace}: ${step.message}`),
        )),
      );
    } catch (error) {
      warnings.push(
        `provider:${provider.namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  log.section("Link");
  log.step("Matching references to exposures");
  const connections = linkByReferences(entries);
  const resources = entries.map((entry) => entry.resource);

  log.step(`${resources.length} resources · ${connections.length} connections`);
  return { resources, connections, warnings };
}
