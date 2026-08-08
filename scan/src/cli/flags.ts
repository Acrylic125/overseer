/** Shared CLI flag parsing for scan / assets / mock. */
export type CliFlags = {
  dir?: string;
  skipAssets: boolean;
  /** Remaining non-flag args (legacy positional paths ignored when --dir is set). */
  positionals: string[];
};

export function parseCliFlags(argv: string[]): CliFlags {
  let dir: string | undefined;
  let skipAssets = false;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dir") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--dir requires a path argument");
      }
      dir = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
      continue;
    }
    if (arg === "--skip-assets" || arg === "--skip-precompute") {
      skipAssets = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    }
    positionals.push(arg);
  }

  return { dir, skipAssets, positionals };
}
