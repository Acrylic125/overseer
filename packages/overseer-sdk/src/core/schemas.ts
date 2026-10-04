import { z } from "zod";

import type { FieldGroup, FieldNode, FieldValue, Resource } from "../types.js";

const fieldValueSchema: z.ZodType<FieldValue> = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.object({ type: z.literal("date"), value: z.string() }),
  z.object({
    type: z.literal("graph"),
    vertices: z.array(z.string()),
    edges: z.array(z.tuple([z.string(), z.string()])),
  }),
  z.object({ type: z.literal("hidden") }),
  z.object({ type: z.literal("secret"), value: z.string() }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  }),
]);

const fieldGroupSchema: z.ZodType<FieldGroup> = z.lazy(() =>
  z.union([
    z.object({
      hideHeading: z.boolean().optional(),
      type: z.literal("all").optional(),
      fields: z.record(z.string(), fieldNodeSchema),
    }),
    z.object({
      hideHeading: z.boolean().optional(),
      type: z.enum(["tab-single", "dropdown-single", "dropdown-multi"]),
      fields: z.record(z.string(), fieldNodeSchema),
      defaultShow: z.string().optional(),
    }),
  ]),
);

const fieldNodeSchema: z.ZodType<FieldNode> = z.lazy(() =>
  z.union([fieldValueSchema, z.array(fieldValueSchema), fieldGroupSchema]),
);

export const resourceAlertSchema = z.object({
  type: z.enum(["warning", "error"]),
  message: z.string(),
});

export const resourceSchema: z.ZodType<Resource> = z.object({
  id: z.templateLiteral([z.string(), ":", z.string()]),
  group: z.string(),
  name: z.string(),
  url: z.string(),
  service: z.string(),
  fields: z.record(z.string(), fieldNodeSchema),
  asset: z.string(),
  alerts: z.array(resourceAlertSchema),
  tags: z.object({
    namespace: z.string().optional(),
    provider: z.string().optional(),
    account: z.string().optional(),
  }),
});

export const edgeKinds = ["dns", "route", "binding", "env", "auth"] as const;

export const exposureSchema = z.object({
  type: z.enum(["host", "ref"]),
  value: z.string().min(1),
  label: z.string(),
  /** DNS hostnames front every other resource exposing the same host. */
  entry: z.boolean().optional(),
  /** Browser origins allowed to call this host. Undefined means unrestricted. */
  allowedOrigins: z.array(z.string()).optional(),
});

export const referenceSchema = z.object({
  type: z.enum(["host", "ref"]),
  value: z.string().min(1),
  kind: z.enum(edgeKinds),
});

export const linkEntrySchema = z.object({
  resource: resourceSchema,
  exposes: z.array(exposureSchema),
  references: z.array(referenceSchema),
  /** Upstream change marker (e.g. `modified_on`) used to skip detail fetches. */
  revision: z.string().optional(),
});

export const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(edgeKinds),
  label: z.string(),
  alerts: z.array(resourceAlertSchema),
});

export const cacheEntrySchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  provider: z.string(),
  namespace: z.string(),
  account: z.string(),
  scanner: z.string(),
  scannerVersion: z.number(),
  scrapedAt: z.iso.datetime(),
  entries: z.array(linkEntrySchema),
  previous: z
    .object({
      scrapedAt: z.iso.datetime(),
      resources: z.record(
        z.string(),
        z.object({ name: z.string(), hash: z.string() }),
      ),
    })
    .optional(),
});

export const resourceChanges = ["added", "modified"] as const;

export const graphSnapshotSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  warnings: z.array(z.string()),
  scopes: z.array(z.object({ scope: z.string(), scrapedAt: z.iso.datetime() })),
  resources: z.array(resourceSchema),
  changes: z.record(z.string(), z.enum(resourceChanges)),
  removed: z.array(
    z.object({ id: z.string(), name: z.string(), scope: z.string() }),
  ),
  edges: z.array(edgeSchema),
});

export type EdgeKind = (typeof edgeKinds)[number];
export type Exposure = z.infer<typeof exposureSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type LinkEntry = z.infer<typeof linkEntrySchema>;
export type Edge = z.infer<typeof edgeSchema>;
export type CacheEntry = z.infer<typeof cacheEntrySchema>;
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;
