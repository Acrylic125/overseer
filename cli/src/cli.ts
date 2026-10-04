import { select } from "@inquirer/prompts";

import { parseCliFlags } from "./cli/flags.js";
import { log, red } from "./cli/log.js";
import { runEnv } from "./commands/env.js";
import { runMock } from "./mock/command.js";
import { runScanPipeline } from "./commands/scan.js";
import { precomputeAssets } from "./pipeline/precompute.js";

function printUsage(): void {
  console.log(`Usage:
  pnpm cli                          Interactive menu
  pnpm cli env                      Configure providers in cli/.env
  pnpm cli scan [filters] [--force] [--skip-assets] [--dir <path>]
                                    Assets → sync stale scopes → graph.json
  pnpm cli sync [filters] [--force] [--dir <path>]
                                    Sync stale scopes → graph.json (no assets)
  pnpm cli graph [--dir <path>]     Rebuild graph.json from the cache (offline)
  pnpm cli assets [--dir <path>]    Bake assets.glb (+ gradient PNG)
  pnpm cli mock [--dir <path>]      Synthetic graph.json

Filters narrow which scopes are synced:
  cloudflare                 every Cloudflare namespace
  cloudflare:prod            one namespace
  cloudflare:prod/worker     one scanner (worker, dns, d1, kv, r2, queue, …)

Scopes younger than their TTL are served from cli/.overseer/cache unless --force.

Artifacts (flat in the output directory):
  assets.glb
  platform-gradient.png
  graph.json

Default directory: ./_generated  (override with --dir)
`);
}

function isExitPrompt(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ExitPromptError" ||
      error.message.includes("User force closed"))
  );
}

async function runAssets(outDir?: string): Promise<void> {
  log.banner();
  log.start("Building assets...");
  try {
    await precomputeAssets({ outDir });
    log.done("Assets ready!");
  } catch (error) {
    log.stop();
    throw error;
  }
}

async function runInteractive(): Promise<void> {
  while (true) {
    console.log();

    const command = await select({
      message: "OVERSEER — Command",
      choices: [
        {
          name: "env",
          value: "env" as const,
          description: "Configure providers in cli/.env",
        },
        {
          name: "scan",
          value: "scan" as const,
          description: "Assets → sync stale scopes → _generated/graph.json",
        },
        {
          name: "sync (force)",
          value: "force" as const,
          description: "Re-scrape every scope, ignoring the cache",
        },
        {
          name: "graph",
          value: "graph" as const,
          description: "Rebuild graph.json from the cache without scraping",
        },
        {
          name: "assets",
          value: "assets" as const,
          description: "Bake assets.glb into _generated/",
        },
        {
          name: "mock",
          value: "mock" as const,
          description: "Write a synthetic graph.json",
        },
        {
          name: "exit",
          value: "exit" as const,
          description: "Quit",
        },
      ],
    });

    if (command === "exit") {
      console.log("Bye.");
      break;
    }

    if (command === "env") {
      await runEnv();
      continue;
    }

    if (command === "scan") {
      await runScanPipeline();
      continue;
    }

    if (command === "force") {
      await runScanPipeline({ skipPrecompute: true, force: true });
      continue;
    }

    if (command === "graph") {
      await runScanPipeline({ skipPrecompute: true, offline: true });
      continue;
    }

    if (command === "assets") {
      await runAssets();
      continue;
    }

    if (command === "mock") {
      await runMock();
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command) {
    await runInteractive();
    return;
  }

  if (command === "help" || command === "-h" || command === "--help") {
    printUsage();
    return;
  }

  if (command === "env") {
    await runEnv();
    return;
  }

  const flags = parseCliFlags(argv.slice(1));

  if (command === "scan" || command === "sync") {
    await runScanPipeline({
      outDir: flags.dir,
      skipPrecompute: command === "sync" || flags.skipAssets,
      only: flags.positionals,
      force: flags.force,
    });
    return;
  }

  if (command === "graph") {
    await runScanPipeline({
      outDir: flags.dir,
      skipPrecompute: true,
      offline: true,
    });
    return;
  }

  if (command === "assets") {
    await runAssets(flags.dir);
    return;
  }

  if (command === "mock") {
    await runMock({ outDir: flags.dir });
    return;
  }

  console.error(red(`Unknown command: ${command}\n`));
  printUsage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  if (isExitPrompt(error)) {
    console.log("\nBye.");
    return;
  }
  log.stop();
  const message = error instanceof Error ? error.message : String(error);
  log.error(`OVERSEER failed: ${message}`, error);
  process.exitCode = 1;
});
