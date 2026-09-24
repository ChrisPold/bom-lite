// src/rollups/rollupEngine.ts
//
// Rollup engine for BOM-Lite.
//
// Two derived quantities per node:
//   totalAssemblyCost   — recursive sum of (child total × edge qty) + own unit cost
//   criticalPathLeadTime — longest lead-time path from this node to any leaf
//
// Cycles: if a node participates in a cycle (directly or transitively), its
// rollup is NaN. The NaN propagates up to every ancestor. Nothing in a
// cyclic subtree is cached.
//
// Pure functions. The memo is passed in and mutated — the caller owns it.

import type { BomGraph } from "../graph/types";
import {
  memoCostKey,
  memoLeadKey,
  type RollupMemo,
} from "./memo";

export function totalAssemblyCost(
  graph: BomGraph,
  nodeId: string,
  memo: RollupMemo = new Map(),
): number {
  return computeCost(graph, nodeId, memo, new Set<string>());
}

export function criticalPathLeadTime(
  graph: BomGraph,
  nodeId: string,
  memo: RollupMemo = new Map(),
): number {
  return computeLead(graph, nodeId, memo, new Set<string>());
}

// ─── Internal ───────────────────────────────────────────────────────────────

function computeCost(
  graph: BomGraph,
  nodeId: string,
  memo: RollupMemo,
  stack: Set<string>,
): number {
  const key = memoCostKey(nodeId);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  if (stack.has(nodeId)) return NaN;

  const node = graph.nodes.get(nodeId);
  if (!node) return NaN;

  stack.add(nodeId);
  try {
    const edgeIds = graph.edgesByParent.get(nodeId) ?? [];
    let total = node.unitCost;

    for (const edgeId of edgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const childCost = computeCost(graph, edge.childId, memo, stack);
      if (Number.isNaN(childCost)) return NaN;
      total += edge.qtyPerParent * childCost;
    }

    memo.set(key, total);
    return total;
  } finally {
    stack.delete(nodeId);
  }
}

function computeLead(
  graph: BomGraph,
  nodeId: string,
  memo: RollupMemo,
  stack: Set<string>,
): number {
  const key = memoLeadKey(nodeId);
  const cached = memo.get(key);
  if (cached !== undefined) return cached;

  if (stack.has(nodeId)) return NaN;

  const node = graph.nodes.get(nodeId);
  if (!node) return NaN;

  stack.add(nodeId);
  try {
    const edgeIds = graph.edgesByParent.get(nodeId) ?? [];
    let maxChildLead = 0;

    for (const edgeId of edgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const childLead = computeLead(graph, edge.childId, memo, stack);
      if (Number.isNaN(childLead)) return NaN;
      if (childLead > maxChildLead) maxChildLead = childLead;
    }

    const total = node.leadTimeDays + maxChildLead;
    memo.set(key, total);
    return total;
  } finally {
    stack.delete(nodeId);
  }
}