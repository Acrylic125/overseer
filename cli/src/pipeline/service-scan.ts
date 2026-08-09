import { config as loadEnv } from "dotenv";

import { log } from "../cli/log.js";
import { envPath } from "../paths.js";
import { transformProviders } from "../providers.js";
import type { ScannedService } from "../schema.js";
import { scrapeCloudflare } from "../scanners/cf/scrape.js";
import { finalizeScan, resourceToService } from "../scanners/transform.js";
import type { ScrapeContext, ScanOutcome } from "../scanners/types.js";
import { scrapeVercel } from "../scanners/vercel/scrape.js";

/** Load provider tokens (cli/.env first, then ui/.env). */
export function loadScanEnv(): void {
  loadEnv({ path: envPath });
}

/**
 * Step 2 — scrape each provider, map resources → services,
 * then finalize with cross-provider env→domain links and the internet hub.
 */
export async function runServiceScan(): Promise<ScanOutcome> {
  loadScanEnv();

  const providers = transformProviders(process.env);
  const cfProviders = providers.filter((p) => p.provider === "cf");
  const vercelProviders = providers.filter((p) => p.provider === "vercel");

  if (cfProviders.length === 0 && vercelProviders.length === 0) {
    log.section("Scanning providers");
    log.step("No providers configured");
    return {
      services: [],
      warnings: [
        "No providers configured (PROVIDER_CF_*_API_KEY or PROVIDER_VERCEL_*_API_KEY)",
      ],
    };
  }

  const resources: ScrapeContext["resources"] = [];
  const warnings: string[] = [];
  const services: ScannedService[] = [];

  if (cfProviders.length > 0) {
    const ctx = await scrapeCloudflare(cfProviders);
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...ctx.resources.map(resourceToService));
  } else {
    log.section("Scanning Cloudflare");
    log.step("No providers configured");
  }

  if (vercelProviders.length > 0) {
    const ctx = await scrapeVercel(vercelProviders);
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...ctx.resources.map(resourceToService));
  } else {
    log.section("Scanning Vercel");
    log.step("No providers configured");
  }

  log.section("Finalize");
  log.step(`${services.length} services · linking env → domains`);

  return finalizeScan(services, resources, warnings);
}
