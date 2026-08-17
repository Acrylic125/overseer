import type { FieldValue } from "../types.js";
import type { WorkflowNode } from "./schemas.js";

type NodeEnds = { starts: string[]; ends: string[] };

const STEP_TYPES = new Set([
  "step_do",
  "step_sleep",
  "step_wait_for_event",
  "step_sleep_until",
  "function_call",
]);

function uniqueName(base: string, used: Map<string, number>) {
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  if (count === 0) return base;
  return `${base} (${count + 1})`;
}

export function workflowNodesToGraph(
  nodes: WorkflowNode[],
): Extract<FieldValue, { type: "graph" }> {
  const vertices: string[] = [];
  const edges: [string, string][] = [];
  const seenEdges = new Set<string>();
  const usedNames = new Map<string, number>();

  function addVertex(label: string) {
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

  function walkSequence(list: WorkflowNode[]): NodeEnds {
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

  function walkBranches(branches: Array<{ nodes?: WorkflowNode[] }>): NodeEnds {
    const starts: string[] = [];
    const ends: string[] = [];
    for (const branch of branches) {
      const result = walkSequence(branch.nodes ?? []);
      starts.push(...result.starts);
      ends.push(...result.ends);
    }
    return { starts, ends };
  }

  function walkNode(node: WorkflowNode): NodeEnds {
    const type = node.type ?? "";

    if (STEP_TYPES.has(type)) {
      const rawName = node.name?.trim() ? node.name.trim() : type;
      const name = addVertex(rawName);
      if (node.nodes && node.nodes.length > 0) {
        const inner = walkSequence(node.nodes);
        if (inner.starts.length > 0) {
          connect([name], inner.starts);
          return {
            starts: [name],
            ends: inner.ends.length ? inner.ends : [name],
          };
        }
      }
      return { starts: [name], ends: [name] };
    }

    if (type === "parallel" && node.nodes) {
      const starts: string[] = [];
      const ends: string[] = [];
      for (const child of node.nodes) {
        const result = walkNode(child);
        starts.push(...result.starts);
        ends.push(...result.ends);
      }
      return { starts, ends };
    }

    if ((type === "if" || type === "switch") && node.branches) {
      return walkBranches(node.branches);
    }

    if (type === "try") {
      const parts: NodeEnds[] = [];
      for (const block of [
        node.try_block,
        node.catch_block,
        node.finally_block,
      ]) {
        if (!block?.nodes) continue;
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
      (type === "loop" ||
        type === "block" ||
        type === "function_def" ||
        type === "start") &&
      node.nodes
    ) {
      return walkSequence(node.nodes);
    }

    if (node.nodes) {
      return walkSequence(node.nodes);
    }

    return { starts: [], ends: [] };
  }

  walkSequence(nodes);

  return { type: "graph", vertices, edges };
}
