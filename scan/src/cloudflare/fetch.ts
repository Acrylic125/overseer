import Cloudflare from "cloudflare";

import type { CloudflareProvider } from "../providers.js";
import type { ScannedService } from "../schema.js";

type RawService = ScannedService & { lookupKeys: string[] };

type SpeciesMeta = Pick<ScannedService, "species" | "zone" | "group" | "category">;

function speciesForType(type: string): SpeciesMeta {
  switch (type) {
    case "D1":
    case "KV":
    case "Vectorize":
      return {
        species: "database",
        zone: "data",
        group: "data",
        category: "database",
      };
    case "R2":
      return {
        species: "object_storage",
        zone: "data",
        group: "storage",
        category: "storage",
      };
    case "Queue":
      return {
        species: "queue",
        zone: "compute",
        group: "messaging",
        category: "integration",
      };
    case "Worker":
      return {
        species: "microservice",
        zone: "compute",
        group: "compute",
        category: "compute",
      };
    default:
      return {
        species: "microservice",
        zone: "compute",
        group: "compute",
        category: "compute",
      };
  }
}

function withCategory(
  service: Omit<
    RawService,
    | "category"
    | "color"
    | "species"
    | "health"
    | "zone"
    | "metrics"
    | "group"
    | "width"
    | "depth"
  >,
): RawService {
  const meta = speciesForType(service.type);
  return {
    ...service,
    ...meta,
    color: "#111827",
    health: "healthy",
    width: 1,
    depth: 1,
    metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
  };
}

const REQUEST_TIMEOUT_MS = 8_000;
const BINDING_TIMEOUT_MS = 5_000;
const BINDING_CONCURRENCY = 3;
const LOG_PREFIX = "[scan:cf]";

function log(message: string, extra?: Record<string, unknown>) {
  if (extra) console.log(LOG_PREFIX, message, extra);
  else console.log(LOG_PREFIX, message);
}

function logError(message: string, error: unknown) {
  const detail =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : { error };
  console.error(LOG_PREFIX, message, detail);
}

