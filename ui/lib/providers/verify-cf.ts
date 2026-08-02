import Cloudflare from "cloudflare";

import type { CloudflareProvider } from "@/lib/providers/transformer";

export type ProviderStatus = "ok" | "error";

export async function verifyCloudflareProvider(
  provider: CloudflareProvider,
): Promise<{ status: ProviderStatus; message?: string }> {
  try {
    const client = new Cloudflare({
      apiToken: provider.apiKey.trim(),
      maxRetries: 0,
    });

    // Account tokens (cfat_) must use accounts.tokens.verify, not user.tokens.verify.
    if (provider.apiKey.trim().startsWith("cfat_")) {
      const iterator = client.accounts.list({ per_page: 1 })[
        Symbol.asyncIterator
      ]();
      const next = await iterator.next();
      if (next.done || !next.value) {
        return {
          status: "error",
          message: "Token authenticated but has no accessible accounts",
        };
      }

      try {
        const result = await client.accounts.tokens.verify({
          account_id: next.value.id,
        });
        if (result.status === "active") {
          return { status: "ok" };
        }
        return {
          status: "error",
          message: `Token status: ${result.status ?? "unknown"}`,
        };
      } catch {
        // Listing accounts already proved the token works.
        return { status: "ok" };
      }
    }

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
