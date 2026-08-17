import type { ScrapeStepFn } from "../core/scrape-async.js";
import { cloudflareScanners, scanCloudflare } from "./scanners.js";

export type CloudflareProviderConfig = {
  apiKey: string;
  namespace: string;
};

export function newCloudflareProvider() {
  return {
    provider: "cf" as const,
    scanners: cloudflareScanners,
    scan(
      config: CloudflareProviderConfig,
      fn?: ScrapeStepFn,
    ) {
      return scanCloudflare(config.apiKey, config.namespace, fn);
    },
  };
}
