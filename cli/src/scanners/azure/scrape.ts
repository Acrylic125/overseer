import { log as cli } from "../../cli/log.js";
import type { AzureProvider } from "../../providers.js";
import type { ScannedService } from "../../schema.js";
import { transformAzure } from "./transform.js";
import type {
  ScrapedAzureEntra,
  ScrapedAzureEntraSecret,
  ScrapedResource,
  ScrapeContext,
  ServiceScanner,
} from "../types.js";
import {
  elapsed,
  formatAuthFailure,
  formatPermissionHint,
  isAuthFailure,
  log,
  logError,
  REQUEST_TIMEOUT_MS,
  settled,
  withTimeout,
} from "./client.js";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

type ProviderFetchResult = {
  resources: ScrapedResource[];
  warnings: string[];
};

type GraphPasswordCredential = {
  displayName?: string | null;
  hint?: string | null;
  endDateTime?: string | null;
  keyId?: string | null;
};

type GraphApplication = {
  id?: string;
  appId?: string;
  displayName?: string | null;
  passwordCredentials?: GraphPasswordCredential[] | null;
  web?: { redirectUris?: string[] | null } | null;
  spa?: { redirectUris?: string[] | null } | null;
  publicClient?: { redirectUris?: string[] | null } | null;
};

type GraphListResponse<T> = {
  value?: T[];
  "@odata.nextLink"?: string;
};

function serviceId(namespace: string, objectId: string) {
  return `${namespace}:azure:entra:${objectId}`;
}

function tokenUrl(tenantId: string) {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<T> {
  const response = await withTimeout(fetch(url, init), REQUEST_TIMEOUT_MS, label);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const detail =
      body &&
      typeof body === "object" &&
      body !== null &&
      ("error_description" in body || "error" in body)
        ? String(
            (body as { error_description?: unknown; error?: unknown })
              .error_description ??
              (typeof (body as { error?: unknown }).error === "object"
                ? JSON.stringify((body as { error: unknown }).error)
                : (body as { error?: unknown }).error) ??
              text,
          )
        : text || response.statusText;
    throw new Error(`${response.status} ${detail}`);
  }

  return body as T;
}

async function acquireToken(provider: AzureProvider): Promise<string> {
  const body = new URLSearchParams({
    client_id: provider.clientId,
    client_secret: provider.pat,
    scope: GRAPH_SCOPE,
    grant_type: "client_credentials",
  });

  const result = await fetchJson<{ access_token?: string }>(
    tokenUrl(provider.tenantId),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    `azure.token:${provider.namespace}`,
  );

  if (!result.access_token) {
    throw new Error("Token response missing access_token");
  }
  return result.access_token;
}

function parseRedirectUris(app: GraphApplication): string[] {
  const uris = new Set<string>();
  for (const list of [
    app.web?.redirectUris,
    app.spa?.redirectUris,
    app.publicClient?.redirectUris,
  ]) {
    if (!list) continue;
    for (const uri of list) {
      if (typeof uri === "string" && uri.trim()) uris.add(uri.trim());
    }
  }
  return [...uris].sort((a, b) => a.localeCompare(b));
}

function parseSecrets(
  credentials: GraphPasswordCredential[] | null | undefined,
): ScrapedAzureEntraSecret[] {
  if (!credentials || credentials.length === 0) return [];

  return credentials.map((cred) => {
    // Portal Client secrets "Description" column → Graph displayName.
    const description =
      typeof cred.displayName === "string" ? cred.displayName : "";
    const hint =
      typeof cred.hint === "string" && cred.hint.trim()
        ? cred.hint.trim()
        : null;
    const expiresAt =
      typeof cred.endDateTime === "string" && cred.endDateTime
        ? cred.endDateTime
        : null;
    return { description, hint, expiresAt };
  });
}

async function listApplications(
  token: string,
  namespace: string,
): Promise<{ apps: GraphApplication[]; warnings: string[] }> {
  const apps: GraphApplication[] = [];
  const warnings: string[] = [];
  let url: string | null =
    `${GRAPH_BASE}/applications?$select=id,appId,displayName,passwordCredentials,web,spa,publicClient&$top=100`;
  let pages = 0;
  const maxPages = 50;

  while (url && pages < maxPages) {
    pages += 1;
    const label = `applications.list:${namespace}:page:${pages}`;
    const result: Awaited<
      ReturnType<typeof settled<GraphListResponse<GraphApplication> | null>>
    > = await settled(
      fetchJson<GraphListResponse<GraphApplication>>(
        url,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
        label,
      ),
      null,
      label,
    );

    if (result.error || !result.value) {
      if (result.error) {
        warnings.push(formatPermissionHint(result.error));
      }
      break;
    }

    apps.push(...(result.value.value ?? []));
    url = result.value["@odata.nextLink"] ?? null;
  }

  if (pages >= maxPages && url) {
    warnings.push(
      `provider:${namespace}: stopped after ${maxPages} application pages`,
    );
  }

  return { apps, warnings };
}

