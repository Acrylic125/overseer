import type { ConnectorMeta, ScannedService, ServiceFields } from "./schema.js";
import { parseEnvUrl } from "./utils.js";

/** Stable id for the public-internet hub service. */
export const INTERNET_ID = "internet";

/** Shape basename under `cli/assets/shapes/` (rendered as the cloud pad). */
export const INTERNET_SHAPE = "cloud";

export const INTERNET_SOURCE_TYPE = "internet";
export const INTERNET_LABEL = "Public Internet";

const OPEN_TO_INTERNET_KEY = "bool:Is Open To Internet";

/** True when networking marks the resource as publicly reachable. */
export function isOpenToInternet(
  fields: ServiceFields | null | undefined,
): boolean {
  const value = fields?.networking?.[OPEN_TO_INTERNET_KEY];
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(Boolean);
  return false;
}

export function isInternetService(service: { id: string }): boolean {
  return service.id === INTERNET_ID;
}

/**
 * Public internet as a service resource.
 * `group` defaults to `null` (standalone hub).
 */
export function createInternetService(options?: {
  group?: string | null;
}): ScannedService {
  return {
    id: INTERNET_ID,
    group: options?.group ?? null,
    name: INTERNET_LABEL,
    connections: [],
    sourceType: INTERNET_SOURCE_TYPE,
    service: INTERNET_SHAPE,
    fields: {},
  };
}

/**
 * Ensure a single internet hub service exists.
 * Open reachability stays on `bool:Is Open To Internet` — layout/UI derive
 * connectors to the hub from that flag (do not store `"internet"` in connections).
 */
export function ensureInternetHub(services: ScannedService[]): ScannedService[] {
  if (services.some(isInternetService)) return services;
  return [...services, createInternetService()];
}

/**
 * Connections for connector routing: real scrape links plus a derived edge to
 * the internet hub when the networking bool says the service is public.
 */
export function connectionsForLayout(service: ScannedService): string[] {
  if (isInternetService(service)) return service.connections;
  if (!isOpenToInternet(service.fields)) return service.connections;
  if (service.connections.includes(INTERNET_ID)) return service.connections;
  return [...service.connections, INTERNET_ID];
}

function hostFromDomain(domain: string): string | null {
  const url = parseEnvUrl(domain.includes("://") ? domain : `https://${domain}`);
  return url?.hostname.toLowerCase() ?? null;
}

/** First public hostname label for connector text, or null. */
export function domainConnectorLabel(domains: string[]): string | null {
  for (const domain of domains) {
    const host = hostFromDomain(domain);
    if (host) return host;
  }
  return null;
}

function domainsFromNetworking(fields: ServiceFields): string[] {
  const networking = fields.networking;
  if (!networking) return [];

  const domains: string[] = [];
  const raw = networking["link:Domains"];
  if (Array.isArray(raw)) {
    domains.push(...raw.filter((d): d is string => typeof d === "string"));
  } else if (typeof raw === "string" && raw) {
    domains.push(raw);
  }

  const entry = networking["link:Entry Domain"];
  if (typeof entry === "string" && entry) {
    domains.push(entry);
  }

  return domains;
}

/** Domains from networking fields (`link:Domains`, `link:Entry Domain`). */
export function networkingDomains(fields: ServiceFields): string[] {
  return domainsFromNetworking(fields);
}

/**
 * Label public-internet edges using scraped domains (before env redaction).
 * Stores meta on the service; layout derives the edge via `connectionsForLayout`.
 */
export function linkInternetDomains(
  services: ScannedService[],
  domainsByServiceId: Map<string, string[]>,
): void {
  for (const service of services) {
    if (isInternetService(service) || !isOpenToInternet(service.fields)) continue;

    const scraped = domainsByServiceId.get(service.id) ?? [];
    const label = domainConnectorLabel(
      scraped.length > 0 ? scraped : domainsFromNetworking(service.fields),
    );
    if (!label) continue;

    const meta: ConnectorMeta = {
      variant: "default",
      labels: [null, label],
    };
    service.connectionMeta = {
      ...(service.connectionMeta ?? {}),
      [INTERNET_ID]: meta,
    };
  }
}
