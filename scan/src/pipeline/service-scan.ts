import { config as loadEnv } from "dotenv";

import { log } from "../cli/log.js";
import { envPath, uiEnvPath } from "../paths.js";
import { transformProviders } from "../providers.js";
import { CloudflareScanner } from "../scanners/cf/index.js";
import type { ScanOutcome } from "../scanners/types.js";

/** Load provider tokens (scan/.env first, then ui/.env). */
export function loadScanEnv(): void {
  loadEnv({ path: envPath });
  loadEnv({ path: uiEnvPath });
}

/**
 * Step 2 — Pull live provider resources into scanned services.
 */
export async function runServiceScan(): Promise<ScanOutcome> {
  loadScanEnv();

  const providers = transformProviders(process.env).filter(
    (p) => p.provider === "cf",
  );

  if (providers.length === 0) {
    log.section("Scanning Cloudflare");
    log.step("No providers configured");
    return {
      services: [],
      warnings: ["No Cloudflare providers configured (PROVIDER_CF_*_API_KEY)"],
    };
  }

  const scanner = new CloudflareScanner(providers);
  return scanner.scan();
}
