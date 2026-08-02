import Cloudflare from "cloudflare";

import { layoutServices } from "@/lib/providers/cloudflare/layout";
import {
  SPECIES_STYLE,
  speciesToCategory,
} from "@/lib/infrastructure-styles";
import type { CloudflareProvider } from "@/lib/providers/transformer";
import type {
  InfrastructureService,
  InfrastructureSpecies,
  InfrastructureZone,
} from "@/server/routers/infrastructure";

type RawService = Omit<InfrastructureService, "x" | "y" | "connections"> & {
  connections: string[];
  lookupKeys: string[];
};

function speciesForType(type: string): {
  species: InfrastructureSpecies;
  zone: InfrastructureZone;
  group: string;
} {
  switch (type) {
    case "D1":
    case "KV":
    case "R2":
    case "Vectorize":
      return { species: "database", zone: "data", group: "data" };
    case "Queue":
      return { species: "queue", zone: "compute", group: "messaging" };
    case "Worker":
      return { species: "microservice", zone: "compute", group: "compute" };
    default:
      return { species: "microservice", zone: "compute", group: "compute" };
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
  const { species, zone, group } = speciesForType(service.type);
  const style = SPECIES_STYLE[species];
  return {
    ...service,
    species,
    category: speciesToCategory(species),
    color: style.accent,
    health: "healthy",
    zone,
    group,
    width: 1,
    depth: 1,
    metrics: { rps: 0, errorRate: 0, latencyMs: 0 },
  };
}

const REQUEST_TIMEOUT_MS = 8_000;
const BINDING_TIMEOUT_MS = 5_000;
const BINDING_CONCURRENCY = 6;
const LOG_PREFIX = "[cf-infra]";

function log(message: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(LOG_PREFIX, message, extra);
  } else {
    console.log(LOG_PREFIX, message);
  }
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
    log(`${label} fallback`, { duration: elapsed(start) });
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return { value: fallback, error: `${label}: ${message}` };
  }
}

function formatPermissionHint(error: string): string {
  if (error.includes("10000") || error.includes("Authentication error") || error.includes("403")) {
    return `${error.split(":")[0]} — API token is missing permission (got 403)`;
  }
  return error;
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

/** Fetch only the first account — listing every accessible account can take tens of seconds. */
async function getFirstAccount(client: Cloudflare) {
  const start = Date.now();
  const iterator = client
    .accounts.list({ per_page: 1 })
    [Symbol.asyncIterator]();

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

  for (const name of workerList.names) {
    const domain =
      workerDomains.get(name) ??
      (workersDevSubdomain
        ? `${name}.${workersDevSubdomain}.workers.dev`
        : undefined);
    services.push(
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
    services.push(
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
    services.push(
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
    services.push(
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
    services.push(
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
    services.push(
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

  log("account fetch complete", {
    namespace: ns,
    accountId,
    services: services.length,
    duration: elapsed(accountStart),
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

  const account = await getFirstAccount(client);
  if (!account) {
    log("provider has no accounts", { namespace: provider.namespace });
    return {
      services: [],
      warnings: [`Provider "${provider.namespace}" has no accessible accounts`],
    };
  }

  log("using account", {
    namespace: provider.namespace,
    accountId: account.id,
    accountName: account.name,
  });

  const result = await fetchAccountInfrastructure(
    client,
    provider,
    account.id,
  );

  log("provider done", {
    namespace: provider.namespace,
    services: result.services.length,
    duration: elapsed(start),
  });

  return result;
}

export type InfrastructureFetchResult = {
  services: InfrastructureService[];
  edges: { source: string; target: string; path: { x: number; y: number }[] }[];
  warnings: string[];
  /** Temporary empty-center guide */
  centerGuide?: { x: number; y: number; radius: number };
};

export async function fetchCloudflareInfrastructure(
  providers: CloudflareProvider[],
): Promise<InfrastructureFetchResult> {
  const start = Date.now();
  log("fetch start", {
    providers: providers.map((p) => p.namespace),
  });

  if (providers.length === 0) {
    log("no providers configured");
    return {
      services: [],
      edges: [],
      warnings: ["No Cloudflare providers configured in .env"],
      centerGuide: { x: 0, y: 0, radius: 200 },
    };
  }

  const settledResults = await Promise.allSettled(
    providers.map((provider) => fetchProviderInfrastructure(provider)),
  );

  const services: RawService[] = [];
  const warnings: string[] = [];
  const errors: Error[] = [];

  for (const [index, result] of settledResults.entries()) {
    const namespace = providers[index]!.namespace;
    if (result.status === "fulfilled") {
      services.push(...result.value.services);
      warnings.push(...result.value.warnings);
      continue;
    }

    const error =
      result.reason instanceof Error
        ? result.reason
        : new Error(String(result.reason));
    logError(`provider:${namespace} failed`, error);
    errors.push(error);
    warnings.push(`provider:${namespace}: ${error.message}`);
  }

  if (services.length === 0 && errors.length > 0) {
    throw new Error(
      `Cloudflare fetch failed: ${errors.map((e) => e.message).join("; ")}`,
    );
  }

  const raw = services.map(({ lookupKeys: _lookupKeys, ...rest }) => rest);
  const laidOut = layoutServices(raw);

  log("fetch complete", {
    services: laidOut.services.length,
    connections: laidOut.services.reduce(
      (sum, s) => sum + s.connections.length,
      0,
    ),
    routedEdges: laidOut.edges.length,
    warnings: warnings.length,
    duration: elapsed(start),
  });

  return {
    services: laidOut.services,
    edges: laidOut.edges,
    warnings,
    centerGuide: laidOut.centerGuide,
  };
}
