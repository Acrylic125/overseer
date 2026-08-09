import { debug, debugError, elapsed } from "../cli/log.js";

export { elapsed };

/** Verbose API logs — only when OVERSEER_DEBUG=1. */
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
