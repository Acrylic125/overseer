import Cloudflare from "cloudflare";

import {
  collect,
  mapPool,
  mapPoolCollect,
  settled,
  type ScrapeStepFn,
} from "../core/scrape-async.js";
import { envToClaims, parseEnvUrl, urlBaseMatchClaim } from "../core/claims.js";
import { resourceId } from "../core/resource-id.js";
import { scanEntries } from "../core/scan.js";
import { redactSensitiveValue } from "../core/utils.js";
import type {
  ProviderResourceScanner,
  ResourceClaims,
  ConnectionRequirement,
  ResourceFields,
} from "../types.js";
import { iconForKind } from "./icons.js";
import {
  parseR2Cors,
  parseR2CustomDomains,
  parseR2ManagedDomains,
  parseWorkerSettings,
  parseWorkflowGraph,
  type R2Cors,
  type R2CustomDomains,
  type R2ManagedDomains,
  type WorkerBinding,
} from "./schemas.js";
import { workflowNodesToGraph } from "./workflow-graph.js";

const DETAIL_CONCURRENCY = 3;
const noopStep: ScrapeStepFn = () => {};

async function firstAccountId(client: Cloudflare) {
  const iterator = client.accounts
    .list({ per_page: 1 })
    [Symbol.asyncIterator]();
  const next = await iterator.next();
  if (next.done || !next.value?.id) {
    throw new Error("Cloudflare token has no accessible accounts");
  }
  return next.value.id;
}

async function cloudflareAccount(
  apiToken: string,
  fn: ScrapeStepFn = noopStep,
) {
  const client = new Cloudflare({ apiToken });
  fn({ message: "Resolving account" });
  const accountId = await firstAccountId(client);
  return {
    client,
    accountId,
    account: { account_id: accountId },
    fn,
  };
}

type CloudflareAccount = Awaited<ReturnType<typeof cloudflareAccount>>;

function idFor(
  namespace: string,
  accountId: string,
  type: string,
  key: string,
) {
  return resourceId("cf", namespace, accountId, type, key);
}

function workerName(worker: { id?: string | null; name?: string | null }) {
  if ("name" in worker && worker.name) return worker.name;
  return worker.id ?? null;
}

function extractEnv(binding: WorkerBinding) {
  const type = binding.type;
  const key = binding.name;
  if (!type || !key) return null;
  if (type !== "plain_text" && type !== "secret_text") return null;
  return {
    key,
    value: binding.text ?? "",
    type,
  };
}

function workerEnvFields(bindings: WorkerBinding[]) {
  const fields: ResourceFields = {};
  for (const binding of bindings) {
    const env = extractEnv(binding);
    if (!env) continue;
    if (env.type === "secret_text") {
      fields[env.key] = redactSensitiveValue(env.value);
      continue;
    }
    fields[env.key] = env.value;
  }
  return fields;
}

function workerEnvValues(bindings: WorkerBinding[]) {
  const values: string[] = [];
  for (const binding of bindings) {
    const env = extractEnv(binding);
    if (!env) continue;
    values.push(env.value);
  }
  return values;
}

function bindingRefClaims(bindings: WorkerBinding[], workerName: string) {
  const claims: ResourceClaims[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (!value) return;
    const trimmed = value.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    claims.push({ type: "ref", value: trimmed });
  };
  for (const binding of bindings) {
    const type = binding.type?.toLowerCase();
    if (type === "plain_text" || type === "secret_text") continue;
    const classRef =
      binding.class_name && (binding.script_name ?? workerName)
        ? `${binding.script_name ?? workerName}:${binding.class_name}`
        : null;
    add(binding.namespace_id);
    add(binding.database_id);
    add(binding.id);
    add(binding.bucket_name);
    add(binding.index_name);
    add(binding.queue_name);
    add(binding.service);
    add(binding.workflow_name);
    add(classRef);
  }
  return claims;
}

function requireRef(
  refs: Array<{ value: string | null | undefined; label: string }>,
  claim: ResourceClaims,
): ConnectionRequirement {
  if (claim.type !== "ref") return false;
  const claimValue = claim.value.trim().toLowerCase();
  for (const ref of refs) {
    if (!ref.value) continue;
    if (ref.value.trim().toLowerCase() === claimValue) {
      return { type: "connected" as const, label: ref.label };
    }
  }
  return false;
}

