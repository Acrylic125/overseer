import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadEnv } from "dotenv";

import { layoutServices } from "./layout-service.js";
import { transformProviders } from "./providers.js";
import { infrastructureDbSchema, type InfrastructureDb } from "./schema.js";
import { CloudflareScanner } from "./scanners/cf-scanner.js";

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

  const scanner = new CloudflareScanner(providers);
  const { services, warnings } = await scanner.scan();
  const layout = layoutServices(services);

  const db: InfrastructureDb = infrastructureDbSchema.parse({
    version: 1 as const,
    scannedAt: new Date().toISOString(),
    services,
    resources: layout.resources,
    scene: layout.scene,
    warnings,
  });

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");

  const platforms = db.resources.filter((r) => r.type === "platform").length;
  const icons = db.resources.filter((r) => r.type === "icon").length;
  const connectors = db.resources.filter((r) => r.type === "connector").length;

  console.log(
    `[scan] wrote ${db.services.length} services → ${outPath}` +
      ` (${platforms} platforms, ${icons} icons, ${connectors} connectors` +
      `, ${layout.scene.connectorSegments.length} segments)` +
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
