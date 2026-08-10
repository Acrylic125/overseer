import { Vercel } from "@vercel/sdk";

import { log as cli } from "../../cli/log.js";
import type { VercelProvider } from "../../providers.js";
import type { ScannedService } from "../../schema.js";
import type {
  ScrapedEnvVar,
  ScrapedVercelProject,
  ScrapeContext,
  ServiceScanner,
} from "../types.js";
import {
  elapsed,
  formatAuthFailure,
  formatPermissionHint,
  isAuthFailure,
  log,
  logError,
  mapPool,
  PROJECT_CONCURRENCY,
  REQUEST_TIMEOUT_MS,
  settled,
  withTimeout,
} from "./client.js";
import { transformVercel } from "./transform.js";

type ProjectRef = {
  id: string;
  name: string;
  listedEnvs: ScrapedEnvVar[];
};

type ProviderFetchResult = {
  resources: ScrapedVercelProject[];
  warnings: string[];
};

function serviceId(namespace: string, projectId: string) {
  return `${namespace}:vercel:project:${projectId}`;
}

function toEnvVar(row: {
  key: string;
  value?: string;
  type: string;
  target?: string | string[];
  comment?: string;
  gitBranch?: string;
  system?: boolean;
  id?: string;
  visibility?: string;
  decrypted?: boolean;
}): ScrapedEnvVar {
  const target =
    row.target == null
      ? undefined
      : Array.isArray(row.target)
        ? row.target
        : [row.target];
  return {
    key: row.key,
    value: row.value ?? "",
    type: row.type,
    target,
    comment: row.comment,
    gitBranch: row.gitBranch,
    system: row.system,
    id: row.id,
    visibility: row.visibility,
    decrypted: row.decrypted,
  };
}

function envKey(env: ScrapedEnvVar): string {
  const targets = env.target?.slice().sort().join(",") ?? "";
  return `${env.key}|${targets}`;
}

function isPlainEnv(env: ScrapedEnvVar): boolean {
  if (env.visibility === "secret") return false;
  if (env.visibility === "config") return true;
  const type = env.type.toLowerCase();
  return type === "plain" || type === "plain_text";
}

function shouldDecryptEnv(env: ScrapedEnvVar): boolean {
  return Boolean(env.id) && !isPlainEnv(env);
}

function mergeEnvEntry(
  prev: ScrapedEnvVar | undefined,
  next: ScrapedEnvVar,
): ScrapedEnvVar {
  if (!prev) return next;
  return {
    ...prev,
    ...next,
    id: next.id ?? prev.id,
    type: next.type || prev.type,
    visibility: next.visibility ?? prev.visibility,
    value: next.value?.trim() ? next.value : (prev.value ?? ""),
    decrypted: next.decrypted ?? prev.decrypted,
    target: next.target ?? prev.target,
    gitBranch: next.gitBranch ?? prev.gitBranch,
    comment: next.comment ?? prev.comment,
    system: next.system ?? prev.system,
  };
}

function mergeEnvs(...sources: ScrapedEnvVar[][]): ScrapedEnvVar[] {
  const byKey = new Map<string, ScrapedEnvVar>();
  for (const source of sources) {
    for (const env of source) {
      const key = envKey(env);
      byKey.set(key, mergeEnvEntry(byKey.get(key), env));
    }
  }
  return [...byKey.values()];
}

function projectsFromPage(
  page: Awaited<ReturnType<Vercel["projects"]["getProjects"]>> | null,
): { projects: ProjectRef[]; next: string | null } {
  if (!page) return { projects: [], next: null };

  if (Array.isArray(page)) {
    return {
      projects: page.map((project) => ({
        id: project.id,
        name: project.name,
        listedEnvs: (project.env ?? []).map((row) => toEnvVar(row)),
      })),
      next: null,
    };
  }

  return {
    projects: page.projects.map((project) => ({
      id: project.id,
      name: project.name,
      listedEnvs: (project.env ?? []).map((row) => toEnvVar(row)),
    })),
    next: page.pagination?.next == null ? null : String(page.pagination.next),
  };
}

function envsFromFilterResponse(
  body: Awaited<ReturnType<Vercel["projects"]["filterProjectEnvs"]>> | null,
): ScrapedEnvVar[] {
  if (!body) return [];
  if (Array.isArray(body)) return body.map((row) => toEnvVar(row));
  if ("envs" in body && Array.isArray(body.envs)) {
    return body.envs.map((row) => toEnvVar(row));
  }
  return [];
}

