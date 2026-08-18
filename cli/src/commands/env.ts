import { confirm, input, select } from "@inquirer/prompts";
import path from "node:path";

import {
  azureEnvKeys,
  cloudflareEnvKeys,
  type ProviderKind,
  vercelEnvKeys,
} from "../providers.js";
import { envPath, repoRoot } from "../paths.js";
import {
  applyPendingChanges,
  printUnifiedDiff,
  readEnvLines,
  writeEnvLines,
  type PendingEnvChange,
} from "./env-file.js";

const NAMESPACE_RE = /^[a-zA-Z0-9_]+$/;

const DOCS = {
  cf: {
    url: "https://dash.cloudflare.com/profile/api-tokens",
    hint: [
      'Use "Read all resources", or custom Account Read for',
      "Workers, Durable Objects, Workflows, KV, D1, R2, Queues, and Vectorize.",
    ],
  },
  vercel: {
    url: "https://vercel.com/account/tokens",
    hint: ["Grant read access to projects, domains, and environment variables."],
  },
  azure: {
    newApp:
      "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/CreateApplicationBlade",
    apps:
      "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    permissions:
      "https://learn.microsoft.com/en-us/graph/permissions-reference#applicationreadall",
    consent:
      "https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/grant-admin-consent",
    secret:
      "https://learn.microsoft.com/en-us/entra/identity-platform/howto-create-service-principal-portal#option-3-create-a-new-client-secret",
  },
} as const;

function queueChanges(
  pending: PendingEnvChange[],
  changes: PendingEnvChange[],
) {
  for (const change of changes) {
    const index = pending.findIndex((entry) => entry.key === change.key);
    if (index >= 0) {
      pending[index] = change;
    } else {
      pending.push(change);
    }
  }
}

function change(
  key: string,
  value: string,
  service: ProviderKind,
  namespace: string,
): PendingEnvChange {
  return { key, value, service, namespace };
}

function printQueued(keys: string[]) {
  for (const key of keys) {
    console.log(`Queued ${key}`);
  }
  console.log();
}

async function promptNamespace() {
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
  return namespace.trim();
}

async function promptRequired(message: string) {
  const value = await input({
    message,
    validate: (raw) =>
      raw.trim() ? true : "Required (Ctrl+C to cancel)",
  });
  return value.trim();
}

async function configureCloudflare(
  pending: PendingEnvChange[],
  namespace: string,
) {
  const keys = cloudflareEnvKeys(namespace);

  console.log("\nCreate a READONLY Cloudflare API token at:");
  console.log(`  ${DOCS.cf.url}`);
  for (const line of DOCS.cf.hint) {
    console.log(line);
  }
  console.log(`\nStored as ${keys.apiKey}\n`);

  const apiKey = await promptRequired("Paste the API token");
  queueChanges(pending, [
    change(keys.apiKey, apiKey, "cf", namespace),
  ]);
  printQueued([keys.apiKey]);
}

async function configureVercel(pending: PendingEnvChange[], namespace: string) {
  const keys = vercelEnvKeys(namespace);

  console.log("\nCreate a Vercel API token at:");
  console.log(`  ${DOCS.vercel.url}`);
  for (const line of DOCS.vercel.hint) {
    console.log(line);
  }
  console.log(`\nStored as ${keys.apiKey}`);
  console.log(`Optional team id stored as ${keys.teamId}\n`);

  const apiKey = await promptRequired("Paste the API token");
  const teamId = await input({
    message: "Team id (optional, leave blank for personal account)",
  });

  const queued: string[] = [keys.apiKey];
  queueChanges(pending, [change(keys.apiKey, apiKey, "vercel", namespace)]);

  if (teamId.trim()) {
    queueChanges(pending, [
      change(keys.teamId, teamId.trim(), "vercel", namespace),
    ]);
    queued.push(keys.teamId);
  }

  printQueued(queued);
}

async function configureAzure(pending: PendingEnvChange[], namespace: string) {
  const keys = azureEnvKeys(namespace);

  console.log("\nOne Entra app = scanner login (like a CF API token).");
  console.log("Scan then lists all app registrations in the tenant.\n");
  console.log("1. New registration (single tenant, no redirect)");
  console.log(`   ${DOCS.azure.newApp}`);
  console.log("2. Overview → copy Tenant ID + Client ID");
  console.log(`   ${DOCS.azure.apps}`);
  console.log("3. API permissions → Microsoft Graph → Application →");
  console.log("   Application.Read.All, then Grant admin consent");
  console.log(`   ${DOCS.azure.permissions}`);
  console.log(`   ${DOCS.azure.consent}`);
  console.log("4. Certificates & secrets → New client secret");
  console.log(`   ${DOCS.azure.secret}`);
  console.log(
    `\nStored as:\n  ${keys.tenantId}\n  ${keys.clientId}\n  ${keys.clientSecret}\n`,
  );

  const tenantId = await promptRequired("Directory (tenant) ID");
  const clientId = await promptRequired("Application (client) ID");
  const clientSecret = await promptRequired("Client secret value");

  queueChanges(pending, [
    change(keys.tenantId, tenantId, "azure", namespace),
    change(keys.clientId, clientId, "azure", namespace),
    change(keys.clientSecret, clientSecret, "azure", namespace),
  ]);
  printQueued([keys.tenantId, keys.clientId, keys.clientSecret]);
}

/** Interactive provider setup — writes credentials into `cli/.env`. */
export async function runEnv() {
  const pending: PendingEnvChange[] = [];

  while (true) {
    const service = await select({
      message: "Select a provider",
      choices: [
        {
          name: "Cloudflare",
          value: "cf" as const,
          description:
            "Workers, Durable Objects, Workflows, KV, D1, R2, Queues, Vectorize",
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

    const namespace = await promptNamespace();

    if (service === "cf") {
      await configureCloudflare(pending, namespace);
      continue;
    }

    if (service === "vercel") {
      await configureVercel(pending, namespace);
      continue;
    }

    await configureAzure(pending, namespace);
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
    message: "Write these changes to .env?",
    default: false,
  });

  if (!ok) {
    console.log("Aborted.");
    return;
  }

  await writeEnvLines(envPath, nextLines);
  console.log(`Wrote ${path.relative(repoRoot, envPath)}`);
}
