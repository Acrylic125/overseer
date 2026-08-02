import { z } from "zod";

export const infrastructureCategorySchema = z.enum([
  "compute",
  "storage",
  "database",
  "integration",
]);

export const infrastructureSpeciesSchema = z.enum([
  "database",
  "api_gateway",
  "microservice",
  "queue",
  "cdn_edge",
  "load_balancer",
  "object_storage",
]);

export const nodeHealthSchema = z.enum(["healthy", "warning", "critical"]);

export const infrastructureZoneSchema = z.enum([
  "payment",
  "auth",
  "edge",
  "data",
  "compute",
]);

export const nodeMetricsSchema = z.object({
  rps: z.number(),
  errorRate: z.number(),
  latencyMs: z.number(),
});

/** Service row as written by the scanner (positions applied by the UI). */
export const scannedServiceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  width: z.number().positive().default(1),
  depth: z.number().positive().default(1),
  group: z.string().min(1),
  connections: z.array(z.string()),
  species: infrastructureSpeciesSchema,
  category: infrastructureCategorySchema,
  health: nodeHealthSchema,
  zone: infrastructureZoneSchema,
  metrics: nodeMetricsSchema,
  color: z.string().min(1),
  additionalInfo: z.string().optional(),
});

export const infrastructureDbSchema = z.object({
  version: z.literal(1),
  scannedAt: z.string().datetime({ offset: true }),
  services: z.array(scannedServiceSchema),
  warnings: z.array(z.string()),
});

export type ScannedService = z.infer<typeof scannedServiceSchema>;
export type InfrastructureDb = z.infer<typeof infrastructureDbSchema>;
