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
  z.number(),
  z.array(z.union([z.string(), z.boolean(), z.number(), explicitFieldSchema])),
  explicitFieldSchema,
]);

export type FieldValue = z.infer<typeof fieldValueSchema>;

function resolveScalar(value: unknown): ResolvedField | null {
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "number") {
    return { type: "string", value: String(value) };
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

/** Footprint `[width, depth]`. Omitted → `[1, 1]`. */
export const sizeSchema = z.tuple([z.number(), z.number()]);
export type Size = z.infer<typeof sizeSchema>;

export const DEFAULT_SIZE: Size = [1, 1];

export function resolveSize(size?: Size | null): Size {
  return size ?? DEFAULT_SIZE;
}

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

export const connectorEndpointLabelSchema = z.string().nullable();

export const connectorLabelsSchema = z.tuple([
  connectorEndpointLabelSchema,
  connectorEndpointLabelSchema,
]);

const legacyConnectorLabelSchema = z.tuple([z.string(), z.string()]);

function legacyEndpointLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  const parsed = legacyConnectorLabelSchema.safeParse(value);
  if (!parsed.success) return null;
  const [kind, detail] = parsed.data;
  if (kind === "domain") return detail;
  return `${kind}: ${detail}`;
}

function migrateConnectorLabels(
  nodes: [string, string],
  from: unknown,
  to: unknown,
): [string | null, string | null] | undefined {
  const fromLabel = legacyEndpointLabel(from);
  const toLabel = legacyEndpointLabel(to);
  if (!fromLabel && !toLabel) return undefined;

  const involvesInternet = nodes[0] === "internet" || nodes[1] === "internet";
  if (involvesInternet) {
    const domain = fromLabel === toLabel ? fromLabel : (fromLabel ?? toLabel);
    return [null, domain];
  }

  return [fromLabel, toLabel];
}

function normalizeInternetConnector<
  T extends {
    nodes: [string, string];
    labels?: [string | null, string | null];
    path: [number, number, number][];
  },
>(connector: T): T {
  const involvesInternet =
    connector.nodes[0] === "internet" || connector.nodes[1] === "internet";
  if (!involvesInternet || connector.nodes[0] === "internet") {
    return connector;
  }

  const serviceId = connector.nodes[0];
  const domain = connector.labels?.[1] ?? connector.labels?.[0] ?? null;

  return {
    ...connector,
    nodes: ["internet", serviceId],
    labels: domain != null ? [null, domain] : connector.labels,
    path: [...connector.path].reverse(),
  };
}

const connectorSchemaInput = z.object({
  nodes: z.tuple([z.string().min(1), z.string().min(1)]),
  labels: connectorLabelsSchema.optional(),
  from: legacyConnectorLabelSchema.nullable().optional(),
  to: legacyConnectorLabelSchema.nullable().optional(),
  variant: z.enum(["default", "warning"]).optional(),
  path: z.array(posSchema).min(2),
});

export const connectorSchema = connectorSchemaInput.transform((connector) => {
  const labels =
    connector.labels ??
    migrateConnectorLabels(connector.nodes, connector.from, connector.to);
  const normalized = normalizeInternetConnector({
    nodes: connector.nodes,
    ...(labels ? { labels } : {}),
    path: connector.path,
  });
  return {
    nodes: normalized.nodes,
    ...(normalized.labels ? { labels: normalized.labels } : {}),
    ...(connector.variant === "warning" ? { variant: connector.variant } : {}),
    path: normalized.path,
  };
});

export const infrastructureDbSchema = z.object({
  resources: z.array(resourceSchema),
  groups: z.array(groupSchema),
  static: staticSchema,
  connectors: z.array(connectorSchema),
});

export type CategoryFields = z.infer<typeof categoryFieldsSchema>;
export type ServiceFields = Record<string, CategoryFields>;
export type Resource = z.infer<typeof resourceSchema>;
export type Group = z.infer<typeof groupSchema>;
export type ConnectorEndpointLabel = z.infer<typeof connectorEndpointLabelSchema>;
export type ConnectorLabels = z.infer<typeof connectorLabelsSchema>;
export type Connector = z.infer<typeof connectorSchema>;
export type InfrastructureDb = z.infer<typeof infrastructureDbSchema>;

const OPEN_TO_INTERNET_KEY = "Is Open To Internet";
const OPEN_TO_INTERNET_KEY_LEGACY = "bool:Is Open To Internet";

function readOpenToInternetFlag(fields: CategoryFields | undefined): unknown {
  if (!fields) return undefined;
  return fields[OPEN_TO_INTERNET_KEY] ?? fields[OPEN_TO_INTERNET_KEY_LEGACY];
}

/** True when any category has `Is Open To Internet` set. */
export function isOpenToInternet(
  fields: ServiceFields | null | undefined,
): boolean {
  if (!fields) return false;

  for (const category of Object.values(fields)) {
    const value = readOpenToInternetFlag(category);
    if (typeof value === "boolean") return value;
    if (Array.isArray(value)) {
      if (value.some(Boolean)) return true;
      continue;
    }
    if (value && typeof value === "object" && "type" in value) {
      const resolved = resolveFieldValue(value);
      if (resolved && !Array.isArray(resolved) && resolved.type === "bool") {
        if (resolved.value) return true;
      }
    }
  }

  return false;
}
