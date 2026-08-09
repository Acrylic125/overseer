import { access, constants as fsConstants, readFile, writeFile } from "node:fs/promises";

import { redactSensitiveValue } from "../utils.js";

export type PendingEnvChange = {
  key: string;
  value: string;
  service: string;
  namespace: string;
};

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readEnvLines(filePath: string): Promise<string[]> {
  if (!(await fileExists(filePath))) return [];
  const raw = await readFile(filePath, "utf8");
  if (raw.length === 0) return [];
  const lines = raw.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export async function writeEnvLines(
  filePath: string,
  lines: string[],
): Promise<void> {
  const body = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  await writeFile(filePath, body, "utf8");
}

/**
 * Line-by-line update: override the first matching KEY= line, else append.
 * Later pending changes for the same key replace earlier ones.
 */
export function applyPendingChanges(
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
export function maskEnvLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return line;

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return line;

  const key = trimmed.slice(0, eq);
  const value = trimmed.slice(eq + 1);
  if (!/(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|PAT)$/i.test(key)) {
    return line;
  }
  return `${key}=${redactSensitiveValue(value)}`;
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

    if (oldCount === 0) oldStart = 0;
    else if (oldStart === null) oldStart = 1;

    if (newCount === 0) newStart = 0;
    else if (newStart === null) newStart = 1;

    return { oldStart, oldCount, newStart, newCount, lines };
  });
}

export function printUnifiedDiff(
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
