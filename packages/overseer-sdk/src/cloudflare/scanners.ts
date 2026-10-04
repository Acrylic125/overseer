import Cloudflare from "cloudflare";

import { collect, mapPool, mapPoolCollect, settled } from "../core/scrape-async.js";
import { envReferences, hostOf, refReferences } from "../core/claims.js";
import {
  DEFAULT_TTL_MS,
  HOUR_MS,
  defineProvider,
  type Scanner,
} from "../core/provider.js";
import { resourceId } from "../core/resource-id.js";
import type { Exposure, LinkEntry, Reference } from "../core/schemas.js";
import { redactSensitiveValue } from "../core/utils.js";
import {
  table,
  type FieldNode,
  type ResourceAlert,
  type ResourceFields,
} from "../types.js";
import { iconForKind } from "./icons.js";
import {
  parseDnsRecord,
  parseR2Cors,
  parseR2CustomDomains,
  parseWorkerSecret,
  parseWorkerSettings,
  parseWorkflowGraph,
  type R2Cors,
  type R2CustomDomains,
  type WorkerBinding,
  type WorkerSecret,
} from "./schemas.js";
import { workflowNodesToGraph } from "./workflow-graph.js";

const DETAIL_CONCURRENCY = 3;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const DNS_RECORD_TYPES = new Set(["A", "AAAA", "CNAME"]);

export const WORKER_DEFAULT_POLICY = {
  onAfterSensitiveVarLastUpdatedDays: [90, "warn"] as [
    number,
    "warn" | "error",
  ],
};

type CloudflareCtx = {
  client: Cloudflare;
  accountId: string;
  account: { account_id: string };
  /** Memoised per account; DNS and Worker routes both need the zone list. */
  zones: () => Promise<Array<{ id: string; name: string }>>;
  policy: typeof WORKER_DEFAULT_POLICY;
};

type WorkerEnv = {
  key: string;
  value: string;
  type: string;
  modifiedOn?: string;
};

function idFor(namespace: string, accountId: string, type: string, key: string) {
  return resourceId("cf", namespace, accountId, type, key);
}

function refExposures(
  refs: Array<string | null | undefined>,
  label: string,
): Exposure[] {
  const exposures: Exposure[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    exposures.push({ type: "ref", value, label });
  }
  return exposures;
}

function hostExposures(hosts: string[], extra: Partial<Exposure> = {}) {
  const exposures: Exposure[] = [];
  for (const host of hosts) {
    exposures.push({ type: "host", value: host, label: host, ...extra });
  }
  return exposures;
}

function sensitiveVarAlerts(
  envs: WorkerEnv[],
  policy: typeof WORKER_DEFAULT_POLICY,
) {
  const alerts: ResourceAlert[] = [];
  const now = Date.now();
  const [thresholdDays, severity] = policy.onAfterSensitiveVarLastUpdatedDays;

  for (const env of envs) {
    if (env.type !== "secret_text") continue;
    if (!env.modifiedOn) continue;
    const modified = Date.parse(env.modifiedOn);
    if (Number.isNaN(modified)) continue;
    const ageDays = (now - modified) / MS_PER_DAY;
    if (ageDays < thresholdDays) continue;
    alerts.push({
      type: severity === "error" ? "error" : "warning",
      message: `Secret "${env.key}" has not been updated in ${Math.floor(ageDays)} days`,
    });
  }

  return alerts;
}

function workerName(worker: { id?: string | null; name?: string | null }) {
  if ("name" in worker && worker.name) return worker.name;
  return worker.id ?? null;
}

