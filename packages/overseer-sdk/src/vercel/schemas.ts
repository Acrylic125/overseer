import { z } from "zod";

export const vercelEnvRowSchema = z.object({
  key: z.string(),
  value: z.string().optional(),
  type: z.string().optional(),
  target: z.union([z.string(), z.array(z.string())]).optional(),
  gitBranch: z.string().optional(),
  customEnvironmentIds: z.array(z.string()).optional(),
  updatedAt: z.number().optional(),
});

export const vercelDomainRowSchema = z.object({
  name: z.string(),
});

export const vercelCustomEnvironmentSchema = z.object({
  id: z.string(),
  slug: z.string(),
});

export type VercelEnvRow = z.infer<typeof vercelEnvRowSchema>;
export type VercelDomainRow = z.infer<typeof vercelDomainRowSchema>;
export type VercelCustomEnvironment = z.infer<
  typeof vercelCustomEnvironmentSchema
>;

export function parseVercelEnvRow(value: object) {
  const parsed = vercelEnvRowSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseVercelDomainRow(value: object) {
  const parsed = vercelDomainRowSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseVercelCustomEnvironment(value: unknown) {
  const parsed = vercelCustomEnvironmentSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseVercelCustomEnvironments(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((row) => parseVercelCustomEnvironment(row))
      .filter((row): row is VercelCustomEnvironment => row !== null);
  }
  if (value && typeof value === "object" && "environments" in value) {
    const environments = value.environments;
    if (Array.isArray(environments)) {
      return parseVercelCustomEnvironments(environments);
    }
  }
  return [];
}
