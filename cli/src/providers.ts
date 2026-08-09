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

export type Provider = CloudflareProvider | VercelProvider;

const CF_API_KEY_PATTERN = /^PROVIDER_CF_(.+)_API_KEY$/;
const VERCEL_API_KEY_PATTERN = /^PROVIDER_VERCEL_(.+)_API_KEY$/;
const VERCEL_TEAM_ID_PATTERN = /^PROVIDER_VERCEL_(.+)_TEAM_ID$/;

/**
 * Converts process.env entries like PROVIDER_CF_<Namespace>_API_KEY /
 * PROVIDER_VERCEL_<Namespace>_API_KEY into typed provider configs.
 */
export function transformProviders(
  envRecord: NodeJS.ProcessEnv = process.env,
): Provider[] {
  const providers: Provider[] = [];
  const vercelTeamIds = new Map<string, string>();

  for (const [key, value] of Object.entries(envRecord)) {
    if (!value) continue;
    const teamMatch = VERCEL_TEAM_ID_PATTERN.exec(key);
    if (!teamMatch?.[1]) continue;
    const teamId = value.trim();
    if (teamId) vercelTeamIds.set(teamMatch[1], teamId);
  }

  for (const [key, value] of Object.entries(envRecord)) {
    if (!value) continue;

    const cfMatch = CF_API_KEY_PATTERN.exec(key);
    if (cfMatch?.[1]) {
      const apiKey = value.trim();
      if (!apiKey) continue;
      providers.push({
        provider: "cf",
        apiKey,
        namespace: cfMatch[1],
      });
      continue;
    }

    const vercelMatch = VERCEL_API_KEY_PATTERN.exec(key);
    if (vercelMatch?.[1]) {
      const apiKey = value.trim();
      if (!apiKey) continue;
      const namespace = vercelMatch[1];
      const teamId = vercelTeamIds.get(namespace);
      providers.push({
        provider: "vercel",
        apiKey,
        namespace,
        ...(teamId ? { teamId } : {}),
      });
    }
  }

  return providers.sort((a, b) => {
    const byProvider = a.provider.localeCompare(b.provider);
    if (byProvider !== 0) return byProvider;
    return a.namespace.localeCompare(b.namespace);
  });
}
