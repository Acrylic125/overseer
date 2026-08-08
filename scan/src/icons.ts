/**
 * Mesh / SVG basenames under `scan/assets/icons/` (no path, no extension).
 * These are the wire-format `service` values written into infrastructure.json.
 */
export const DEFAULT_ICON_SERVICE = "all-unknown";

/** Cloudflare product kind → icon basename. Missing kinds use {@link DEFAULT_ICON_SERVICE}. */
const CF_ICON_BY_KIND: Record<string, string> = {
  Worker: "cf-worker",
  KV: "cf-worker-kv",
  D1: "cf-d1",
  R2: "r2",
};

/** Resolve a Cloudflare kind to an assets.glb mesh name. */
export function iconServiceForCfKind(kind: string): string {
  return CF_ICON_BY_KIND[kind] ?? DEFAULT_ICON_SERVICE;
}