/** Returns null when credentials can scan; otherwise a human-readable reason. */
export async function probeAzureProvider(
  provider: AzureProvider,
): Promise<string | null> {
  try {
    const token = await acquireToken(provider);
    await fetchJson<GraphListResponse<GraphApplication>>(
      `${GRAPH_BASE}/applications?$select=id&$top=1`,
      { headers: { Authorization: `Bearer ${token}` } },
      `probe:${provider.namespace}`,
    );
    return null;
  } catch (error) {
    const message = formatAuthFailure(provider.namespace, error);
    const prefix = `provider:${provider.namespace}: `;
    return message.startsWith(prefix) ? message.slice(prefix.length) : message;
  }
}

async function fetchProviderEntra(
  provider: AzureProvider,
  showNamespace: boolean,
): Promise<ProviderFetchResult> {
  const start = Date.now();
  log("provider start", { namespace: provider.namespace });

  cli.section(
    showNamespace
      ? `Scanning Azure (${provider.namespace})`
      : "Scanning Azure",
  );

  let token: string;
  try {
    token = await acquireToken(provider);
  } catch (error) {
    cli.failStep("Token unusable");
    return {
      resources: [],
      warnings: [formatAuthFailure(provider.namespace, error)],
    };
  }

  const listed = await listApplications(token, provider.namespace);
  if (
    listed.warnings.some(
      (warning) => isAuthFailure(warning) && listed.apps.length === 0,
    )
  ) {
    const authWarning =
      listed.warnings.find((warning) => isAuthFailure(warning)) ??
      listed.warnings[0]!;
    cli.failStep("Token unusable");
    return {
      resources: [],
      warnings: [formatAuthFailure(provider.namespace, authWarning)],
    };
  }

  cli.step(`Found ${listed.apps.length} app registrations`);

  const resources: ScrapedAzureEntra[] = [];
  for (const app of listed.apps) {
    if (!app.id || !app.appId) continue;
    const name =
      (typeof app.displayName === "string" && app.displayName.trim()) ||
      app.appId;
    resources.push({
      kind: "azure-entra",
      id: serviceId(provider.namespace, app.id),
      name,
      group: provider.namespace,
      objectId: app.id,
      applicationId: app.appId,
      directoryId: provider.tenantId,
      redirectUris: parseRedirectUris(app),
      secrets: parseSecrets(app.passwordCredentials),
    });
  }

  resources.sort((a, b) => a.name.localeCompare(b.name));
  cli.step(`${resources.length} resources found (${elapsed(start)})`);
  log("provider done", {
    namespace: provider.namespace,
    resources: resources.length,
    duration: elapsed(start),
  });

  return { resources, warnings: listed.warnings };
}

export async function scrapeAzure(
  providers: AzureProvider[],
): Promise<ScrapeContext> {
  const start = Date.now();
  const showNamespace = providers.length > 1;
  log("scrape start", { providers: providers.map((p) => p.namespace) });

  if (providers.length === 0) {
    return {
      resources: [],
      warnings: [
        "No Azure providers configured (PROVIDER_AZURE_*_{TENANT_ID,CLIENT_ID,PAT})",
      ],
    };
  }

  const resources: ScrapedResource[] = [];
  const warnings: string[] = [];

  for (const provider of providers) {
    try {
      const result = await fetchProviderEntra(provider, showNamespace);
      resources.push(...result.resources);
      warnings.push(...result.warnings);
    } catch (reason) {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      logError(`provider:${provider.namespace} failed`, error);
      cli.failStep(`Failed: ${error.message}`);
      warnings.push(
        isAuthFailure(error)
          ? formatAuthFailure(provider.namespace, error)
          : `provider:${provider.namespace}: ${error.message}`,
      );
    }
  }

  log("scrape complete", {
    resources: resources.length,
    warnings: warnings.length,
    duration: elapsed(start),
  });

  return { resources, warnings };
}

/**
 * Azure scanner facade (Entra ID app registrations for now).
 * Auth: Entra app client id + PAT (client secret) → Graph.
 *
 * New providers mirror this in their scrape file:
 *   probe → scrape → transform
 */
export class AzureScanner implements ServiceScanner {
  constructor(private readonly providers: AzureProvider[]) {}

  static probe = probeAzureProvider;

  scrape(): Promise<ScrapeContext> {
    return scrapeAzure(this.providers);
  }

  transform(ctx: ScrapeContext): ScannedService[] {
    return transformAzure(ctx);
  }
}
