// src/views/graph/layout.ts
//
// Computes a simple top-down tree layout for the node-graph view.
//
// Algorithm (classic "reingold-tilford lite"):
//   1. Walk the visible tree bottom-up.
//   2. Leaves get consecutive integer x slots (0, 1, 2, ...).
//   3. Internal nodes get x = midpoint of their first and last child.
//   4. Depth is y in pixels (depth * Y_STEP).
//   5. Shared nodes get a distinct reactFlowId per parent, mirroring
//      the row projection's edge-keyed rows.
//   6. Collapsed nodes have no visible children.
//   7. Cycles are guarded by a per-path ancestor set.
//
// Pure function. No I/O. No store access.

import type { BomGraph } from "../../graph/types";

export const X_STEP = 220;
export const Y_STEP = 110;

export interface GraphNodeProjection {
  /** Unique per rendered instance: edge id for children, node id for roots. */
  readonly reactFlowId: string;
  /** Reference to the underlying PartNode. */
  readonly nodeId: string;
  readonly edgeId: string | null;
  readonly parentId: string | null;
  readonly depth: number;
  readonly x: number;
  readonly y: number;
}

export interface GraphEdgeProjection {
  readonly id: string;
  /** reactFlowId of the source node. */
  readonly source: string;
  /** reactFlowId of the target node. */
  readonly target: string;
  readonly qtyPerParent: number;
}

export interface GraphProjection {
  readonly nodes: GraphNodeProjection[];
  readonly edges: GraphEdgeProjection[];
}

export function projectGraph(
  graph: BomGraph,
  expanded: ReadonlySet<string>,
): GraphProjection {
  // Pass 1 — determine which nodes are "visible" in the current expansion,
  // and assign each visible instance a reactFlowId.
  interface Instance {
    reactFlowId: string;
    nodeId: string;
    edgeId: string | null;
    parentId: string | null;
    depth: number;
    children: Instance[];
  }

  let nextLeafX = 0;

  // Assign x coordinates bottom-up. Returns the x for this subtree's root.
  function assignX(inst: Instance, ancestors: Set<string>): number {
    const node = graph.nodes.get(inst.nodeId);
    if (!node) return nextLeafX++;

    const isExpanded = expanded.has(inst.nodeId);
    const childEdgeIds = isExpanded
      ? graph.edgesByParent.get(inst.nodeId) ?? []
      : [];

    if (childEdgeIds.length === 0 || ancestors.has(inst.nodeId)) {
      const x = nextLeafX++;
      (inst as Instance & { x: number }).x = x;
      return x;
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(inst.nodeId);

    const childInstances: Instance[] = [];
    for (const eid of childEdgeIds) {
      const e = graph.edges.get(eid);
      if (!e) continue;
      childInstances.push({
        reactFlowId: eid,
        nodeId: e.childId,
        edgeId: eid,
        parentId: inst.nodeId,
        depth: inst.depth + 1,
        children: [],
      });
    }

    // Recurse into children first, so leaves claim the low x slots first.
    const childXs: number[] = [];
    for (const child of childInstances) {
      childXs.push(assignX(child, nextAncestors));
    }
    inst.children = childInstances;

    if (childXs.length === 0) {
      const x = nextLeafX++;
      (inst as Instance & { x: number }).x = x;
      return x;
    }

    const x = (childXs[0]! + childXs[childXs.length - 1]!) / 2;
    (inst as Instance & { x: number }).x = x;
    return x;
  }

  const rootInstances: Instance[] = [...graph.roots]
    .filter((id) => graph.nodes.has(id))
    .sort()
    .map((nodeId) => ({
      reactFlowId: nodeId,
      nodeId,
      edgeId: null,
      parentId: null,
      depth: 0,
      children: [],
    }));

  for (const root of rootInstances) {
    assignX(root, new Set());
  }

  // Pass 2 — flatten instances into projection rows + edge rows.
  const nodes: GraphNodeProjection[] = [];
  const edges: GraphEdgeProjection[] = [];

  function emit(inst: Instance): void {
    const anyInst = inst as Instance & { x: number };
    const x = typeof anyInst.x === "number" ? anyInst.x : 0;
    nodes.push({
      reactFlowId: inst.reactFlowId,
      nodeId: inst.nodeId,
      edgeId: inst.edgeId,
      parentId: inst.parentId,
      depth: inst.depth,
      x: x * X_STEP,
      y: inst.depth * Y_STEP,
    });
    for (const child of inst.children) {
      const e = child.edgeId ? graph.edges.get(child.edgeId) : undefined;
      edges.push({
        id: child.reactFlowId,
        source: inst.reactFlowId,
        target: child.reactFlowId,
        qtyPerParent: e ? e.qtyPerParent : 1,
      });
      emit(child);
    }
  }

  for (const root of rootInstances) emit(root);

  return { nodes, edges };
}