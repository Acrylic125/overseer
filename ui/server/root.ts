import { infrastructureRouter } from "@/server/routers/infrastructure";
import { router } from "@/server/trpc";

export const appRouter = router({
  infrastructure: infrastructureRouter,
});

export type AppRouter = typeof appRouter;
