import Cloudflare from "cloudflare";

import { log as cli } from "../../cli/log.js";
import type { CloudflareProvider } from "../../providers.js";
import type {
  ScrapedCfD1,
  ScrapedCfKv,
  ScrapedCfQueue,
  ScrapedCfR2,
  ScrapedCfVectorize,
  ScrapedCfWorker,
  ScrapedEnvVar,
  ScrapedResource,
  ScrapeContext,
} from "../types.js";
import {
  assertTokenUsable,
  BINDING_CONCURRENCY,
  BINDING_TIMEOUT_MS,
  collectPages,
  elapsed,
  formatAuthFailure,
  formatPermissionHint,
  isAuthFailure,
  isMissingR2CorsConfig,
  isRateLimited,
  log,
  logError,
  mapPool,
  REQUEST_TIMEOUT_MS,
  settled,
  withTimeout,
} from "./client.js";

function formatCorsEntries(
  rules: Array<{
    allowedOrigins?: string[];
    allowedMethods?: string[];
  }>,
): string[] {
  const entries: string[] = [];
  for (const rule of rules) {
    const origins = rule.allowedOrigins ?? [];
    const methods = rule.allowedMethods ?? [];
    for (const method of methods) {
      for (const origin of origins) {
        entries.push(`${method} ${origin}`);
      }
    }
  }
  return entries;
}

function workerViewLogUrl(accountId: string, name: string) {
  return `https://dash.cloudflare.com/${accountId}/workers/services/view/${encodeURIComponent(name)}/production/observability/events`;
}

function r2S3ApiUrl(accountId: string, bucketName: string) {
  return `https://${accountId}.r2.cloudflarestorage.com/${bucketName}`;
}

function serviceId(
  namespace: string,
  accountId: string,
  type: string,
  key: string,
) {
  return `${namespace}:${accountId}:${type}:${key}`;
}

function resolveBindingTarget(
  binding: { type: string } & Record<string, unknown>,
  indexes: {
    byKvId: Map<string, string>;
    byD1Id: Map<string, string>;
    byR2Name: Map<string, string>;
    byVectorizeName: Map<string, string>;
    byQueueName: Map<string, string>;
    byWorkerName: Map<string, string>;
  },
): string | null {
  switch (binding.type) {
    case "kv_namespace": {
      const id = binding.namespace_id;
      return typeof id === "string" ? (indexes.byKvId.get(id) ?? null) : null;
    }
    case "d1": {
      const id =
        (typeof binding.database_id === "string" && binding.database_id) ||
        (typeof binding.id === "string" && binding.id) ||
        null;
      return id ? (indexes.byD1Id.get(id) ?? null) : null;
    }
    case "r2_bucket": {
      const name = binding.bucket_name;
      return typeof name === "string"
        ? (indexes.byR2Name.get(name) ?? null)
        : null;
    }
    case "vectorize": {
      const name = binding.index_name;
      return typeof name === "string"
        ? (indexes.byVectorizeName.get(name) ?? null)
        : null;
    }
    case "queue": {
      const name = binding.queue_name;
      return typeof name === "string"
        ? (indexes.byQueueName.get(name) ?? null)
        : null;
    }
    case "service": {
      const name = binding.service;
      return typeof name === "string"
        ? (indexes.byWorkerName.get(name) ?? null)
        : null;
    }
    default:
      return null;
  }
}

function extractEnvFromBinding(
  binding: { type: string } & Record<string, unknown>,
): ScrapedEnvVar | null {
  if (binding.type === "plain_text") {
    const key = typeof binding.name === "string" ? binding.name : null;
    if (!key) return null;
    return {
      key,
      value: typeof binding.text === "string" ? binding.text : "",
      type: "plain_text",
    };
  }
  if (binding.type === "secret_text") {
    const key = typeof binding.name === "string" ? binding.name : null;
    if (!key) return null;
    return {
      key,
      // Cloudflare does not return secret values on read.
      value: typeof binding.text === "string" ? binding.text : "",
      type: "secret_text",
    };
  }
  return null;
}

type AccountFetchResult = {
  resources: ScrapedResource[];
  warnings: string[];
};

async function timedList<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<{ value: T; error: string | null }> {
  return settled(run(), fallback, label);
}

