import { scrapeCloudflare } from "./cf/scrape.js";
import type { CloudflareProvider } from "../providers.js";
import type { ScannedService } from "../schema.js";
import type { ScanOutcome, ServiceScanner } from "./types.js";

/**
 * Cloudflare account scanner.
 *
 * Pipeline:
 *   1. Scan and Transform — pull CF resources into {@link ScannedService} rows
 *      (`group` is already the provider namespace from fetch)
 *   2. Group — normalize empty cluster labels
 */
export class CloudflareScanner implements ServiceScanner {
  constructor(private readonly providers: CloudflareProvider[]) {}

  async scan(): Promise<ScanOutcome> {
    // 1. Scan and Transform
    const { services, warnings } = await scrapeCloudflare(this.providers);

    // 2. Group
    const grouped = normalizeGroups(services);

    return { services: grouped, warnings };
  }
}

/** Ensure every service has a non-empty group label used as a layout cluster. */
function normalizeGroups(services: ScannedService[]): ScannedService[] {
  return services.map((service) => {
    const group = service.group?.trim() ?? "default";
    if (group === service.group) return service;
    return { ...service, group };
  });
}
