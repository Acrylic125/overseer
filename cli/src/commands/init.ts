import { confirm, input, select } from "@inquirer/prompts";
import path from "node:path";

import {
  applyPendingChanges,
  printUnifiedDiff,
  readEnvLines,
  writeEnvLines,
  type PendingEnvChange,
} from "./env-file.js";
import { envPath, repoRoot } from "../paths.js";

const CF_TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";
const VERCEL_TOKEN_URL = "https://vercel.com/account/tokens";
const AZURE_NEW_APP_URL =
  "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade";
const AZURE_APPS_URL =
  "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade";
const AZURE_PERM_DOCS_URL =
  "https://learn.microsoft.com/en-us/graph/permissions-reference#applicationreadall";
const AZURE_CONSENT_DOCS_URL =
  "https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent";
const AZURE_SECRET_DOCS_URL =
  "https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal#option-3-create-a-new-client-secret";
const NAMESPACE_RE = /^[a-zA-Z0-9_]+$/;

type ServiceType = "cf" | "vercel" | "azure";

function envKeyFor(service: Exclude<ServiceType, "azure">, namespace: string): string {
  switch (service) {
    case "cf":
      return `PROVIDER_CF_${namespace}_API_KEY`;
    case "vercel":
      return `PROVIDER_VERCEL_${namespace}_API_KEY`;
  }
}

function teamEnvKeyFor(namespace: string): string {
  return `PROVIDER_VERCEL_${namespace}_TEAM_ID`;
}

function azureTenantKeyFor(namespace: string): string {
  return `PROVIDER_AZURE_${namespace}_TENANT_ID`;
}

function azureClientIdKeyFor(namespace: string): string {
  return `PROVIDER_AZURE_${namespace}_CLIENT_ID`;
}

function azurePatKeyFor(namespace: string): string {
  return `PROVIDER_AZURE_${namespace}_PAT`;
}

