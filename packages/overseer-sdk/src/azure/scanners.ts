import { ClientSecretCredential } from "@azure/identity";
import { Client, PageIterator } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";

import { envReferences } from "../core/claims.js";
import {
  DEFAULT_TTL_MS,
  defineProvider,
  type Scanner,
} from "../core/provider.js";
import { resourceId } from "../core/resource-id.js";
import { type ScrapeStepFn } from "../core/scrape-async.js";
import type { LinkEntry } from "../core/schemas.js";
import { table, type ResourceAlert } from "../types.js";
import { iconForKind } from "./icons.js";
import { type AzureApplication, parseApplicationsPage } from "./schemas.js";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export const DEFAULT_POLICY = {
  onBeforeSecretExpireDays: [30, "warn"],
  onAfterSecretExpire: "error",
  onSecretNoExpiry: "warn",
  onNoSecretRotationAfter: [180, "warn"],
} as const;

function redirectUris(app: AzureApplication) {
  const uris = new Set<string>();
  for (const key of ["web", "spa", "publicClient"] as const) {
    const block = app[key];
    if (!block?.redirectUris) continue;
    for (const uri of block.redirectUris) {
      if (uri) uris.add(uri);
    }
  }
  return [...uris];
}

function namedSecrets(credentials: AzureApplication["passwordCredentials"]) {
  if (!credentials || credentials.length === 0) return [];
  const used = new Map<string, number>();
  const secrets = [];

  for (const credential of credentials) {
    const base = credential.displayName?.trim() || "(no description)";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    let name = base;
    if (count > 0) {
      name = `${base} (${count + 1})`;
    }
    secrets.push({ name, credential });
  }

  return secrets;
}

function policyAlertType(severity: "warn" | "error") {
  if (severity === "error") return "error";
  return "warning";
}

function dayLabel(days: number) {
  if (days === 1) return "1 day";
  return `${days} days`;
}

function secretAlerts(
  credentials: AzureApplication["passwordCredentials"],
  policy: typeof DEFAULT_POLICY,
) {
  const alerts: ResourceAlert[] = [];
  const now = Date.now();

  for (const { name, credential } of namedSecrets(credentials)) {
    const end = credential.endDateTime
      ? Date.parse(credential.endDateTime)
      : Number.NaN;
    if (!credential.endDateTime || Number.isNaN(end)) {
      alerts.push({
        type: policyAlertType(policy.onSecretNoExpiry),
        message: `Secret "${name}" has no expiry date`,
      });
    } else if (end <= now) {
      alerts.push({
        type: policyAlertType(policy.onAfterSecretExpire),
        message: `Secret "${name}" expired`,
      });
    } else {
      const [beforeDays, beforeSeverity] = policy.onBeforeSecretExpireDays;
      const daysUntil = (end - now) / MS_PER_DAY;
      if (daysUntil <= beforeDays) {
        alerts.push({
          type: policyAlertType(beforeSeverity),
          message: `Secret "${name}" expires in ${dayLabel(Math.ceil(daysUntil))}`,
        });
      }
    }

    const start = credential.startDateTime
      ? Date.parse(credential.startDateTime)
      : Number.NaN;
    if (Number.isNaN(start)) continue;
    const [rotationDays, rotationSeverity] = policy.onNoSecretRotationAfter;
    const ageDays = (now - start) / MS_PER_DAY;
    if (ageDays < rotationDays) continue;
    alerts.push({
      type: policyAlertType(rotationSeverity),
      message: `Secret "${name}" has not been rotated in ${dayLabel(Math.floor(ageDays))}`,
    });
  }

  return alerts;
}

