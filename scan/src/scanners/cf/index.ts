import type { CloudflareProvider } from "../../providers.js";
import type { ScannedService } from "../../schema.js";
import type { ScanOutcome, ServiceScanner } from "../types.js";
import { scrapeCloudflare } from "./scrape.js";

/**
 * Cloudflare account scanner.
 *
 * Pipeline:
 *   1. Scan and Transform — pull CF resources into {@link ScannedService} rows
 *      (`group` is the provider namespace, set in scrape)
 *   2. Group — normalize empty cluster labels
 */
export class CloudflareScanner implements ServiceScanner {
  constructor(private readonly providers: CloudflareProvider[]) {}

  async scan(): Promise<ScanOutcome> {
    const { services, warnings } = await scrapeCloudflare(this.providers);
    return { services: normalizeGroups(services), warnings };
  }
}

/** Ensure every service has a non-empty group label used as a layout cluster. */
function normalizeGroups(services: ScannedService[]): ScannedService[] {
  return services.map((service) => {
    const group = service.group.trim() || "default";
    if (group === service.group) return service;
    return { ...service, group };
  });
}
