import { z } from "zod";

export const workerBindingSchema = z
  .object({
    type: z.string().optional(),
    name: z.string().optional(),
    text: z.string().optional(),
    namespace_id: z.string().optional(),
    database_id: z.string().optional(),
    id: z.string().optional(),
    bucket_name: z.string().optional(),
    index_name: z.string().optional(),
    queue_name: z.string().optional(),
    service: z.string().optional(),
    class_name: z.string().optional(),
    script_name: z.string().optional(),
    workflow_name: z.string().optional(),
  })
  .passthrough();

export const workerSettingsSchema = z.object({
  bindings: z.array(workerBindingSchema).optional(),
});

export const workerSecretSchema = z
  .object({
    name: z.string(),
    type: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

export const r2CorsSchema = z.object({
  rules: z
    .array(
      z.object({
        allowed: z
          .object({
            origins: z.array(z.string()).optional(),
            methods: z.array(z.string()).optional(),
          })
          .optional(),
        allowedOrigins: z.array(z.string()).optional(),
        allowedMethods: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

export const r2CustomDomainsSchema = z.object({
  domains: z
    .array(
      z.object({
        domain: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .optional(),
});

export const r2ManagedDomainsSchema = z.object({
  enabled: z.boolean().optional(),
});

export type WorkerBinding = z.infer<typeof workerBindingSchema>;
export type WorkerSettings = z.infer<typeof workerSettingsSchema>;
export type WorkerSecret = z.infer<typeof workerSecretSchema>;
export type R2Cors = z.infer<typeof r2CorsSchema>;
export type R2CustomDomains = z.infer<typeof r2CustomDomainsSchema>;
export type R2ManagedDomains = z.infer<typeof r2ManagedDomainsSchema>;

export type WorkflowNode = {
  type?: string;
  name?: string;
  nodes?: WorkflowNode[];
  branches?: Array<{ nodes?: WorkflowNode[] }>;
  try_block?: { nodes?: WorkflowNode[] };
  catch_block?: { nodes?: WorkflowNode[] };
  finally_block?: { nodes?: WorkflowNode[] };
};

export const workflowNodeSchema: z.ZodType<WorkflowNode> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    name: z.string().optional(),
    nodes: z.array(workflowNodeSchema).optional(),
    branches: z
      .array(z.object({ nodes: z.array(workflowNodeSchema).optional() }))
      .optional(),
    try_block: z.object({ nodes: z.array(workflowNodeSchema).optional() }).optional(),
    catch_block: z.object({ nodes: z.array(workflowNodeSchema).optional() }).optional(),
    finally_block: z
      .object({ nodes: z.array(workflowNodeSchema).optional() })
      .optional(),
  }),
);

export const workflowGraphSchema = z.object({
  graph: z
    .object({
      workflow: z
        .object({
          nodes: z.array(workflowNodeSchema).optional(),
        })
        .optional(),
      nodes: z.array(workflowNodeSchema).optional(),
    })
    .optional(),
  workflow: z
    .object({
      nodes: z.array(workflowNodeSchema).optional(),
    })
    .optional(),
  nodes: z.array(workflowNodeSchema).optional(),
});

export function parseWorkerSettings(value: object) {
  const parsed = workerSettingsSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseWorkerSecret(value: object) {
  const parsed = workerSecretSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseR2Cors(value: object) {
  const parsed = r2CorsSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseR2CustomDomains(value: object) {
  const parsed = r2CustomDomainsSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseR2ManagedDomains(value: object) {
  const parsed = r2ManagedDomainsSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}

export function parseWorkflowGraph(value: object) {
  const parsed = workflowGraphSchema.safeParse(value);
  if (!parsed.success) return null;
  return parsed.data;
}
