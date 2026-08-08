import Cloudflare from "cloudflare";

import { debug, debugError, elapsed } from "../../cli/log.js";

export const REQUEST_TIMEOUT_MS = 8_000;
export const BINDING_TIMEOUT_MS = 5_000;
export const BINDING_CONCURRENCY = 3;

export { elapsed };

/** Verbose CF API logs — only when OVERSEER_DEBUG=1. */
export function log(message: string, extra?: Record<string, unknown>) {
  debug(message, extra);
}

export function logError(message: string, error: unknown) {
  debugError(message, error);
}

export function withTimeout<T>(
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

export async function settled<T>(
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

export function isAuthFailure(error: unknown): boolean {
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

export function isRateLimited(error: unknown): boolean {
  const text = errorText(error);
  return /\b429\b/.test(text) || text.includes("10502");
}

/** Cloudflare returns 404 / code 10059 when a bucket has no CORS policy yet. */
export function isMissingR2CorsConfig(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes("10059") ||
    text.includes("The CORS configuration does not exist")
  );
}

export function formatAuthFailure(namespace: string, error: unknown): string {
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

export function formatPermissionHint(error: string): string {
  if (
    error.includes("10000") ||
    error.includes("Authentication error") ||
    error.includes("403")
  ) {
    return `${error.split(":")[0]} — API token is missing permission (got 403)`;
  }
  return error;
}

export async function assertTokenUsable(
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

export async function collectPages<T>(
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

export async function getFirstAccount(client: Cloudflare) {
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

export async function mapPool<T>(
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
