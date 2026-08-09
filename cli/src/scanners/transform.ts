import type {
  CategoryFields,
  ScannedService,
  ServiceFields,
} from "../schema.js";
import { ensureInternetHub } from "../internet.js";
import {
  iconServiceForAzureKind,
  iconServiceForCfKind,
  iconServiceForVercelKind,
} from "../icons.js";
import { isSecretEnvType, redactSensitiveValue } from "../utils.js";
import type {
  ScrapedAzureEntraSecret,
  ScrapedEnvVar,
  ScrapedResource,
  ScanOutcome,
} from "./types.js";

/**
 * Field category keys for env vars, split by deploy target:
 *   `environment:production` | `environment:preview` | `environment:development`
 *   | `environment:shared` (no target)
 *
 * Multi-target vars are duplicated into each target bucket. UI tabs these.
 */
export const ENV_CATEGORY_PREFIX = "environment:";
export const ENV_SHARED_TARGET = "shared";

const ENV_TARGET_ORDER = [
  "production",
  "preview",
  "development",
  ENV_SHARED_TARGET,
] as const;

function displayEnvValue(env: ScrapedEnvVar): string {
  // Undecrypted ciphertext isn't useful in the UI — fully mask it.
  if (env.type === "encrypted" && env.decrypted === false) {
    return "******";
  }
  if (isSecretEnvType(env.type)) {
    return redactSensitiveValue(env.value);
  }
  return env.value;
}

function writeEnvFields(fields: CategoryFields, env: ScrapedEnvVar): void {
  const base = env.key;
  // Same key can appear once per target bucket; disambiguate branches.
  const fieldKey =
    env.gitBranch && env.gitBranch.length > 0
      ? `${base} [${env.gitBranch}]`
      : base;

  // UI only needs name → value; keep metadata out of the scan output.
  fields[fieldKey] = displayEnvValue(env);
}

function normalizeEnvTarget(target: string): string {
  const trimmed = target.trim().toLowerCase();
  return trimmed || ENV_SHARED_TARGET;
}

/** Build per-target `environment:<target>` categories (secrets redacted). */
export function buildEnvironmentFieldsByTarget(
  envs: ScrapedEnvVar[],
): ServiceFields {
  const buckets = new Map<string, CategoryFields>();

  for (const env of envs) {
    const targets =
      env.target && env.target.length > 0
        ? env.target.map(normalizeEnvTarget)
        : [ENV_SHARED_TARGET];

    for (const target of new Set(targets)) {
      const bucket = buckets.get(target) ?? {};
      writeEnvFields(bucket, env);
      buckets.set(target, bucket);
    }
  }

  const ordered = [...buckets.keys()].sort((a, b) => {
    const ai = ENV_TARGET_ORDER.indexOf(a as (typeof ENV_TARGET_ORDER)[number]);
    const bi = ENV_TARGET_ORDER.indexOf(b as (typeof ENV_TARGET_ORDER)[number]);
    const aRank = ai === -1 ? ENV_TARGET_ORDER.length : ai;
    const bRank = bi === -1 ? ENV_TARGET_ORDER.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });

  const fields: ServiceFields = {};
  for (const target of ordered) {
    fields[`${ENV_CATEGORY_PREFIX}${target}`] = buckets.get(target)!;
  }
  return fields;
}

/** Normalize a hostname / URL-ish string to a bare lowercase host. */
export function normalizeHost(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  if (!value) return null;

  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch {
      return null;
    }
  }

  value = value.split("/")[0] ?? "";
  value = value.replace(/:\d+$/, "").replace(/\.$/, "");
  if (!value) return null;

  if (value === "localhost") return value;

  // Require a dotted hostname so random words don't match.
  if (!value.includes(".")) return null;
  if (
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
      value,
    )
  ) {
    return null;
  }

  return value;
}

