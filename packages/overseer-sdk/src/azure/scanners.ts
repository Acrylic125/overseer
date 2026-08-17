import { ClientSecretCredential } from "@azure/identity";
import { Client, PageIterator } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";

import { envToClaims, urlBaseMatchClaim } from "../core/claims.js";
import { parseEnvUrl, type EnvVar } from "../core/env.js";
import { resourceId } from "../core/resource-id.js";
import { type ScrapeStepFn } from "../core/scrape-async.js";
import type { FieldValue, ProviderResourceScanner } from "../types.js";
import { iconForKind } from "./icons.js";
import {
  type AzureApplication,
  parseApplicationsPage,
} from "./schemas.js";

const noopStep: ScrapeStepFn = () => {};

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

function secretFields(credentials: AzureApplication["passwordCredentials"]) {
  if (!credentials) return {};
  const fields: Record<string, FieldValue | FieldValue[]> = {};
  const used = new Map<string, number>();

  for (const credential of credentials) {
    const base = credential.displayName?.trim() || "(no description)";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const key = count === 0 ? base : `${base} (${count + 1})`;
    const hint = credential.hint;
    const redacted = hint ? `${hint}******` : "******";
    const expiry = credential.endDateTime;
    fields[key] = expiry
      ? [redacted, { type: "date", value: expiry }]
      : redacted;
  }

  return fields;
}

async function scrapeEntra(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  fn: ScrapeStepFn = noopStep,
) {
  const credential = new ClientSecretCredential(
    tenantId,
    clientId,
    clientSecret,
  );
  const client = Client.initWithMiddleware({
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

  return applications.map((application) => ({ application, tenantId }));
}

export const entraScanner = {
  type: "Entra",
  scrape: scrapeEntra,
  transform(item, namespace) {
    const objectId = item.application.id;
    const applicationId = item.application.appId;
    if (!objectId || !applicationId) return null;
    const name = item.application.displayName ?? applicationId;
    const uris = redirectUris(item.application);
    const secrets = secretFields(item.application.passwordCredentials);
    return {
      id: resourceId("azure", namespace, "entra", objectId),
      group: namespace,
      name,
      url: `https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationMenuBlade/~/Overview/appId/${applicationId}`,
      service: "Entra",
      asset: iconForKind("Entra"),
      fields: {
        "Application (client) ID": applicationId,
        "Directory (tenant) ID": item.tenantId,
        ...(uris.length > 0 ? { "Redirect URIs": uris } : {}),
        ...secrets,
      },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const uris = redirectUris(item.application);
    const envs: EnvVar[] = uris.map((uri) => ({
      key: uri,
      value: uri,
      type: "plain",
    }));
    return {
      claims: envToClaims(envs),
      require: (claim) => {
        for (const uri of uris) {
          if (!urlBaseMatchClaim(uri, claim)) continue;
          const label = parseEnvUrl(uri)?.hostname ?? uri;
          return { type: "connected", label };
        }
        return false;
      },
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeEntra>>[number],
  [string, string, string, ScrapeStepFn]
>;

export const azureScanners = [entraScanner];
