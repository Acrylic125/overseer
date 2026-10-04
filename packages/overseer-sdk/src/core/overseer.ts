import { createHash } from "node:crypto";

import type { Cache } from "./cache.js";
import { createGraph } from "./graph.js";
import { linkEntries } from "./link.js";
import type { Provider, ProviderScope } from "./provider.js";
import { mapPool, type ScrapeStepFn } from "./scrape-async.js";
import type { GraphSnapshot, LinkEntry } from "./schemas.js";

const SCOPE_CONCURRENCY = 3;

type ScopeTarget = { provider: string; namespace: string; scanner?: string; account?: string };

/** `provider`, `provider:namespace` or `provider:namespace/scanner`. */
function parseFilter(filter: string) {
  const parts = filter.trim().split("/");
  if (parts.length > 3 || parts.some((part) => !part)) throw new Error(`Invalid scope filter: ${filter}`);
  const [provider = "", namespace] = parts[0]!.split(":");
  const scanner = parts.at(-1) === parts[0] ? undefined : parts.at(-1);
  const account = parts.length === 3 ? parts[1] : undefined;
  return { provider, namespace, scanner, account };
}

function matches(filter: ReturnType<typeof parseFilter>, target: ScopeTarget) {
  if (filter.provider !== target.provider) return false;
  if (filter.namespace && filter.namespace !== target.namespace) return false;
  if (filter.account && target.account && filter.account !== target.account) return false;
  if (filter.scanner && target.scanner && filter.scanner !== target.scanner) {
    return false;
  }
  return true;
}

function fingerprints(entries: LinkEntry[]) {
  const out: Record<string, { name: string; hash: string }> = {};
  for (const entry of entries) {
    out[entry.resource.id] = {
      name: entry.resource.name,
      hash: createHash("sha1").update(JSON.stringify(entry)).digest("hex"),
    };
  }
  return out;
}

export function overseer(config: { providers?: Provider[]; cache: Cache }) {
  const { providers = [], cache } = config;

  async function snapshot(): Promise<GraphSnapshot> {
    const { entries: cached, invalid } = await cache.list();
    const configured = new Set(
      providers.map((provider) => `${provider.id}:${provider.namespace}`),
    );
    const active = cached.filter((entry) =>
      providers.length === 0 || configured.has(`${entry.provider}:${entry.namespace}`),
    );
    const entries = active.flatMap((entry) => entry.entries);

    const changes: GraphSnapshot["changes"] = {};
    const removed: GraphSnapshot["removed"] = [];
    for (const cacheEntry of active) {
      const before = cacheEntry.previous?.resources;
      if (!before) {
        for (const entry of cacheEntry.entries) changes[entry.resource.id] = "added";
        continue;
      }
      const current = fingerprints(cacheEntry.entries);
      for (const [id, print] of Object.entries(current)) {
        const old = before[id];
        if (!old) changes[id] = "added";
        else if (old.hash !== print.hash) changes[id] = "modified";
      }
      for (const [id, print] of Object.entries(before)) {
        if (current[id]) continue;
        removed.push({ id, name: print.name, scope: cacheEntry.scope });
      }
    }

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      warnings: invalid.map(
        (name) => `cache:${name}: failed validation, re-scraped on next sync`,
      ),
      scopes: active.map((entry) => ({
        scope: entry.scope,
        scrapedAt: entry.scrapedAt,
      })),
      resources: entries.map((entry) => entry.resource),
      changes,
      removed,
      edges: linkEntries(entries),
    };
  }

  return {
    /**
     * Scrape only scopes that are stale (older than the scanner TTL), unknown,
     * or on an outdated scanner version. `only` narrows which scopes are
     * considered; `force` ignores freshness.
     */
    async sync(
      options: { only?: string[]; force?: boolean; onStep?: ScrapeStepFn } = {},
    ) {
      const step = options.onStep ?? (() => {});
      const filters = (options.only ?? []).map(parseFilter);
      for (const filter of filters) {
        const matchesProvider = providers.some((provider) => matches(filter, { provider: provider.id, namespace: provider.namespace }) && (!filter.scanner || provider.scanners.includes(filter.scanner)));
        if (!matchesProvider) throw new Error(`No configured scanner matches ${filter.provider}:${filter.namespace ?? "*"}/${filter.scanner ?? "*"}`);
      }
      const wants = (target: ScopeTarget) =>
        filters.length === 0 || filters.some((filter) => matches(filter, target));

      const { entries: cached } = await cache.list();
      const cachedByScope = new Map(cached.map((entry) => [entry.scope, entry]));
      const now = Date.now();
      const result = {
        scraped: [] as string[],
        fresh: [] as string[],
        failed: [] as Array<{ scope: string; error: string }>,
      };

      for (const provider of providers) {
        if (!wants({ provider: provider.id, namespace: provider.namespace })) {
          continue;
        }
        const label = `${provider.id}:${provider.namespace}`;
        let scopes: ProviderScope[];
        try {
          scopes = await provider.discover((s) =>
            step({ message: `${label}: ${s.message}` }),
          );
        } catch (error) {
          result.failed.push({
            scope: label,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const due = scopes.filter((scope) => {
          if (!wants(scope)) return false;
          const existing = cachedByScope.get(scope.scope);
          if (options.force || !existing) return true;
          if (existing.scannerVersion !== scope.scannerVersion) return true;
          if (now - Date.parse(existing.scrapedAt) >= scope.ttlMs) return true;
          result.fresh.push(scope.scope);
          return false;
        });

        await mapPool(due, SCOPE_CONCURRENCY, async (scope) => {
          const existing = cachedByScope.get(scope.scope);
          const reusable =
            existing && existing.scannerVersion === scope.scannerVersion
              ? existing.entries
              : [];
          try {
            const entries = await scope.scan({
              previous: new Map(
                reusable.map((entry) => [entry.resource.id, entry]),
              ),
              step: (s) => step({ message: `${scope.scope}: ${s.message}` }),
            });
            await cache.write({
              version: 1,
              scope: scope.scope,
              provider: scope.provider,
              namespace: scope.namespace,
              account: scope.account,
              scanner: scope.scanner,
              scannerVersion: scope.scannerVersion,
              scrapedAt: new Date().toISOString(),
              entries,
              ...(existing
                ? {
                    previous: {
                      scrapedAt: existing.scrapedAt,
                      resources: fingerprints(existing.entries),
                    },
                  }
                : {}),
            });
            result.scraped.push(scope.scope);
          } catch (error) {
            result.failed.push({
              scope: scope.scope,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        });
      }

      return result;
    },
    /** Link cached scopes into a snapshot. No network access. */
    snapshot,
    async graph() {
      return createGraph(await snapshot());
    },
  };
}
