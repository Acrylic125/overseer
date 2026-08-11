import { iconServiceForVercelKind } from "../../icons.js";
import type { CategoryFields, ScannedService, ServiceFields } from "../../schema.js";
import { redactSensitiveValue } from "../../utils.js";
import type {
  ScrapedEnvVar,
  ScrapedVercelProject,
  ScrapeContext,
} from "../types.js";

function isPlainEnv(env: ScrapedEnvVar): boolean {
  const type = env.type.toLowerCase();
  return type === "plain" || type === "plain_text";
}

function wireEnvValue(env: ScrapedEnvVar): string {
  if (isPlainEnv(env)) return env.value;
  return redactSensitiveValue(env.value);
}

function envFields(envs: ScrapedEnvVar[]): ServiceFields {
  const buckets = new Map<string, CategoryFields>();

  for (const env of envs) {
    const targets =
      env.target && env.target.length > 0
        ? [...new Set(env.target.map((t) => t.trim().toLowerCase()).filter(Boolean))]
        : ["shared"];

    for (const target of targets) {
      const category =
        target === "shared" ? "Environment Variables" : `environment:${target}`;
      const fields = buckets.get(category) ?? {};
      const key =
        env.gitBranch && env.gitBranch.length > 0
          ? `${env.key} [${env.gitBranch}]`
          : env.key;
      fields[key] = wireEnvValue(env);
      buckets.set(category, fields);
    }
  }

  return Object.fromEntries(buckets);
}

function projectService(resource: ScrapedVercelProject): ScannedService {
  return {
    id: resource.id,
    group: resource.group,
    name: resource.name,
    sourceType: "vercel",
    service: iconServiceForVercelKind("Project"),
    connections: [],
    fields: {
      networking: {
        "Is Open To Internet": resource.domains.length > 0,
        Domains: resource.domains,
      },
    },
  };
}

export function transformVercel(ctx: ScrapeContext): ScannedService[] {
  return ctx.resources
    .filter((resource): resource is ScrapedVercelProject => resource.kind === "vercel-project")
    .map(projectService);
}

/** Redact and attach env fields after env-value linking. */
export function applyVercelEnvFields(
  services: ScannedService[],
  resources: ScrapedVercelProject[],
): void {
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const resource of resources) {
    if (resource.envs.length === 0) continue;
    const service = byId.get(resource.id);
    if (!service) continue;
    Object.assign(service.fields, envFields(resource.envs));
  }
}
