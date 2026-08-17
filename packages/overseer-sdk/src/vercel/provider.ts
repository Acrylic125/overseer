import { scanEntries } from "../core/scan.js";
import type { ScrapeStepFn } from "../core/scrape-async.js";
import { projectScanner, vercelScanners } from "./scanners.js";

export type VercelProviderConfig = {
  apiKey: string;
  namespace: string;
  teamId?: string;
};

export function newVercelProvider() {
  return {
    provider: "vercel" as const,
    scanners: vercelScanners,
    async scan(
      config: VercelProviderConfig,
      fn?: ScrapeStepFn,
    ) {
      const items = await projectScanner.scrape(
        config.apiKey,
        config.teamId,
        fn,
      );
      return scanEntries(projectScanner, items, config.namespace);
    },
  };
}
