import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  infrastructureDbSchema,
  type InfrastructureDb,
} from "@/lib/infrastructure-schema";
import {
  layoutOutputSchema,
  layoutOutputToDb,
} from "@/lib/layout-output-to-db";

export * from "@/lib/infrastructure-schema";

function resolveDbPath() {
  if (process.env.INFRASTRUCTURE_DB_PATH) {
    return path.resolve(process.env.INFRASTRUCTURE_DB_PATH);
  }
  // Next.js runs with cwd = ui/
  return path.resolve(process.cwd(), "public", "infrastructure.json");
}

/**
 * Load and zod-parse the JSON database produced by `scan`.
 */
export async function loadInfrastructureDb(): Promise<InfrastructureDb> {
  const dbPath = resolveDbPath();
  let raw: string;
  try {
    raw = await readFile(dbPath, "utf8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code === "ENOENT") {
      throw new Error(
        `Infrastructure database not found at ${dbPath}. Run \`pnpm scan\` in the scan/ package.`,
      );
    }
    throw error;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Infrastructure database at ${dbPath} is not valid JSON.`);
  }

  const legacy = infrastructureDbSchema.safeParse(json);
  if (legacy.success) {
    return legacy.data;
  }

  const layout = layoutOutputSchema.safeParse(json);
  if (layout.success) {
    return layoutOutputToDb(layout.data);
  }

  const detail = [...legacy.error.issues, ...layout.error.issues]
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
  throw new Error(
    `Infrastructure database failed schema validation (${dbPath}): ${detail}`,
  );
}