function workerRevision(worker: object) {
  if ("modified_on" in worker && typeof worker.modified_on === "string") {
    return worker.modified_on;
  }
  if ("updated_on" in worker && typeof worker.updated_on === "string") {
    return worker.updated_on;
  }
  return undefined;
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

function mergeWorkerEnvs(bindings: WorkerBinding[], secrets: WorkerSecret[]) {
  const byKey = new Map<string, WorkerEnv>();
  for (const binding of bindings) {
    const env = extractEnv(binding);
    if (!env) continue;
    byKey.set(env.key, env);
  }
  for (const secret of secrets) {
    if (secret.type && secret.type !== "secret_text") continue;
    const existing = byKey.get(secret.name);
    if (existing) {
      if (!existing.value && secret.text) existing.value = secret.text;
      if (secret.modified_on) existing.modifiedOn = secret.modified_on;
      continue;
    }
    byKey.set(secret.name, {
      key: secret.name,
      value: secret.text ?? "",
      type: secret.type ?? "secret_text",
      modifiedOn: secret.modified_on,
    });
  }
  return [...byKey.values()];
}

function workerEnvFields(envs: WorkerEnv[]) {
  const fields: ResourceFields = {};
  for (const env of envs) {
    let value: FieldNode = { type: "hidden" };
    if (env.value) {
      value = { type: "secret", value: redactSensitiveValue(env.value) };
    }
    fields[env.key] = value;
  }
  return fields;
}

function bindingReferences(bindings: WorkerBinding[], name: string) {
  const values: Array<string | null | undefined> = [];
  for (const binding of bindings) {
    const type = binding.type?.toLowerCase();
    if (type === "plain_text" || type === "secret_text") continue;
    const script = binding.script_name ?? name;
    values.push(
      binding.namespace_id,
      binding.database_id,
      binding.id,
      binding.bucket_name,
      binding.index_name,
      binding.queue_name,
      binding.service,
      binding.workflow_name,
      binding.class_name ? `${script}:${binding.class_name}` : null,
    );
  }
  return refReferences(values, "binding");
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

function r2Domains(custom: R2CustomDomains) {
  if (!custom.domains) return [];
  return custom.domains
    .map((row) => row.domain)
    .filter((domain): domain is string => Boolean(domain));
}

async function r2Cors(
  client: CloudflareCtx["client"],
  bucketName: string,
  account: CloudflareCtx["account"],
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

async function scrapeWorkerSecrets(
  ctx: CloudflareCtx,
  scriptName: string,
  bindings: WorkerBinding[],
) {
  // Settings omit secret_text values. The secrets API lists names and may return text.
  const listed = await settled(
    () =>
      collect(ctx.client.workers.scripts.secrets.list(scriptName, ctx.account)),
    [],
  );
  const secrets: WorkerSecret[] = [];
  for (const row of listed) {
    const parsed = parseWorkerSecret(row);
    if (parsed) secrets.push(parsed);
  }

  const envs = mergeWorkerEnvs(bindings, secrets);
  const missing = envs.filter(
    (env) => env.type === "secret_text" && !env.value,
  );
  await mapPool(missing, DETAIL_CONCURRENCY, async (env) => {
    const got = await settled(
      () =>
        ctx.client.workers.scripts.secrets.get(env.key, {
          account_id: ctx.accountId,
          script_name: scriptName,
        }),
      null,
    );
    if (!got) return;
    const parsed = parseWorkerSecret(got);
    if (parsed?.text) env.value = parsed.text;
  });
  return envs;
}

async function scrapeRoutes(ctx: CloudflareCtx) {
  const zones = await ctx.zones();
  const byScript = new Map<string, string[]>();
  await mapPool(zones, DETAIL_CONCURRENCY, async (zone) => {
    const routes = await collect(ctx.client.workers.routes.list({ zone_id: zone.id }));
    for (const route of routes) {
      if (!route.script) continue;
      const list = byScript.get(route.script) ?? [];
      list.push(route.pattern);
      byScript.set(route.script, list);
    }
  });
  return byScript;
}

export const workerScanner: Scanner<CloudflareCtx> = {
  key: "worker",
  version: 1,
  ttlMs: HOUR_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing workers" });
    const listedWorkers = await collect(
      ctx.client.workers.scripts.list(ctx.account),
    );
    const betaWorkers =
      listedWorkers.length > 0
        ? []
        : await collect(ctx.client.workers.beta.workers.list(ctx.account));

    const workers: Array<{ name: string; revision?: string }> = [];
    for (const worker of [...listedWorkers, ...betaWorkers]) {
      const name = workerName(worker);
      if (name) workers.push({ name, revision: workerRevision(worker) });
    }

    // Settings and secrets are N+1 calls; skip them when the script is unchanged.
    const details = new Map<
      string,
      { fields: ResourceFields; alerts: ResourceAlert[]; references: Reference[] }
    >();
    let reused = 0;
    await mapPool(workers, DETAIL_CONCURRENCY, async ({ name, revision }) => {
      const cached = run.previous.get(
        idFor(run.namespace, ctx.accountId, "worker", name),
      );
      if (revision && cached?.revision === revision) {
        const environment = cached.resource.fields.Environment;
        details.set(name, {
          fields: environment ? { Environment: environment } : {},
          alerts: cached.resource.alerts,
          references: cached.references,
        });
        reused += 1;
        return;
      }

      const settings = await settled(
        () =>
          ctx.client.workers.scripts.scriptAndVersionSettings.get(
            name,
            ctx.account,
          ),
        null,
      );
      const bindings = settings
        ? (parseWorkerSettings(settings)?.bindings ?? [])
        : [];
      const envs = await scrapeWorkerSecrets(ctx, name, bindings);
      const envFields = workerEnvFields(envs);
      details.set(name, {
        fields:
          Object.keys(envFields).length > 0
            ? { Environment: { fields: envFields } }
            : {},
        alerts: sensitiveVarAlerts(envs, ctx.policy),
        references: [
          ...envReferences(
            envs.map((env) => ({
              value: env.value,
              secret: env.type === "secret_text",
            })),
          ),
          ...bindingReferences(bindings, name),
        ],
      });
    });
    if (reused > 0) {
      run.step({ message: `Reused details for ${reused} unchanged workers` });
    }

    run.step({ message: "Listing worker domains and routes" });
    const [workerDomains, workersSubdomain, routes] = await Promise.all([
      collect(ctx.client.workers.domains.list(ctx.account)),
      settled(() => ctx.client.workers.subdomains.get(ctx.account), {
        subdomain: "",
      }),
      scrapeRoutes(ctx),
    ]);

    const entries: LinkEntry[] = [];
    for (const { name, revision } of workers) {
      const hosts: string[] = [];
      for (const row of workerDomains) {
        if (row.service !== name) continue;
        if (row.hostname) hosts.push(row.hostname);
      }
      const patterns = routes.get(name) ?? [];
      if (hosts.length === 0 && patterns.length === 0 && workersSubdomain.subdomain) {
        hosts.push(`${name}.${workersSubdomain.subdomain}.workers.dev`);
      }
      const detail = details.get(name);
      const exposes: Exposure[] = [
        ...hostExposures(hosts),
        ...refExposures([name], name),
      ];
      for (const pattern of patterns) {
        const host = hostOf(pattern);
        if (host) exposes.push({ type: "host", value: host, label: pattern });
      }

      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "worker", name),
          group: run.namespace,
          name,
          url: `https://dash.cloudflare.com/${ctx.accountId}/workers/services/view/${encodeURIComponent(name)}/production/observability/events`,
          service: "Worker",
          asset: iconForKind("Worker"),
          fields: {
            ...(hosts.length > 0 ? { Domains: hosts } : {}),
            ...(patterns.length > 0 ? { Routes: patterns } : {}),
            ...detail?.fields,
          },
          alerts: detail?.alerts ?? [],
          tags: { namespace: run.namespace },
        },
        exposes,
        references: detail?.references ?? [],
        ...(revision ? { revision } : {}),
      });
    }
    return entries;
  },
};

