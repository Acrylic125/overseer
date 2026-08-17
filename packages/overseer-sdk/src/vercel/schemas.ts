import { z } from "zod";

export const vercelEnvRowSchema = z.object({
  key: z.string(),
  value: z.string().optional(),
  type: z.string().optional(),
  target: z.union([z.string(), z.array(z.string())]).optional(),
  gitBranch: z.string().optional(),
});

export const vercelDomainRowSchema = z.object({
  name: z.string(),
});

export type VercelEnvRow = z.infer<typeof vercelEnvRowSchema>;
export type VercelDomainRow = z.infer<typeof vercelDomainRowSchema>;

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
