/**
 * Mesh / SVG basenames under `cli/assets/icons/` (no path, no extension).
 * These are the wire-format `service` values written into infrastructure.json.
 */
export const DEFAULT_ICON_SERVICE = "all-unknown";

/** Cloudflare product kind → icon basename. Missing kinds use {@link DEFAULT_ICON_SERVICE}. */
const CF_ICON_BY_KIND: Record<string, string> = {
  Worker: "cf-worker",
  "Durable Object": "cf-do",
  Workflow: "cf-workflow",
  KV: "cf-worker-kv",
  D1: "cf-d1",
  R2: "cf-r2",
  Vectorize: "cf-vectorize",
};

/** Vercel product kind → icon basename. */
const VERCEL_ICON_BY_KIND: Record<string, string> = {
  Project: "vercel",
};

/** Azure product kind → icon basename. */
const AZURE_ICON_BY_KIND: Record<string, string> = {
  Entra: "azure-entra",
};

/** Resolve a Cloudflare kind to an assets.glb mesh name. */
export function iconServiceForCfKind(kind: string): string {
  return CF_ICON_BY_KIND[kind] ?? DEFAULT_ICON_SERVICE;
}

/** Resolve a Vercel kind to an assets.glb mesh name. */
export function iconServiceForVercelKind(kind: string): string {
  return VERCEL_ICON_BY_KIND[kind] ?? DEFAULT_ICON_SERVICE;
}

/** Resolve an Azure kind to an assets.glb mesh name. */
export function iconServiceForAzureKind(kind: string): string {
  return AZURE_ICON_BY_KIND[kind] ?? DEFAULT_ICON_SERVICE;
}
