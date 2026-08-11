import { z } from "zod";

/** Supported field value types (implicit from JS value, or explicit via `{ type }`). */
export const fieldTypes = ["string", "bool", "date", "graph"] as const;
export type FieldType = (typeof fieldTypes)[number];

/** Column span within the 2-col field grid (label | value). */
export const FIELD_TYPE_SPAN: Record<FieldType, 1 | 2> = {
  string: 1,
  bool: 1,
  date: 1,
  graph: 2,
};

export type FieldGraphEdge = [string, string];

export type FieldGraphValue = {
  type: "graph";
  vertices: string[];
  edges: FieldGraphEdge[];
};

export type FieldDateValue = {
  type: "date";
  value: string;
};

export type FieldStringValue = {
  type: "string";
  value: string;
};

export type FieldBoolValue = {
  type: "bool";
  value: boolean;
};

export type ExplicitFieldValue =
  | FieldGraphValue
  | FieldDateValue
  | FieldStringValue
  | FieldBoolValue;

/** One resolved scalar after implicit/explicit typing. */
export type ResolvedField =
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "date"; value: string }
  | { type: "graph"; vertices: string[]; edges: FieldGraphEdge[] };

const fieldGraphSchema = z.object({
  type: z.literal("graph"),
  vertices: z.array(z.string()),
  edges: z.array(z.tuple([z.string(), z.string()])),
});

const fieldDateSchema = z.object({
  type: z.literal("date"),
  value: z.string(),
});

const fieldStringSchema = z.object({
  type: z.literal("string"),
  value: z.string(),
});

const fieldBoolSchema = z.object({
  type: z.literal("bool"),
  value: z.boolean(),
});

const explicitFieldSchema = z.discriminatedUnion("type", [
  fieldGraphSchema,
  fieldDateSchema,
  fieldStringSchema,
  fieldBoolSchema,
]);

/** Wire value: primitives (implicit), arrays (implicit items), or `{ type }` objects. */
export const fieldValueSchema = z.union([
  z.string(),
  z.boolean(),
  z.array(z.union([z.string(), z.boolean(), explicitFieldSchema])),
  explicitFieldSchema,
]);

export type FieldValue = z.infer<typeof fieldValueSchema>;

function resolveScalar(value: unknown): ResolvedField | null {
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.type === "graph") {
      const parsed = fieldGraphSchema.safeParse(value);
      return parsed.success
        ? {
            type: "graph",
            vertices: parsed.data.vertices,
            edges: parsed.data.edges,
          }
        : null;
    }
    if (record.type === "date") {
      const parsed = fieldDateSchema.safeParse(value);
      return parsed.success
        ? { type: "date", value: parsed.data.value }
        : null;
    }
    if (record.type === "string") {
      const parsed = fieldStringSchema.safeParse(value);
      return parsed.success
        ? { type: "string", value: parsed.data.value }
        : null;
    }
    if (record.type === "bool") {
      const parsed = fieldBoolSchema.safeParse(value);
      return parsed.success
        ? { type: "bool", value: parsed.data.value }
        : null;
    }
  }
  return null;
}

/**
 * Resolve a category field value to typed scalar(s).
 * Arrays stay implicit wrappers — each item is resolved independently.
 */
export function resolveFieldValue(
  value: unknown,
): ResolvedField | ResolvedField[] | null {
  if (Array.isArray(value)) {
    const items: ResolvedField[] = [];
    for (const item of value) {
      const resolved = resolveScalar(item);
      if (resolved) items.push(resolved);
    }
    return items;
  }
  return resolveScalar(value);
}

/** Span for a resolved value: multi-item arrays force span 2 per item. */
export function fieldSpan(resolved: ResolvedField | ResolvedField[]): 1 | 2 {
  if (Array.isArray(resolved)) {
    if (resolved.length <= 1) {
      const only = resolved[0];
      return only ? FIELD_TYPE_SPAN[only.type] : 1;
    }
    return 2;
  }
  return FIELD_TYPE_SPAN[resolved.type];
}

/** One category of fields: bare names → values (type implied or explicit). */
export const categoryFieldsSchema = z.record(z.string(), fieldValueSchema);

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

/** Endpoint label on a connector — `null` for the public-internet side. */
export const connectorEndpointLabelSchema = z.string().nullable();

/** `[from label, to label]` aligned with connector `nodes` order. */
export const connectorLabelsSchema = z.tuple([
  connectorEndpointLabelSchema,
  connectorEndpointLabelSchema,
]);

/** Scan-time graph metadata on a service (not written to infrastructure.json). */
export const connectorMetaSchema = z.object({
  variant: z.enum(["default", "warning"]).default("default"),
  labels: connectorLabelsSchema.optional(),
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
  labels: connectorLabelsSchema.optional(),
  variant: z.enum(["default", "warning"]).optional(),
  path: z.array(posSchema).min(2),
});

export const infrastructureDbSchema = z.object({
  resources: z.array(resourceSchema),
  groups: z.array(groupSchema),
  static: staticSchema,
  connectors: z.array(connectorSchema),
});

export type ConnectorEndpointLabel = z.infer<typeof connectorEndpointLabelSchema>;
export type ConnectorLabels = z.infer<typeof connectorLabelsSchema>;
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