/** Run a resource list scan and log CLI duration when it finishes. */
async function timedServiceScan<T>(
  label: string,
  run: () => Promise<T>,
): Promise<T> {
  const start = Date.now();
  try {
    return await run();
  } finally {
    cli.step(`Scanning ${label} (${elapsed(start)})`);
  }
}

async function listWorkerNames(
  client: Cloudflare,
  accountId: string,
): Promise<{ names: string[]; warnings: string[] }> {
  const account = { account_id: accountId };
  const warnings: string[] = [];

  const scriptsResult = await timedList(
    "workers.scripts.list",
    () =>
      collectPages(
        client.workers.scripts.list(account),
        "workers.scripts.list",
      ),
    [],
  );

  const fromScripts = scriptsResult.value
    .map((worker) => worker.id)
    .filter((name): name is string => Boolean(name));

  if (fromScripts.length > 0) {
    return { names: fromScripts, warnings };
  }

  if (scriptsResult.error) {
    warnings.push(formatPermissionHint(scriptsResult.error));
  }

  const betaResult = await timedList(
    "workers.beta.workers.list",
    () =>
      collectPages(
        client.workers.beta.workers.list(account),
        "workers.beta.workers.list",
      ),
    [],
  );

  const fromBeta = betaResult.value
    .map((worker) => worker.name)
    .filter((name): name is string => Boolean(name));

  if (fromBeta.length > 0) {
    log("using beta workers list fallback", { count: fromBeta.length });
    return { names: fromBeta, warnings };
  }

  if (betaResult.error) {
    warnings.push(formatPermissionHint(betaResult.error));
  }

  warnings.push(
    "No Workers loaded — connection lines come from Worker bindings. Grant Account → Workers Scripts → Read on the API token.",
  );

  return { names: [], warnings };
}

