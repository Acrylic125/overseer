import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  graphSnapshotSchema,
  type GraphSnapshot,
  type LayoutOutput,
} from "@acrylic125/overseer-sdk";
import { layout, type LayoutLens } from "@acrylic125/overseer-sdk/layout";

import { env } from "@/env";
import type { InfrastructureDb } from "@/lib/infrastructure-schema";
import {
  layoutOutputSchema,
  layoutOutputToDb,
} from "@/lib/layout-output-to-db";

function resolveGraphPath() {
  if (env.OVERSEER_GRAPH_PATH) return path.resolve(env.OVERSEER_GRAPH_PATH);
  // Next.js runs with cwd = ui/
  return path.resolve(process.cwd(), "public", "graph.json");
}

const glbPath = path.resolve(process.cwd(), "public", "assets.glb");

let snapshotCache: { mtimeMs: number; snapshot: GraphSnapshot } | null = null;
// Layout (packing + connector routing) is the expensive part; reuse it per lens
// until graph.json changes on disk.
const layoutCache = new Map<LayoutLens, InfrastructureDb>();
const previousLayouts = new Map<LayoutLens, LayoutOutput>();

export async function loadGraphSnapshot() {
  const graphPath = resolveGraphPath();
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(graphPath)).mtimeMs;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(
        `Graph not found at ${graphPath}. Run \`pnpm cli scan --dir ../ui/public\` or \`pnpm cli mock --dir ../ui/public\`.`,
      );
    }
    throw error;
  }
  if (snapshotCache?.mtimeMs === mtimeMs) return snapshotCache.snapshot;

  const raw = await readFile(graphPath, "utf8");
  let parsed: ReturnType<typeof graphSnapshotSchema.safeParse>;
  try {
    parsed = graphSnapshotSchema.safeParse(JSON.parse(raw));
  } catch {
    throw new Error(`Graph at ${graphPath} is not valid JSON.`);
  }
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Graph at ${graphPath} failed schema validation: ${detail}`);
  }

  snapshotCache = { mtimeMs, snapshot: parsed.data };
  layoutCache.clear();
  return parsed.data;
}

export async function loadInfrastructureDb(lens: LayoutLens) {
  const snapshot = await loadGraphSnapshot();
  const cached = layoutCache.get(lens);
  if (cached) return { db: cached, snapshot };

  const output = layout({
    resources: snapshot.resources,
    edges: snapshot.edges,
    glb: await readFile(glbPath),
    lens,
    previous: previousLayouts.get(lens),
  });
  const db = layoutOutputToDb(layoutOutputSchema.parse(output));
  if (snapshotCache?.snapshot === snapshot) {
    previousLayouts.set(lens, output);
    layoutCache.set(lens, db);
  }
  return { db, snapshot };
}
