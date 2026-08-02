import Cloudflare from "cloudflare";

import type { CloudflareProvider } from "@/lib/providers/transformer";

export type ProviderStatus = "ok" | "error";

export async function verifyCloudflareProvider(
  provider: CloudflareProvider,
): Promise<{ status: ProviderStatus; message?: string }> {
  try {
    const client = new Cloudflare({ apiToken: provider.apiKey });
    const result = await client.user.tokens.verify();

    if (result.status === "active") {
      return { status: "ok" };
    }

    return {
      status: "error",
      message: `Token status: ${result.status ?? "unknown"}`,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Verification failed";
    return { status: "error", message };
  }
}
