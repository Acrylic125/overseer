import { mkdir, readdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { cacheEntrySchema, type CacheEntry } from "./schemas.js";

export type Cache = {
  list: () => Promise<{ entries: CacheEntry[]; invalid: string[] }>;
  write: (entry: CacheEntry) => Promise<void>;
};

function fileName(scope: string) {
  return `${Buffer.from(scope).toString("base64url")}.json`;
}

function isNotFound(error: Error) {
  return "code" in error && error.code === "ENOENT";
}

/** One JSON file per scope. Entries are already redacted by the scanners. */
export function fileCache(dir: string): Cache {
  return {
    async list() {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (error) {
        if (error instanceof Error && isNotFound(error)) {
          return { entries: [], invalid: [] };
        }
        throw error;
      }

      const entries: CacheEntry[] = [];
      const invalid: string[] = [];
      for (const name of names.filter((name) => name.endsWith(".json")).sort()) {
        const raw = await readFile(path.join(dir, name), "utf8");
        try {
          const parsed = cacheEntrySchema.safeParse(JSON.parse(raw));
          if (parsed.success) {
            entries.push(parsed.data);
            continue;
          }
        } catch {
          // Falls through to invalid; a corrupt file is re-scraped on next sync.
        }
        invalid.push(name);
      }
      return { entries, invalid };
    },
    async write(entry) {
      await mkdir(dir, { recursive: true });
      const validated = cacheEntrySchema.parse(entry);
      const destination = path.join(dir, fileName(entry.scope));
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(validated)}\n`, { mode: 0o600 });
        await rename(temporary, destination);
      } finally {
        await rm(temporary, { force: true });
      }
    },
  };
}
