import type { InfrastructureCategory } from "@/server/routers/infrastructure";

export type ServiceTypeMeta = {
  /** Mesh name in `/assets.glb`, matching the source SVG filename. */
  icon: string;
  /** Visual category driving block silhouette and accents. */
  type: InfrastructureCategory;
};

/** Fallback mesh basename when `service` is missing from `scan/assets/icons/`. */
export const UNKNOWN_SERVICE = "all-unknown";

/**
 * Wire-format `service` values are icon basenames (no path / extension).
 * Unknown values resolve to {@link UNKNOWN_SERVICE}.
 */
export const SERVICE_TYPES: Record<string, ServiceTypeMeta> = {
  "all-unknown": { icon: UNKNOWN_SERVICE, type: "compute" },
  "cf-worker": { icon: "cf-worker", type: "compute" },
  "cf-worker-kv": { icon: "cf-worker-kv", type: "database" },
  "cf-d1": { icon: "cf-d1", type: "database" },
  r2: { icon: "r2", type: "storage" },
};

export function resolveServiceType(service: string): ServiceTypeMeta {
  return SERVICE_TYPES[service] ?? SERVICE_TYPES[UNKNOWN_SERVICE]!;
}

/** Mesh name in `/assets.glb`; always resolves to a bundled fallback. */
export function resolveServiceIcon(service: string): string {
  return resolveServiceType(service).icon;
}
