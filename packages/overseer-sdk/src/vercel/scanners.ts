import { Vercel } from "@vercel/sdk";

import { envToClaims, urlBaseMatchClaim } from "../core/claims.js";
import { envFields, type EnvVar } from "../core/env.js";
import { resourceId } from "../core/resource-id.js";
import {
  mapPoolCollect,
  settled,
  type ScrapeStepFn,
} from "../core/scrape-async.js";
import type { ProviderResourceScanner } from "../types.js";
import { iconForKind } from "./icons.js";
import {
  parseVercelDomainRow,
  parseVercelEnvRow,
  type VercelEnvRow,
} from "./schemas.js";

const PROJECT_CONCURRENCY = 4;
const noopStep: ScrapeStepFn = () => {};

function toEnv(row: VercelEnvRow) {
  let target: string[] | undefined;
  if (Array.isArray(row.target)) {
    target = row.target;
  } else if (row.target) {
    target = [row.target];
  }
  return {
    key: row.key,
    value: row.value ?? "",
    type: row.type ?? "plain",
    target,
    gitBranch: row.gitBranch,
  };
}

function dedupeEnvs(rows: VercelEnvRow[]) {
  const seen = new Set<string>();
  const envs: EnvVar[] = [];
  for (const row of rows) {
    const env = toEnv(row);
    const id = `${env.key}|${(env.target ?? []).join(",")}|${env.gitBranch ?? ""}`;
    if (seen.has(id)) continue;
    seen.add(id);
    envs.push(env);
  }
  return envs;
}

async function scrapeProjects(
  apiKey: string,
  teamId?: string,
  fn: ScrapeStepFn = noopStep,
) {
  const client = new Vercel({
    bearerToken: apiKey,
    retryConfig: { strategy: "none" },
  });

  fn({ message: "Listing projects" });
  const projects = [];
  let from: string | undefined;

  for (let page = 0; page < 50; page += 1) {
    const result = await client.projects.getProjects({
      limit: "100",
      ...(from ? { from } : {}),
      ...(teamId ? { teamId } : {}),
    });

    if (Array.isArray(result)) {
      projects.push(...result);
      break;
    }

    projects.push(...result.projects);
    if (result.pagination?.next == null) break;
    from = String(result.pagination.next);
  }

  fn({ message: "Fetching project domains and envs" });
  return mapPoolCollect(projects, PROJECT_CONCURRENCY, async (project) => {
    const [projectDomains, projectEnvs] = await Promise.all([
      settled(async () => {
        const rows = [];
        let until: number | undefined;
        for (let page = 0; page < 20; page += 1) {
          const result = await client.projects.getProjectDomains({
            idOrName: project.id,
            limit: 100,
            ...(until != null ? { until } : {}),
            ...(teamId ? { teamId } : {}),
          });
          rows.push(...result.domains);
          if (result.pagination?.next == null) break;
          until = result.pagination.next;
        }
        return rows;
      }, []),
      settled(async () => {
        const result = await client.projects.filterProjectEnvs({
          idOrName: project.id,
          decrypt: "true",
          ...(teamId ? { teamId } : {}),
        });
        if (Array.isArray(result)) return result;
        if ("envs" in result && Array.isArray(result.envs)) return result.envs;
        return [];
      }, []),
    ]);

    const parsedEnvs = [
      ...projectEnvs
        .map((row) => parseVercelEnvRow(row))
        .filter((row): row is VercelEnvRow => row !== null),
      ...(project.env ?? [])
        .map((row) => parseVercelEnvRow(row))
        .filter((row): row is VercelEnvRow => row !== null),
    ];

    return {
      project,
      domains: projectDomains
        .map((row) => parseVercelDomainRow(row))
        .filter((row) => row !== null)
        .map((row) => row.name),
      envs: dedupeEnvs(parsedEnvs),
    };
  });
}

export const projectScanner = {
  type: "Project",
  scrape: scrapeProjects,
  transform(item, namespace) {
    const projectId = item.project.id;
    const name = item.project.name;
    const open = item.domains.length > 0;
    return {
      id: resourceId("vercel", namespace, "project", projectId),
      group: namespace,
      name,
      url: `https://vercel.com/${namespace}/${name}`,
      service: "Project",
      asset: iconForKind("Project"),
      fields: {
        "Is Open To Internet": open,
        ...(item.domains.length > 0 ? { Domains: item.domains } : {}),
        ...envFields(item.envs),
      },
      alerts: [],
      tags: { namespace },
    };
  },
  connection(item) {
    const domains = item.domains;
    return {
      claims: envToClaims(item.envs),
      require: (claim) => {
        for (const domain of domains) {
          if (!urlBaseMatchClaim(domain, claim)) continue;
          return { type: "connected", label: domain };
        }
        return false;
      },
    };
  },
} satisfies ProviderResourceScanner<
  Awaited<ReturnType<typeof scrapeProjects>>[number],
  [string, string | undefined, ScrapeStepFn]
>;

export const vercelScanners = [projectScanner];