export const dnsScanner: Scanner<CloudflareCtx> = {
  key: "dns",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing zones" });
    const zones = await ctx.zones();
    run.step({ message: `Listing DNS records for ${zones.length} zones` });

    const byHost = new Map<
      string,
      { zone: string; records: Array<{ type: string; content: string; proxied: boolean }> }
    >();
    await mapPool(zones, DETAIL_CONCURRENCY, async (zone) => {
      const rows = await collect(ctx.client.dns.records.list({ zone_id: zone.id }));
      for (const row of rows) {
        const record = parseDnsRecord(row);
        if (!record || !DNS_RECORD_TYPES.has(record.type)) continue;
        const host = record.name.toLowerCase();
        const existing = byHost.get(host) ?? { zone: zone.name, records: [] };
        existing.records.push({
          type: record.type,
          content: record.content ?? "",
          proxied: record.proxied ?? false,
        });
        byHost.set(host, existing);
      }
    });

    const entries: LinkEntry[] = [];
    for (const [host, { zone, records }] of byHost) {
      const references: Reference[] = [{ type: "host", value: host, kind: "dns" }];
      for (const record of records) {
        if (record.type !== "CNAME") continue;
        const target = hostOf(record.content);
        if (target) references.push({ type: "host", value: target, kind: "dns" });
      }
      const proxied = records.some((record) => record.proxied);
      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "dns", host),
          group: run.namespace,
          name: host,
          url: `https://dash.cloudflare.com/${ctx.accountId}/${encodeURIComponent(zone)}/dns/records`,
          service: "DNS",
          asset: iconForKind("DNS"),
          fields: {
            Zone: zone,
            Proxied: proxied,
            Records: table({
              columns: ["Type", "Content", "Proxied"],
              rows: records.map((record) => ({
                Type: record.type,
                Content: record.content,
                Proxied: record.proxied ? "yes" : "no",
              })),
            }),
          },
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: [{ type: "host", value: host, label: host, entry: true }],
        references,
      });
    }
    return entries;
  },
};

