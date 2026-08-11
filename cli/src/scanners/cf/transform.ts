import { iconServiceForCfKind } from "../../icons.js";
import type {
  CategoryFields,
  FieldGraphValue,
  ScannedService,
  ServiceFields,
} from "../../schema.js";
import { redactSensitiveValue } from "../../utils.js";
import type {
  ScrapedCfDurableObject,
  ScrapedCfR2,
  ScrapedCfWorker,
  ScrapedCfWorkflow,
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
        ? [
            ...new Set(
              env.target.map((t) => t.trim().toLowerCase()).filter(Boolean),
            ),
          ]
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

function workerLikeService(
  resource: ScrapedCfWorker | ScrapedCfDurableObject,
  kind: "Worker" | "Durable Object",
): ScannedService {
  return {
    id: resource.id,
    group: resource.group,
    name: resource.name,
    sourceType: "cf",
    service: iconServiceForCfKind(kind),
    connections: [...resource.connections],
    fields: {
      networking: {
        "Is Open To Internet": resource.domains.length > 0,
        Domains: resource.domains,
      },
      observability: {
        "View Logs": resource.logUrl,
      },
    },
  };
}

function workflowService(resource: ScrapedCfWorkflow): ScannedService {
  const steps: FieldGraphValue | null = resource.steps
    ? {
        type: "graph",
        vertices: resource.steps.vertices,
        edges: resource.steps.edges,
      }
    : null;

  return {
    id: resource.id,
    group: resource.group,
    name: resource.name,
    sourceType: "cf",
    service: iconServiceForCfKind("Workflow"),
    connections: [...resource.connections],
    fields: steps
      ? {
          Workflow: {
            Steps: steps,
          },
        }
      : {},
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
        "Is Open To Internet": resource.openToInternet,
        Domains: resource.domains,
        "S3 API URL": [resource.s3ApiUrl],
        ...(resource.cors.length > 0 ? { CORS: resource.cors } : {}),
      },
    },
  };
}

function openNetworking(): ServiceFields {
  return {
    networking: {
      "Is Open To Internet": true,
    },
  };
}

export function transformCf(ctx: ScrapeContext): ScannedService[] {
  const services: ScannedService[] = [];

  for (const resource of ctx.resources) {
    switch (resource.kind) {
      case "cf-worker":
        services.push(workerLikeService(resource, "Worker"));
        break;
      case "cf-do":
        services.push(workerLikeService(resource, "Durable Object"));
        break;
      case "cf-workflow":
        services.push(workflowService(resource));
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
  resources: Array<ScrapedCfWorker | ScrapedCfDurableObject>,
): void {
  const byId = new Map(services.map((service) => [service.id, service]));
  for (const resource of resources) {
    if (resource.envs.length === 0) continue;
    const service = byId.get(resource.id);
    if (!service) continue;
    Object.assign(service.fields, envFields(resource.envs));
  }
}
