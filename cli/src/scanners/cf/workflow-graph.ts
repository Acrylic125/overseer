import type { FieldGraphEdge, FieldGraphValue } from "../../schema.js";

type NodeEnds = { starts: string[]; ends: string[] };

const STEP_TYPES = new Set([
  "step_do",
  "step_sleep",
  "step_wait_for_event",
  "step_sleep_until",
  "function_call",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueName(base: string, used: Map<string, number>): string {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  if (count === 0) return base;
  return `${base} (${count + 1})`;
}

/**
 * Flatten a Cloudflare Workflow version graph into vertices + directed edges.
 * Nested control flow (parallel / if / try / loop) is preserved as fan-out edges.
 */
export function workflowNodesToGraph(nodes: unknown[]): FieldGraphValue {
  const vertices: string[] = [];
  const edges: FieldGraphEdge[] = [];
  const seenEdges = new Set<string>();
  const usedNames = new Map<string, number>();

  function addVertex(label: string): string {
    const name = uniqueName(label, usedNames);
    vertices.push(name);
    return name;
  }

  function addEdge(from: string, to: string) {
    const key = `${from}\0${to}`;
    if (seenEdges.has(key) || from === to) return;
    seenEdges.add(key);
    edges.push([from, to]);
  }

  function connect(fromEnds: string[], toStarts: string[]) {
    for (const from of fromEnds) {
      for (const to of toStarts) addEdge(from, to);
    }
  }

  function walkSequence(list: unknown[]): NodeEnds {
    let first: string[] = [];
    let prevEnds: string[] = [];

    for (const node of list) {
      const result = walkNode(node);
      if (result.starts.length === 0 && result.ends.length === 0) continue;
      if (first.length === 0) first = result.starts;
      if (prevEnds.length > 0) connect(prevEnds, result.starts);
      prevEnds = result.ends;
    }

    return { starts: first, ends: prevEnds };
  }

  function walkBranches(
    branches: Array<{ nodes?: unknown[] }>,
  ): NodeEnds {
    const starts: string[] = [];
    const ends: string[] = [];
    for (const branch of branches) {
      const result = walkSequence(branch.nodes ?? []);
      starts.push(...result.starts);
      ends.push(...result.ends);
    }
    return { starts, ends };
  }

  function walkNode(node: unknown): NodeEnds {
    if (!isRecord(node)) return { starts: [], ends: [] };
    const type = typeof node.type === "string" ? node.type : "";

    if (STEP_TYPES.has(type)) {
      const rawName =
        typeof node.name === "string" && node.name.trim()
          ? node.name.trim()
          : type;
      const name = addVertex(rawName);
      // Nested children inside step_do (rare) still run after the step.
      if (Array.isArray(node.nodes) && node.nodes.length > 0) {
        const inner = walkSequence(node.nodes);
        if (inner.starts.length > 0) {
          connect([name], inner.starts);
          return { starts: [name], ends: inner.ends.length ? inner.ends : [name] };
        }
      }
      return { starts: [name], ends: [name] };
    }

    if (type === "parallel" && Array.isArray(node.nodes)) {
      const starts: string[] = [];
      const ends: string[] = [];
      for (const child of node.nodes) {
        const result = walkNode(child);
        starts.push(...result.starts);
        ends.push(...result.ends);
      }
      return { starts, ends };
    }

    if ((type === "if" || type === "switch") && Array.isArray(node.branches)) {
      return walkBranches(
        node.branches.filter((branch): branch is { nodes?: unknown[] } =>
          isRecord(branch),
        ),
      );
    }

    if (type === "try") {
      const parts: NodeEnds[] = [];
      for (const key of ["try_block", "catch_block", "finally_block"] as const) {
        const block = node[key];
        if (!isRecord(block) || !Array.isArray(block.nodes)) continue;
        parts.push(walkSequence(block.nodes));
      }
      if (parts.length === 0) return { starts: [], ends: [] };
      for (let i = 1; i < parts.length; i += 1) {
        const prev = parts[i - 1]!;
        const next = parts[i]!;
        connect(prev.ends, next.starts);
      }
      return {
        starts: parts[0]!.starts,
        ends: parts[parts.length - 1]!.ends,
      };
    }

    if (
      (type === "loop" || type === "block" || type === "function_def" || type === "start") &&
      Array.isArray(node.nodes)
    ) {
      return walkSequence(node.nodes);
    }

    if (Array.isArray(node.nodes)) {
      return walkSequence(node.nodes);
    }

    return { starts: [], ends: [] };
  }

  walkSequence(nodes);

  return { type: "graph", vertices, edges };
}
