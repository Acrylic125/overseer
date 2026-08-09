import { config as loadEnv } from "dotenv";

import { log } from "../cli/log.js";
import { envPath } from "../paths.js";
import {
  transformProviders,
  type AzureProvider,
  type CloudflareProvider,
  type Provider,
  type VercelProvider,
} from "../providers.js";
import type { ScannedService } from "../schema.js";
import { AzureScanner } from "../scanners/azure/scrape.js";
import { CloudflareScanner } from "../scanners/cf/scrape.js";
import { finalizeScan } from "../scanners/transform.js";
import type { ScrapeContext, ScanOutcome } from "../scanners/types.js";
import { VercelScanner } from "../scanners/vercel/scrape.js";

/** Load provider tokens from `cli/.env` (no tip / inject noise). */
export function loadScanEnv(): void {
  loadEnv({ path: envPath, quiet: true });
}

function platformLabel(provider: Provider): string {
  switch (provider.provider) {
    case "cf":
      return "Cloudflare";
    case "vercel":
      return "Vercel";
    case "azure":
      return "Azure";
  }
}

type EnvEntry = {
  provider: Provider;
  name: string;
  platform: string;
  error?: string;
};

async function probeProvider(provider: Provider): Promise<string | null> {
  switch (provider.provider) {
    case "cf":
      return CloudflareScanner.probe(provider);
    case "vercel":
      return VercelScanner.probe(provider);
    case "azure":
      return AzureScanner.probe(provider);
  }
}

async function probeEnvironments(providers: Provider[]): Promise<EnvEntry[]> {
  const entries: EnvEntry[] = [];

  for (const provider of providers) {
    const base = {
      provider,
      name: provider.namespace,
      platform: platformLabel(provider),
    };
    const error = await probeProvider(provider);
    entries.push(error ? { ...base, error } : base);
  }

  return entries;
}

/**
 * Step 2 — scrape each provider, map resources → services,
 * then finalize with cross-provider env→domain links and the internet hub.
 */
export async function runServiceScan(): Promise<ScanOutcome> {
  loadScanEnv();

  const providers = transformProviders(process.env);

  if (providers.length === 0) {
    log.environments([]);
    return {
      services: [],
      warnings: [
        "No providers configured (PROVIDER_CF_*_API_KEY, PROVIDER_VERCEL_*_API_KEY, or PROVIDER_AZURE_*_{TENANT_ID,CLIENT_ID,PAT})",
      ],
    };
  }

  const environments = await probeEnvironments(providers);
  log.environments(
    environments.map(({ name, platform, error }) => ({
      name,
      platform,
      error,
    })),
  );

  const warnings: string[] = [];
  for (const entry of environments) {
    if (!entry.error) continue;
    warnings.push(`provider:${entry.provider.namespace}: ${entry.error}`);
  }

  const scannable = environments.filter((entry) => !entry.error);
  const cfProviders = scannable
    .map((entry) => entry.provider)
    .filter((p): p is CloudflareProvider => p.provider === "cf");
  const vercelProviders = scannable
    .map((entry) => entry.provider)
    .filter((p): p is VercelProvider => p.provider === "vercel");
  const azureProviders = scannable
    .map((entry) => entry.provider)
    .filter((p): p is AzureProvider => p.provider === "azure");

  const resources: ScrapeContext["resources"] = [];
  const services: ScannedService[] = [];

  if (cfProviders.length > 0) {
    const scanner = new CloudflareScanner(cfProviders);
    const ctx = await scanner.scrape();
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...scanner.transform(ctx));
  }

  if (vercelProviders.length > 0) {
    const scanner = new VercelScanner(vercelProviders);
    const ctx = await scanner.scrape();
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...scanner.transform(ctx));
  }

  if (azureProviders.length > 0) {
    const scanner = new AzureScanner(azureProviders);
    const ctx = await scanner.scrape();
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...scanner.transform(ctx));
  }

  log.section("Finalize");
  log.step(`${services.length} services · linking env → domains`);

  return finalizeScan(services, resources, warnings);
}
