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

/**
 * Shared identity / graph fields on every scanned service.
 *
 * `service` is the icon basename from `scan/assets/icons/` (e.g. `cf-worker`,
 * `r2`) — not a path. Unresolvable icons should use `all-unknown`.
 */
/** Cluster path, or `null` for ungrouped hubs (e.g. public internet). */
export const serviceGroupSchema = z.union([z.string().min(1), z.null()]);

export const scannedServiceBaseSchema = z.object({
  id: z.string().min(1),
  group: serviceGroupSchema,
  name: z.string().min(1),
  connections: z.array(z.string()),
  sourceType: z.string().min(1),
  service: z.string().min(1),
});

export const scannedServiceSchema = scannedServiceBaseSchema.extend({
  fields: z.record(z.string(), categoryFieldsSchema),
});

/** Service with layout placement. `size` omitted → `[1, 1]`. */
export const placedServiceSchema = scannedServiceSchema.extend({
  pos: posSchema,
  size: sizeSchema.optional(),
});

/**
 * Platforms and silhouettes. Nest via `parent` (pad id of the containing
 * platform). Root pads omit `parent`. Positions are world-absolute.
 */
export const padSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("platform"),
    id: z.string().min(1),
    group: z.string().min(1),
    parent: z.string().min(1).optional(),
    pos: posSchema,
    size: sizeSchema.optional(),
  }),
  z.object({
    type: z.literal("shape"),
    id: z.string().min(1),
    shape: z.string().min(1),
    /** Optional cluster label; `null`/omitted for standalone hubs. */
    group: serviceGroupSchema.optional(),
    parent: z.string().min(1).optional(),
    label: z.string().optional(),
    pos: posSchema,
    size: sizeSchema.optional(),
  }),
]);

export const connectorSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  path: z.array(posSchema).min(2),
});

export const infrastructureDbSchema = z.object({
  version: z.literal(2),
  scannedAt: z.string().datetime({ offset: true }),
  services: z.array(placedServiceSchema),
  pads: z.array(padSchema),
  connectors: z.array(connectorSchema),
  warnings: z.array(z.string()),
});

export type CategoryFields = z.infer<typeof categoryFieldsSchema>;
export type ServiceFields = Record<string, CategoryFields>;
export type ScannedService = z.infer<typeof scannedServiceSchema>;
export type PlacedService = z.infer<typeof placedServiceSchema>;
export type Pad = z.infer<typeof padSchema>;
export type Connector = z.infer<typeof connectorSchema>;
export type InfrastructureDb = z.infer<typeof infrastructureDbSchema>;

/**
 * Dense 3D scene bake derived at load time (not stored in the DB).
 * World XZ ground plane (scan layout y → world z).
 */
export type SceneBake = {
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
  camera: {
    position: [number, number, number];
    span: number;
    far: number;
  };
  centerGuide: { x: number; y: number; radius: number };
  publicInternet: {
    group: string | null;
    shape: string;
    centerX: number;
    centerZ: number;
    width: number;
    depth: number;
  };
  connectorSegments: Array<{
    midX: number;
    midZ: number;
    length: number;
    dx: number;
    dz: number;
    sourceId: string;
    targetId: string;
  }>;
  connectorJoints: Array<{
    x: number;
    z: number;
    sourceId: string;
    targetId: string;
  }>;
};

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
