import { config as loadEnv } from "dotenv";

import { log } from "../cli/log.js";
import {
  ensureInternetHub,
  linkInternetDomains,
} from "../internet.js";
import { envPath } from "../paths.js";
import {
  transformProviders,
  type AzureProvider,
  type CloudflareProvider,
  type Provider,
  type VercelProvider,
} from "../providers.js";
import type { ConnectorMeta, ScannedService } from "../schema.js";
import { linkEntraByEnvValues } from "../scanners/azure/transform.js";
import { AzureScanner } from "../scanners/azure/scrape.js";
import {
  applyCfEnvFields,
  transformCf,
} from "../scanners/cf/transform.js";
import { CloudflareScanner } from "../scanners/cf/scrape.js";
import type {
  ScrapedCfWorker,
  ScrapedResource,
  ScrapedVercelProject,
  ScanOutcome,
} from "../scanners/types.js";
import {
  applyVercelEnvFields,
  transformVercel,
} from "../scanners/vercel/transform.js";
import { VercelScanner } from "../scanners/vercel/scrape.js";
import { envValueForLinking, parseEnvUrl, urlsFromEnvValue } from "../utils.js";

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

function hostFromDomain(domain: string): string | null {
  const url = parseEnvUrl(domain.includes("://") ? domain : `https://${domain}`);
  return url?.hostname.toLowerCase() ?? null;
}

function resourceDomains(resource: ScrapedResource): string[] {
  switch (resource.kind) {
    case "cf-worker":
    case "cf-r2":
    case "vercel-project":
      return resource.domains;
    default:
      return [];
  }
}

function resourceEnvs(resource: ScrapedResource) {
  switch (resource.kind) {
    case "cf-worker":
    case "vercel-project":
      return resource.envs;
    default:
      return [];
  }
}

function addConnection(
  service: ScannedService,
  targetId: string,
  meta?: ConnectorMeta,
): void {
  if (!service.connections.includes(targetId)) {
    service.connections.push(targetId);
  }
  if (!meta) return;

  const prev = service.connectionMeta?.[targetId];
  if (prev?.variant === "warning" && meta.variant !== "warning") return;

  service.connectionMeta = {
    ...(service.connectionMeta ?? {}),
    [targetId]: meta,
  };
}

function corsAllowsOrigin(cors: string[], origin: string): boolean {
  const normalized = origin.toLowerCase();
  for (const entry of cors) {
    const parts = entry.trim().split(/\s+/);
    const allowed = parts[parts.length - 1]?.toLowerCase();
    if (!allowed) continue;
    if (allowed === "*") return true;
    if (allowed === normalized) return true;
    if (allowed.startsWith("*.") && normalized.endsWith(allowed.slice(1))) {
      return true;
    }
  }
  return false;
}

function resourceById(resources: ScrapedResource[]): Map<string, ScrapedResource> {
  return new Map(resources.map((resource) => [resource.id, resource]));
}

function domainsByServiceId(
  resources: ScrapedResource[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const resource of resources) {
    const domains = resourceDomains(resource);
    if (resource.kind === "cf-r2") {
      domains.push(resource.s3ApiUrl);
    }
    if (domains.length > 0) {
      map.set(resource.id, domains);
    }
  }
  return map;
}

/** Link services when a raw env value references another service's domain. */
function linkEnvToDomains(
  services: ScannedService[],
  resources: ScrapedResource[],
): void {
  const byResourceId = resourceById(resources);
  const ownersByHost = new Map<string, Set<string>>();

  for (const [serviceId, domains] of domainsByServiceId(resources)) {
    for (const domain of domains) {
      const host = hostFromDomain(domain);
      if (!host) continue;
      const owners = ownersByHost.get(host) ?? new Set<string>();
      owners.add(serviceId);
      ownersByHost.set(host, owners);
    }
  }

  const byId = new Map(services.map((service) => [service.id, service]));

  for (const resource of resources) {
    const service = byId.get(resource.id);
    if (!service) continue;

    for (const env of resourceEnvs(resource)) {
      const value = envValueForLinking(env);
      if (!value) continue;
      for (const url of urlsFromEnvValue(value)) {
        const host = url.hostname.toLowerCase();
        const owners = ownersByHost.get(host);
        if (!owners) continue;
        for (const ownerId of owners) {
          if (ownerId === resource.id) continue;
          const owner = byResourceId.get(ownerId);
          const label = host;

          if (owner?.kind === "cf-r2") {
            const origin = `${url.protocol}//${url.host}`;
            const allowed = corsAllowsOrigin(owner.cors, origin);
            if (allowed) {
              addConnection(service, ownerId, {
                variant: "default",
                labels: [label, label],
              });
            } else {
              addConnection(service, ownerId, {
                variant: "warning",
                labels: [label, "origin not allowed"],
              });
            }
          } else {
            addConnection(service, ownerId, {
              variant: "default",
              labels: [label, label],
            });
          }
        }
      }
    }
  }
}

/**
 * Step 2 — scrape, link on raw env values, then redact env fields for output.
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

  const resources: ScrapedResource[] = [];
  const services: ScannedService[] = [];

  if (cfProviders.length > 0) {
    const scanner = new CloudflareScanner(cfProviders);
    const ctx = await scanner.scrape();
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...transformCf(ctx));
  }

  if (vercelProviders.length > 0) {
    const scanner = new VercelScanner(vercelProviders);
    const ctx = await scanner.scrape();
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...transformVercel(ctx));
  }

  if (azureProviders.length > 0) {
    const scanner = new AzureScanner(azureProviders);
    const ctx = await scanner.scrape();
    resources.push(...ctx.resources);
    warnings.push(...ctx.warnings);
    services.push(...scanner.transform(ctx));
  }

  log.section("Finalize");
  log.step(`${services.length} services · linking env values`);

  // Link on raw scrape data before env redaction.
  linkEnvToDomains(services, resources);
  linkEntraByEnvValues(services, resources);
  linkInternetDomains(services, domainsByServiceId(resources));

  const cfWorkers = resources.filter(
    (resource): resource is ScrapedCfWorker => resource.kind === "cf-worker",
  );
  const vercelProjects = resources.filter(
    (resource): resource is ScrapedVercelProject =>
      resource.kind === "vercel-project",
  );
  applyCfEnvFields(services, cfWorkers);
  applyVercelEnvFields(services, vercelProjects);

  return {
    services: ensureInternetHub(services),
    warnings: [...warnings],
  };
}
