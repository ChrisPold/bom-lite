// src/graph/cycleDetection.ts
//
// Detects three structural issues in a BOM graph:
//   - self-references (A -> A)
//   - orphan edges  (edge whose parentId has no PartNode)
//   - cycles        (A -> B -> ... -> A)
//
// Pure functions. No I/O. No mutation of inputs.

import type { ConsumesEdge, PartNode } from "./types";

export interface GraphAnalysis {
  /** Each entry is one cycle, listed as node ids in traversal order. */
  cycles: string[][];
  /** Edge ids whose parentId has no node in the node map. */
  orphans: string[];
  /** Node ids that appear as both parent and child of the same edge. */
  selfReferences: string[];
}

/** Returns node ids that have at least one self-referencing edge. Deduped. */
export function detectSelfReferences(
  edges: readonly ConsumesEdge[],
): string[] {
  const seen = new Set<string>();
  for (const e of edges) {
    if (e.parentId === e.childId) seen.add(e.parentId);
  }
  return [...seen];
}

/** Returns edge ids whose parentId is not present in the node map. */
export function detectOrphans(
  edges: readonly ConsumesEdge[],
  nodes: ReadonlyMap<string, PartNode>,
): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (!nodes.has(e.parentId)) out.push(e.id);
  }
  return out;
}

/**
 * Returns all cycles reachable from the edge set. Self-referencing edges
 * are excluded here — use detectSelfReferences for those.
 *
 * Uses DFS with an explicit on-stack set. Each cycle is reported once.
 */
export function detectCycles(edges: readonly ConsumesEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.parentId === e.childId) continue; // handled separately
    const list = adjacency.get(e.parentId);
    if (list) list.push(e.childId);
    else adjacency.set(e.parentId, [e.childId]);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      if (start !== -1) {
        cycles.push(stack.slice(start));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    onStack.add(node);
    stack.push(node);

    const children = adjacency.get(node);
    if (children) {
      for (const c of children) dfs(c);
    }

    stack.pop();
    onStack.delete(node);
  }

  // Collect every node that appears in any edge (as parent or child).
  const allNodes = new Set<string>();
  for (const [p, children] of adjacency) {
    allNodes.add(p);
    for (const c of children) allNodes.add(c);
  }

  for (const n of allNodes) {
    if (!visited.has(n)) dfs(n);
  }

  return cycles;
}

/** Convenience wrapper: runs all three detectors and returns one object. */
export function analyzeGraph(
  edges: readonly ConsumesEdge[],
  nodes: ReadonlyMap<string, PartNode>,
): GraphAnalysis {
  return {
    cycles: detectCycles(edges),
    orphans: detectOrphans(edges, nodes),
    selfReferences: detectSelfReferences(edges),
  };
}