import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { LayoutResult } from "./layout/index.js";
import { log } from "../cli/log.js";
import {
  ARTIFACT_INFRASTRUCTURE_JSON,
  artifactPath,
} from "../paths.js";
import {
  infrastructureDbSchema,
  type InfrastructureDb,
  type PlacedService,
} from "../schema.js";

export type WriteDbInput = {
  layout: LayoutResult;
  warnings: string[];
  /** Artifact directory (`_generated` or `--dir`). */
  outDir: string;
};

/** Drop empty `connections` / `connectionMeta` so the wire JSON stays sparse. */
function forWire(db: InfrastructureDb): InfrastructureDb {
  return {
    ...db,
    services: db.services.map((service) => {
      let next: PlacedService = service;
      if (service.connections.length === 0) {
        const { connections: _omit, ...rest } = next;
        next = rest as PlacedService;
      }
      if (
        !service.connectionMeta ||
        Object.keys(service.connectionMeta).length === 0
      ) {
        const { connectionMeta: _omitMeta, ...rest } = next;
        next = rest as PlacedService;
      }
      return next;
    }),
  };
}

/**
 * Step 4 — Validate and write `infrastructure.json` into the artifact dir.
 */
export async function writeInfrastructureDb(
  input: WriteDbInput,
): Promise<InfrastructureDb> {
  const outPath = artifactPath(input.outDir, ARTIFACT_INFRASTRUCTURE_JSON);
  log.section("Writing output");
  log.start("Writing output...");
  log.step(path.relative(process.cwd(), outPath) || ARTIFACT_INFRASTRUCTURE_JSON);

  const db: InfrastructureDb = infrastructureDbSchema.parse({
    version: 2 as const,
    scannedAt: new Date().toISOString(),
    services: input.layout.services,
    pads: input.layout.pads,
    connectors: input.layout.connectors,
    warnings: input.warnings,
  });

  await mkdir(input.outDir, { recursive: true });
  await writeFile(
    outPath,
    `${JSON.stringify(forWire(db), null, 2)}\n`,
    "utf8",
  );

  for (const warning of db.warnings) {
    log.warn(warning);
  }

  return db;
}