async function fetchAccountInfrastructure(
  client: Cloudflare,
  provider: CloudflareProvider,
  accountId: string,
): Promise<AccountFetchResult> {
  const ns = provider.namespace;
  const account = { account_id: accountId };
  const accountStart = Date.now();
  const warnings: string[] = [];

  log("listing resources", { namespace: ns, accountId });

  const [
    workerList,
    kvResult,
    d1Result,
    r2Result,
    vectorizeResult,
    queuesResult,
    domainsResult,
    workersDevResult,
  ] = await Promise.all([
    timedServiceScan("Workers", () => listWorkerNames(client, accountId)),
    timedServiceScan("KV", () =>
      timedList(
        "kv.namespaces.list",
        () =>
          collectPages(
            client.kv.namespaces.list(account),
            "kv.namespaces.list",
          ),
        [],
      ),
    ),
    timedServiceScan("D1", () =>
      timedList(
        "d1.database.list",
        () =>
          collectPages(client.d1.database.list(account), "d1.database.list"),
        [],
      ),
    ),
    timedServiceScan("R2", () =>
      timedList(
        "r2.buckets.list",
        () =>
          withTimeout(
            client.r2.buckets.list({ ...account, per_page: 100 }),
            REQUEST_TIMEOUT_MS,
            "r2.buckets.list",
          ),
        { buckets: [] as { name?: string }[] },
      ),
    ),
    timedServiceScan("Vectorize", () =>
      timedList(
        "vectorize.indexes.list",
        () =>
          collectPages(
            client.vectorize.indexes.list(account),
            "vectorize.indexes.list",
          ),
        [],
      ),
    ),
    timedServiceScan("Queues", () =>
      timedList(
        "queues.list",
        () => collectPages(client.queues.list(account), "queues.list"),
        [],
      ),
    ),
    timedList(
      "workers.domains.list",
      () =>
        collectPages(
          client.workers.domains.list(account),
          "workers.domains.list",
        ),
      [],
    ),
    timedList(
      "workers.subdomains.get",
      () =>
        withTimeout(
          client.workers.subdomains.get(account),
          REQUEST_TIMEOUT_MS,
          "workers.subdomains.get",
        ),
      { subdomain: "" },
    ),
  ]);

  warnings.push(...workerList.warnings);
  for (const result of [
    kvResult,
    d1Result,
    r2Result,
    vectorizeResult,
    queuesResult,
    domainsResult,
    workersDevResult,
  ]) {
    if (result.error) warnings.push(formatPermissionHint(result.error));
  }

  const listErrors = [
    ...workerList.warnings,
    kvResult.error,
    d1Result.error,
    r2Result.error,
    vectorizeResult.error,
    queuesResult.error,
    domainsResult.error,
    workersDevResult.error,
  ].filter((error): error is string => Boolean(error));

  if (
    listErrors.some((error) => isAuthFailure(error) || isRateLimited(error))
  ) {
    log("aborting account fetch after auth/rate-limit failure", {
      namespace: ns,
    });
    return {
      resources: [],
      warnings: [
        formatAuthFailure(
          ns,
          listErrors.find(
            (error) => isAuthFailure(error) || isRateLimited(error),
          )!,
        ),
      ],
    };
  }

  const workerDomains = new Map<string, string>();
  for (const domain of domainsResult.value) {
    if (!domain.service || !domain.hostname) continue;
    if (!workerDomains.has(domain.service)) {
      workerDomains.set(domain.service, domain.hostname);
    }
  }
  const workersDevSubdomain = workersDevResult.value.subdomain || "";

  const kvNamespaces = kvResult.value;
  const d1Databases = d1Result.value;
  const r2Response = r2Result.value;
  const vectorizeIndexes = vectorizeResult.value;
  const queues = queuesResult.value;

  log("resource counts", {
    namespace: ns,
    workers: workerList.names.length,
    kv: kvNamespaces.length,
    d1: d1Databases.length,
    r2: r2Response.buckets?.length ?? 0,
    vectorize: vectorizeIndexes.length,
    queues: queues.length,
    duration: elapsed(accountStart),
  });

  const resources: ScrapedResource[] = [];

  function trackResource(resource: ScrapedResource) {
    resources.push(resource);
    log("scanning service", {
      kind: resource.kind,
      name: resource.name,
      id: resource.id,
    });
  }

  for (const name of workerList.names) {
    const entryDomain =
      workerDomains.get(name) ??
      (workersDevSubdomain
        ? `${name}.${workersDevSubdomain}.workers.dev`
        : "");
    const domains = entryDomain ? [entryDomain] : [];
    const worker: ScrapedCfWorker = {
      kind: "cf-worker",
      id: serviceId(ns, accountId, "worker", name),
      name,
      group: ns,
      domains,
      envs: [],
      connections: [],
      logUrl: workerViewLogUrl(accountId, name),
    };
    trackResource(worker);
  }

  for (const kv of kvNamespaces) {
    const resource: ScrapedCfKv = {
      kind: "cf-kv",
      id: serviceId(ns, accountId, "kv", kv.id),
      name: kv.title,
      group: ns,
      namespaceId: kv.id,
    };
    trackResource(resource);
  }

  for (const db of d1Databases) {
    if (!db.uuid || !db.name) continue;
    const resource: ScrapedCfD1 = {
      kind: "cf-d1",
      id: serviceId(ns, accountId, "d1", db.uuid),
      name: db.name,
      group: ns,
      databaseId: db.uuid,
    };
    trackResource(resource);
  }

  for (const bucket of r2Response.buckets ?? []) {
    if (!bucket.name) continue;
    const resource: ScrapedCfR2 = {
      kind: "cf-r2",
      id: serviceId(ns, accountId, "r2", bucket.name),
      name: bucket.name,
      group: ns,
      domains: [],
      openToInternet: false,
      s3ApiUrl: r2S3ApiUrl(accountId, bucket.name),
      cors: [],
    };
    trackResource(resource);
  }

  for (const index of vectorizeIndexes) {
    if (!index.name) continue;
    const resource: ScrapedCfVectorize = {
      kind: "cf-vectorize",
      id: serviceId(ns, accountId, "vectorize", index.name),
      name: index.name,
      group: ns,
    };
    trackResource(resource);
  }

  for (const queue of queues) {
    const name = queue.queue_name;
    const id = queue.queue_id ?? name;
    if (!name || !id) continue;
    const resource: ScrapedCfQueue = {
      kind: "cf-queue",
      id: serviceId(ns, accountId, "queue", id),
      name,
      group: ns,
      queueId: id,
    };
    trackResource(resource);
  }

  const byKvId = new Map<string, string>();
  const byD1Id = new Map<string, string>();
  const byR2Name = new Map<string, string>();
  const byVectorizeName = new Map<string, string>();
  const byQueueName = new Map<string, string>();
  const byWorkerName = new Map<string, string>();

  for (const resource of resources) {
    switch (resource.kind) {
      case "cf-worker":
        byWorkerName.set(resource.name, resource.id);
        break;
      case "cf-kv":
        byKvId.set(resource.namespaceId, resource.id);
        break;
      case "cf-d1":
        byD1Id.set(resource.databaseId, resource.id);
        break;
      case "cf-r2":
        byR2Name.set(resource.name, resource.id);
        break;
      case "cf-vectorize":
        byVectorizeName.set(resource.name, resource.id);
        break;
      case "cf-queue":
        byQueueName.set(resource.name, resource.id);
        break;
    }
  }

  const indexes = {
    byKvId,
    byD1Id,
    byR2Name,
    byVectorizeName,
    byQueueName,
    byWorkerName,
  };

  const r2Resources = resources.filter(
    (resource): resource is ScrapedCfR2 => resource.kind === "cf-r2",
  );
  if (r2Resources.length > 0) {
    const r2NetStart = Date.now();
    log("fetching r2 networking", {
      buckets: r2Resources.length,
      concurrency: BINDING_CONCURRENCY,
    });
    await mapPool(r2Resources, BINDING_CONCURRENCY, async (bucket) => {
      const start = Date.now();

      const [managedResult, customResult, corsResult] = await Promise.all([
        settled(
          withTimeout(
            client.r2.buckets.domains.managed.list(bucket.name, account),
            BINDING_TIMEOUT_MS,
            `r2.managed:${bucket.name}`,
          ),
          null,
          `r2.managed:${bucket.name}`,
        ),
        settled(
          withTimeout(
            client.r2.buckets.domains.custom.list(bucket.name, account),
            BINDING_TIMEOUT_MS,
            `r2.custom:${bucket.name}`,
          ),
          null,
          `r2.custom:${bucket.name}`,
        ),
        settled(
          withTimeout(
            client.r2.buckets.cors.get(bucket.name, account).catch((error) => {
              if (isMissingR2CorsConfig(error)) return { rules: [] };
              throw error;
            }),
            BINDING_TIMEOUT_MS,
            `r2.cors:${bucket.name}`,
          ),
          null,
          `r2.cors:${bucket.name}`,
        ),
      ]);

      const listedDomains = customResult.value?.domains ?? [];
      const customDomains = listedDomains
        .map((domain) => domain.domain)
        .filter((domain): domain is string => Boolean(domain));
      const enabledCustomDomain = listedDomains.some(
        (domain) => domain.enabled && domain.domain,
      );

      const managedEnabled = Boolean(managedResult.value?.enabled);
      const corsEntries = formatCorsEntries(
        (corsResult.value?.rules ?? []).map((rule) => ({
          allowedOrigins: rule.allowed?.origins ?? [],
          allowedMethods: rule.allowed?.methods ?? [],
        })),
      );

      bucket.domains = customDomains;
      bucket.openToInternet = managedEnabled || enabledCustomDomain;
      bucket.cors = corsEntries;

      log("r2 networking resolved", {
        bucket: bucket.name,
        customDomains: customDomains.length,
        corsRules: corsEntries.length,
        isOpenToInternet: bucket.openToInternet,
        duration: elapsed(start),
        ...(managedResult.error ? { managedError: managedResult.error } : {}),
        ...(customResult.error ? { customError: customResult.error } : {}),
        ...(corsResult.error ? { corsError: corsResult.error } : {}),
      });
    });
    cli.step(`Resolving R2 networking (${elapsed(r2NetStart)})`);
  }

  const workerResources = resources.filter(
    (resource): resource is ScrapedCfWorker => resource.kind === "cf-worker",
  );
  const bindingsStart = Date.now();
  let bindingsOk = 0;
  let bindingsFailed = 0;
  let bindingsLinked = 0;

  log("fetching worker bindings", {
    workers: workerResources.length,
    concurrency: BINDING_CONCURRENCY,
  });

  await mapPool(workerResources, BINDING_CONCURRENCY, async (worker) => {
    const start = Date.now();
    const settingsResult = await settled(
      withTimeout(
        client.workers.scripts.scriptAndVersionSettings.get(worker.name, {
          account_id: accountId,
        }),
        BINDING_TIMEOUT_MS,
        `bindings:${worker.name}`,
      ),
      null,
      `bindings:${worker.name}`,
    );

    const settings = settingsResult.value;

    if (!settings?.bindings) {
      bindingsFailed += 1;
      log("bindings empty/unavailable", {
        worker: worker.name,
        duration: elapsed(start),
        error: settingsResult.error,
      });
      return;
    }

    const targets = new Set<string>();
    const envs: ScrapedEnvVar[] = [];
    for (const binding of settings.bindings) {
      const record = binding as unknown as {
        type: string;
      } & Record<string, unknown>;

      const env = extractEnvFromBinding(record);
      if (env) envs.push(env);

      const target = resolveBindingTarget(record, indexes);
      if (target && target !== worker.id) targets.add(target);
    }
    worker.envs = envs;
    worker.connections = [...targets];
    bindingsOk += 1;
    bindingsLinked += targets.size;
    log("bindings resolved", {
      worker: worker.name,
      bindingCount: settings.bindings.length,
      envs: envs.length,
      connections: targets.size,
      duration: elapsed(start),
    });
  });

  cli.step(`Resolving bindings (${elapsed(bindingsStart)})`);
  log("bindings complete", {
    namespace: ns,
    ok: bindingsOk,
    failedOrEmpty: bindingsFailed,
    connections: bindingsLinked,
    duration: elapsed(bindingsStart),
  });

  return { resources, warnings };
}

