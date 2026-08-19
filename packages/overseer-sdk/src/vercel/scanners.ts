import { Vercel } from "@vercel/sdk";
import { z } from "zod";

import { envToClaims, urlBaseMatchClaim } from "../core/claims.js";
import { resourceId } from "../core/resource-id.js";
import {
  mapPool,
  mapPoolCollect,
  settled,
  type ScrapeStepFn,
} from "../core/scrape-async.js";
import type {
  FieldGroup,
  FieldNode,
  ProviderResourceScanner,
  ResourceFields,
} from "../types.js";
import { iconForKind } from "./icons.js";
import {
  parseVercelCustomEnvironments,
  parseVercelDomainRow,
  parseVercelEnvRow,
  type VercelCustomEnvironment,
  type VercelEnvRow,
} from "./schemas.js";

const PROJECT_CONCURRENCY = 4;
// Vercel always has these three built-in targets; custom environments are extra.
const STANDARD_ENV_TARGETS = ["production", "preview", "development"] as const;
const noopStep: ScrapeStepFn = () => {};

type VercelEnv = {
  key: string;
  value: string;
  type: string;
  target: string[];
  gitBranch?: string;
};

async function vercelAccountSlug(client: Vercel, teamId?: string) {
  if (teamId) {
    const team = await client.teams.getTeam({ teamId });
    if (!team.slug) {
      throw new Error("Vercel team has no slug");
    }
    return team.slug;
  }

  const auth = await client.user.getAuthUser();
  const username = auth?.user.username;
  if (!username) {
    throw new Error("Vercel token has no accessible account");
  }
  return username;
}

function rowTargets(row: VercelEnvRow, customEnvById: Map<string, string>) {
  const targets = new Set<string>();
  if (Array.isArray(row.target)) {
    for (const target of row.target) targets.add(target);
  } else if (row.target) {
    targets.add(row.target);
  }
  for (const id of row.customEnvironmentIds ?? []) {
    const slug = customEnvById.get(id);
    if (slug) targets.add(slug);
  }
  return [...targets];
}

function toEnv(row: VercelEnvRow, customEnvById: Map<string, string>): VercelEnv {
  return {
    key: row.key,
    value: row.value ?? "",
    type: row.type ?? "plain",
    target: rowTargets(row, customEnvById),
    gitBranch: row.gitBranch,
  };
}

