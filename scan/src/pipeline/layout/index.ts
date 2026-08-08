import type { ScannedService } from "../../schema.js";
import { elapsed, log } from "../../cli/log.js";
import { layoutServices, type LayoutResult } from "./pack.js";

export type { LayoutResult } from "./pack.js";
export { layoutServices } from "./pack.js";

/**
 * Step 3 — Pack services into platforms, icons, connectors.
 */
export async function runLayout(
  services: ScannedService[],
): Promise<LayoutResult> {
  log.section("Layout");
  log.start("Packing layout...");
  log.step("Packing platforms");

  const start = Date.now();
  const layout = await layoutServices(services);
  const duration = elapsed(start);

  const platforms = layout.pads.filter((p) => p.type === "platform").length;
  const nested = layout.pads.filter(
    (p) => p.type === "platform" && p.parent,
  ).length;

  log.step(
    `${platforms} platforms` +
      (nested ? ` (${nested} nested)` : "") +
      ` · ${layout.services.length} services · ${layout.connectors.length} connectors` +
      ` (${duration})`,
  );

  return layout;
}