/** Interactive provider setup — writes API tokens into `cli/.env`. */
export async function runInit(): Promise<void> {
  const pending: PendingEnvChange[] = [];

  while (true) {
    const service = await select({
      message: "Select a service type",
      choices: [
        {
          name: "Cloudflare",
          value: "cf" as const,
          description: "Workers, Durable Objects, Workflows, KV, D1, R2, Queues, Vectorize",
        },
        {
          name: "Vercel",
          value: "vercel" as const,
          description: "Projects, domains, and environment variables",
        },
        {
          name: "Azure",
          value: "azure" as const,
          description: "Entra ID app registrations and client secrets",
        },
        {
          name: "Done",
          value: "done" as const,
          description: "Finish and review .env changes",
        },
      ],
    });

    if (service === "done") break;

    const namespace = await input({
      message: "Namespace / group name (a-zA-Z0-9_, e.g. my_group)",
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) return "Namespace is required";
        if (!NAMESPACE_RE.test(trimmed)) {
          return 'Only letters, digits, and "_" are allowed';
        }
        return true;
      },
    });

    if (service === "cf") {
      const key = envKeyFor("cf", namespace.trim());

      console.log("\nCreate a READONLY Cloudflare API token at:");
      console.log(`  ${CF_TOKEN_URL}`);
      console.log('\nUse "Read all resources", or custom Account Read for');
      console.log("Workers, Durable Objects, Workflows, KV, D1, R2, Queues, and Vectorize.");
      console.log(`\nStored as ${key}\n`);

      const token = await input({
        message: "Paste the API token",
        validate: (value) =>
          value.trim() ? true : "Token is required (Ctrl+C to cancel)",
      });

      const change: PendingEnvChange = {
        key,
        value: token.trim(),
        service: "cf",
        namespace: namespace.trim(),
      };
      const idx = pending.findIndex((p) => p.key === change.key);
      if (idx >= 0) pending[idx] = change;
      else pending.push(change);
      console.log(`Queued ${change.key}\n`);
    }

    if (service === "vercel") {
      const key = envKeyFor("vercel", namespace.trim());
      const teamKey = teamEnvKeyFor(namespace.trim());

      console.log("\nCreate a Vercel API token at:");
      console.log(`  ${VERCEL_TOKEN_URL}`);
      console.log("\nGrant read access to projects, domains, and env vars.");
      console.log(`\nStored as ${key}`);
      console.log(`Optional team id stored as ${teamKey}\n`);

      const token = await input({
        message: "Paste the API token",
        validate: (value) =>
          value.trim() ? true : "Token is required (Ctrl+C to cancel)",
      });

      const teamId = await input({
        message: "Team id (optional, leave blank for personal account)",
      });

      const change: PendingEnvChange = {
        key,
        value: token.trim(),
        service: "vercel",
        namespace: namespace.trim(),
      };
      const idx = pending.findIndex((p) => p.key === change.key);
      if (idx >= 0) pending[idx] = change;
      else pending.push(change);
      console.log(`Queued ${change.key}`);

      if (teamId.trim()) {
        const teamChange: PendingEnvChange = {
          key: teamKey,
          value: teamId.trim(),
          service: "vercel",
          namespace: namespace.trim(),
        };
        const teamIdx = pending.findIndex((p) => p.key === teamChange.key);
        if (teamIdx >= 0) pending[teamIdx] = teamChange;
        else pending.push(teamChange);
        console.log(`Queued ${teamChange.key}`);
      }
      console.log();
    }

    if (service === "azure") {
      const ns = namespace.trim();
      const tenantKey = azureTenantKeyFor(ns);
      const clientIdKey = azureClientIdKeyFor(ns);
      const patKey = azurePatKeyFor(ns);

      console.log("\nOne Entra app = scanner login (like a CF API token).");
      console.log("Scan then lists all app registrations in the tenant.\n");
      console.log("1. New registration (single tenant, no redirect)");
      console.log(`   ${AZURE_NEW_APP_URL}`);
      console.log("2. Overview → copy Tenant ID + Client ID");
      console.log(`   ${AZURE_APPS_URL}`);
      console.log("3. API permissions → Microsoft Graph → Application →");
      console.log("   Application.Read.All, then Grant admin consent");
      console.log(`   ${AZURE_PERM_DOCS_URL}`);
      console.log(`   ${AZURE_CONSENT_DOCS_URL}`);
      console.log("4. Certificates & secrets → New client secret (= PAT)");
      console.log(`   ${AZURE_SECRET_DOCS_URL}`);
      console.log(`\nStored as:\n  ${tenantKey}\n  ${clientIdKey}\n  ${patKey}\n`);

      const tenantId = await input({
        message: "Directory (tenant) ID",
        validate: (value) =>
          value.trim() ? true : "Tenant ID is required (Ctrl+C to cancel)",
      });
      const clientId = await input({
        message: "Application (client) ID",
        validate: (value) =>
          value.trim() ? true : "Client ID is required (Ctrl+C to cancel)",
      });
      const pat = await input({
        message: "PAT (client secret value)",
        validate: (value) =>
          value.trim() ? true : "PAT is required (Ctrl+C to cancel)",
      });

      const changes: PendingEnvChange[] = [
        {
          key: tenantKey,
          value: tenantId.trim(),
          service: "azure",
          namespace: ns,
        },
        {
          key: clientIdKey,
          value: clientId.trim(),
          service: "azure",
          namespace: ns,
        },
        {
          key: patKey,
          value: pat.trim(),
          service: "azure",
          namespace: ns,
        },
      ];
      for (const change of changes) {
        const idx = pending.findIndex((p) => p.key === change.key);
        if (idx >= 0) pending[idx] = change;
        else pending.push(change);
        console.log(`Queued ${change.key}`);
      }
      console.log();
    }
  }

  if (pending.length === 0) {
    console.log("\nNo changes to apply.");
    return;
  }

  const currentLines = await readEnvLines(envPath);
  const nextLines = applyPendingChanges(currentLines, pending);
  const fileLabel = path.relative(repoRoot, envPath);

  console.log();
  printUnifiedDiff(fileLabel, currentLines, nextLines);
  console.log();

  const ok = await confirm({
    message: "Commit these changes? (y to confirm)",
    default: false,
  });

  if (!ok) {
    console.log("Aborted — returning home.");
    return;
  }

  await writeEnvLines(envPath, nextLines);
  console.log(`Wrote ${path.relative(repoRoot, envPath)}`);
}