function dedupeEnvs(
  rows: VercelEnvRow[],
  customEnvById: Map<string, string>,
) {
  const seen = new Set<string>();
  const envs: VercelEnv[] = [];
  for (const row of rows) {
    const env = toEnv(row, customEnvById);
    const id = `${env.key}|${env.target.join(",")}|${env.gitBranch ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    envs.push(env);
  }
  return envs;
}

function projectCustomEnvironments(project: object) {
  if (!("customEnvironments" in project)) return [];
  return parseVercelCustomEnvironments(project.customEnvironments);
}

function environmentNames(
  customEnvs: VercelCustomEnvironment[],
  envs: VercelEnv[],
) {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    names.push(trimmed);
  };

  for (const target of STANDARD_ENV_TARGETS) add(target);
  for (const env of customEnvs) add(env.slug);
  for (const env of envs) {
    for (const target of env.target) add(target);
  }
  return names;
}

const pullEnvSchema = z.object({
  env: z.record(z.string(), z.string()).optional(),
});

// Vercel list APIs return a base64 JSON envelope (starts with eyJ, no dots).
function isEncryptedEnvelope(value: string) {
  if (!value.startsWith("eyJ")) return false;
  return !value.includes(".");
}

function envClaimValues(envs: VercelEnv[]) {
  const values: string[] = [];
  for (const env of envs) {
    if (env.type.toLowerCase() === "sensitive") continue;
    if (!env.value || isEncryptedEnvelope(env.value)) continue;
    values.push(env.value);
  }
  return values;
}

function vercelEnvValue(env: VercelEnv): FieldNode {
  if (env.type.toLowerCase() === "sensitive") return { type: "hidden" };
  if (!env.value || isEncryptedEnvelope(env.value)) return { type: "hidden" };
  return { type: "secret", value: env.value };
}

async function pullTargetEnvs(
  apiKey: string,
  projectId: string,
  target: string,
  teamId?: string,
) {
  const params = new URLSearchParams({ source: "vercel-cli:env:pull" });
  if (teamId) params.set("teamId", teamId);
  const url = `https://api.vercel.com/v3/env/pull/${encodeURIComponent(projectId)}/${encodeURIComponent(target)}?${params}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) return {};
  const parsed = pullEnvSchema.safeParse(await response.json());
  if (!parsed.success) return {};
  return parsed.data.env ?? {};
}

function applyPulledValues(
  envs: VercelEnv[],
  pulledByTarget: Map<string, Record<string, string>>,
) {
  const next: VercelEnv[] = [];
  for (const env of envs) {
    const targets = env.target.length > 0 ? env.target : ["production"];
    for (const target of targets) {
      const pulled = pulledByTarget.get(target)?.[env.key];
      next.push({
        ...env,
        target: [target],
        value: pulled ?? env.value,
      });
    }
  }
  return next;
}

function vercelEnvKey(env: VercelEnv) {
  if (env.gitBranch && env.gitBranch.length > 0) {
    return `${env.key} [${env.gitBranch}]`;
  }
  return env.key;
}

function vercelEnvGroup(envs: VercelEnv[], targets: string[]): FieldGroup {
  const grouped: Record<string, ResourceFields> = {};
  for (const target of targets) {
    grouped[target] = {};
  }

  for (const env of envs) {
    const envTargets = env.target.length > 0 ? env.target : targets;
    const key = vercelEnvKey(env);
    const value = vercelEnvValue(env);
    for (const target of envTargets) {
      const bucket = grouped[target];
      if (!bucket) continue;
      bucket[key] = value;
    }
  }

  const fields: ResourceFields = {};
  for (const target of targets) {
    fields[target] = {
      hideHeading: true,
      fields: grouped[target] ?? {},
    };
  }

  return {
    type: "dropdown-single",
    defaultShow: "production",
    fields,
  };
}

async function scrapeCustomEnvironments(
  client: Vercel,
  projectId: string,
  teamId: string | undefined,
  fallback: VercelCustomEnvironment[],
) {
  const environment = client.environment;
  if (
    !environment ||
    typeof environment.getProjectsByIdOrNameCustomEnvironments !== "function"
  ) {
    return fallback;
  }

  return settled(async () => {
    const result = await environment.getProjectsByIdOrNameCustomEnvironments({
      idOrName: projectId,
      ...(teamId ? { teamId } : {}),
    });
    const parsed = parseVercelCustomEnvironments(result);
    if (parsed.length > 0) return parsed;
    return fallback;
  }, fallback);
}

async function scrapeProjects(
  apiKey: string,
  teamId?: string,
  fn: ScrapeStepFn = noopStep,
) {
  const client = new Vercel({
    bearerToken: apiKey,
    retryConfig: { strategy: "none" },
  });

  fn({ message: "Resolving account" });
  const accountSlug = await vercelAccountSlug(client, teamId);

  fn({ message: "Listing projects" });
  const projects = [];
  let from: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const result = await client.projects.getProjects({
      limit: "100",
      ...(from ? { from } : {}),
      ...(teamId ? { teamId } : {}),
    });

    if (Array.isArray(result)) {
      projects.push(...result);
      break;
    }

    projects.push(...result.projects);
    if (result.pagination?.next == null) break;
    from = String(result.pagination.next);
  }

  fn({ message: "Fetching project domains and envs" });
  return mapPoolCollect(projects, PROJECT_CONCURRENCY, async (project) => {
    const listedCustomEnvs = projectCustomEnvironments(project);
    const [projectDomains, projectEnvs, customEnvs] = await Promise.all([
      settled(async () => {
        const rows = [];
        let until: number | undefined;
        for (let page = 0; page < 20; page += 1) {
          const result = await client.projects.getProjectDomains({
            idOrName: project.id,
            limit: 100,
            ...(until != null ? { until } : {}),
            ...(teamId ? { teamId } : {}),
          });
          rows.push(...result.domains);
          if (result.pagination?.next == null) break;
          until = result.pagination.next;
        }
        return rows;
      }, []),
      settled(async () => {
        const result = await client.projects.filterProjectEnvs({
          idOrName: project.id,
          decrypt: "true",
          source: "vercel-cli:env:pull",
          ...(teamId ? { teamId } : {}),
        });
        if (Array.isArray(result)) return result;
        if ("envs" in result && Array.isArray(result.envs)) return result.envs;
        return [];
      }, []),
      scrapeCustomEnvironments(client, project.id, teamId, listedCustomEnvs),
    ]);

    const customEnvById = new Map(
      customEnvs.map((env) => [env.id, env.slug]),
    );

    const parsedEnvs = [
      ...projectEnvs
        .map((row) => parseVercelEnvRow(row))
        .filter((row): row is VercelEnvRow => row !== null),
      ...(project.env ?? [])
        .map((row) => parseVercelEnvRow(row))
        .filter((row): row is VercelEnvRow => row !== null),
    ];

    const envs = dedupeEnvs(parsedEnvs, customEnvById);
    const environments = environmentNames(customEnvs, envs);

    const pulledByTarget = new Map<string, Record<string, string>>();
    await mapPool(environments, PROJECT_CONCURRENCY, async (target) => {
      const pulled = await settled(
        () => pullTargetEnvs(apiKey, project.id, target, teamId),
        {},
      );
      pulledByTarget.set(target, pulled);
    });

    return {
      project,
      accountSlug,
      domains: projectDomains
        .map((row) => parseVercelDomainRow(row))
        .filter((row) => row !== null)
        .map((row) => row.name),
      envs: applyPulledValues(envs, pulledByTarget),
      environments,
    };
  });
}

export const projectScanner = {
  type: "Project",
  scrape: scrapeProjects,
  transform(item, { namespace }) {
    const projectId = item.project.id;
    const name = item.project.name;
    const environments = item.environments;
    return {
      id: resourceId("vercel", namespace, "project", projectId),
      group: namespace,
      name,
      url: `https://vercel.com/${encodeURIComponent(item.accountSlug)}s-projects/${encodeURIComponent(name)}`,
      service: "Project",
      asset: iconForKind("Project"),
      fields: {
        ...(item.domains.length > 0 ? { Domains: item.domains } : {}),
        ...(environments.length > 0
          ? { Environment: vercelEnvGroup(item.envs, environments) }
          : {}),
      },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const domains = item.domains;
    return {
      claims: envToClaims(envClaimValues(item.envs)),
      require: (claim) => {
        for (const domain of domains) {
          if (!urlBaseMatchClaim(domain, claim)) continue;
          return { type: "connected", label: domain };
        }
        return false;
      },
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeProjects>>[number],
  [string, string | undefined, ScrapeStepFn]
>;

export const vercelScanners = [projectScanner];
