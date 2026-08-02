import { readFile } from "node:fs/promises";
import path from "node:path";

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

/** Service row from the scan JSON database (no grid positions yet). */
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

function resolveDbPath() {
  if (process.env.INFRASTRUCTURE_DB_PATH) {
    return path.resolve(process.env.INFRASTRUCTURE_DB_PATH);
  }
  // Next.js runs with cwd = ui/
  return path.resolve(process.cwd(), "data", "infrastructure.json");
}

/**
 * Load and zod-parse the JSON database produced by `scan`.
 */
export async function loadInfrastructureDb(): Promise<InfrastructureDb> {
  const dbPath = resolveDbPath();
  let raw: string;
  try {
    raw = await readFile(dbPath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      throw new Error(
        `Infrastructure database not found at ${dbPath}. Run \`pnpm scan\` in the scan/ package.`,
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Infrastructure database at ${dbPath} is not valid JSON.`);
  }

  const parsed = infrastructureDbSchema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Infrastructure database failed schema validation (${dbPath}): ${detail}`,
    );
  }

  return parsed.data;
}
