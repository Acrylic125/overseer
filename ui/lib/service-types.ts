import type { InfrastructureCategory } from "@/server/routers/infrastructure";

export type ServiceTypeMeta = {
  /** Mesh name in `/assets.glb`, matching the source SVG filename. */
  icon: string;
  /** Visual category driving block silhouette and accents. */
  type: InfrastructureCategory;
};

/** Fallback mesh basename when `service` is missing from `cli/assets/icons/`. */
export const UNKNOWN_SERVICE = "all-unknown";

/**
 * Known icon basenames → visual category.
 * Wire-format `service` values are icon basenames (no path / extension).
 * Unknown basenames still pass through as the icon name so new SVGs work
 * without a UI whitelist update (GLB load falls back to {@link UNKNOWN_SERVICE}).
 */
export const SERVICE_TYPES: Record<string, ServiceTypeMeta> = {
  "all-unknown": { icon: UNKNOWN_SERVICE, type: "compute" },
  "cf-worker": { icon: "cf-worker", type: "compute" },
  "cf-worker-kv": { icon: "cf-worker-kv", type: "database" },
  "cf-d1": { icon: "cf-d1", type: "database" },
  "cf-vectorize": { icon: "cf-vectorize", type: "database" },
  r2: { icon: "r2", type: "storage" },
  vercel: { icon: "vercel", type: "compute" },
  "azure-entra": { icon: "azure-entra", type: "integration" },
};

export function resolveServiceType(service: string): ServiceTypeMeta {
  const known = SERVICE_TYPES[service];
  if (known) return known;
  if (service) {
    return { icon: service, type: "compute" };
  }
  return SERVICE_TYPES[UNKNOWN_SERVICE]!;
}

/** Mesh name in `/assets.glb`; always resolves to a bundled fallback name. */
export function resolveServiceIcon(service: string): string {
  return resolveServiceType(service).icon;
}
