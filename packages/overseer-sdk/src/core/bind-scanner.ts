import type { ProviderResourceScanner } from "../types.js";
import type { LinkEntry } from "./link.js";

export type BoundScanner<
  TArgs extends unknown[],
  TPolicy = undefined,
> = {
  scrape: (...args: TArgs) => Promise<readonly object[]> | readonly object[];
  link: (
    items: readonly object[],
    namespace: string,
    policy?: TPolicy,
  ) => LinkEntry[];
};

export function bindScanner<
  T extends object,
  TArgs extends unknown[],
  TPolicy,
>(
  scanner: ProviderResourceScanner<T, TArgs, TPolicy>,
): BoundScanner<TArgs, TPolicy> {
  return {
    scrape: (...args: TArgs) => scanner.scrape(...args),
    link(items, namespace, policy) {
      const entries: LinkEntry[] = [];
      const effectivePolicy = policy ?? scanner.policy;
      for (const item of items as T[]) {
        const resource = scanner.transform(item, namespace, effectivePolicy);
        if (!resource) continue;
        entries.push({ resource, connection: scanner.connection(item) });
      }
      return entries;
    },
  };
}
