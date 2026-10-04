import type { ScrapeStepFn } from "./scrape-async.js";
import type { LinkEntry } from "./schemas.js";

export type ScanRun = {
  namespace: string;
  /** Entries from the last scrape of this scope, keyed by resource id. */
  previous: Map<string, LinkEntry>;
  step: ScrapeStepFn;
};

export type Scanner<TCtx> = {
  key: string;
  /** Bump when the entry shape changes so cached scopes are re-scraped. */
  version: number;
  ttlMs: number;
  scan: (ctx: TCtx, run: ScanRun) => Promise<LinkEntry[]>;
};

export type ProviderScope = {
  scope: string;
  provider: string;
  namespace: string;
  account: string;
  scanner: string;
  scannerVersion: number;
  ttlMs: number;
  scan: (run: Omit<ScanRun, "namespace">) => Promise<LinkEntry[]>;
};

export type Provider = {
  id: string;
  namespace: string;
  scanners: string[];
  discover: (step: ScrapeStepFn) => Promise<ProviderScope[]>;
};

export const HOUR_MS = 60 * 60 * 1000;
export const DEFAULT_TTL_MS = 6 * HOUR_MS;

export function defineProvider<TCtx>(input: {
  id: string;
  namespace: string;
  scanners: Scanner<TCtx>[];
  accounts: (step: ScrapeStepFn) => Promise<Array<{ account: string; ctx: TCtx }>>;
}): Provider {
  return {
    id: input.id,
    namespace: input.namespace,
    scanners: input.scanners.map((scanner) => scanner.key),
    async discover(step) {
      const accounts = await input.accounts(step);
      const scopes: ProviderScope[] = [];
      for (const { account, ctx } of accounts) {
        for (const scanner of input.scanners) {
          scopes.push({
            scope: `${input.id}:${input.namespace}/${account}/${scanner.key}`,
            provider: input.id,
            namespace: input.namespace,
            account,
            scanner: scanner.key,
            scannerVersion: scanner.version,
            ttlMs: scanner.ttlMs,
            async scan(run) {
              const entries = await scanner.scan(ctx, { ...run, namespace: input.namespace });
              return entries.map((entry) => ({
                ...entry,
                resource: {
                  ...entry.resource,
                  tags: { ...entry.resource.tags, provider: input.id, account, namespace: input.namespace },
                },
              }));
            },
          });
        }
      }
      return scopes;
    },
  };
}
