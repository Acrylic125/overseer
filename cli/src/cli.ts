import { confirm, input, select } from "@inquirer/prompts";
import { access, constants as fsConstants, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(cliRoot, "..");
/** Same env file the scan package prefers. */
const ENV_PATH = path.join(repoRoot, "scan", ".env");

const CF_TOKEN_URL = "https://dash.cloudflare.com/profile/api-tokens";
const NAMESPACE_RE = /^[a-zA-Z0-9_]+$/;

type ServiceType = "cf";

type PendingEnvChange = {
  key: string;
  value: string;
  service: ServiceType;
  namespace: string;
};

function maskSecret(value: string): string {
  if (value.length <= 6) {
    return `${value.slice(0, Math.min(3, value.length))}*********`;
  }
  return `${value.slice(0, 3)}*********${value.slice(-3)}`;
}

function envKeyFor(service: ServiceType, namespace: string): string {
  switch (service) {
    case "cf":
      return `PROVIDER_CF_${namespace}_API_KEY`;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readEnvLines(filePath: string): Promise<string[]> {
  if (!(await fileExists(filePath))) return [];
  const raw = await readFile(filePath, "utf8");
  if (raw.length === 0) return [];
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Line-by-line update: override the first matching KEY= line, else append.
 * Later pending changes for the same key replace earlier ones.
 */
function applyPendingChanges(
  lines: string[],
  changes: PendingEnvChange[],
): string[] {
  const byKey = new Map<string, PendingEnvChange>();
  for (const change of changes) {
    byKey.set(change.key, change);
  }

  const remaining = new Map(byKey);
  const nextLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) return line;

    const key = trimmed.slice(0, eq);
    const change = remaining.get(key);
    if (!change) return line;

    remaining.delete(key);
    return `${key}=${change.value}`;
  });

  for (const change of remaining.values()) {
    nextLines.push(`${change.key}=${change.value}`);
  }

  return nextLines;
}

/** Mask secret-looking env values for terminal display. */
function maskEnvLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return line;

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return line;

  const key = trimmed.slice(0, eq);
  const value = trimmed.slice(eq + 1);
  if (!/(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)$/i.test(key)) {
    return line;
  }
  return `${key}=${maskSecret(value)}`;
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "add"; line: string }
  | { type: "remove"; line: string };

/** LCS line diff (git-style hunks over small .env files). */
function diffLines(before: string[], after: string[]): DiffOp[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (before[i] === after[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ type: "equal", line: before[i]! });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "remove", line: before[i]! });
      i += 1;
    } else {
      ops.push({ type: "add", line: after[j]! });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ type: "remove", line: before[i]! });
    i += 1;
  }
  while (j < m) {
    ops.push({ type: "add", line: after[j]! });
    j += 1;
  }
  return ops;
}

type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: string[];
};

