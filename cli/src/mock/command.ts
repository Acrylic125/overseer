import { elapsed, log } from "../cli/log.js";
import { writeGraphSnapshot } from "../pipeline/output.js";
import { resolveOutDir } from "../paths.js";
import { createMockServices } from "./services.js";

export type MockOptions = {
  outDir?: string;
};

/** Synthetic graph.json — same output path as a live scan. */
export async function runMock(options: MockOptions = {}) {
  const outDir = resolveOutDir(options.outDir);

  log.banner();
  log.start("Generating mock...");

  try {
    log.section("Mock services");
    const start = Date.now();
    const snapshot = createMockServices();
    log.step(
      `${snapshot.resources.length} services · ${snapshot.edges.length} edges (${elapsed(start)})`,
    );
    await writeGraphSnapshot(snapshot, outDir);
    log.done("Mock Complete!");
  } catch (error) {
    log.stop();
    throw error;
  }
}