function formatCors(cors: R2Cors) {
  if (!cors.rules) return [];
  const entries: string[] = [];
  for (const rule of cors.rules) {
    const origins = rule.allowed?.origins ?? rule.allowedOrigins ?? [];
    const methods = rule.allowed?.methods ?? rule.allowedMethods ?? [];
    for (const method of methods) {
      for (const origin of origins) entries.push(`${method} ${origin}`);
    }
  }
  return entries;
}

function r2CorsOrigins(cors: R2Cors) {
  if (!cors.rules) return [];
  const origins: string[] = [];
  for (const rule of cors.rules) {
    origins.push(...(rule.allowed?.origins ?? rule.allowedOrigins ?? []));
  }
  return origins;
}

function r2CorsAllowsClaim(cors: R2Cors | undefined, claim: ResourceClaims) {
  if (!cors) return true;
  if (claim.type !== "url") return false;
  const claimHost =
    parseEnvUrl(claim.value)?.hostname.toLowerCase() ??
    claim.value.trim().toLowerCase();
  if (!claimHost) return false;
  for (const origin of r2CorsOrigins(cors)) {
    if (origin === "*") return true;
    if (urlBaseMatchClaim(origin, claim)) return true;
  }
  return false;
}

function r2Domains(custom: R2CustomDomains) {
  if (!custom.domains) return [];
  return custom.domains
    .map((row) => row.domain)
    .filter((domain): domain is string => Boolean(domain));
}

function r2OpenToInternet(
  managed: R2ManagedDomains | undefined,
  custom: R2CustomDomains | undefined,
) {
  const managedEnabled = managed?.enabled === true;
  const customEnabled =
    custom?.domains?.some((row) => row.enabled === true && row.domain) ?? false;
  return managedEnabled || customEnabled;
}

async function r2Cors(
  client: CloudflareAccount["client"],
  bucketName: string,
  account: CloudflareAccount["account"],
) {
  try {
    return await client.r2.buckets.cors.get(bucketName, account);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (
      text.includes("10059") ||
      text.includes("The CORS configuration does not exist")
    ) {
      return { rules: [] };
    }
    throw error;
  }
}

async function scrapeWorkers(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing workers" });
  const listedWorkers = await collect(
    ctx.client.workers.scripts.list(ctx.account),
  );
  const betaWorkers =
    listedWorkers.length > 0
      ? []
      : await collect(ctx.client.workers.beta.workers.list(ctx.account));
  const workerSettings: Record<
    string,
    ReturnType<typeof parseWorkerSettings>
  > = {};
  const workerNames = [
    ...listedWorkers.map((worker) => workerName(worker)),
    ...betaWorkers.map((worker) => workerName(worker)),
  ].filter((name): name is string => Boolean(name));

  await mapPool(workerNames, DETAIL_CONCURRENCY, async (name) => {
    const settings = await settled(
      () =>
        ctx.client.workers.scripts.scriptAndVersionSettings.get(
          name,
          ctx.account,
        ),
      null,
    );
    if (!settings) return;
    const parsed = parseWorkerSettings(settings);
    if (parsed) workerSettings[name] = parsed;
  });

  ctx.fn({ message: "Listing worker domains" });
  const workerDomains = await collect(
    ctx.client.workers.domains.list(ctx.account),
  );
  const workersSubdomain = await settled(
    () => ctx.client.workers.subdomains.get(ctx.account),
    { subdomain: "" },
  );

  const listed = listedWorkers.length > 0 ? listedWorkers : betaWorkers;
  const items = [];
  for (const worker of listed) {
    const name = workerName(worker);
    if (!name) continue;
    const hosts: string[] = [];
    for (const row of workerDomains) {
      if (row.service !== name) continue;
      if (row.hostname) hosts.push(row.hostname);
    }
    if (hosts.length === 0 && workersSubdomain.subdomain) {
      hosts.push(`${name}.${workersSubdomain.subdomain}.workers.dev`);
    }
    items.push({
      accountId: ctx.accountId,
      name,
      domains: hosts,
      bindings: workerSettings[name]?.bindings ?? [],
    });
  }
  return items;
}