/** Extract hostnames referenced by an environment value. */
export function hostsFromEnvValue(value: string): string[] {
  const hosts = new Set<string>();
  const trimmed = value.trim();
  if (!trimmed) return [];

  const whole = normalizeHost(trimmed);
  if (whole) hosts.add(whole);

  for (const match of trimmed.matchAll(/https?:\/\/[^\s"'`]+/gi)) {
    const host = normalizeHost(match[0] ?? "");
    if (host) hosts.add(host);
  }

  for (const match of trimmed.matchAll(
    /\b[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+\b/gi,
  )) {
    const host = normalizeHost(match[0] ?? "");
    if (host) hosts.add(host);
  }

  return [...hosts];
}

function sourceTypeOf(resource: ScrapedResource): string {
  switch (resource.kind) {
    case "vercel-project":
      return "vercel";
    case "azure-entra":
      return "azure";
    default:
      return "cf";
  }
}

function iconOf(resource: ScrapedResource): string {
  switch (resource.kind) {
    case "cf-worker":
      return iconServiceForCfKind("Worker");
    case "cf-kv":
      return iconServiceForCfKind("KV");
    case "cf-d1":
      return iconServiceForCfKind("D1");
    case "cf-r2":
      return iconServiceForCfKind("R2");
    case "cf-vectorize":
      return iconServiceForCfKind("Vectorize");
    case "cf-queue":
      return iconServiceForCfKind("Queue");
    case "vercel-project":
      return iconServiceForVercelKind("Project");
    case "azure-entra":
      return iconServiceForAzureKind("Entra");
  }
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

function resourceEnvs(resource: ScrapedResource): ScrapedEnvVar[] {
  switch (resource.kind) {
    case "cf-worker":
    case "vercel-project":
      return resource.envs;
    default:
      return [];
  }
}

function networkingFields(
  domains: string[],
  openToInternet: boolean,
  extra?: CategoryFields,
): ServiceFields {
  return {
    networking: {
      "bool:Is Open To Internet": openToInternet,
      "link:domains": domains,
      ...extra,
    },
  };
}

/** Redacted value + expiry as a multiline string array for Client Secrets. */
function formatEntraSecretValue(secret: ScrapedAzureEntraSecret): string[] {
  const redacted = secret.hint ? `${secret.hint}******` : "******";
  const expiry = secret.expiresAt ? secret.expiresAt.slice(0, 10) : "unknown";
  return [redacted, expiry];
}

function entraSecretFields(secrets: ScrapedAzureEntraSecret[]): CategoryFields {
  const fields: CategoryFields = {};
  const usedKeys = new Map<string, number>();

  for (const secret of secrets) {
    // Graph `displayName` is the portal "Description" column.
    const base = secret.description.trim() || "(no description)";
    const count = usedKeys.get(base) ?? 0;
    usedKeys.set(base, count + 1);
    const key = count === 0 ? base : `${base} (${count + 1})`;
    fields[key] = formatEntraSecretValue(secret);
  }

  return fields;
}

/** Map a scraped resource into a scanned service. */
export function resourceToService(resource: ScrapedResource): ScannedService {
  const group = resource.group.trim() || "default";
  const base = {
    id: resource.id,
    sourceType: sourceTypeOf(resource),
    service: iconOf(resource),
    name: resource.name,
    group,
  };

  switch (resource.kind) {
    case "cf-worker":
      return {
        ...base,
        connections: [...resource.connections],
        fields: {
          ...networkingFields(resource.domains, resource.domains.length > 0),
          ...(resource.envs.length > 0
            ? buildEnvironmentFieldsByTarget(resource.envs)
            : {}),
          observability: {
            "link:View Logs": resource.logUrl,
          },
        },
      };

    case "cf-r2":
      return {
        ...base,
        connections: [],
        fields: networkingFields(resource.domains, resource.openToInternet, {
          "link:S3 API URL": resource.s3ApiUrl,
          ...(resource.cors.length > 0 ? { cors: resource.cors } : {}),
        }),
      };

    case "vercel-project":
      return {
        ...base,
        connections: [],
        fields: {
          ...networkingFields(resource.domains, resource.domains.length > 0),
          ...(resource.envs.length > 0
            ? buildEnvironmentFieldsByTarget(resource.envs)
            : {}),
        },
      };

    case "azure-entra": {
      const secretFields = entraSecretFields(resource.secrets);
      return {
        ...base,
        connections: [],
        fields: {
          Overview: {
            "Application (client) ID": resource.applicationId,
            "Directory (tenant) ID": resource.directoryId,
            ...(resource.redirectUris.length > 0
              ? { "Redirect URIs": resource.redirectUris }
              : {}),
          },
          ...(Object.keys(secretFields).length > 0
            ? { "Client Secrets": secretFields }
            : {}),
        },
      };
    }

    case "cf-kv":
    case "cf-d1":
    case "cf-vectorize":
    case "cf-queue":
      return {
        ...base,
        connections: [],
        fields: {},
      };
  }
}

/**
 * Implicitly link services when A's env value references B's domain.
 * Connections are added on the env-holding service (A → B).
 */
export function linkEnvToDomains(
  services: ScannedService[],
  resources: ScrapedResource[],
): void {
  const ownersByHost = new Map<string, Set<string>>();

  for (const resource of resources) {
    for (const domain of resourceDomains(resource)) {
      const host = normalizeHost(domain);
      if (!host) continue;
      const owners = ownersByHost.get(host) ?? new Set<string>();
      owners.add(resource.id);
      ownersByHost.set(host, owners);
    }
  }

  const byId = new Map(services.map((service) => [service.id, service]));

  for (const resource of resources) {
    const service = byId.get(resource.id);
    if (!service) continue;

    const linked = new Set(service.connections);
    for (const env of resourceEnvs(resource)) {
      if (!env.value || isSecretEnvType(env.type)) continue;
      for (const host of hostsFromEnvValue(env.value)) {
        const owners = ownersByHost.get(host);
        if (!owners) continue;
        for (const ownerId of owners) {
          if (ownerId !== resource.id) linked.add(ownerId);
        }
      }
    }
    service.connections = [...linked];
  }
}

const CLIENT_ID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function clientIdsFromEnvValue(value: string): string[] {
  const ids = new Set<string>();
  for (const match of value.matchAll(CLIENT_ID_RE)) {
    const id = match[0]?.toLowerCase();
    if (id) ids.add(id);
  }
  return [...ids];
}

function addConnection(
  service: ScannedService,
  targetId: string,
  meta?: { variant: "default" | "warning"; text?: string },
): void {
  if (!service.connections.includes(targetId)) {
    service.connections.push(targetId);
  }
  if (!meta) return;

  const prev = service.connectionMeta?.[targetId];
  // Prefer warning over default when both linkers touch the same edge.
  if (prev?.variant === "warning" && meta.variant !== "warning") return;

  service.connectionMeta = {
    ...(service.connectionMeta ?? {}),
    [targetId]: {
      variant: meta.variant,
      ...(meta.text ? { text: meta.text } : {}),
    },
  };
}

function domainsMatchRedirects(
  domains: string[],
  redirectUris: string[],
): boolean {
  const serviceHosts = domains
    .map((domain) => normalizeHost(domain))
    .filter((host): host is string => Boolean(host));
  if (serviceHosts.length === 0) return false;

  for (const uri of redirectUris) {
    const redirectHost = normalizeHost(uri);
    if (!redirectHost) continue;
    for (const host of serviceHosts) {
      if (
        host === redirectHost ||
        host.endsWith(`.${redirectHost}`) ||
        redirectHost.endsWith(`.${host}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Link services whose env values contain an Entra application (client) ID.
 * Warning when the source has no domain, or domains don't match redirect URIs.
 */
export function linkEnvToAzureClientIds(
  services: ScannedService[],
  resources: ScrapedResource[],
): void {
  const entraByClientId = new Map<
    string,
    { id: string; redirectUris: string[] }
  >();

  for (const resource of resources) {
    if (resource.kind !== "azure-entra") continue;
    entraByClientId.set(resource.applicationId.toLowerCase(), {
      id: resource.id,
      redirectUris: resource.redirectUris,
    });
  }
  if (entraByClientId.size === 0) return;

  const byId = new Map(services.map((service) => [service.id, service]));

  for (const resource of resources) {
    const service = byId.get(resource.id);
    if (!service || resource.kind === "azure-entra") continue;

    const domains = resourceDomains(resource);
    for (const env of resourceEnvs(resource)) {
      if (!env.value || isSecretEnvType(env.type)) continue;
      for (const clientId of clientIdsFromEnvValue(env.value)) {
        const entra = entraByClientId.get(clientId);
        if (!entra || entra.id === resource.id) continue;

        if (domains.length === 0) {
          addConnection(service, entra.id, {
            variant: "warning",
            text: "Service has no domain",
          });
        } else if (!domainsMatchRedirects(domains, entra.redirectUris)) {
          addConnection(service, entra.id, {
            variant: "warning",
            text: "Domain does not match redirect URI",
          });
        } else {
          addConnection(service, entra.id, { variant: "default" });
        }
      }
    }
  }
}

/** Cross-provider finalize: env→domain / env→Entra links + public-internet hub. */
export function finalizeScan(
  services: ScannedService[],
  resources: ScrapedResource[],
  warnings: string[],
): ScanOutcome {
  linkEnvToDomains(services, resources);
  linkEnvToAzureClientIds(services, resources);
  return {
    services: ensureInternetHub(services),
    warnings: [...warnings],
  };
}
