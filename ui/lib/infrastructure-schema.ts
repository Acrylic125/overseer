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

function normalizeInternetConnector<T extends {
  nodes: [string, string];
  labels?: [string | null, string | null];
  path: [number, number, number][];
}>(connector: T): T {
  const involvesInternet =
    connector.nodes[0] === "internet" || connector.nodes[1] === "internet";
  if (!involvesInternet || connector.nodes[0] === "internet") {
    return connector;
  }

  const serviceId = connector.nodes[0];
  const domain =
    connector.labels?.[1] ??
    connector.labels?.[0] ??
    null;

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

const OPEN_TO_INTERNET_KEY = "bool:Is Open To Internet";

/** True when `fields.networking["bool:Is Open To Internet"]` is set. */
export function isOpenToInternet(
  fields: ServiceFields | null | undefined,
): boolean {
  const value = fields?.networking?.[OPEN_TO_INTERNET_KEY];
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(Boolean);
  return false;
}