async function scrapeDurableObjects(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing durable objects" });
  const durableObjects = await collect(
    ctx.client.durableObjects.namespaces.list(ctx.account),
  );
  return durableObjects.map((namespaceDo) => ({
    accountId: ctx.accountId,
    namespaceDo,
  }));
}

async function scrapeWorkflows(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing workflows" });
  const workflows = await collect(ctx.client.workflows.list(ctx.account));
  return mapPoolCollect(workflows, DETAIL_CONCURRENCY, async (workflow) => {
    const name = workflow.name;
    if (!name) return null;

    const versions = await settled(
      () => collect(ctx.client.workflows.versions.list(name, ctx.account)),
      [],
    );
    const latest = [...versions].sort((a, b) => {
      const aTime = Date.parse(a.modified_on || a.created_on) || 0;
      const bTime = Date.parse(b.modified_on || b.created_on) || 0;
      return bTime - aTime;
    })[0];

    let graph = null;
    if (latest?.id) {
      const raw = await settled(
        () =>
          ctx.client.workflows.versions.graph(latest.id, {
            account_id: ctx.accountId,
            workflow_name: name,
          }),
        null,
      );
      if (raw) graph = parseWorkflowGraph(raw);
    }

    return {
      accountId: ctx.accountId,
      workflow,
      graph,
    };
  });
}

async function scrapeKv(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing KV namespaces" });
  const kv = await collect(ctx.client.kv.namespaces.list(ctx.account));
  return kv.map((row) => ({ accountId: ctx.accountId, kv: row }));
}

async function scrapeD1(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing D1 databases" });
  const d1 = await collect(ctx.client.d1.database.list(ctx.account));
  return d1.map((db) => ({ accountId: ctx.accountId, db }));
}

async function scrapeR2(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing R2 buckets" });
  const r2Result = await settled(
    () => ctx.client.r2.buckets.list({ ...ctx.account, per_page: 100 }),
    { buckets: [] },
  );
  const r2 = r2Result.buckets ?? [];
  return mapPoolCollect(r2, DETAIL_CONCURRENCY, async (bucket) => {
    const name = bucket.name;
    if (!name) return null;

    const [managed, custom, cors] = await Promise.all([
      settled(
        () => ctx.client.r2.buckets.domains.managed.list(name, ctx.account),
        null,
      ),
      settled(
        () => ctx.client.r2.buckets.domains.custom.list(name, ctx.account),
        null,
      ),
      settled(() => r2Cors(ctx.client, name, ctx.account), null),
    ]);

    return {
      accountId: ctx.accountId,
      bucket,
      custom: custom ? (parseR2CustomDomains(custom) ?? undefined) : undefined,
      managed: managed
        ? (parseR2ManagedDomains(managed) ?? undefined)
        : undefined,
      cors: cors ? (parseR2Cors(cors) ?? undefined) : undefined,
    };
  });
}

async function scrapeVectorize(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing Vectorize indexes" });
  const vectorize = await collect(
    ctx.client.vectorize.indexes.list(ctx.account),
  );
  return vectorize.map((index) => ({
    accountId: ctx.accountId,
    index,
  }));
}

async function scrapeQueues(ctx: CloudflareAccount) {
  ctx.fn({ message: "Listing queues" });
  const queues = await collect(ctx.client.queues.list(ctx.account));
  return queues.map((queue) => ({
    accountId: ctx.accountId,
    queue,
  }));
}

