import type { InfrastructureCategory } from "@/server/routers/infrastructure";

export type ServiceTypeMeta = {
  /** Public URL of the provider SVG icon. */
  icon: string;
  /** Visual category driving block silhouette / accents. */
  type: InfrastructureCategory;
};

/**
 * Provider → service-key → icon + category.
 * Keys are lowercase snake_case; resolve via `resolveServiceType`.
 */
export const SERVICE_TYPES = {
  cf: {
    worker: {
      icon: "/cf-icons/Worker.svg",
      type: "compute",
    },
    workers_ai: {
      icon: "/cf-icons/Workers AI.svg",
      type: "compute",
    },
    durable_objects: {
      icon: "/cf-icons/Durable Objects.svg",
      type: "compute",
    },
    pages: {
      icon: "/cf-icons/Pages.svg",
      type: "compute",
    },
    cdn: {
      icon: "/cf-icons/CDN.svg",
      type: "compute",
    },
    cache: {
      icon: "/cf-icons/Cache.svg",
      type: "storage",
    },
    load_balancer: {
      icon: "/cf-icons/Load Balancer.svg",
      type: "compute",
    },
    tunnel: {
      icon: "/cf-icons/Tunnel.svg",
      type: "compute",
    },
    vectorize: {
      // No dedicated SVG yet — callers fall back to category Lucide glyph.
      icon: "",
      type: "storage",
    },
    kv: {
      icon: "/cf-icons/KV.svg",
      type: "database",
    },
    d1: {
      icon: "/cf-icons/D1.svg",
      type: "database",
    },
    r2: {
      icon: "/cf-icons/R2.svg",
      type: "storage",
    },
    queue: {
      icon: "/cf-icons/Queue.svg",
      type: "integration",
    },
    stream: {
      icon: "/cf-icons/Stream.svg",
      type: "storage",
    },
    images: {
      icon: "/cf-icons/Images.svg",
      type: "storage",
    },
    waf: {
      icon: "/cf-icons/WAF.svg",
      type: "compute",
    },
    ddos: {
      icon: "/cf-icons/DDoS.svg",
      type: "compute",
    },
    ssl: {
      icon: "/cf-icons/SSL.svg",
      type: "compute",
    },
    api_shield: {
      icon: "/cf-icons/API Shield.svg",
      type: "compute",
    },
    analytics: {
      icon: "/cf-icons/Analytics.svg",
      type: "compute",
    },
    logs: {
      icon: "/cf-icons/Logs.svg",
      type: "integration",
    },
    secrets: {
      icon: "/cf-icons/Secrets.svg",
      type: "database",
    },
    email: {
      icon: "/cf-icons/Email.svg",
      type: "integration",
    },
    data_localization_suite: {
      icon: "/cf-icons/Data Localization Suite.svg",
      type: "storage",
    },
  },
} as const satisfies Record<
  string,
  Record<string, ServiceTypeMeta>
>;

export type ServiceProvider = keyof typeof SERVICE_TYPES;

/** Common aliases → canonical SERVICE_TYPES.cf keys. */
const CF_ALIASES: Record<string, keyof typeof SERVICE_TYPES.cf> = {
  lb: "load_balancer",
  loadbalancer: "load_balancer",
  durable_object: "durable_objects",
  durableobject: "durable_objects",
  do: "durable_objects",
  workersai: "workers_ai",
  worker_ai: "workers_ai",
  apishield: "api_shield",
  api: "api_shield",
  datalocalizationsuite: "data_localization_suite",
};

function normalizeKey(type: string): string {
  return type.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Look up Cloudflare (or later other provider) metadata for a service `type` string.
 */
export function resolveServiceType(
  type: string,
  provider: ServiceProvider = "cf",
): ServiceTypeMeta | undefined {
  const catalog = SERVICE_TYPES[provider];
  const key = normalizeKey(type);
  const compact = key.replace(/_/g, "");

  const resolvedKey =
    (CF_ALIASES[key] as string | undefined) ??
    (CF_ALIASES[compact] as string | undefined) ??
    (key in catalog ? key : undefined);

  if (!resolvedKey) return undefined;
  const meta = catalog[resolvedKey as keyof typeof catalog] as
    | ServiceTypeMeta
    | undefined;
  return meta;
}

/** CF product icons as baked path meshes (see svg-icon-geometry). */
const ENABLE_SVG_ICONS = true;

/** Icon path for a service type, or undefined when missing / empty. */
export function resolveServiceIcon(
  type: string,
  provider: ServiceProvider = "cf",
): string | undefined {
  if (!ENABLE_SVG_ICONS) return undefined;
  const icon = resolveServiceType(type, provider)?.icon;
  return icon ? icon : undefined;
}
