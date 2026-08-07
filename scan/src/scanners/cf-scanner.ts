import { scrapeCloudflare } from "../cloudflare/fetch.js";
import type { CloudflareProvider } from "../providers.js";
import type { ScannedService } from "../schema.js";
import type { ScanOutcome, ServiceScanner } from "../scanner.js";

/**
 * Cloudflare account scanner.
 *
 * Pipeline:
 *   1. Scan and Transform — pull CF resources into {@link ScannedService} rows
 *   2. Group — normalize cluster (`group`) labels for layout
 */
export class CloudflareScanner implements ServiceScanner {
  constructor(private readonly providers: CloudflareProvider[]) {}

  async scan(): Promise<ScanOutcome> {
    // 1. Scan and Transform
    const { services, warnings } = await scrapeCloudflare(this.providers);

    // 2. Group
    const grouped = groupServices(services);

    return { services: grouped, warnings };
  }
}

/** Ensure every service has a non-empty group label used as a layout cluster. */
function groupServices(services: ScannedService[]): ScannedService[] {
  return services.map((service) => {
    const group = service.group.trim() || "default";
    if (group === service.group) return service;
    return { ...service, group };
  });
}