export const durableObjectScanner: Scanner<CloudflareCtx> = {
  key: "durable-object",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing durable objects" });
    const namespaces = await collect(
      ctx.client.durableObjects.namespaces.list(ctx.account),
    );
    const entries: LinkEntry[] = [];
    for (const namespaceDo of namespaces) {
      const doId = namespaceDo.id;
      if (!doId) continue;
      const name = namespaceDo.name ?? namespaceDo.class ?? doId;
      const classRef =
        namespaceDo.script && namespaceDo.class
          ? `${namespaceDo.script}:${namespaceDo.class}`
          : null;
      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "do", doId),
          group: run.namespace,
          name,
          url: `https://dash.cloudflare.com/${ctx.accountId}/workers/durable-objects/view/${encodeURIComponent(doId)}`,
          service: "Durable Object",
          asset: iconForKind("Durable Object"),
          fields: {},
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: refExposures(
          [doId, namespaceDo.name, namespaceDo.class, classRef],
          name,
        ),
        references: [],
      });
    }
    return entries;
  },
};

export const workflowScanner: Scanner<CloudflareCtx> = {
  key: "workflow",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing workflows" });
    const workflows = await collect(ctx.client.workflows.list(ctx.account));
    return mapPoolCollect(workflows, DETAIL_CONCURRENCY, async (workflow) => {
      const name = workflow.name;
      if (!name || !workflow.id) return null;

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

      const nodes =
        graph?.graph?.workflow?.nodes ??
        graph?.graph?.nodes ??
        graph?.workflow?.nodes ??
        graph?.nodes ??
        null;
      const fields: ResourceFields = {};
      if (workflow.script_name) fields.Script = workflow.script_name;
      if (nodes && nodes.length > 0) fields.Steps = workflowNodesToGraph(nodes);

      return {
        resource: {
          id: idFor(run.namespace, ctx.accountId, "workflow", workflow.id),
          group: run.namespace,
          name,
          url: "",
          service: "Workflow",
          asset: iconForKind("Workflow"),
          fields,
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: refExposures([name, workflow.id], name),
        references: [],
      } satisfies LinkEntry;
    });
  },
};

export const kvScanner: Scanner<CloudflareCtx> = {
  key: "kv",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing KV namespaces" });
    const namespaces = await collect(ctx.client.kv.namespaces.list(ctx.account));
    const entries: LinkEntry[] = [];
    for (const kv of namespaces) {
      const title = kv.title ?? kv.id;
      if (!kv.id || !title) continue;
      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "kv", kv.id),
          group: run.namespace,
          name: title,
          url: "",
          service: "KV",
          asset: iconForKind("KV"),
          fields: {},
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: refExposures([kv.id, title], title),
        references: [],
      });
    }
    return entries;
  },
};

export const d1Scanner: Scanner<CloudflareCtx> = {
  key: "d1",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing D1 databases" });
    const databases = await collect(ctx.client.d1.database.list(ctx.account));
    const entries: LinkEntry[] = [];
    for (const db of databases) {
      if (!db.uuid || !db.name) continue;
      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "d1", db.uuid),
          group: run.namespace,
          name: db.name,
          url: "",
          service: "D1",
          asset: iconForKind("D1"),
          fields: {},
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: refExposures([db.uuid, db.name], db.name),
        references: [],
      });
    }
    return entries;
  },
};

