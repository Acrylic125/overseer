import type { Provider } from "@acrylic125/overseer-sdk";
import { azure } from "@acrylic125/overseer-sdk/azure";
import { cloudflare } from "@acrylic125/overseer-sdk/cloudflare";
import { vercel } from "@acrylic125/overseer-sdk/vercel";

const CF_PROVIDER_PREFIX = "PROVIDER_CF";
const CF_SUFFIX_API_KEY = "API_KEY";

const VERCEL_PROVIDER_PREFIX = "PROVIDER_VERCEL";
const VERCEL_SUFFIX_API_KEY = "API_KEY";
const VERCEL_SUFFIX_TEAM_ID = "TEAM_ID";
const VERCEL_SUFFIX_API_URL = "API_URL";

const AZURE_PROVIDER_PREFIX = "PROVIDER_AZURE";
const AZURE_SUFFIX_TENANT_ID = "TENANT_ID";
const AZURE_SUFFIX_CLIENT_ID = "CLIENT_ID";
const AZURE_SUFFIX_CLIENT_SECRET = "CLIENT_SECRET";
const AZURE_SUFFIX_AUTHORITY_HOST = "AUTHORITY_HOST";
const AZURE_SUFFIX_GRAPH_URL = "GRAPH_URL";

export type ProviderKind = "cf" | "vercel" | "azure";

export function cloudflareEnvKeys(namespace: string) {
  return {
    apiKey: `${CF_PROVIDER_PREFIX}_${namespace}_${CF_SUFFIX_API_KEY}`,
  } as const;
}

export function vercelEnvKeys(namespace: string) {
  return {
    apiKey: `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_API_KEY}`,
    teamId: `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_TEAM_ID}`,
    apiUrl: `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_API_URL}`,
  } as const;
}

export function azureEnvKeys(namespace: string) {
  return {
    tenantId: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_TENANT_ID}`,
    clientId: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_CLIENT_ID}`,
    clientSecret: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_CLIENT_SECRET}`,
    authorityHost: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_AUTHORITY_HOST}`,
    graphUrl: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_GRAPH_URL}`,
  } as const;
}

function namespacesForKey(
  env: NodeJS.ProcessEnv,
  prefix: string,
  suffix: string,
) {
  const tail = `_${suffix}`;
  return Object.keys(env).flatMap((key) => {
    if (!key.startsWith(`${prefix}_`) || !key.endsWith(tail)) return [];
    return [key.slice(prefix.length + 1, -tail.length)];
  });
}

function requireEnv(env: NodeJS.ProcessEnv, key: string, label: string) {
  const value = env[key];
  if (!value) {
    throw new Error(`${label} (${key}) not found`);
  }
  return value;
}

export function envToProviders(env: NodeJS.ProcessEnv) {
  const providers: Provider[] = [];

  for (const namespace of namespacesForKey(
    env,
    CF_PROVIDER_PREFIX,
    CF_SUFFIX_API_KEY,
  )) {
    const keys = cloudflareEnvKeys(namespace);
    providers.push(
      cloudflare({
        namespace,
        apiToken: requireEnv(
          env,
          keys.apiKey,
          `Cloudflare API key for ${namespace}`,
        ),
      }),
    );
  }

  for (const namespace of namespacesForKey(
    env,
    VERCEL_PROVIDER_PREFIX,
    VERCEL_SUFFIX_API_KEY,
  )) {
    const keys = vercelEnvKeys(namespace);
    providers.push(
      vercel({
        namespace,
        apiToken: requireEnv(env, keys.apiKey, `Vercel API key for ${namespace}`),
        teamId: env[keys.teamId],
        apiUrl: env[keys.apiUrl],
      }),
    );
  }

  for (const namespace of namespacesForKey(
    env,
    AZURE_PROVIDER_PREFIX,
    AZURE_SUFFIX_TENANT_ID,
  )) {
    const keys = azureEnvKeys(namespace);
    providers.push(
      azure({
        namespace,
        tenantId: requireEnv(env, keys.tenantId, `Azure tenant ID for ${namespace}`),
        clientId: requireEnv(env, keys.clientId, `Azure client ID for ${namespace}`),
        clientSecret: requireEnv(
          env,
          keys.clientSecret,
          `Azure client secret for ${namespace}`,
        ),
        authorityHost: env[keys.authorityHost],
        graphBaseUrl: env[keys.graphUrl],
      }),
    );
  }

  return providers;
}
