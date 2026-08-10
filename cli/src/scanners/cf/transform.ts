import { iconServiceForCfKind } from "../../icons.js";
import type { CategoryFields, ScannedService, ServiceFields } from "../../schema.js";
import { redactSensitiveValue } from "../../utils.js";
import type {
  ScrapedCfR2,
  ScrapedCfWorker,
  ScrapedEnvVar,
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

function workerService(resource: ScrapedCfWorker): ScannedService {
  return {
    id: resource.id,
    group: resource.group,
    name: resource.name,
    sourceType: "cf",
    service: iconServiceForCfKind("Worker"),
    connections: [...resource.connections],
    fields: {
      networking: {
        "bool:Is Open To Internet": resource.domains.length > 0,
        "link:Domains": resource.domains,
      },
      observability: {
        "link:View Logs": resource.logUrl,
      },
    },
  };
}

function r2Service(resource: ScrapedCfR2): ScannedService {
  return {
    id: resource.id,
    group: resource.group,
    name: resource.name,
    sourceType: "cf",
    service: iconServiceForCfKind("R2"),
    connections: [],
    fields: {
      networking: {
        "bool:Is Open To Internet": resource.openToInternet,
        "link:Domains": resource.domains,
        "link:S3 API URL": [resource.s3ApiUrl],
        ...(resource.cors.length > 0 ? { CORS: resource.cors } : {}),
      },
    },
  };
}

function openNetworking(): ServiceFields {
  return {
    networking: {
      "bool:Is Open To Internet": true,
    },
  };
}

export function transformCf(ctx: ScrapeContext): ScannedService[] {
  const services: ScannedService[] = [];

  for (const resource of ctx.resources) {
    switch (resource.kind) {
      case "cf-worker":
        services.push(workerService(resource));
        break;
      case "cf-r2":
        services.push(r2Service(resource));
        break;
      case "cf-d1":
      case "cf-vectorize":
        services.push({
          id: resource.id,
          group: resource.group,
          name: resource.name,
          sourceType: "cf",
          service: iconServiceForCfKind(
            resource.kind === "cf-d1" ? "D1" : "Vectorize",
          ),
          connections: [],
          fields: openNetworking(),
        });
        break;
      case "cf-kv":
        services.push({
          id: resource.id,
          group: resource.group,
          name: resource.name,
          sourceType: "cf",
          service: iconServiceForCfKind("KV"),
          connections: [],
          fields: {},
        });
        break;
      case "cf-queue":
        services.push({
          id: resource.id,
          group: resource.group,
          name: resource.name,
          sourceType: "cf",
          service: iconServiceForCfKind("Queue"),
          connections: [],
          fields: {},
        });
        break;
    }
  }

  return services;
}

/** Redact and attach env fields after env-value linking. */
export function applyCfEnvFields(
  services: ScannedService[],
  resources: ScrapedCfWorker[],
): void {
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const resource of resources) {
    if (resource.envs.length === 0) continue;
    const service = byId.get(resource.id);
    if (!service) continue;
    Object.assign(service.fields, envFields(resource.envs));
  }
}
