import { infrastructureRouter } from "@/server/routers/infrastructure";
import { providersRouter } from "@/server/routers/providers";
import { router } from "@/server/trpc";

export const appRouter = router({
  providers: providersRouter,
  infrastructure: infrastructureRouter,
});

export type AppRouter = typeof appRouter;
