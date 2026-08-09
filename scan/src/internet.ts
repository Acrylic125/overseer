import type { ScannedService, ServiceFields } from "./schema.js";

/** Stable id for the public-internet hub service. */
export const INTERNET_ID = "internet";

/** Shape basename under `scan/assets/shapes/` (rendered as the cloud pad). */
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
 * `group` defaults to `null` (standalone hub); set it to place membership metadata.
 */
export function createInternetService(options?: {
  group?: string | null;
  connections?: string[];
}): ScannedService {
  return {
    id: INTERNET_ID,
    group: options?.group ?? null,
    name: INTERNET_LABEL,
    connections: options?.connections ?? [],
    sourceType: INTERNET_SOURCE_TYPE,
    service: INTERNET_SHAPE,
    fields: {},
  };
}

/**
 * Ensure a single internet service exists and link every publicly reachable
 * service to it via `connections`.
 */
export function ensureInternetLinks(services: ScannedService[]): ScannedService[] {
  let internet = services.find(isInternetService) ?? null;
  const rest = services.filter((service) => !isInternetService(service));

  const linked = rest.map((service) => {
    if (!isOpenToInternet(service.fields)) return service;
    if (service.connections.includes(INTERNET_ID)) return service;
    return {
      ...service,
      connections: [...service.connections, INTERNET_ID],
    };
  });

  if (!internet) {
    internet = createInternetService();
  }

  return [...linked, internet];
}
