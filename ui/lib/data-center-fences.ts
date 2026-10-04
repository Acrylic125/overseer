import type { ConnectorPath } from "@/lib/graph/connector-paths";
import { conveyorPacketRoute } from "./data-center";

/** Solid fence spans after reserving clearance for the full conveyor ribbon. */
export function fenceSpans(
  start: number,
  end: number,
  fixed: number,
  axis: "x" | "z",
  paths: ConnectorPath[],
): [number, number][] {
  const cross = axis === "x" ? "z" : "x";
  const clearance = 0.27;
  const openings: [number, number][] = [];
  for (const path of paths) {
    const points = conveyorPacketRoute(path).path.points;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      const delta = b[cross] - a[cross];
      let lo = 0;
      let hi = 1;
      if (Math.abs(delta) < 1e-8) {
        if (Math.abs(a[cross] - fixed) > clearance) continue;
      } else {
        const t1 = (fixed - clearance - a[cross]) / delta;
        const t2 = (fixed + clearance - a[cross]) / delta;
        lo = Math.max(0, Math.min(t1, t2));
        hi = Math.min(1, Math.max(t1, t2));
        if (lo > hi) continue;
      }
      const p = a[axis] + (b[axis] - a[axis]) * lo;
      const q = a[axis] + (b[axis] - a[axis]) * hi;
      openings.push([Math.min(p, q) - clearance, Math.max(p, q) + clearance]);
    }
  }
  openings.sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let cursor = start;
  for (const [lo, hi] of openings) {
    if (hi <= cursor || lo >= end) continue;
    if (lo > cursor) spans.push([cursor, Math.min(lo, end)]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < end) spans.push([cursor, end]);
  return spans.filter(([a, b]) => b - a > 0.1);
}
