import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { transformProviders } from "./lib/providers/transformer";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
  },
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
  createFinalSchema: (shape) =>
    z.object(shape).transform((validated) => ({
      ...validated,
      providers: transformProviders(process.env),
    })),
});
