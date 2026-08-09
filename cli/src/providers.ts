export type CloudflareProvider = {
  provider: "cf";
  apiKey: string;
  namespace: string;
};

export type VercelProvider = {
  provider: "vercel";
  apiKey: string;
  namespace: string;
  /** Optional team id for team-scoped tokens (`PROVIDER_VERCEL_<ns>_TEAM_ID`). */
  teamId?: string;
};

/**
 * Azure provider — Microsoft Graph via client-credentials.
 * `pat` is the Entra app client secret (same role as CF/Vercel API tokens).
 */
export type AzureProvider = {
  provider: "azure";
  namespace: string;
  tenantId: string;
  clientId: string;
  pat: string;
};

export type Provider = CloudflareProvider | VercelProvider | AzureProvider;

const CF_API_KEY_PATTERN = /^PROVIDER_CF_(.+)_API_KEY$/;
const VERCEL_API_KEY_PATTERN = /^PROVIDER_VERCEL_(.+)_API_KEY$/;
const VERCEL_TEAM_ID_PATTERN = /^PROVIDER_VERCEL_(.+)_TEAM_ID$/;
const AZURE_TENANT_PATTERN = /^PROVIDER_AZURE_(.+)_TENANT_ID$/;
const AZURE_CLIENT_ID_PATTERN = /^PROVIDER_AZURE_(.+)_CLIENT_ID$/;
const AZURE_PAT_PATTERN = /^PROVIDER_AZURE_(.+)_PAT$/;
/** @deprecated Prefer PROVIDER_AZURE_<ns>_PAT */
const AZURE_CLIENT_SECRET_PATTERN = /^PROVIDER_AZURE_(.+)_CLIENT_SECRET$/;

/**
 * Converts process.env entries like PROVIDER_CF_<Namespace>_API_KEY /
 * PROVIDER_VERCEL_<Namespace>_API_KEY /
 * PROVIDER_AZURE_<Namespace>_{TENANT_ID,CLIENT_ID,PAT}
 * into typed provider configs.
 */
export function transformProviders(
  envRecord: NodeJS.ProcessEnv = process.env,
): Provider[] {
  const providers: Provider[] = [];
  const vercelTeamIds = new Map<string, string>();
  const azureTenants = new Map<string, string>();
  const azureClientIds = new Map<string, string>();
  const azurePats = new Map<string, string>();

  for (const [key, value] of Object.entries(envRecord)) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    const teamMatch = VERCEL_TEAM_ID_PATTERN.exec(key);
    if (teamMatch?.[1]) {
      vercelTeamIds.set(teamMatch[1], trimmed);
      continue;
    }

    const tenantMatch = AZURE_TENANT_PATTERN.exec(key);
    if (tenantMatch?.[1]) {
      azureTenants.set(tenantMatch[1], trimmed);
      continue;
    }

    const clientIdMatch = AZURE_CLIENT_ID_PATTERN.exec(key);
    if (clientIdMatch?.[1]) {
      azureClientIds.set(clientIdMatch[1], trimmed);
      continue;
    }

    const patMatch = AZURE_PAT_PATTERN.exec(key);
    if (patMatch?.[1]) {
      azurePats.set(patMatch[1], trimmed);
      continue;
    }

    const secretMatch = AZURE_CLIENT_SECRET_PATTERN.exec(key);
    if (secretMatch?.[1] && !azurePats.has(secretMatch[1])) {
      azurePats.set(secretMatch[1], trimmed);
    }
  }

  for (const [key, value] of Object.entries(envRecord)) {
    if (!value) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;

    const cfMatch = CF_API_KEY_PATTERN.exec(key);
    if (cfMatch?.[1]) {
      providers.push({
        provider: "cf",
        apiKey: trimmed,
        namespace: cfMatch[1],
      });
      continue;
    }

    const vercelMatch = VERCEL_API_KEY_PATTERN.exec(key);
    if (vercelMatch?.[1]) {
      const namespace = vercelMatch[1];
      const teamId = vercelTeamIds.get(namespace);
      providers.push({
        provider: "vercel",
        apiKey: trimmed,
        namespace,
        ...(teamId ? { teamId } : {}),
      });
    }
  }

  const azureNamespaces = new Set([
    ...azureTenants.keys(),
    ...azureClientIds.keys(),
    ...azurePats.keys(),
  ]);
  for (const namespace of azureNamespaces) {
    const tenantId = azureTenants.get(namespace);
    const clientId = azureClientIds.get(namespace);
    const pat = azurePats.get(namespace);
    if (!tenantId || !clientId || !pat) continue;
    providers.push({
      provider: "azure",
      namespace,
      tenantId,
      clientId,
      pat,
    });
  }

  return providers.sort((a, b) => {
    const byProvider = a.provider.localeCompare(b.provider);
    if (byProvider !== 0) return byProvider;
    return a.namespace.localeCompare(b.namespace);
  });
}
