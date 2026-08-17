export type ScrapeStepFn = (step: { message: string }) => void;

export async function collect<T>(iterable: AsyncIterable<T>, maxItems = 250) {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
    if (items.length >= maxItems) break;
  }
  return items;
}

export async function settled<T>(run: () => Promise<T>, fallback: T) {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

export async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
) {
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      const item = items[current];
      if (item !== undefined) await fn(item);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(items.length, 1)) },
      () => worker(),
    ),
  );
}

export async function mapPoolCollect<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R | null | undefined>,
) {
  const results: R[] = [];
  await mapPool(items, concurrency, async (item) => {
    const result = await fn(item);
    if (result == null) return;
    results.push(result);
  });
  return results;
}
