import type {
  ConnectionContext,
  Resource,
  TransformContext,
} from "../types.js";
import { linkResources, type LinkEntry } from "./link.js";

export function scanEntries<T, TPolicy = undefined>(
  scanner: {
    policy?: TPolicy;
    transform: (item: T, ctx: TransformContext<TPolicy>) => Resource | null;
    connection: (
      item: T,
      ctx: ConnectionContext<TPolicy>,
    ) => LinkEntry["connection"];
  },
  items: T[],
  namespace: string,
) {
  const transformCtx: TransformContext<TPolicy> = {
    namespace,
    policy: scanner.policy,
  };
  const connectionCtx: ConnectionContext<TPolicy> = {
    policy: scanner.policy,
  };
  const entries = [];
  for (const item of items) {
    const resource = scanner.transform(item, transformCtx);
    if (!resource) continue;
    const entry: LinkEntry = {
      resource,
      connection: scanner.connection(item, connectionCtx),
    };
    entries.push(entry);
  }
  return entries;
}

export { linkResources as linkByReferences };