function elapsed(start: number) {
  return `${Date.now() - start}ms`;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${ms}ms: ${label}`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function settled<T>(
  promise: Promise<T>,
  fallback: T,
  label: string,
): Promise<{ value: T; error: string | null }> {
  const start = Date.now();
  try {
    const value = await promise;
    log(`${label} ok`, { duration: elapsed(start) });
    return { value, error: null };
  } catch (error) {
    logError(`${label} failed — using fallback`, error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { value: fallback, error: `${label}: ${message}` };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isAuthFailure(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes("10502") ||
    text.includes("Too many authentication failures") ||
    text.includes('"code":10000') ||
    text.includes("Authentication error") ||
    text.includes("Invalid API Token") ||
    text.includes("Invalid request headers") ||
    /\b401\b/.test(text) ||
    (/\b429\b/.test(text) && text.toLowerCase().includes("auth"))
  );
}

function isRateLimited(error: unknown): boolean {
  const text = errorText(error);
  return /\b429\b/.test(text) || text.includes("10502");
}

function formatAuthFailure(namespace: string, error: unknown): string {
  const text = errorText(error);
  if (
    text.includes("10502") ||
    text.includes("Too many authentication failures")
  ) {
    return `provider:${namespace}: Cloudflare temporarily locked this API token after too many auth failures. Wait a few minutes, confirm PROVIDER_CF_${namespace}_API_KEY, then scan once.`;
  }
  if (text.includes("9109") || text.includes("Cannot use the access token from location")) {
    const ipMatch = text.match(/location:\s*([0-9a-fA-F:.]+)/);
    const ip = ipMatch?.[1] ?? "this machine";
    return `provider:${namespace}: Cloudflare rejected this token from IP ${ip} (code 9109). In the Cloudflare dashboard, edit the token’s Client IP Address Filtering to allow ${ip}, or clear the IP filter.`;
  }
  if (/\b429\b/.test(text)) {
    return `provider:${namespace}: Cloudflare rate-limited the API token. Wait a few minutes, then scan once.`;
  }
  if (
    text.includes("10000") ||
    text.includes("Authentication error") ||
    text.includes("Invalid API Token")
  ) {
    return `provider:${namespace}: API token rejected — check PROVIDER_CF_${namespace}_API_KEY.`;
  }
  return `provider:${namespace}: ${text}`;
}

function formatPermissionHint(error: string): string {
  if (
    error.includes("10000") ||
    error.includes("Authentication error") ||
    error.includes("403")
  ) {
    return `${error.split(":")[0]} — API token is missing permission (got 403)`;
  }
  return error;
}

async function assertTokenUsable(
  client: Cloudflare,
  namespace: string,
  apiToken: string,
): Promise<{ accountId: string; accountName?: string } | { error: string }> {
  // Account tokens (cfat_) are not valid on /user/tokens/verify.
  // User tokens (cfut_ / legacy) use the user verify endpoint.
  const isAccountToken = apiToken.startsWith("cfat_");

  if (!isAccountToken) {
    try {
      const result = await withTimeout(
        client.user.tokens.verify(),
        REQUEST_TIMEOUT_MS,
        "user.tokens.verify",
      );
      if (result.status !== "active") {
        return {
          error: `provider:${namespace}: API token status is "${result.status ?? "unknown"}" (expected active).`,
        };
      }
    } catch (error) {
      // Fall through to accounts.list for tokens that can't use user verify.
      if (!isAuthFailure(error) && !isRateLimited(error)) {
        return { error: formatAuthFailure(namespace, error) };
      }
      log("user.tokens.verify failed — probing accounts.list", { namespace });
    }
  }

  try {
    const account = await getFirstAccount(client);
    if (!account) {
      return {
        error: `provider:${namespace}: token authenticated but has no accessible accounts`,
      };
    }

    if (isAccountToken) {
      try {
        const result = await withTimeout(
          client.accounts.tokens.verify({ account_id: account.id }),
          REQUEST_TIMEOUT_MS,
          "accounts.tokens.verify",
        );
        if (result.status !== "active") {
          return {
            error: `provider:${namespace}: API token status is "${result.status ?? "unknown"}" (expected active).`,
          };
        }
      } catch (error) {
        // Account list already proved the token works; missing verify perm is OK.
        if (isAuthFailure(error) || isRateLimited(error)) {
          return { error: formatAuthFailure(namespace, error) };
        }
        log("accounts.tokens.verify skipped", {
          namespace,
          error: errorText(error),
        });
      }
    }

    return { accountId: account.id, accountName: account.name };
  } catch (error) {
    return { error: formatAuthFailure(namespace, error) };
  }
}

async function collectPages<T>(
  iterable: AsyncIterable<T>,
  label: string,
  maxItems = 250,
): Promise<T[]> {
  const items: T[] = [];
  const start = Date.now();
  const iterator = iterable[Symbol.asyncIterator]();

  while (items.length < maxItems) {
    const next = await withTimeout(
      iterator.next(),
      REQUEST_TIMEOUT_MS,
      `${label} item ${items.length + 1}`,
    );
    if (next.done) break;
    items.push(next.value);
  }

  log(`${label} collected`, { count: items.length, duration: elapsed(start) });
  return items;
}

async function getFirstAccount(client: Cloudflare) {
  const start = Date.now();
  const iterator = client.accounts.list({ per_page: 1 })[Symbol.asyncIterator]();

  const next = await withTimeout(
    iterator.next(),
    REQUEST_TIMEOUT_MS,
    "accounts.list first",
  );

  if (next.done || !next.value) {
    log("accounts.list empty", { duration: elapsed(start) });
    return null;
  }

  log("accounts.list first", {
    accountId: next.value.id,
    accountName: next.value.name,
    duration: elapsed(start),
  });

  return next.value;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current]!);
    }
  }

  const pool = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => worker(),
  );
  await Promise.all(pool);
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

type AccountFetchResult = {
  services: RawService[];
  warnings: string[];
};

async function timedList<T>(
  label: string,
  run: () => Promise<T>,
  fallback: T,
): Promise<{ value: T; error: string | null }> {
  return settled(run(), fallback, label);
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
    listWorkerNames(client, accountId),
    timedList(
      "kv.namespaces.list",
      () =>
        collectPages(client.kv.namespaces.list(account), "kv.namespaces.list"),
      [],
    ),
    timedList(
      "d1.database.list",
      () => collectPages(client.d1.database.list(account), "d1.database.list"),
      [],
    ),
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
    timedList(
      "vectorize.indexes.list",
      () =>
        collectPages(
          client.vectorize.indexes.list(account),
          "vectorize.indexes.list",
        ),
      [],
    ),
    timedList(
      "queues.list",
      () => collectPages(client.queues.list(account), "queues.list"),
      [],
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
      services: [],
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

  const services: RawService[] = [];

  function trackService(service: RawService) {
    services.push(service);
    log("scanning service", {
      type: service.type,
      name: service.name,
      id: service.id,
      ...(service.additionalInfo
        ? { additionalInfo: service.additionalInfo }
        : {}),
    });
  }

  for (const name of workerList.names) {
    const domain =
      workerDomains.get(name) ??
      (workersDevSubdomain
        ? `${name}.${workersDevSubdomain}.workers.dev`
        : undefined);
    trackService(
      withCategory({
        id: serviceId(ns, accountId, "worker", name),
        type: "Worker",
        name,
        connections: [],
        lookupKeys: [name],
        additionalInfo: domain,
      }),
    );
  }

  for (const kv of kvNamespaces) {
    trackService(
      withCategory({
        id: serviceId(ns, accountId, "kv", kv.id),
        type: "KV",
        name: kv.title,
        connections: [],
        lookupKeys: [kv.id, kv.title],
      }),
    );
  }

  for (const db of d1Databases) {
    if (!db.uuid || !db.name) continue;
    trackService(
      withCategory({
        id: serviceId(ns, accountId, "d1", db.uuid),
        type: "D1",
        name: db.name,
        connections: [],
        lookupKeys: [db.uuid, db.name],
      }),
    );
  }

  for (const bucket of r2Response.buckets ?? []) {
    if (!bucket.name) continue;
    trackService(
      withCategory({
        id: serviceId(ns, accountId, "r2", bucket.name),
        type: "R2",
        name: bucket.name,
        connections: [],
        lookupKeys: [bucket.name],
      }),
    );
  }

  for (const index of vectorizeIndexes) {
    if (!index.name) continue;
    trackService(
      withCategory({
        id: serviceId(ns, accountId, "vectorize", index.name),
        type: "Vectorize",
        name: index.name,
        connections: [],
        lookupKeys: [index.name],
      }),
    );
  }

  for (const queue of queues) {
    const name = queue.queue_name;
    const id = queue.queue_id ?? name;
    if (!name || !id) continue;
    trackService(
      withCategory({
        id: serviceId(ns, accountId, "queue", id),
        type: "Queue",
        name,
        connections: [],
        lookupKeys: [name, id],
      }),
    );
  }

  const byKvId = new Map<string, string>();
  const byD1Id = new Map<string, string>();
  const byR2Name = new Map<string, string>();
  const byVectorizeName = new Map<string, string>();
  const byQueueName = new Map<string, string>();
  const byWorkerName = new Map<string, string>();

  for (const service of services) {
    if (service.type === "Worker") byWorkerName.set(service.name, service.id);
    else if (service.type === "KV")
      byKvId.set(service.lookupKeys[0]!, service.id);
    else if (service.type === "D1")
      byD1Id.set(service.lookupKeys[0]!, service.id);
    else if (service.type === "R2") byR2Name.set(service.name, service.id);
    else if (service.type === "Vectorize")
      byVectorizeName.set(service.name, service.id);
    else if (service.type === "Queue")
      byQueueName.set(service.name, service.id);
  }

  const indexes = {
    byKvId,
    byD1Id,
    byR2Name,
    byVectorizeName,
    byQueueName,
    byWorkerName,
  };

  const workerServices = services.filter((s) => s.type === "Worker");
  const bindingsStart = Date.now();
  let bindingsOk = 0;
  let bindingsFailed = 0;
  let bindingsLinked = 0;

  log("fetching worker bindings", {
    workers: workerServices.length,
    concurrency: BINDING_CONCURRENCY,
  });

  await mapPool(workerServices, BINDING_CONCURRENCY, async (worker) => {
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
    for (const binding of settings.bindings) {
      const target = resolveBindingTarget(
        binding as unknown as { type: string } & Record<string, unknown>,
        indexes,
      );
      if (target && target !== worker.id) targets.add(target);
    }
    worker.connections = [...targets];
    bindingsOk += 1;
    bindingsLinked += targets.size;
    log("bindings resolved", {
      worker: worker.name,
      bindingCount: settings.bindings.length,
      connections: targets.size,
      duration: elapsed(start),
    });
  });

  log("bindings complete", {
    namespace: ns,
    ok: bindingsOk,
    failedOrEmpty: bindingsFailed,
    connections: bindingsLinked,
    duration: elapsed(bindingsStart),
  });

  return { services, warnings };
}

async function fetchProviderInfrastructure(
  provider: CloudflareProvider,
): Promise<AccountFetchResult> {
  const start = Date.now();
  log("provider start", { namespace: provider.namespace });

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
    return { services: [], warnings: [tokenCheck.error] };
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
      services: result.services.length,
      duration: elapsed(start),
    });
    return result;
  } catch (error) {
    if (isAuthFailure(error) || isRateLimited(error)) {
      return {
        services: [],
        warnings: [formatAuthFailure(provider.namespace, error)],
      };
    }
    throw error;
  }
}

export type ScrapeResult = {
  services: ScannedService[];
  warnings: string[];
};

export async function scrapeCloudflare(
  providers: CloudflareProvider[],
): Promise<ScrapeResult> {
  const start = Date.now();
  log("scrape start", { providers: providers.map((p) => p.namespace) });

  if (providers.length === 0) {
    return {
      services: [],
      warnings: ["No Cloudflare providers configured (PROVIDER_CF_*_API_KEY)"],
    };
  }

  const services: RawService[] = [];
  const warnings: string[] = [];

  for (const provider of providers) {
    try {
      const result = await fetchProviderInfrastructure(provider);
      services.push(...result.services);
      warnings.push(...result.warnings);
    } catch (reason) {
      const error =
        reason instanceof Error ? reason : new Error(String(reason));
      logError(`provider:${provider.namespace} failed`, error);
      warnings.push(
        isAuthFailure(error) || isRateLimited(error)
          ? formatAuthFailure(provider.namespace, error)
          : `provider:${provider.namespace}: ${error.message}`,
      );
    }
  }

  const cleaned: ScannedService[] = services.map(
    ({ lookupKeys: _lookupKeys, ...rest }) => rest,
  );

  console.log(`[scan:cf] services scanned (${cleaned.length}):`);
  for (const service of cleaned) {
    console.log(`  - ${service.type}: ${service.name}`);
  }

  log("scrape complete", {
    services: cleaned.length,
    warnings: warnings.length,
    duration: elapsed(start),
  });

  return { services: cleaned, warnings };
}