async function fetchProviderInfrastructure(
  provider: CloudflareProvider,
  showNamespace: boolean,
): Promise<AccountFetchResult> {
  const start = Date.now();
  log("provider start", { namespace: provider.namespace });

  cli.section(
    showNamespace
      ? `Scanning Cloudflare (${provider.namespace})`
      : "Scanning Cloudflare",
  );

  const client = new Cloudflare({
    apiToken: provider.apiKey,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });

  const tokenCheck = await assertTokenUsable(
    client,
    provider.namespace,
    provider.apiKey,
  );
  if ("error" in tokenCheck) {
    log("provider token unusable", {
      namespace: provider.namespace,
      warning: tokenCheck.error,
    });
    cli.failStep("Token unusable");
    return { resources: [], warnings: [tokenCheck.error] };
  }

  log("using account", {
    namespace: provider.namespace,
    accountId: tokenCheck.accountId,
    accountName: tokenCheck.accountName,
  });

  try {
    const result = await fetchAccountInfrastructure(
      client,
      provider,
      tokenCheck.accountId,
    );
    log("provider done", {
      namespace: provider.namespace,
      resources: result.resources.length,
      duration: elapsed(start),
    });
    cli.step(`${result.resources.length} resources found (${elapsed(start)})`);
    return result;
  } catch (error) {
    if (isAuthFailure(error) || isRateLimited(error)) {
      return {
        resources: [],
        warnings: [formatAuthFailure(provider.namespace, error)],
      };
    }
    throw error;
  }
}

export async function scrapeCloudflare(
  providers: CloudflareProvider[],
): Promise<ScrapeContext> {
  const start = Date.now();
  const showNamespace = providers.length > 1;
  log("scrape start", { providers: providers.map((p) => p.namespace) });

  if (providers.length === 0) {
    return {
      resources: [],
      warnings: ["No Cloudflare providers configured (PROVIDER_CF_*_API_KEY)"],
    };
  }

  const resources: ScrapedResource[] = [];
  const warnings: string[] = [];

  for (const provider of providers) {
    try {
      const result = await fetchProviderInfrastructure(provider, showNamespace);
      resources.push(...result.resources);
      warnings.push(...result.warnings);
    } catch (reason) {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      logError(`provider:${provider.namespace} failed`, error);
      cli.failStep(`Failed: ${error.message}`);
      warnings.push(
        isAuthFailure(error) || isRateLimited(error)
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
