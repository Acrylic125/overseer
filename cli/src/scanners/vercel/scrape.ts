import { Vercel } from "@vercel/sdk";

import { log as cli } from "../../cli/log.js";
import type { VercelProvider } from "../../providers.js";
import type { ScannedService } from "../../schema.js";
import { resourceToService } from "../transform.js";
import type {
  ScrapedEnvVar,
  ScrapedResource,
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

type ProjectRef = {
  id: string;
  name: string;
  /** Env vars embedded on the project list payload (fallback). */
  listedEnvs: ScrapedEnvVar[];
};

type ProviderFetchResult = {
  resources: ScrapedResource[];
  warnings: string[];
};

function serviceId(namespace: string, projectId: string) {
  return `${namespace}:vercel:project:${projectId}`;
}

function teamParams(provider: VercelProvider): { teamId?: string } {
  return provider.teamId ? { teamId: provider.teamId } : {};
}

function paginationNext(
  pagination: { next?: number | string | null } | undefined,
): string | null {
  if (!pagination || pagination.next == null) return null;
  return String(pagination.next);
}

function normalizeTargets(
  target: string | string[] | undefined,
): string[] | undefined {
  if (target == null) return undefined;
  if (typeof target === "string") return [target];
  if (Array.isArray(target)) {
    return target.filter((item): item is string => typeof item === "string");
  }
  return undefined;
}

function parseEnvRow(row: {
  key?: unknown;
  value?: unknown;
  type?: unknown;
  target?: string | string[];
  comment?: string;
  gitBranch?: string;
  system?: boolean;
  id?: string;
  visibility?: string;
  decrypted?: boolean;
}): ScrapedEnvVar | null {
  if (typeof row.key !== "string" || !row.key) return null;
  return {
    key: row.key,
    value: typeof row.value === "string" ? row.value : "",
    type: typeof row.type === "string" ? row.type : "plain",
    target: normalizeTargets(row.target),
    comment: row.comment,
    gitBranch: row.gitBranch,
    system: row.system,
    id: row.id,
    visibility: row.visibility,
    decrypted: row.decrypted,
  };
}

function extractEnvs(body: unknown): ScrapedEnvVar[] {
  if (!body || typeof body !== "object") return [];

  if ("key" in body && typeof (body as { key?: unknown }).key === "string") {
    const env = parseEnvRow(body as Parameters<typeof parseEnvRow>[0]);
    return env ? [env] : [];
  }

  const envs = (body as { envs?: unknown }).envs;
  if (!Array.isArray(envs)) return [];

  const result: ScrapedEnvVar[] = [];
  for (const env of envs) {
    if (!env || typeof env !== "object") continue;
    const parsed = parseEnvRow(env as Parameters<typeof parseEnvRow>[0]);
    if (parsed) result.push(parsed);
  }
  return result;
}

function extractProjects(body: unknown): {
  projects: ProjectRef[];
  next: string | null;
} {
  const toProject = (item: unknown): ProjectRef | null => {
    if (!item || typeof item !== "object") return null;
    const row = item as { id?: unknown; name?: unknown; env?: unknown };
    if (typeof row.id !== "string" || typeof row.name !== "string") {
      return null;
    }
    const listedEnvs = Array.isArray(row.env)
      ? extractEnvs({ envs: row.env })
      : [];
    return { id: row.id, name: row.name, listedEnvs };
  };

  if (Array.isArray(body)) {
    return {
      projects: body
        .map(toProject)
        .filter((project): project is ProjectRef => project != null),
      next: null,
    };
  }

  if (!body || typeof body !== "object") {
    return { projects: [], next: null };
  }

  const record = body as {
    projects?: unknown;
    pagination?: { next?: number | string | null };
  };
  const raw = Array.isArray(record.projects) ? record.projects : [];
  return {
    projects: raw
      .map(toProject)
      .filter((project): project is ProjectRef => project != null),
    next: paginationNext(record.pagination),
  };
}

function extractDomains(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const domains = (body as { domains?: unknown }).domains;
  if (!Array.isArray(domains)) return [];

  const names: string[] = [];
  for (const domain of domains) {
    if (!domain || typeof domain !== "object") continue;
    const name = (domain as { name?: unknown }).name;
    if (typeof name === "string" && name) names.push(name);
  }
  return names;
}

function mergeEnvs(primary: ScrapedEnvVar[], fallback: ScrapedEnvVar[]) {
  if (primary.length === 0) return fallback;
  if (fallback.length === 0) return primary;

  const byKey = new Map<string, ScrapedEnvVar>();
  for (const env of fallback) {
    byKey.set(`${env.key}|${env.target?.join(",") ?? ""}|${env.id ?? ""}`, env);
  }
  for (const env of primary) {
    byKey.set(`${env.key}|${env.target?.join(",") ?? ""}|${env.id ?? ""}`, env);
  }
  return [...byKey.values()];
}

async function listAllProjects(
  client: Vercel,
  provider: VercelProvider,
): Promise<{ projects: ProjectRef[]; warnings: string[] }> {
  const projects: ProjectRef[] = [];
  const warnings: string[] = [];
  let from: string | undefined;
  let pages = 0;
  const maxPages = 50;

  while (pages < maxPages) {
    pages += 1;
    const label = from ? `projects.list page ${pages}` : "projects.list";
    const result = await settled(
      withTimeout(
        client.projects.getProjects({
          limit: "100",
          ...(from ? { from } : {}),
          ...teamParams(provider),
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

    const extracted = extractProjects(result.value);
    projects.push(...extracted.projects);
    if (!extracted.next) break;
    from = extracted.next;
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
  let pages = 0;
  const maxPages = 20;

  while (pages < maxPages) {
    pages += 1;
    const label = `domains:${project.name}:${pages}`;
    const result = await settled(
      withTimeout(
        client.projects.getProjectDomains({
          idOrName: project.id,
          limit: 100,
          ...(until != null ? { until } : {}),
          ...teamParams(provider),
        }),
        REQUEST_TIMEOUT_MS,
        label,
      ),
      null,
      label,
    );

    if (result.error) {
      return { domains, error: result.error };
    }

    domains.push(...extractDomains(result.value));

    const pagination =
      result.value && typeof result.value === "object"
        ? (result.value as { pagination?: { next?: number | null } }).pagination
        : undefined;
    if (pagination?.next == null) break;
    until = pagination.next;
  }

  return { domains: [...new Set(domains)], error: null };
}

async function listProjectEnvs(
  client: Vercel,
  provider: VercelProvider,
  project: ProjectRef,
): Promise<{ envs: ScrapedEnvVar[]; error: string | null }> {
  const envs: ScrapedEnvVar[] = [];
  let pages = 0;
  const maxPages = 20;
  // filterProjectEnvs pagination uses `until` via next timestamp on some shapes.
  let until: number | undefined;

  while (pages < maxPages) {
    pages += 1;
    const label = `envs:${project.name}:${pages}`;
    const result = await settled(
      withTimeout(
        client.projects.filterProjectEnvs({
          idOrName: project.id,
          decrypt: "true",
          ...teamParams(provider),
        }),
        REQUEST_TIMEOUT_MS,
        label,
      ),
      null,
      label,
    );

    if (result.error) {
      return { envs, error: result.error };
    }

    const pageEnvs = extractEnvs(result.value);
    envs.push(...pageEnvs);

    const pagination =
      result.value && typeof result.value === "object"
        ? (result.value as { pagination?: { next?: number | null } }).pagination
        : undefined;

    // Most env list responses are a single page; stop when no pagination next
    // or when the page returned nothing new.
    if (pagination?.next == null) break;
    if (until === pagination.next) break;
    until = pagination.next;
    // SDK filterProjectEnvs request has no `until` today — break after first page
    // if we can't advance. Keep loop for shapes that embed all envs once.
    break;
  }

  return { envs, error: null };
}

/**
 * List endpoint often returns encrypted blobs with `decrypted: false`.
 * Fetch each env by id to get the plaintext when the token allows it.
 */
async function decryptEnvs(
  client: Vercel,
  provider: VercelProvider,
  project: ProjectRef,
  envs: ScrapedEnvVar[],
): Promise<ScrapedEnvVar[]> {
  const out = new Array<ScrapedEnvVar>(envs.length);
  const jobs = envs.map((env, index) => ({ env, index }));

  await mapPool(jobs, PROJECT_CONCURRENCY, async ({ env, index }) => {
    const needsDecrypt =
      Boolean(env.id) &&
      env.decrypted === false &&
      env.type !== "sensitive" &&
      env.type !== "secret";

    if (!needsDecrypt || !env.id) {
      out[index] = env;
      return;
    }

    const label = `env.decrypt:${project.name}:${env.key}`;
    const result = await settled(
      withTimeout(
        client.projects.getProjectEnv({
          idOrName: project.id,
          id: env.id,
          ...teamParams(provider),
        }),
        REQUEST_TIMEOUT_MS,
        label,
      ),
      null,
      label,
    );

    if (!result.value || typeof result.value !== "object") {
      out[index] = env;
      return;
    }

    const decrypted = extractEnvs(result.value)[0];
    if (!decrypted) {
      const value = (result.value as { value?: unknown }).value;
      if (typeof value === "string") {
        out[index] = { ...env, value, decrypted: true };
        return;
      }
      out[index] = env;
      return;
    }

    out[index] = {
      ...env,
      ...decrypted,
      key: env.key,
      decrypted: decrypted.decrypted ?? true,
    };
  });

  return out;
}

/** Returns null when the token can scan; otherwise a human-readable reason. */
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
        ...teamParams(provider),
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

  const resources: ScrapedResource[] = [];
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
    const domains = domainsResult.domains;

    resources.push({
      kind: "vercel-project",
      id: serviceId(provider.namespace, project.id),
      name: project.name,
      group: provider.namespace,
      domains,
      envs,
    } satisfies ScrapedVercelProject);

    log("project scraped", {
      project: project.name,
      domains: domains.length,
      envs: envs.length,
      listedEnvs: project.listedEnvs.length,
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
      warnings: [
        "No Vercel providers configured (PROVIDER_VERCEL_*_API_KEY)",
      ],
    };
  }

  const resources: ScrapedResource[] = [];
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

/**
 * Vercel scanner facade.
 *
 * New providers mirror this in their scrape file:
 *   probe → scrape → transform
 */
export class VercelScanner implements ServiceScanner {
  constructor(private readonly providers: VercelProvider[]) {}

  /** `null` if scannable; otherwise a human-readable reason. */
  static probe(provider: VercelProvider): Promise<string | null> {
    return probeVercelProvider(provider);
  }

  scrape(): Promise<ScrapeContext> {
    return scrapeVercel(this.providers);
  }

  transform(ctx: ScrapeContext): ScannedService[] {
    return ctx.resources.map(resourceToService);
  }
}