export const workerScanner = {
  type: "Worker",
  scrape: scrapeWorkers,
  transform(item, { namespace }) {
    return {
      id: idFor(namespace, item.accountId, "worker", item.name),
      group: namespace,
      name: item.name,
      url: `https://dash.cloudflare.com/${item.accountId}/workers/services/view/${encodeURIComponent(item.name)}/production/observability/events`,
      service: "Worker",
      asset: iconForKind("Worker"),
      fields: {
        "Is Open To Internet": item.domains.length > 0,
        ...(item.domains.length > 0 ? { Domains: item.domains } : {}),
        ...workerEnvFields(item.bindings),
      },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const domains = item.domains;
    return {
      claims: [
        ...envToClaims(workerEnvValues(item.bindings)),
        ...bindingRefClaims(item.bindings, item.name),
      ],
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
  Awaited<ReturnType<typeof scrapeWorkers>>[number],
  [CloudflareAccount]
>;

export const durableObjectScanner = {
  type: "Durable Object",
  scrape: scrapeDurableObjects,
  transform(item, { namespace }) {
    const doId = item.namespaceDo.id;
    if (!doId) return null;
    const name = item.namespaceDo.name ?? item.namespaceDo.class ?? doId;
    return {
      id: idFor(namespace, item.accountId, "do", doId),
      group: namespace,
      name,
      url: `https://dash.cloudflare.com/${item.accountId}/workers/durable-objects/view/${encodeURIComponent(doId)}`,
      service: "Durable Object",
      asset: iconForKind("Durable Object"),
      fields: { "Is Open To Internet": false },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const namespaceDo = item.namespaceDo;
    const name = namespaceDo.name ?? namespaceDo.class ?? namespaceDo.id ?? "";
    const script = namespaceDo.script;
    const className = namespaceDo.class;
    const classRef = script && className ? `${script}:${className}` : null;
    return {
      claims: [],
      require: (claim) =>
        requireRef(
          [
            { value: namespaceDo.id, label: name },
            { value: namespaceDo.name, label: name },
            { value: namespaceDo.class, label: name },
            { value: classRef, label: name },
          ],
          claim,
        ),
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeDurableObjects>>[number],
  [CloudflareAccount]
>;

export const workflowScanner = {
  type: "Workflow",
  scrape: scrapeWorkflows,
  transform(item, { namespace }) {
    const name = item.workflow.name;
    const workflowId = item.workflow.id;
    if (!name || !workflowId) return null;
    const nodes =
      item.graph?.graph?.workflow?.nodes ??
      item.graph?.graph?.nodes ??
      item.graph?.workflow?.nodes ??
      item.graph?.nodes ??
      null;
    const fields: ResourceFields = {};
    if (nodes && nodes.length > 0) {
      fields.Steps = workflowNodesToGraph(nodes);
    }
    return {
      id: idFor(namespace, item.accountId, "workflow", workflowId),
      group: namespace,
      name,
      url: "",
      service: "Workflow",
      asset: iconForKind("Workflow"),
      fields,
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const name = item.workflow.name ?? "";
    return {
      claims: [],
      require: (claim) =>
        requireRef(
          [
            { value: item.workflow.name, label: name },
            { value: item.workflow.id, label: name },
            { value: item.workflow.script_name, label: name },
          ],
          claim,
        ),
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeWorkflows>>[number],
  [CloudflareAccount]
>;

export const kvScanner = {
  type: "KV",
  scrape: scrapeKv,
  transform(item, { namespace }) {
    const kvId = item.kv.id;
    const title = item.kv.title ?? kvId;
    if (!kvId || !title) return null;
    return {
      id: idFor(namespace, item.accountId, "kv", kvId),
      group: namespace,
      name: title,
      url: "",
      service: "KV",
      asset: iconForKind("KV"),
      fields: {},
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const kvId = item.kv.id;
    const title = item.kv.title ?? kvId ?? "";
    return {
      claims: [],
      require: (claim) =>
        requireRef(
          [
            { value: kvId, label: title },
            { value: title, label: title },
          ],
          claim,
        ),
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeKv>>[number],
  [CloudflareAccount]
>;

export const d1Scanner = {
  type: "D1",
  scrape: scrapeD1,
  transform(item, { namespace }) {
    const uuid = item.db.uuid;
    const name = item.db.name;
    if (!uuid || !name) return null;
    return {
      id: idFor(namespace, item.accountId, "d1", uuid),
      group: namespace,
      name,
      url: "",
      service: "D1",
      asset: iconForKind("D1"),
      fields: { "Is Open To Internet": true },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const name = item.db.name ?? "";
    return {
      claims: [],
      require: (claim) =>
        requireRef(
          [
            { value: item.db.uuid, label: name },
            { value: name, label: name },
          ],
          claim,
        ),
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeD1>>[number],
  [CloudflareAccount]
>;

export const r2Scanner = {
  type: "R2",
  scrape: scrapeR2,
  transform(item, { namespace }) {
    const name = item.bucket.name;
    if (!name) return null;
    const domains = item.custom ? r2Domains(item.custom) : [];
    const cors = item.cors ? formatCors(item.cors) : [];
    const open = r2OpenToInternet(item.managed, item.custom);
    const s3ApiUrl = `https://${item.accountId}.r2.cloudflarestorage.com/${name}`;
    return {
      id: idFor(namespace, item.accountId, "r2", name),
      group: namespace,
      name,
      url: "",
      service: "R2",
      asset: iconForKind("R2"),
      fields: {
        "Is Open To Internet": open,
        ...(domains.length > 0 ? { Domains: domains } : {}),
        "S3 API URL": s3ApiUrl,
        ...(cors.length > 0 ? { CORS: cors } : {}),
      },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const domains = item.custom ? r2Domains(item.custom) : [];
    const cors = item.cors;
    const name = item.bucket.name ?? "";
    return {
      claims: [],
      require: (claim) => {
        const refMatch = requireRef([{ value: name, label: name }], claim);
        if (refMatch) return refMatch;
        for (const domain of domains) {
          if (!urlBaseMatchClaim(domain, claim)) continue;
          if (!r2CorsAllowsClaim(cors, claim)) {
            return {
              type: "connected",
              label: domain,
              errorMessage: `CORS does not allow ${claim.value}`,
            };
          }
          return { type: "connected", label: domain };
        }
        return false;
      },
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeR2>>[number],
  [CloudflareAccount]
>;

export const vectorizeScanner = {
  type: "Vectorize",
  scrape: scrapeVectorize,
  transform(item, { namespace }) {
    const name = item.index.name;
    if (!name) return null;
    return {
      id: idFor(namespace, item.accountId, "vectorize", name),
      group: namespace,
      name,
      url: "",
      service: "Vectorize",
      asset: iconForKind("Vectorize"),
      fields: { "Is Open To Internet": true },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const name = item.index.name ?? "";
    return {
      claims: [],
      require: (claim) => requireRef([{ value: name, label: name }], claim),
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeVectorize>>[number],
  [CloudflareAccount]
>;

export const queueScanner = {
  type: "Queue",
  scrape: scrapeQueues,
  transform(item, { namespace }) {
    const name = item.queue.queue_name;
    const queueId = item.queue.queue_id ?? name;
    if (!name || !queueId) return null;
    return {
      id: idFor(namespace, item.accountId, "queue", queueId),
      group: namespace,
      name,
      url: "",
      service: "Queue",
      asset: iconForKind("Queue"),
      fields: {},
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const name = item.queue.queue_name ?? "";
    const queueId = item.queue.queue_id ?? name;
    return {
      claims: [],
      require: (claim) =>
        requireRef(
          [
            { value: name, label: name },
            { value: queueId, label: name },
          ],
          claim,
        ),
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeQueues>>[number],
  [CloudflareAccount]
>;

export const cloudflareScanners = [
  workerScanner,
  durableObjectScanner,
  workflowScanner,
  kvScanner,
  d1Scanner,
  r2Scanner,
  vectorizeScanner,
  queueScanner,
];

export async function scanCloudflare(
  apiToken: string,
  namespace: string,
  fn: ScrapeStepFn = noopStep,
) {
  const account = await cloudflareAccount(apiToken, fn);
  const [workers, durableObjects, workflows, kv, d1, r2, vectorize, queues] =
    await Promise.all([
      workerScanner.scrape(account),
      durableObjectScanner.scrape(account),
      workflowScanner.scrape(account),
      kvScanner.scrape(account),
      d1Scanner.scrape(account),
      r2Scanner.scrape(account),
      vectorizeScanner.scrape(account),
      queueScanner.scrape(account),
    ]);

  return [
    ...scanEntries(workerScanner, workers, namespace),
    ...scanEntries(durableObjectScanner, durableObjects, namespace),
    ...scanEntries(workflowScanner, workflows, namespace),
    ...scanEntries(kvScanner, kv, namespace),
    ...scanEntries(d1Scanner, d1, namespace),
    ...scanEntries(r2Scanner, r2, namespace),
    ...scanEntries(vectorizeScanner, vectorize, namespace),
    ...scanEntries(queueScanner, queues, namespace),
  ];
}