async function listAllProjects(
  client: Vercel,
  provider: VercelProvider,
): Promise<{ projects: ProjectRef[]; warnings: string[] }> {
  const projects: ProjectRef[] = [];
  const warnings: string[] = [];
  let from: string | undefined;
  let pages = 0;

  while (pages < 50) {
    pages += 1;
    const label = from ? `projects.list page ${pages}` : "projects.list";
    const result = await settled(
      withTimeout(
        client.projects.getProjects({
          limit: "100",
          ...(from ? { from } : {}),
          ...(provider.teamId ? { teamId: provider.teamId } : {}),
        }),
        REQUEST_TIMEOUT_MS,
        label,
      ),
      null,
      label,
    );

    if (result.error) {
      warnings.push(formatPermissionHint(result.error));
      break;
    }

    const page = projectsFromPage(result.value);
    projects.push(...page.projects);
    if (!page.next) break;
    from = page.next;
  }

  return { projects, warnings };
}

async function listProjectDomains(
  client: Vercel,
  provider: VercelProvider,
  project: ProjectRef,
): Promise<{ domains: string[]; error: string | null }> {
  const domains: string[] = [];
  let until: number | undefined;

  for (let pages = 0; pages < 20; pages += 1) {
    const label = `domains:${project.name}:${pages + 1}`;
    const result = await settled(
      withTimeout(
        client.projects.getProjectDomains({
          idOrName: project.id,
          limit: 100,
          ...(until != null ? { until } : {}),
          ...(provider.teamId ? { teamId: provider.teamId } : {}),
        }),
        REQUEST_TIMEOUT_MS,
        label,
      ),
      null,
      label,
    );

    if (result.error) return { domains, error: result.error };

    const page = result.value;
    if (!page) break;

    for (const domain of page.domains) {
      if (domain.name) domains.push(domain.name);
    }

    if (page.pagination?.next == null) break;
    until = page.pagination.next;
  }

  return { domains: [...new Set(domains)], error: null };
}

async function listProjectEnvs(
  client: Vercel,
  provider: VercelProvider,
  project: ProjectRef,
): Promise<{ envs: ScrapedEnvVar[]; error: string | null }> {
  const result = await settled(
    withTimeout(
      client.projects.filterProjectEnvs({
        idOrName: project.id,
        decrypt: "true",
        ...(provider.teamId ? { teamId: provider.teamId } : {}),
      }),
      REQUEST_TIMEOUT_MS,
      `envs:${project.name}`,
    ),
    null,
    `envs:${project.name}`,
  );

  if (result.error) return { envs: [], error: result.error };

  return { envs: envsFromFilterResponse(result.value), error: null };
}

async function fetchDecryptedEnv(
  client: Vercel,
  provider: VercelProvider,
  project: ProjectRef,
  env: ScrapedEnvVar,
): Promise<ScrapedEnvVar> {
  if (!shouldDecryptEnv(env) || !env.id) return env;

  const label = `env.decrypt:${project.name}:${env.key}`;
  const result = await settled(
    withTimeout(
      client.projects.getProjectEnv({
        idOrName: project.id,
        id: env.id,
        ...(provider.teamId ? { teamId: provider.teamId } : {}),
      }),
      REQUEST_TIMEOUT_MS,
      label,
    ),
    null,
    label,
  );

  const row = result.value;
  if (!row || Array.isArray(row)) return env;

  const value =
    "value" in row && typeof row.value === "string" ? row.value : env.value;
  const decrypted =
    "value" in row && typeof row.value === "string"
      ? true
      : "decrypted" in row && typeof row.decrypted === "boolean"
        ? row.decrypted
        : env.decrypted;

  return {
    ...env,
    value,
    decrypted,
    type:
      "type" in row && typeof row.type === "string" ? row.type : env.type,
    visibility:
      "visibility" in row && typeof row.visibility === "string"
        ? row.visibility
        : env.visibility,
  };
}

async function decryptEnvs(
  client: Vercel,
  provider: VercelProvider,
  project: ProjectRef,
  envs: ScrapedEnvVar[],
): Promise<ScrapedEnvVar[]> {
  const out = new Array<ScrapedEnvVar>(envs.length);
  const jobs = envs.map((env, index) => ({ env, index }));

  await mapPool(jobs, PROJECT_CONCURRENCY, async ({ env, index }) => {
    out[index] = await fetchDecryptedEnv(client, provider, project, env);
  });

  return out;
}

