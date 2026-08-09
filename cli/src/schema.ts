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

/**
 * Shared identity / graph fields on every scanned service.
 *
 * `service` is the icon basename from `cli/assets/icons/` (e.g. `cf-worker`,
 * `vercel`, `r2`) — not a path. Unresolvable icons should use `all-unknown`.
 */
/** Cluster path, or `null` for ungrouped hubs (e.g. public internet). */
export const serviceGroupSchema = z.union([z.string().min(1), z.null()]);

export const scannedServiceBaseSchema = z.object({
  id: z.string().min(1),
  group: serviceGroupSchema,
  name: z.string().min(1),
  /** Omitted in JSON when empty; defaults to `[]` when read. */
  connections: z.array(z.string()).default([]),
  /**
   * Optional per-target edge metadata (keyed by connected service id).
   * Used when building connectors (variant / label text).
   */
  connectionMeta: z
    .record(
      z.string(),
      z.object({
        variant: z.enum(["default", "warning"]).default("default"),
        text: z.string().min(1).optional(),
      }),
    )
    .optional(),
  sourceType: z.string().min(1),
  service: z.string().min(1),
});

/** Scanned service before layout (no positions yet). */
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
 *
 * Example — platform inside a platform:
 * ```
 * { type: "platform", id: "org", group: "acme", pos: [0,0,0], size: [40, 30] }
 * { type: "platform", id: "api", group: "api", parent: "org", pos: [2,2,0], size: [12, 8] }
 * ```
 *
 * `size` omitted → `[1, 1]` (layout always sets explicit sizes for pads).
 */
export const padSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("platform"),
    /** Stable id — children reference this via `parent`. */
    id: z.string().min(1),
    /** Cluster / group label shown on the platform. */
    group: z.string().min(1),
    /** Containing platform pad id, when nested. */
    parent: z.string().min(1).optional(),
    pos: posSchema,
    size: sizeSchema.optional(),
  }),
  z.object({
    type: z.literal("shape"),
    id: z.string().min(1),
    /** Mesh basename under `cli/assets/shapes/` (no path / extension). */
    shape: z.string().min(1),
    /** Optional cluster label; `null`/omitted for standalone hubs. */
    group: serviceGroupSchema.optional(),
    parent: z.string().min(1).optional(),
    /** Optional label drawn on the shape (e.g. "Public Internet"). */
    label: z.string().optional(),
    pos: posSchema,
    size: sizeSchema.optional(),
  }),
]);

export const connectorVariantSchema = z.enum(["default", "warning"]);
export type ConnectorVariant = z.infer<typeof connectorVariantSchema>;

export const connectorSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  path: z.array(posSchema).min(2),
  /** Visual / severity variant. Omitted → default. */
  variant: connectorVariantSchema.default("default"),
  /** Shown in the UI only when an endpoint service is focused. */
  text: z.string().min(1).optional(),
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
