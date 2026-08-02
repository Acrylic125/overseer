import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { env } from "@/env";
import { verifyCloudflareProvider } from "@/lib/providers/verify-cf";
import { publicProcedure, router } from "@/server/trpc";

export const providersRouter = router({
  list: publicProcedure.query(() =>
    env.providers.map(({ provider, namespace }) => ({
      provider,
      namespace,
    })),
  ),

  verify: publicProcedure
    .input(
      z.object({
        namespace: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const provider = env.providers.find(
        (p) => p.namespace === input.namespace,
      );

      if (!provider) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Provider "${input.namespace}" not found`,
        });
      }

      if (provider.provider === "cf") {
        const result = await verifyCloudflareProvider(provider);
        return {
          namespace: provider.namespace,
          provider: provider.provider,
          ...result,
        };
      }

      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: `Verification not supported for provider "${provider.provider}"`,
      });
    }),
});