export async function probeVercelProvider(
  provider: VercelProvider,
): Promise<string | null> {
  const client = new Vercel({
    bearerToken: provider.apiKey,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retryConfig: { strategy: "none" },
  });

  try {
    await withTimeout(
      client.projects.getProjects({
        limit: "1",
        ...(provider.teamId ? { teamId: provider.teamId } : {}),
      }),
      REQUEST_TIMEOUT_MS,
      `probe:${provider.namespace}`,
    );
    return null;
  } catch (error) {
    const message = formatAuthFailure(provider.namespace, error);
    const prefix = `provider:${provider.namespace}: `;
    return message.startsWith(prefix) ? message.slice(prefix.length) : message;
  }
}

async function fetchProviderProjects(
  provider: VercelProvider,
  showNamespace: boolean,
): Promise<ProviderFetchResult> {
  const start = Date.now();
  log("provider start", { namespace: provider.namespace });

  cli.section(
    showNamespace
      ? `Scanning Vercel (${provider.namespace})`
      : "Scanning Vercel",
  );

  const client = new Vercel({
    bearerToken: provider.apiKey,
    timeoutMs: REQUEST_TIMEOUT_MS,
    retryConfig: { strategy: "none" },
  });

  const listed = await listAllProjects(client, provider);
  if (
    listed.warnings.some(
      (warning) => isAuthFailure(warning) && listed.projects.length === 0,
    )
  ) {
    const authWarning =
      listed.warnings.find((warning) => isAuthFailure(warning)) ??
      listed.warnings[0]!;
    cli.failStep("Token unusable");
    return {
      resources: [],
      warnings: [formatAuthFailure(provider.namespace, authWarning)],
    };
  }

  cli.step(`Found ${listed.projects.length} projects`);

  const resources: ScrapedVercelProject[] = [];
  const warnings = [...listed.warnings];

  await mapPool(listed.projects, PROJECT_CONCURRENCY, async (project) => {
    const projectStart = Date.now();
    const [domainsResult, envsResult] = await Promise.all([
      listProjectDomains(client, provider, project),
      listProjectEnvs(client, provider, project),
    ]);

    if (domainsResult.error) {
      warnings.push(
        formatPermissionHint(
          `provider:${provider.namespace}:project:${project.name}:domains: ${domainsResult.error}`,
        ),
      );
    }
    if (envsResult.error) {
      warnings.push(
        formatPermissionHint(
          `provider:${provider.namespace}:project:${project.name}:env: ${envsResult.error}`,
        ),
      );
    }

    const merged = mergeEnvs(envsResult.envs, project.listedEnvs);
    const envs = await decryptEnvs(client, provider, project, merged);

    resources.push({
      kind: "vercel-project",
      id: serviceId(provider.namespace, project.id),
      name: project.name,
      group: provider.namespace,
      domains: domainsResult.domains,
      envs,
    });

    log("project scraped", {
      project: project.name,
      domains: domainsResult.domains.length,
      envs: envs.length,
      duration: elapsed(projectStart),
    });
  });

  resources.sort((a, b) => a.name.localeCompare(b.name));
  cli.step(`${resources.length} resources found (${elapsed(start)})`);
  log("provider done", {
    namespace: provider.namespace,
    resources: resources.length,
    duration: elapsed(start),
  });

  return { resources, warnings };
}

export async function scrapeVercel(
  providers: VercelProvider[],
): Promise<ScrapeContext> {
  const start = Date.now();
  const showNamespace = providers.length > 1;
  log("scrape start", { providers: providers.map((p) => p.namespace) });

  if (providers.length === 0) {
    return {
      resources: [],
      warnings: ["No Vercel providers configured (PROVIDER_VERCEL_*_API_KEY)"],
    };
  }

  const resources: ScrapedVercelProject[] = [];
  const warnings: string[] = [];

  for (const provider of providers) {
    try {
      const result = await fetchProviderProjects(provider, showNamespace);
      resources.push(...result.resources);
      warnings.push(...result.warnings);
    } catch (reason) {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      logError(`provider:${provider.namespace} failed`, error);
      cli.failStep(`Failed: ${error.message}`);
      warnings.push(
        isAuthFailure(error)
          ? formatAuthFailure(provider.namespace, error)
          : `provider:${provider.namespace}: ${error.message}`,
      );
    }
  }

  log("scrape complete", {
    resources: resources.length,
    warnings: warnings.length,
    duration: elapsed(start),
  });

  return { resources, warnings };
}

export class VercelScanner implements ServiceScanner {
  constructor(private readonly providers: VercelProvider[]) {}

  static probe = probeVercelProvider;

  scrape(): Promise<ScrapeContext> {
    return scrapeVercel(this.providers);
  }

  transform(ctx: ScrapeContext): ScannedService[] {
    return transformVercel(ctx);
  }
}
