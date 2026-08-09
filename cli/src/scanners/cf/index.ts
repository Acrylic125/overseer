import { ensureInternetLinks, isInternetService } from "../../internet.js";
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
 *   2. Group — normalize empty cluster labels (internet keeps `group: null`)
 *   3. Internet — ensure the hub service exists; link publicly reachable resources
 */
export class CloudflareScanner implements ServiceScanner {
  constructor(private readonly providers: CloudflareProvider[]) {}

  async scan(): Promise<ScanOutcome> {
    const { services, warnings } = await scrapeCloudflare(this.providers);
    return {
      services: ensureInternetLinks(normalizeGroups(services)),
      warnings,
    };
  }
}

/** Ensure every grouped service has a non-empty cluster label. */
function normalizeGroups(services: ScannedService[]): ScannedService[] {
  return services.map((service) => {
    if (isInternetService(service) || service.group == null) return service;
    const group = service.group.trim() || "default";
    if (group === service.group) return service;
    return { ...service, group };
  });
}