/** Build unified-diff hunks with 3 lines of context (like git). */
function buildHunks(ops: DiffOp[], context = 3): Hunk[] {
  type Marked = { op: DiffOp; oldNo: number | null; newNo: number | null };
  const marked: Marked[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const op of ops) {
    if (op.type === "equal") {
      oldNo += 1;
      newNo += 1;
      marked.push({ op, oldNo, newNo });
    } else if (op.type === "remove") {
      oldNo += 1;
      marked.push({ op, oldNo, newNo: null });
    } else {
      newNo += 1;
      marked.push({ op, oldNo: null, newNo });
    }
  }

  const changeIdx: number[] = [];
  for (let i = 0; i < marked.length; i++) {
    if (marked[i]!.op.type !== "equal") changeIdx.push(i);
  }
  if (changeIdx.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  let start = Math.max(0, changeIdx[0]! - context);
  let end = Math.min(marked.length - 1, changeIdx[0]! + context);
  for (let c = 1; c < changeIdx.length; c++) {
    const idx = changeIdx[c]!;
    const nextStart = Math.max(0, idx - context);
    if (nextStart <= end + 1) {
      end = Math.min(marked.length - 1, idx + context);
    } else {
      ranges.push({ start, end });
      start = nextStart;
      end = Math.min(marked.length - 1, idx + context);
    }
  }
  ranges.push({ start, end });

  return ranges.map((range) => {
    const slice = marked.slice(range.start, range.end + 1);
    let oldStart: number | null = null;
    let newStart: number | null = null;
    let oldCount = 0;
    let newCount = 0;
    const lines: string[] = [];

    for (const item of slice) {
      if (item.op.type === "equal") {
        if (oldStart === null) oldStart = item.oldNo;
        if (newStart === null) newStart = item.newNo;
        oldCount += 1;
        newCount += 1;
        lines.push(` ${maskEnvLine(item.op.line)}`);
      } else if (item.op.type === "remove") {
        if (oldStart === null) oldStart = item.oldNo;
        oldCount += 1;
        lines.push(`-${maskEnvLine(item.op.line)}`);
      } else {
        if (newStart === null) newStart = item.newNo;
        newCount += 1;
        lines.push(`+${maskEnvLine(item.op.line)}`);
      }
    }

    // Match git: empty side uses 0,0 (e.g. new file / delete all)
    if (oldCount === 0) oldStart = 0;
    else if (oldStart === null) oldStart = 1;

    if (newCount === 0) newStart = 0;
    else if (newStart === null) newStart = 1;

    return { oldStart, oldCount, newStart, newCount, lines };
  });
}

function printUnifiedDiff(
  fileLabel: string,
  before: string[],
  after: string[],
): void {
  const ops = diffLines(before, after);
  const hunks = buildHunks(ops);

  console.log(`diff --git a/${fileLabel} b/${fileLabel}`);
  console.log(`--- a/${fileLabel}`);
  console.log(`+++ b/${fileLabel}`);

  if (hunks.length === 0) {
    console.log("(no line changes)");
    return;
  }

  for (const hunk of hunks) {
    console.log(
      `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`,
    );
    for (const line of hunk.lines) {
      if (line.startsWith("+")) {
        console.log(`\x1b[32m${line}\x1b[0m`);
      } else if (line.startsWith("-")) {
        console.log(`\x1b[31m${line}\x1b[0m`);
      } else {
        console.log(line);
      }
    }
  }
}

function printHome() {
  console.log(`
Overseer CLI
────────────
`);
}

async function runInit(): Promise<void> {
  const pending: PendingEnvChange[] = [];

  while (true) {
    const service = await select({
      message: "Select a service type",
      choices: [
        {
          name: "Cloudflare",
          value: "cf" as const,
          description: "Workers, KV, D1, R2, Queues, Vectorize",
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
      console.log("Workers, KV, D1, R2, Queues, and Vectorize.");
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
  }

  if (pending.length === 0) {
    console.log("\nNo changes to apply.");
    return;
  }

  const currentLines = await readEnvLines(ENV_PATH);
  const nextLines = applyPendingChanges(currentLines, pending);
  const fileLabel = path.relative(repoRoot, ENV_PATH);

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

  const body = nextLines.length === 0 ? "" : `${nextLines.join("\n")}\n`;
  await writeFile(ENV_PATH, body, "utf8");
  console.log(`Wrote ${path.relative(repoRoot, ENV_PATH)}`);
}

async function main() {
  while (true) {
    printHome();

    const command = await select({
      message: "Command",
      choices: [
        {
          name: "init",
          value: "init" as const,
          description: "Configure providers in scan/.env",
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
    }
  }
}

main().catch((error: unknown) => {
  // Inquirer throws on Ctrl+C
  if (
    error instanceof Error &&
    (error.name === "ExitPromptError" || error.message.includes("User force closed"))
  ) {
    console.log("\nBye.");
    return;
  }
  console.error("[cli] failed", error);
  process.exitCode = 1;
});
