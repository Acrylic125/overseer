import type { ScannedService } from "../schema.js";

/** Result of a provider scanner run. */
export type ScanOutcome = {
  services: ScannedService[];
  warnings: string[];
};

/**
 * Provider-specific scanner.
 *
 * Implementations should follow:
 *   1. Scan and Transform
 *   2. Group
 */
export interface ServiceScanner {
  scan(): Promise<ScanOutcome>;
}
