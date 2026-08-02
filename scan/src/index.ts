import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import { scrapeCloudflare } from "./cloudflare/fetch.js";
import { transformProviders } from "./providers.js";
import { infrastructureDbSchema, type InfrastructureDb } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scanRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(scanRoot, "..");
const defaultOutPath = path.join(
  repoRoot,
  "ui",
  "data",
  "infrastructure.json",
);

// Prefer scan/.env, fall back to ui/.env (shared tokens).
loadEnv({ path: path.join(scanRoot, ".env") });
loadEnv({ path: path.join(repoRoot, "ui", ".env") });

async function main() {
  const outPath = process.argv[2]
    ? path.resolve(process.cwd(), process.argv[2])
    : defaultOutPath;

  const providers = transformProviders(process.env).filter(
    (p) => p.provider === "cf",
  );

  console.log(
    `[scan] providers: ${
      providers.length ? providers.map((p) => p.namespace).join(", ") : "(none)"
    }`,
  );

  const { services, warnings } = await scrapeCloudflare(providers);

  const db: InfrastructureDb = infrastructureDbSchema.parse({
    version: 1 as const,
    scannedAt: new Date().toISOString(),
    services,
    warnings,
  });

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");

  console.log(
    `[scan] wrote ${db.services.length} services → ${outPath}` +
      (db.warnings.length ? ` (${db.warnings.length} warnings)` : ""),
  );
  for (const warning of db.warnings) {
    console.warn(`[scan] warning: ${warning}`);
  }
}

main().catch((error) => {
  console.error("[scan] failed", error);
  process.exitCode = 1;
});
