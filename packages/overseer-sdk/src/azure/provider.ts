import { scanEntries } from "../core/scan.js";
import type { ScrapeStepFn } from "../core/scrape-async.js";
import { azureScanners, entraScanner } from "./scanners.js";

export type AzureProviderConfig = {
  namespace: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

export function newAzureProvider() {
  return {
    provider: "azure" as const,
    scanners: azureScanners,
    async scan(
      config: AzureProviderConfig,
      fn?: ScrapeStepFn,
    ) {
      const items = await entraScanner.scrape(
        config.tenantId,
        config.clientId,
        config.clientSecret,
        fn,
      );
      return scanEntries(entraScanner, items, config.namespace);
    },
  };
}
