const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const CLEAR_LINE = "\r\x1b[2K";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

const isStdoutTty = process.stdout.isTTY === true;
const isStderrTty = process.stderr.isTTY === true;

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
} as const;

function colorEnabled(stream: "stdout" | "stderr" = "stdout"): boolean {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR != null && process.env.FORCE_COLOR !== "") {
    return true;
  }
  return stream === "stderr" ? isStderrTty : isStdoutTty;
}

function paint(
  codes: string,
  text: string,
  stream: "stdout" | "stderr" = "stdout",
): string {
  if (!colorEnabled(stream)) return text;
  return `${codes}${text}${ansi.reset}`;
}

/** Paint text red for error output (honors NO_COLOR / stderr TTY). */
export function red(text: string): string {
  return paint(`${ansi.bold}${ansi.red}`, text, "stderr");
}

function writeStdout(text: string): void {
  process.stdout.write(text);
}

/** Shared CLI logger — banner, spinner, and tree steps. */
export class CliLog {
  private frame = 0;
  private status = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private spinning = false;

  banner(): void {
    this.clearSpinnerLine();
    console.log(paint(`${ansi.bold}${ansi.cyan}`, "OVERSEER") + "\n");
  }

  /** Start or update the status spinner (e.g. "Scanning..."). */
  start(status: string): void {
    this.status = status;
    if (!isStdoutTty) {
      console.log(status);
      return;
    }
    if (!this.spinning) {
      this.spinning = true;
      writeStdout(HIDE_CURSOR);
      this.timer = setInterval(() => this.renderSpinner(), 80);
    }
    this.renderSpinner();
  }

  /** Stop the spinner and leave a final status line (optional). */
  stop(finalLine?: string): void {
    if (!this.spinning && !finalLine) return;
    this.clearSpinnerLine();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.spinning = false;
    if (isStdoutTty) writeStdout(SHOW_CURSOR);
    if (finalLine !== undefined) console.log(finalLine);
  }

  /** Top-level section, e.g. "Scanning Cloudflare". */
  section(title: string): void {
    this.clearSpinnerLine();
    console.log(paint(ansi.bold, title));
    this.redrawSpinner();
  }

  /** Tree child under the current section: `|_ Scanning Workers`. */
  step(title: string): void {
    this.clearSpinnerLine();
    console.log(`${paint(ansi.dim, "|_")} ${title}`);
    this.redrawSpinner();
  }

  info(message: string): void {
    this.clearSpinnerLine();
    console.log(message);
    this.redrawSpinner();
  }

  warn(message: string): void {
    this.clearSpinnerLine();
    console.warn(paint(ansi.yellow, `  warning: ${message}`));
    this.redrawSpinner();
  }

  /** Fatal / step failure — always red on stderr. */
  error(message: string, detail?: unknown): void {
    this.clearSpinnerLine();
    const line = red(message);
    if (detail !== undefined) {
      const detailText =
        detail instanceof Error
          ? detail.stack ?? detail.message
          : typeof detail === "string"
            ? detail
            : String(detail);
      console.error(line);
      console.error(red(detailText));
    } else {
      console.error(line);
    }
    this.redrawSpinner();
  }

  /** Tree child for a failed step (red). */
  failStep(title: string): void {
    this.clearSpinnerLine();
    console.log(`${paint(ansi.dim, "|_")} ${red(title)}`);
    this.redrawSpinner();
  }

  done(message = "Scan Complete!"): void {
    this.stop();
    console.log(`\n${paint(`${ansi.bold}${ansi.green}`, message)}`);
  }

  private renderSpinner(): void {
    if (!isStdoutTty || !this.spinning) return;
    const glyph = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]!;
    this.frame += 1;
    const painted = paint(ansi.cyan, `${glyph} ${this.status}`);
    writeStdout(`${CLEAR_LINE}${painted}`);
  }

  private clearSpinnerLine(): void {
    if (!isStdoutTty || !this.spinning) return;
    writeStdout(CLEAR_LINE);
  }

  private redrawSpinner(): void {
    if (this.spinning) this.renderSpinner();
  }
}

/** Process-wide logger used by the scan pipeline. */
export const log = new CliLog();

/** Human-readable duration since `start` (`Date.now()`). */
export function elapsed(start: number): string {
  return `${Date.now() - start}ms`;
}

/**
 * Yield to the event loop so the spinner / TTY can paint during long sync work.
 * Call between chunks (e.g. every N connectors).
 */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Verbose debug logs (CF API detail). Opt in with OVERSEER_DEBUG=1. */
export function debug(message: string, extra?: Record<string, unknown>): void {
  if (process.env.OVERSEER_DEBUG !== "1") return;
  if (extra) console.log(paint(ansi.magenta, "[debug]"), message, extra);
  else console.log(paint(ansi.magenta, "[debug]"), message);
}

export function debugError(message: string, error: unknown): void {
  if (process.env.OVERSEER_DEBUG !== "1") return;
  const detail =
    error instanceof Error
      ? error.stack ?? error.message
      : String(error);
  console.error(red(`[debug] ${message}`));
  console.error(red(detail));
}
