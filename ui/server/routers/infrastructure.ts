import { z } from "zod";

import { publicProcedure, router } from "@/server/trpc";

/** Visual/behavioral species — silhouette must telegraph function. */
export type InfrastructureSpecies =
  | "database"
  | "api_gateway"
  | "microservice"
  | "queue"
  | "cdn_edge"
  | "load_balancer";

export type NodeHealth = "healthy" | "warning" | "critical";

export type InfrastructureZone =
  | "payment"
  | "auth"
  | "edge"
  | "data"
  | "compute";

/** @deprecated Prefer `species`. Kept for Cloudflare transformer compatibility. */
export type InfrastructureCategory = "compute" | "storage" | "database";

export type NodeMetrics = {
  rps: number;
  errorRate: number;
  latencyMs: number;
};

export type InfrastructureService = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  /** Service IDs this service can access */
  connections: string[];
  species: InfrastructureSpecies;
  /** Legacy category derived from species */
  category: InfrastructureCategory;
  health: NodeHealth;
  zone: InfrastructureZone;
  metrics: NodeMetrics;
  /** Accent / type color */
  color: string;
  /** Optional secondary line (e.g. Worker domain) */
  additionalInfo?: string;
};

export const infrastructureRouter = router({
  list: publicProcedure
    .input(
      z
        .object({
          namespace: z.string().min(1).optional(),
        })
        .optional(),
    )
    .query(async () => {
      // TEMPORARY: provider querying disabled — canvas generates mock client-side.
      return {
        services: [],
        edges: [],
        warnings: [
          "TEMPORARY mock data active — Cloudflare provider querying is disabled.",
        ],
        centerGuide: { x: 0, y: 0, radius: 200 },
        useClientMock: true as const,
      };
    }),
});
