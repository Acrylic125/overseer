import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    /** Defaults to `public/graph.json`, where `pnpm cli scan --dir ../ui/public` writes. */
    OVERSEER_GRAPH_PATH: z.string().optional(),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
});
