import type { ScannedService } from "../schema.js";

/** One environment variable captured during scrape (raw value, pre-redaction). */
export type ScrapedEnvVar = {
  key: string;
  /** Raw value used for domain linking; may be empty for secrets. */
  value: string;
  type: string;
  target?: string[];
  comment?: string;
  gitBranch?: string;
  system?: boolean;
  id?: string;
  visibility?: string;
  decrypted?: boolean;
};

/** Shared identity on every scraped resource. */
type ScrapedBase = {
  id: string;
  name: string;
  /** Group path (usually provider namespace). */
  group: string;
};

export type ScrapedCfWorker = ScrapedBase & {
  kind: "cf-worker";
  domains: string[];
  envs: ScrapedEnvVar[];
  connections: string[];
  logUrl: string;
};

export type ScrapedCfKv = ScrapedBase & {
  kind: "cf-kv";
  namespaceId: string;
};

export type ScrapedCfD1 = ScrapedBase & {
  kind: "cf-d1";
  databaseId: string;
};

export type ScrapedCfR2 = ScrapedBase & {
  kind: "cf-r2";
  domains: string[];
  /** Managed public bucket and/or an enabled custom domain. */
  openToInternet: boolean;
  s3ApiUrl: string;
  cors: string[];
};

export type ScrapedCfVectorize = ScrapedBase & {
  kind: "cf-vectorize";
};

export type ScrapedCfQueue = ScrapedBase & {
  kind: "cf-queue";
  queueId: string;
};

export type ScrapedVercelProject = ScrapedBase & {
  kind: "vercel-project";
  domains: string[];
  envs: ScrapedEnvVar[];
};

export type ScrapedAzureEntraSecret = {
  /** Portal "Description" column (`passwordCredentials.displayName` in Graph). */
  description: string;
  /**
   * Hint from Graph (typically first 3 chars of the secret).
   * Full secret values are never returned after creation.
   */
  hint: string | null;
  /** ISO expiry timestamp from Graph (`endDateTime`). */
  expiresAt: string | null;
};

export type ScrapedAzureEntra = ScrapedBase & {
  kind: "azure-entra";
  applicationId: string;
  directoryId: string;
  /** Redirect URIs from web / spa / publicClient. */
  redirectUris: string[];
  secrets: ScrapedAzureEntraSecret[];
};

/** Discriminated by `kind` — only the fields that service actually has. */
export type ScrapedResource =
  | ScrapedCfWorker
  | ScrapedCfKv
  | ScrapedCfD1
  | ScrapedCfR2
  | ScrapedCfVectorize
  | ScrapedCfQueue
  | ScrapedVercelProject
  | ScrapedAzureEntra;

/** Aggregated scrape results for one provider. */
export type ScrapeContext = {
  resources: ScrapedResource[];
  warnings: string[];
};

/** Final scan output after transform + cross-provider finalize. */
export type ScanOutcome = {
  services: ScannedService[];
  warnings: string[];
};

/**
 * Provider scanner facade. New providers implement this in their scrape file:
 *   1. `probe(provider)` — token check; `null` if scannable, else a reason
 *   2. `scrape()` — emit {@link ScrapedResource} rows
 *   3. `transform(ctx)` — map resources → {@link ScannedService}
 *
 * Cross-provider env→domain links run later via `finalizeScan`.
 */
export interface ServiceScanner {
  scrape(): Promise<ScrapeContext>;
  transform(ctx: ScrapeContext): ScannedService[];
}
