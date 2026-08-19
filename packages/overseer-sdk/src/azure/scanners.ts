import { ClientSecretCredential } from "@azure/identity";
import { Client, PageIterator } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";

import { envToClaims } from "../core/claims.js";
import { resourceId } from "../core/resource-id.js";
import { redactSensitiveValue } from "../core/utils.js";
import { type ScrapeStepFn } from "../core/scrape-async.js";
import {
  table,
  type ProviderResourceScanner,
  type ResourceAlert,
} from "../types.js";
import { iconForKind } from "./icons.js";
import { type AzureApplication, parseApplicationsPage } from "./schemas.js";

const noopStep: ScrapeStepFn = () => {};
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
      Value: redactSensitiveValue(credential.hint ?? ""),
      "Expires On": credential.endDateTime ?? "",
    });
  }

  return table({
    columns: ["Name", "Value", "Expires On"],
    rows,
  });
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
  policy: DEFAULT_POLICY,
  scrape: scrapeEntra,
  transform(item, { namespace, policy = DEFAULT_POLICY }) {
    const objectId = item.application.id;
    const applicationId = item.application.appId;
    if (!objectId || !applicationId) return null;
    const name = item.application.displayName ?? applicationId;
    const uris = redirectUris(item.application);
    const secrets = secretTable(item.application.passwordCredentials);
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
        ...(secrets ? { Secrets: secrets } : {}),
      },
      alerts: secretAlerts(item.application.passwordCredentials, policy),
      tags: { namespace },
    };
  },
  connection(item) {
    const uris = redirectUris(item.application);
    const objectId = item.application.id;
    const applicationId = item.application.appId;
    const name =
      item.application.displayName ?? applicationId ?? objectId ?? "";
    return {
      claims: envToClaims(uris),
      require: (claim) => {
        if (claim.type !== "ref") return false;
        const value = claim.value.trim().toLowerCase();
        if (!value) return false;
        if (objectId && objectId.trim().toLowerCase() === value) {
          return { type: "connected", label: name };
        }
        if (applicationId && applicationId.trim().toLowerCase() === value) {
          return { type: "connected", label: name };
        }
        return false;
      },
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeEntra>>[number],
  [string, string, string, ScrapeStepFn],
  typeof DEFAULT_POLICY
>;

export const azureScanners = [entraScanner];
