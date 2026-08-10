import { z } from "zod";

export const fieldTypes = ["link", "bool"] as const;
export type FieldType = (typeof fieldTypes)[number] | "text";

const fieldTypeSet = new Set<string>(fieldTypes);

/** Parse `"type:Name"` keys; bare keys are plain text. */
export function parseFieldKey(key: string): { type: FieldType; name: string } {
  const separator = key.indexOf(":");
  if (separator > 0) {
    const prefix = key.slice(0, separator);
    if (fieldTypeSet.has(prefix)) {
      return {
        type: prefix as (typeof fieldTypes)[number],
        name: key.slice(separator + 1),
      };
    }
  }
  return { type: "text", name: key };
}

function isStringValue(value: unknown): value is string | string[] {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

function isBoolValue(value: unknown): value is boolean | boolean[] {
  return (
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "boolean"))
  );
}

const fieldValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.boolean()),
]);

/** One category of typed fields: `{ "bool:Name": true, "link:Name": "…", label: "…" }`. */
export const categoryFieldsSchema = z
  .record(z.string(), fieldValueSchema)
  .superRefine((fields, ctx) => {
    for (const [key, value] of Object.entries(fields)) {
      const { type } = parseFieldKey(key);
      if (type === "bool") {
        if (!isBoolValue(value)) {
          ctx.addIssue({
            code: "custom",
            message: `Field "${key}" must be a boolean or boolean[]`,
            path: [key],
          });
        }
      } else if (!isStringValue(value)) {
        ctx.addIssue({
          code: "custom",
          message: `Field "${key}" must be a string or string[]`,
          path: [key],
        });
      }
    }
  });

/** World / layout position: `[x, y, z]`. */
export const posSchema = z.tuple([z.number(), z.number(), z.number()]);
export type Pos = z.infer<typeof posSchema>;

/** Layout / path coords snap to this grid (also z layering offsets). */
export const POS_PRECISION = 0.0001;
const POS_SCALE = 1 / POS_PRECISION;

/** Round a single axis to the nearest {@link POS_PRECISION}. */
export function roundCoord(n: number): number {
  return Math.round(n * POS_SCALE) / POS_SCALE;
}

/** Round `[x, y, z]` to the nearest {@link POS_PRECISION} on every axis. */
export function roundPos(pos: Pos): Pos {
  return [roundCoord(pos[0]), roundCoord(pos[1]), roundCoord(pos[2])];
}

/** Footprint `[width, depth]`. Omitted → `[1, 1]`. */
export const sizeSchema = z.tuple([z.number(), z.number()]);
export type Size = z.infer<typeof sizeSchema>;

export const DEFAULT_SIZE: Size = [1, 1];

export function resolveSize(size?: Size | null): Size {
  return size ?? DEFAULT_SIZE;
}

export function omitDefaultSize(size?: Size | null): Size | undefined {
  if (!size || (size[0] === 1 && size[1] === 1)) return undefined;
  return size;
}

/** Cluster path, or `null` for ungrouped hubs (e.g. public internet). */
export const serviceGroupSchema = z.union([z.string().min(1), z.null()]);

/** Connector endpoint label: `[kind, detail]` shown when that service is focused. */
export const connectorLabelSchema = z.tuple([z.string(), z.string()]);

/** Scan-time graph metadata on a service (not written to infrastructure.json). */
export const connectorMetaSchema = z.object({
  variant: z.enum(["default", "warning"]).default("default"),
  from: connectorLabelSchema.nullable().optional(),
  to: connectorLabelSchema.nullable().optional(),
});

/** Scanned service before layout (internal pipeline only). */
export const scannedServiceSchema = z.object({
  id: z.string().min(1),
  group: serviceGroupSchema,
  name: z.string().min(1),
  connections: z.array(z.string()).default([]),
  connectionMeta: z.record(z.string(), connectorMetaSchema).optional(),
  sourceType: z.string().min(1),
  service: z.string().min(1),
  fields: z.record(z.string(), categoryFieldsSchema),
});

export const resourceSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  name: z.string().min(1),
  sourceType: z.string().min(1),
  service: z.string().min(1),
  fields: z.record(z.string(), categoryFieldsSchema),
  pos: posSchema,
  size: sizeSchema.optional(),
});

export const groupSchema = z.object({
  group: z.string().min(1),
  pos: posSchema,
  size: sizeSchema.optional(),
});

export const publicInternetSchema = z.object({
  id: z.literal("internet"),
  pos: posSchema,
  size: sizeSchema.optional(),
});

export const staticSchema = z.object({
  publicInternet: publicInternetSchema,
});

export const connectorSchema = z.object({
  nodes: z.tuple([z.string().min(1), z.string().min(1)]),
  from: connectorLabelSchema.nullable().optional(),
  to: connectorLabelSchema.nullable().optional(),
  variant: z.enum(["default", "warning"]).optional(),
  path: z.array(posSchema).min(2),
});

export const infrastructureDbSchema = z.object({
  resources: z.array(resourceSchema),
  groups: z.array(groupSchema),
  static: staticSchema,
  connectors: z.array(connectorSchema),
});

export type ConnectorLabel = z.infer<typeof connectorLabelSchema>;
export type ConnectorMeta = z.infer<typeof connectorMetaSchema>;
export type CategoryFields = z.infer<typeof categoryFieldsSchema>;
export type ServiceFields = Record<string, CategoryFields>;
export type ScannedService = z.infer<typeof scannedServiceSchema>;
export type Resource = z.infer<typeof resourceSchema>;
export type Group = z.infer<typeof groupSchema>;
export type Connector = z.infer<typeof connectorSchema>;
export type InfrastructureDb = z.infer<typeof infrastructureDbSchema>;

export function toWireResource(
  service: ScannedService & { pos: Pos; size?: Size },
): Resource {
  const size = omitDefaultSize(service.size);
  return {
    id: service.id,
    group: service.group!,
    name: service.name,
    sourceType: service.sourceType,
    service: service.service,
    fields: service.fields,
    pos: service.pos,
    ...(size ? { size } : {}),
  };
}

export function toWireGroup(
  group: string,
  pos: Pos,
  size: Size,
): Group {
  const wireSize = omitDefaultSize(size);
  return {
    group,
    pos,
    ...(wireSize ? { size: wireSize } : {}),
  };
}
