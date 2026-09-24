// src/rollups/memo.ts
//
// Memoization helpers for the rollup engine.
//
// The rollup engine caches two derived values per node:
//   - totalAssemblyCost  (key: `cost:${nodeId}`)
//   - criticalPathLeadTime (key: `lead:${nodeId}`)
//
// One Map<string, number> holds both, disambiguated by prefix, so callers
// only have to thread one memo through the pipeline.

import type { BomGraph } from "../graph/types";

export type RollupMemo = Map<string, number>;

export const MEMO_COST_PREFIX = "cost:";
export const MEMO_LEAD_PREFIX = "lead:";

export function memoCostKey(nodeId: string): string {
  return `${MEMO_COST_PREFIX}${nodeId}`;
}

export function memoLeadKey(nodeId: string): string {
  return `${MEMO_LEAD_PREFIX}${nodeId}`;
}

/**
 * Delete cached rollups for `nodeId` and every ancestor reachable via
 * edgesByChild. Handles diamonds and cycles without infinite loops.
 *
 * Call this after any mutation that changes a node's unitCost, leadTimeDays,
 * or the set of edges below it.
 */
export function invalidateAncestors(
  nodeId: string,
  graph: BomGraph,
  memo: RollupMemo,
): void {
  const visited = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    memo.delete(memoCostKey(current));
    memo.delete(memoLeadKey(current));

    const parentEdgeIds = graph.edgesByChild.get(current) ?? [];
    for (const edgeId of parentEdgeIds) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      queue.push(edge.parentId);
    }
  }
}

/**
 * Clear the entire memo. Use on graph replacement (load, commit, discard).
 */
export function clearMemo(memo: RollupMemo): void {
  memo.clear();
}