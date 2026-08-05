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

/** Shared identity / graph fields on every scanned service. */
export const scannedServiceBaseSchema = z.object({
  id: z.string().min(1),
  group: z.string().min(1),
  name: z.string().min(1),
  connections: z.array(z.string()),
  sourceType: z.string().min(1),
  service: z.string().min(1),
});

/**
 * Scanned service: base identity plus generic categorized fields.
 * Field keys use optional `"type:name"` templating (`link`, `bool`, or plain text).
 */
export const scannedServiceSchema = scannedServiceBaseSchema.extend({
  fields: z.record(z.string(), categoryFieldsSchema),
});

export const infrastructureDbSchema = z.object({
  version: z.literal(1),
  scannedAt: z.string().datetime({ offset: true }),
  services: z.array(scannedServiceSchema),
  warnings: z.array(z.string()),
});

export type CategoryFields = z.infer<typeof categoryFieldsSchema>;
export type ServiceFields = Record<string, CategoryFields>;
export type ScannedService = z.infer<typeof scannedServiceSchema>;
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
