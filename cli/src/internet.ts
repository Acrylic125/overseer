import type { ScannedService, ServiceFields } from "./schema.js";

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
