const CF_PROVIDER_PREFIX = "PROVIDER_CF";
const CF_SUFFIX_API_KEY = "API_KEY";

const VERCEL_PROVIDER_PREFIX = "PROVIDER_VERCEL";
const VERCEL_SUFFIX_API_KEY = "API_KEY";
const VERCEL_SUFFIX_TEAM_ID = "TEAM_ID";

const AZURE_PROVIDER_PREFIX = "PROVIDER_AZURE";
const AZURE_SUFFIX_TENANT_ID = "TENANT_ID";
const AZURE_SUFFIX_CLIENT_ID = "CLIENT_ID";
const AZURE_SUFFIX_CLIENT_SECRET = "CLIENT_SECRET";

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

export function envToProvider(env: NodeJS.ProcessEnv) {
  const keys = Object.keys(env);
  const providerKeys = keys.filter((key) => key.startsWith("PROVIDER_"));

  const cfNamespaces = providerKeys
    .filter(
      (key) =>
        key.startsWith(`${CF_PROVIDER_PREFIX}_`) &&
        key.endsWith(CF_SUFFIX_API_KEY),
    )
    .map((key) =>
      key
        .replace(`${CF_PROVIDER_PREFIX}_`, "")
        .slice(0, -CF_SUFFIX_API_KEY.length),
    );
  const vercelNamespaces = providerKeys
    .filter(
      (key) =>
        key.startsWith(`${VERCEL_PROVIDER_PREFIX}_`) &&
        key.endsWith(VERCEL_SUFFIX_API_KEY),
    )
    .map((key) =>
      key
        .replace(`${VERCEL_PROVIDER_PREFIX}_`, "")
        .slice(0, -VERCEL_SUFFIX_API_KEY.length),
    );
  const azureNamespaces = providerKeys
    .filter(
      (key) =>
        key.startsWith(`${AZURE_PROVIDER_PREFIX}_`) &&
        key.endsWith(AZURE_SUFFIX_TENANT_ID),
    )
    .map((key) =>
      key
        .replace(`${AZURE_PROVIDER_PREFIX}_`, "")
        .slice(0, -AZURE_SUFFIX_TENANT_ID.length),
    );

  return {
    cloudflare: cfNamespaces.map((namespace) => {
      const key = `${CF_PROVIDER_PREFIX}_${namespace}_${CF_SUFFIX_API_KEY}`;
      const apiKey = env[key];
      if (!apiKey) {
        throw new Error(
          `API key for Cloudflare namespace ${namespace} (${key}) not found`,
        );
      }
      return {
        provider: "cf",
        namespace,
        apiKey,
      };
    }),
    vercel: vercelNamespaces.map((namespace) => {
      let key = `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_API_KEY}`;
      const apiKey = env[key];
      if (!apiKey) {
        throw new Error(
          `API key for Vercel namespace ${namespace} (${key}) not found`,
        );
      }
      key = `${VERCEL_PROVIDER_PREFIX}_${namespace}_${VERCEL_SUFFIX_TEAM_ID}`;
      const teamId = env[key];
      return {
        provider: "vercel",
        namespace,
        apiKey,
        teamId,
      };
    }),
    azure: azureNamespaces.map((namespace) => {
      let key = `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_TENANT_ID}`;
      const tenantId = env[key];
      if (!tenantId) {
        throw new Error(
          `Tenant ID for Azure namespace ${namespace} (${key}) not found`,
        );
      }
      key = `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_CLIENT_ID}`;
      const clientId = env[key];
      if (!clientId) {
        throw new Error(
          `Client ID for Azure namespace ${namespace} (${key}) not found`,
        );
      }
      key = `${AZURE_PROVIDER_PREFIX}_${namespace}_${AZURE_SUFFIX_CLIENT_SECRET}`;
      const clientSecret = env[key];
      if (!clientSecret) {
        throw new Error(
          `Client secret for Azure namespace ${namespace} (${key}) not found`,
        );
      }
      return {
        provider: "azure",
        namespace,
        tenantId,
        clientId,
        clientSecret,
      };
    }),
  } satisfies {
    cloudflare: CloudflareProvider[];
    vercel: VercelProvider[];
    azure: AzureProvider[];
  };
}