export const r2Scanner: Scanner<CloudflareCtx> = {
  key: "r2",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing R2 buckets" });
    const listed = await settled(
      () => ctx.client.r2.buckets.list({ ...ctx.account, per_page: 100 }),
      { buckets: [] },
    );
    return mapPoolCollect(listed.buckets ?? [], DETAIL_CONCURRENCY, async (bucket) => {
      const name = bucket.name;
      if (!name) return null;

      const [customRaw, corsRaw] = await Promise.all([
        settled(
          () => ctx.client.r2.buckets.domains.custom.list(name, ctx.account),
          null,
        ),
        settled(() => r2Cors(ctx.client, name, ctx.account), null),
      ]);
      const custom = customRaw ? parseR2CustomDomains(customRaw) : null;
      const cors = corsRaw ? parseR2Cors(corsRaw) : null;
      const domains = custom ? r2Domains(custom) : [];
      const corsRules = cors ? formatCors(cors) : [];

      return {
        resource: {
          id: idFor(run.namespace, ctx.accountId, "r2", name),
          group: run.namespace,
          name,
          url: "",
          service: "R2",
          asset: iconForKind("R2"),
          fields: {
            ...(domains.length > 0 ? { Domains: domains } : {}),
            "S3 API URL": `https://${ctx.accountId}.r2.cloudflarestorage.com/${name}`,
            ...(corsRules.length > 0 ? { CORS: corsRules } : {}),
          },
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: [
          ...refExposures([name], name),
          ...hostExposures(
            domains,
            cors ? { allowedOrigins: r2CorsOrigins(cors) } : {},
          ),
        ],
        references: [],
      } satisfies LinkEntry;
    });
  },
};

export const vectorizeScanner: Scanner<CloudflareCtx> = {
  key: "vectorize",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing Vectorize indexes" });
    const indexes = await collect(ctx.client.vectorize.indexes.list(ctx.account));
    const entries: LinkEntry[] = [];
    for (const index of indexes) {
      if (!index.name) continue;
      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "vectorize", index.name),
          group: run.namespace,
          name: index.name,
          url: "",
          service: "Vectorize",
          asset: iconForKind("Vectorize"),
          fields: {},
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: refExposures([index.name], index.name),
        references: [],
      });
    }
    return entries;
  },
};

export const queueScanner: Scanner<CloudflareCtx> = {
  key: "queue",
  version: 1,
  ttlMs: DEFAULT_TTL_MS,
  async scan(ctx, run) {
    run.step({ message: "Listing queues" });
    const queues = await collect(ctx.client.queues.list(ctx.account));
    const entries: LinkEntry[] = [];
    for (const queue of queues) {
      const name = queue.queue_name;
      const queueId = queue.queue_id ?? name;
      if (!name || !queueId) continue;
      const consumers: string[] = [];
      for (const consumer of queue.consumers ?? []) {
        if ("script_name" in consumer && consumer.script_name) {
          consumers.push(consumer.script_name);
        }
      }
      entries.push({
        resource: {
          id: idFor(run.namespace, ctx.accountId, "queue", queueId),
          group: run.namespace,
          name,
          url: "",
          service: "Queue",
          asset: iconForKind("Queue"),
          fields: consumers.length > 0 ? { Consumers: consumers } : {},
          alerts: [],
          tags: { namespace: run.namespace },
        },
        exposes: refExposures([name, queueId], name),
        // Messages flow from the queue to its consumer workers.
        references: refReferences(consumers, "binding"),
      });
    }
    return entries;
  },
};

async function listAccountIds(client: Cloudflare) {
  const accountIds: string[] = [];
  const seen = new Set<string>();
  for (let page = 1; ; page += 1) {
    const result = await client.accounts.list({ page });
    let added = 0;
    for (const account of result.result) {
      if (!account.id || seen.has(account.id)) continue;
      seen.add(account.id);
      accountIds.push(account.id);
      added += 1;
    }
    if (added === 0) break;
  }
  if (accountIds.length === 0) {
    throw new Error("Cloudflare token has no accessible accounts");
  }
  return accountIds;
}

export function cloudflare(options: {
  namespace: string;
  apiToken: string;
  policy?: typeof WORKER_DEFAULT_POLICY;
}) {
  const client = new Cloudflare({ apiToken: options.apiToken });
  return defineProvider<CloudflareCtx>({
    id: "cloudflare",
    namespace: options.namespace,
    scanners: [
      workerScanner,
      dnsScanner,
      durableObjectScanner,
      workflowScanner,
      kvScanner,
      d1Scanner,
      r2Scanner,
      vectorizeScanner,
      queueScanner,
    ],
    async accounts(step) {
      step({ message: "Listing accounts" });
      const accountIds = await listAccountIds(client);
      return accountIds.map((accountId) => {
        let zones: Promise<Array<{ id: string; name: string }>> | null = null;
        return {
          account: accountId,
          ctx: {
            client,
            accountId,
            account: { account_id: accountId },
            policy: options.policy ?? WORKER_DEFAULT_POLICY,
            zones() {
              zones ??= collect(
                client.zones.list({ account: { id: accountId } }),
              ).then((rows) => rows.map((zone) => ({ id: zone.id, name: zone.name })));
              return zones;
            },
          },
        };
      });
    },
  });
}
