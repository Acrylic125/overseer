export type CloudflareProvider = {
  provider: "cf";
  apiKey: string;
  namespace: string;
};

export type Provider = CloudflareProvider;

const CF_API_KEY_PATTERN = /^PROVIDER_CF_(.+)_API_KEY$/;

/**
 * Converts process.env entries like PROVIDER_CF_<Namespace>_API_KEY
 * into typed provider configs.
 */
export function transformProviders(
  envRecord: NodeJS.ProcessEnv = process.env,
): Provider[] {
  const providers: Provider[] = [];

  for (const [key, value] of Object.entries(envRecord)) {
    if (!value) continue;

    const match = CF_API_KEY_PATTERN.exec(key);
    if (!match) continue;

    const namespace = match[1];
    if (!namespace) continue;

    const apiKey = value.trim();
    if (!apiKey) continue;

    providers.push({
      provider: "cf",
      apiKey,
      namespace,
    });
  }

  return providers.sort((a, b) => a.namespace.localeCompare(b.namespace));
}

