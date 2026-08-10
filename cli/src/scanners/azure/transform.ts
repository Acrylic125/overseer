import { iconServiceForAzureKind } from "../../icons.js";
import type { CategoryFields, ConnectorMeta, ScannedService } from "../../schema.js";
import { envValueForLinking, parseEnvUrl } from "../../utils.js";
import type {
  ScrapedAzureEntra,
  ScrapedAzureEntraSecret,
  ScrapedResource,
  ScrapeContext,
} from "../types.js";

const CLIENT_ID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

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
  meta: ConnectorMeta,
): void {
  if (!service.connections.includes(targetId)) {
    service.connections.push(targetId);
  }

  const prev = service.connectionMeta?.[targetId];
  if (prev?.variant === "warning" && meta.variant !== "warning") return;

  service.connectionMeta = {
    ...(service.connectionMeta ?? {}),
    [targetId]: meta,
  };
}

function envUuids(value: string): string[] {
  const ids = new Set<string>();
  const trimmed = value.trim().toLowerCase();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      trimmed,
    )
  ) {
    ids.add(trimmed);
  }
  for (const match of value.matchAll(CLIENT_ID_RE)) {
    const id = match[0]?.toLowerCase();
    if (id) ids.add(id);
  }
  return [...ids];
}

function domainsMatchRedirects(
  domains: string[],
  redirectUris: string[],
): boolean {
  const serviceHosts = domains
    .map((domain) => hostFromDomain(domain))
    .filter((host): host is string => Boolean(host));
  if (serviceHosts.length === 0) return false;

  for (const uri of redirectUris) {
    const redirectHost = hostFromDomain(uri);
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

function secretFields(secrets: ScrapedAzureEntraSecret[]): CategoryFields {
  const fields: CategoryFields = {};
  const usedKeys = new Map<string, number>();

  for (const secret of secrets) {
    const base = secret.description.trim() || "(no description)";
    const count = usedKeys.get(base) ?? 0;
    usedKeys.set(base, count + 1);
    const key = count === 0 ? base : `${base} (${count + 1})`;
    const redacted = secret.hint ? `${secret.hint}******` : "******";
    const expiry = secret.expiresAt ? secret.expiresAt.slice(0, 10) : "unknown";
    fields[key] = [redacted, expiry];
  }

  return fields;
}

function entraService(resource: ScrapedAzureEntra): ScannedService {
  const secrets = secretFields(resource.secrets);
  return {
    id: resource.id,
    group: resource.group,
    name: resource.name,
    sourceType: "azure",
    service: iconServiceForAzureKind("Entra"),
    connections: [],
    fields: {
      Overview: {
        "Application (client) ID": resource.applicationId,
        "Directory (tenant) ID": resource.directoryId,
        ...(resource.redirectUris.length > 0
          ? { "Redirect URIs": resource.redirectUris }
          : {}),
      },
      ...(Object.keys(secrets).length > 0 ? { "Client Secrets": secrets } : {}),
    },
  };
}

/**
 * Link services whose env values match an Entra Application (client) ID.
 * Mutates `services` in place (connections on the env-holding service).
 */
export function linkEntraByEnvValues(
  services: ScannedService[],
  resources: ScrapedResource[],
): void {
  type EntraMeta = {
    id: string;
    applicationId: string;
    objectId: string;
    redirectUris: string[];
  };

  const entraByUuid = new Map<string, EntraMeta>();

  for (const resource of resources) {
    if (resource.kind !== "azure-entra") continue;
    const meta: EntraMeta = {
      id: resource.id,
      applicationId: resource.applicationId,
      objectId: resource.objectId,
      redirectUris: resource.redirectUris,
    };
    entraByUuid.set(resource.applicationId.toLowerCase(), meta);
    entraByUuid.set(resource.objectId.toLowerCase(), meta);
  }
  if (entraByUuid.size === 0) return;

  const byId = new Map(services.map((service) => [service.id, service]));

  for (const resource of resources) {
    if (resource.kind === "azure-entra") continue;
    const service = byId.get(resource.id);
    if (!service) continue;

    const domains = resourceDomains(resource);
    for (const env of resourceEnvs(resource)) {
      const value = envValueForLinking(env);
      if (!value) continue;

      const matched = new Set<EntraMeta>();
      for (const uuid of envUuids(value)) {
        const entra = entraByUuid.get(uuid);
        if (entra) matched.add(entra);
      }

      for (const entra of matched) {
        if (entra.id === resource.id) continue;

        const matchedClientId = envUuids(value).find(
          (uuid) => uuid === entra.applicationId.toLowerCase(),
        );
        const label: [string, string] = matchedClientId
          ? ["Application (client) ID", entra.applicationId]
          : ["Object ID", entra.objectId];

        if (domains.length === 0) {
          addConnection(service, entra.id, {
            variant: "warning",
            from: label,
            to: ["redirect URI", "service has no domain"],
          });
        } else if (!domainsMatchRedirects(domains, entra.redirectUris)) {
          addConnection(service, entra.id, {
            variant: "warning",
            from: label,
            to: ["redirect URI", "domain mismatch"],
          });
        } else {
          addConnection(service, entra.id, {
            variant: "default",
            from: label,
            to: label,
          });
        }
      }
    }
  }
}

export function transformAzure(ctx: ScrapeContext): ScannedService[] {
  return ctx.resources
    .filter((resource): resource is ScrapedAzureEntra => resource.kind === "azure-entra")
    .map(entraService);
}
