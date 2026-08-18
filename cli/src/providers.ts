const CF_PROVIDER_PREFIX = "PROVIDER_CF";
const CF_SUFFIX_API_KEY = "API_KEY";

const VERCEL_PROVIDER_PREFIX = "PROVIDER_VERCEL";
const VERCEL_SUFFIX_API_KEY = "API_KEY";
const VERCEL_SUFFIX_TEAM_ID = "TEAM_ID";

const AZURE_PROVIDER_PREFIX = "PROVIDER_AZURE";
const AZURE_SUFFIX_TENANT_ID = "TENANT_ID";
const AZURE_SUFFIX_CLIENT_ID = "CLIENT_ID";
const AZURE_SUFFIX_CLIENT_SECRET = "CLIENT_SECRET";

export type ProviderKind = "cf" | "vercel" | "azure";

export type CloudflareProvider = {
  provider: "cf";
  apiKey: string;
  namespace: string;
};

export type VercelProvider = {
  provider: "vercel";
  apiKey: string;
  namespace: string;
  teamId?: string;
};

export type AzureProvider = {
  provider: "azure";
  namespace: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export function cloudflareEnvKeys(namespace: string) {
  return {
    apiKey: `${CF_PROVIDER_PREFIX}_${namespace}_${CF_SUFFIX_API_KEY}`,
  } as const;
}

export function vercelEnvKeys(namespace: string) {
  return {
    apiKey: `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_API_KEY}`,
    teamId: `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_TEAM_ID}`,
  } as const;
}

export function azureEnvKeys(namespace: string) {
  return {
    tenantId: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_TENANT_ID}`,
    clientId: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_CLIENT_ID}`,
    clientSecret: `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_CLIENT_SECRET}`,
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

export function envToProvider(env: NodeJS.ProcessEnv) {
  const cfNamespaces = namespacesForKey(
    env,
    CF_PROVIDER_PREFIX,
    CF_SUFFIX_API_KEY,
  );
  const vercelNamespaces = namespacesForKey(
    env,
    VERCEL_PROVIDER_PREFIX,
    VERCEL_SUFFIX_API_KEY,
  );
  const azureNamespaces = namespacesForKey(
    env,
    AZURE_PROVIDER_PREFIX,
    AZURE_SUFFIX_TENANT_ID,
  );

  return {
    cloudflare: cfNamespaces.map((namespace) => {
      const keys = cloudflareEnvKeys(namespace);
      return {
        provider: "cf",
        namespace,
        apiKey: requireEnv(env, keys.apiKey, `Cloudflare API key for ${namespace}`),
      };
    }),
    vercel: vercelNamespaces.map((namespace) => {
      const keys = vercelEnvKeys(namespace);
      return {
        provider: "vercel",
        namespace,
        apiKey: requireEnv(env, keys.apiKey, `Vercel API key for ${namespace}`),
        teamId: env[keys.teamId],
      };
    }),
    azure: azureNamespaces.map((namespace) => {
      const keys = azureEnvKeys(namespace);
      return {
        provider: "azure",
        namespace,
        tenantId: requireEnv(
          env,
          keys.tenantId,
          `Azure tenant ID for ${namespace}`,
        ),
        clientId: requireEnv(
          env,
          keys.clientId,
          `Azure client ID for ${namespace}`,
        ),
        clientSecret: requireEnv(
          env,
          keys.clientSecret,
          `Azure client secret for ${namespace}`,
        ),
      };
    }),
  } satisfies {
    cloudflare: CloudflareProvider[];
    vercel: VercelProvider[];
    azure: AzureProvider[];
  };
}
