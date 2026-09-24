// src/views/grid/rowProjection.ts
//
// Flattens a BomGraph into an ordered list of grid rows.
//
// Rules:
//   - One row per root node, plus one row per ConsumesEdge.
//   - A shared node appears once per parent (once per incoming edge).
//   - Collapsed nodes do not recurse into their children.
//   - Deterministic ordering: roots sorted by (partNumber, revision),
//     children sorted by (childPartNumber, childRevision, edgeId).
//   - Cycles are guarded by a per-path ancestor set; a cycle does not
//     cause infinite recursion and the cyclic edge is still shown.
//
// Pure function. No I/O. No store access.

import type { BomGraph, PartNode } from "../../graph/types";

export interface GridRow {
  /** Stable key for React. Edge id for edge rows; node id for root rows. */
  readonly key: string;
  readonly nodeId: string;
  /** Edge id, or null for a root row. */
  readonly edgeId: string | null;
  /** Zero-based nesting depth. Roots are 0. */
  readonly depth: number;
  /** True if this node has any outgoing edges. */
  readonly hasChildren: boolean;
  /** True if this node's children are currently visible. */
  readonly isExpanded: boolean;
  /** Quantity per parent, or null for a root row. */
  readonly qtyPerParent: number | null;
  /** Parent node id, or null for a root row. */
  readonly parentId: string | null;
  /** The underlying node. */
  readonly node: PartNode;
}

export function projectRows(
  graph: BomGraph,
  expandedNodes: ReadonlySet<string>,
): GridRow[] {
  const rows: GridRow[] = [];

  const sortedRootIds = [...graph.roots]
    .filter((id) => graph.nodes.has(id))
    .sort((a, b) => compareNodes(graph.nodes.get(a), graph.nodes.get(b)));

  for (const rootId of sortedRootIds) {
    walk(graph, rootId, null, null, 0, expandedNodes, rows, new Set());
  }

  return rows;
}

function walk(
  graph: BomGraph,
  nodeId: string,
  edgeId: string | null,
  parentId: string | null,
  depth: number,
  expandedNodes: ReadonlySet<string>,
  rows: GridRow[],
  ancestors: Set<string>,
): void {
  const node = graph.nodes.get(nodeId);
  if (!node) return;

  const childEdgeIds = graph.edgesByParent.get(nodeId) ?? [];
  const hasChildren = childEdgeIds.length > 0;
  const isExpanded = hasChildren && expandedNodes.has(nodeId);
  const edge = edgeId ? graph.edges.get(edgeId) : undefined;
  const qtyPerParent = edge ? edge.qtyPerParent : null;

  rows.push({
    key: edgeId ?? nodeId,
    nodeId,
    edgeId,
    depth,
    hasChildren,
    isExpanded,
    qtyPerParent,
    parentId,
    node,
  });

  if (!isExpanded) return;
  if (ancestors.has(nodeId)) return; // cycle guard

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(nodeId);

  const sortedChildEdgeIds = [...childEdgeIds].sort((a, b) => {
    const ea = graph.edges.get(a);
    const eb = graph.edges.get(b);
    if (!ea || !eb) return 0;
    const na = graph.nodes.get(ea.childId);
    const nb = graph.nodes.get(eb.childId);
    const cmp = compareNodes(na, nb);
    if (cmp !== 0) return cmp;
    return ea.id.localeCompare(eb.id);
  });

  for (const childEdgeId of sortedChildEdgeIds) {
    const childEdge = graph.edges.get(childEdgeId);
    if (!childEdge) continue;
    walk(
      graph,
      childEdge.childId,
      childEdge.id,
      nodeId,
      depth + 1,
      expandedNodes,
      rows,
      nextAncestors,
    );
  }
}

function compareNodes(
  a: PartNode | undefined,
  b: PartNode | undefined,
): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.partNumber !== b.partNumber) {
    return a.partNumber.localeCompare(b.partNumber);
  }
  return a.revision.localeCompare(b.revision, undefined, { numeric: true });
}