function secretTable(credentials: AzureApplication["passwordCredentials"]) {
  const secrets = namedSecrets(credentials);
  if (secrets.length === 0) return null;
  const rows: Array<Record<string, string>> = [];

  for (const { name, credential } of secrets) {
    rows.push({
      Name: name,
      // Azure only ever returns a 3-character prefix hint, never the secret.
      Value: credential.hint ? `${credential.hint}******` : "******",
      "Expires On": credential.endDateTime ?? "",
    });
  }

  return table({
    columns: ["Name", "Value", "Expires On"],
    rows,
  });
}

async function scrapeEntra(ctx: AzureCtx, fn: ScrapeStepFn) {
  const credential = new ClientSecretCredential(
    ctx.tenantId,
    ctx.clientId,
    ctx.clientSecret,
    {
      authorityHost: ctx.authorityHost,
      // Instance discovery only recognises Microsoft clouds, so custom authorities must skip it.
      disableInstanceDiscovery: ctx.authorityHost !== undefined,
    },
  );
  const client = Client.initWithMiddleware({
    baseUrl: ctx.graphBaseUrl,
    customHosts: new Set([new URL(ctx.graphBaseUrl).hostname]),
    authProvider: new TokenCredentialAuthenticationProvider(credential, {
      scopes: ["https://graph.microsoft.com/.default"],
    }),
  });

  fn({ message: "Listing applications" });
  const applications: AzureApplication[] = [];
  const firstPage = parseApplicationsPage(
    await client
      .api("/applications")
      .select("id,appId,displayName,passwordCredentials,web,spa,publicClient")
      .top(100)
      .get(),
  );

  const iterator = new PageIterator(
    client,
    firstPage,
    (item: AzureApplication) => {
      applications.push(item);
      return true;
    },
  );
  await iterator.iterate();

  return applications;
}

const GRAPH_BASE_URL = "https://graph.microsoft.com";

type AzureCtx = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  authorityHost?: string;
  graphBaseUrl: string;
  policy: typeof DEFAULT_POLICY;
};

export const entraScanner: Scanner<AzureCtx> = {
  key: "entra",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    const applications = await scrapeEntra(ctx, run.step);
    const entries: LinkEntry[] = [];
    for (const application of applications) {
      const objectId = application.id;
      const applicationId = application.appId;
      if (!objectId || !applicationId) continue;
      const name = application.displayName ?? applicationId;
      const uris = redirectUris(application);
      const secrets = secretTable(application.passwordCredentials);
      entries.push({
        resource: {
          id: resourceId("azure", run.namespace, "entra", objectId),
          group: run.namespace,
          name,
          url: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/${applicationId}`,
          service: "Entra",
          asset: iconForKind("Entra"),
          fields: {
            "Application (client) ID": applicationId,
            "Directory (tenant) ID": ctx.tenantId,
            ...(uris.length > 0 ? { "Redirect URIs": uris } : {}),
            ...(secrets ? { Secrets: secrets } : {}),
          },
          alerts: secretAlerts(application.passwordCredentials, ctx.policy),
          tags: { namespace: run.namespace },
        },
        exposes: [
          { type: "ref", value: objectId, label: name },
          { type: "ref", value: applicationId, label: name },
        ],
        // Redirect URIs point at the apps that sign in through this registration.
        references: envReferences(
          uris.map((uri) => ({ value: uri, secret: true })),
          "auth",
        ),
      });
    }
    return entries;
  },
};

export function azure(options: {
  namespace: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  authorityHost?: string;
  graphBaseUrl?: string;
  policy?: typeof DEFAULT_POLICY;
}) {
  return defineProvider<AzureCtx>({
    id: "azure",
    namespace: options.namespace,
    scanners: [entraScanner],
    async accounts() {
      return [
        {
          account: options.tenantId,
          ctx: {
            tenantId: options.tenantId,
            clientId: options.clientId,
            clientSecret: options.clientSecret,
            authorityHost: options.authorityHost,
            graphBaseUrl: options.graphBaseUrl ?? GRAPH_BASE_URL,
            policy: options.policy ?? DEFAULT_POLICY,
          },
        },
      ];
    },
  });
}
