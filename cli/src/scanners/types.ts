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

/** Durable Object namespace — same field surface as a Worker. */
export type ScrapedCfDurableObject = ScrapedBase & {
  kind: "cf-do";
  domains: string[];
  envs: ScrapedEnvVar[];
  connections: string[];
  logUrl: string;
  /** Hosting Worker script name, when known. */
  scriptName: string | null;
  className: string | null;
  namespaceId: string;
};

export type ScrapedCfWorkflow = ScrapedBase & {
  kind: "cf-workflow";
  connections: string[];
  /** Step graph from the latest deployed version, when available. */
  steps: {
    vertices: string[];
    edges: [string, string][];
  } | null;
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
  /** Entra object ID (`id` in Graph). */
  objectId: string;
  applicationId: string;
  directoryId: string;
  /** Redirect URIs from web / spa / publicClient. */
  redirectUris: string[];
  secrets: ScrapedAzureEntraSecret[];
};

/** Discriminated by `kind` — only the fields that service actually has. */
export type ScrapedResource =
  | ScrapedCfWorker
  | ScrapedCfDurableObject
  | ScrapedCfWorkflow
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
 * Provider scanner facade. Each provider implements probe, scrape, and transform
 * in its own module. Entra client-ID linking lives in azure/transform.ts.
 */
export interface ServiceScanner {
  scrape(): Promise<ScrapeContext>;
  transform(ctx: ScrapeContext): ScannedService[];
}
