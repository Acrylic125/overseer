import { createMockServices } from "../mock.js";
import { runLayout } from "../pipeline/layout/index.js";
import { writeInfrastructureDb } from "../pipeline/output.js";
import { elapsed, log } from "../cli/log.js";
import { resolveOutDir } from "../paths.js";

export type MockOptions = {
  outDir?: string;
};

/** Synthetic infrastructure.json — same layout/output path as live scan. */
export async function runMock(options: MockOptions = {}): Promise<void> {
  const outDir = resolveOutDir(options.outDir);

  log.banner();
  log.start("Generating mock...");

  try {
    log.section("Mock services");
    log.step("Generating");
    const start = Date.now();
    const services = createMockServices();
    log.step(`${services.length} services (${elapsed(start)})`);

    const layout = await runLayout(services);
    await writeInfrastructureDb({
      layout,
      warnings: ["Generated from scan/src/mock.ts"],
      outDir,
    });

    log.done("Mock Complete!");
  } catch (error) {
    log.stop();
    throw error;
  }
}
