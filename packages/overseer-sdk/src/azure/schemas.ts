import { z } from "zod";

const passwordCredentialSchema = z.object({
  displayName: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  endDateTime: z.string().nullable().optional(),
});

const redirectBlockSchema = z.object({
  redirectUris: z.array(z.string().nullable()).nullable().optional(),
});

export const azureApplicationSchema = z.object({
  id: z.string().optional(),
  appId: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  passwordCredentials: z.array(passwordCredentialSchema).optional(),
  web: redirectBlockSchema.nullable().optional(),
  spa: redirectBlockSchema.nullable().optional(),
  publicClient: redirectBlockSchema.nullable().optional(),
});

export const azureApplicationsPageSchema = z.object({
  value: z.array(azureApplicationSchema),
  "@odata.nextLink": z.string().optional(),
});

export type AzureApplication = z.infer<typeof azureApplicationSchema>;

export function parseApplicationsPage(value: object) {
  return azureApplicationsPageSchema.parse(value);
}
