import { select } from "@inquirer/prompts";

import { parseCliFlags } from "./cli/flags.js";
import { log, red } from "./cli/log.js";
import { runInit } from "./commands/init.js";
import { runMock } from "./commands/mock.js";
import { runScanPipeline } from "./commands/scan.js";
import { precomputeAssets } from "./pipeline/precompute.js";

function printUsage(): void {
  console.log(`Usage:
  pnpm cli                      Interactive menu
  pnpm cli init                 Configure providers in scan/.env
  pnpm cli scan [--dir <path>]  Full pipeline → <dir>/…
  pnpm cli scan --skip-assets [--dir <path>]
  pnpm cli assets [--dir <path>]  Bake assets.glb (+ gradient PNG)
  pnpm cli mock [--dir <path>]  Synthetic infrastructure.json

Artifacts (flat in the output directory):
  assets.glb
  platform-gradient.png
  infrastructure.json

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
          name: "init",
          value: "init" as const,
          description: "Configure providers in scan/.env",
        },
        {
          name: "scan",
          value: "scan" as const,
          description: "Assets → service scan → layout → _generated/",
        },
        {
          name: "assets",
          value: "assets" as const,
          description: "Bake assets.glb into _generated/",
        },
        {
          name: "mock",
          value: "mock" as const,
          description: "Write a synthetic infrastructure.json",
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

    if (command === "init") {
      await runInit();
      continue;
    }

    if (command === "scan") {
      await runScanPipeline();
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

  if (command === "init") {
    await runInit();
    return;
  }

  const flags = parseCliFlags(argv.slice(1));

  if (command === "scan") {
    await runScanPipeline({
      outDir: flags.dir,
      skipPrecompute: flags.skipAssets,
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
