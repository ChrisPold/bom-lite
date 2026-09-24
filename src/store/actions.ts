// src/store/actions.ts
//
// All graph mutations go through here. Views dispatch these; they never
// call useGraphStore.setState directly.

import type {
  BomGraph,
  ConsumesEdge,
  PartNode,
  Status,
  SubstituteEdge,
} from "../graph/types";
import { makeNodeId } from "../graph/revisionResolver";
import {
  criticalPathLeadTime,
  totalAssemblyCost,
} from "../rollups/rollupEngine";
import { invalidateAncestors, type RollupMemo } from "../rollups/memo";
import {
  markEdgeDirty,
  markNodeDirty,
  markSubstituteDirty,
} from "./dirtyState";
import { useGraphStore, type ActiveView } from "./graphStore";
import { getToken } from "../fetchLayer/tokenStore";
import { loadRepoConfig } from "../app/repoConfig";

export const rollupMemo: RollupMemo = new Map();

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function loadGraph(graph: BomGraph, sha: string | null): void {
  rollupMemo.clear();
  useGraphStore.getState().__loadFresh(graph, sha);
}

export function discard(): void {
  rollupMemo.clear();
  useGraphStore.getState().__discard();
}

export function selectNode(nodeId: string | null): void {
  useGraphStore.getState().__selectNode(nodeId);
}

export function setActiveView(view: ActiveView): void {
  useGraphStore.getState().__setActiveView(view);
}

export function toggleGridRow(edgeId: string): void {
  useGraphStore.getState().__toggleGridRow(edgeId);
}

export function toggleGraphNode(nodeId: string): void {
  useGraphStore.getState().__toggleGraphNode(nodeId);
}

// ─── Node mutations ─────────────────────────────────────────────────────────

export type NodeField =
  | "description"
  | "status"
  | "uom"
  | "unitCost"
  | "leadTimeDays"
  | "supplier"
  | "mpn"
  | "cadPath"
  | "drawingPath";

const ROLLUP_AFFECTING_NODE_FIELDS: ReadonlySet<NodeField> = new Set([
  "unitCost",
  "leadTimeDays",
]);

export function updateNodeField<K extends NodeField>(
  nodeId: string,
  field: K,
  value: PartNode[K],
): void {
  const state = useGraphStore.getState();
  const node = state.graph.nodes.get(nodeId);
  if (!node) return;
  if (node[field] === value) return;

  const updated: PartNode = { ...node, [field]: value };
  const nodes = new Map(state.graph.nodes);
  nodes.set(nodeId, updated);
  const graph: BomGraph = { ...state.graph, nodes };

  state.__setGraph(graph);
  state.__setDirty(markNodeDirty(state.dirty, nodeId));

  if (ROLLUP_AFFECTING_NODE_FIELDS.has(field)) {
    invalidateAndRecompute(graph, nodeId);
  }
}

export function addChildNode(
  parentId: string,
  child: {
    partNumber: string;
    revision: string;
    description?: string;
    status?: Status;
    uom?: string;
    unitCost?: number;
    leadTimeDays?: number;
  },
): void {
  const state = useGraphStore.getState();
  if (!state.graph.nodes.has(parentId)) return;

  const childId = makeNodeId(child.partNumber, child.revision);
  const existing = state.graph.nodes.get(childId);

  const childNode: PartNode = existing ?? {
    id: childId,
    partNumber: child.partNumber,
    revision: child.revision,
    description: child.description ?? "",
    status: child.status ?? "WIP",
    uom: child.uom ?? "EA",
    unitCost: child.unitCost ?? 0,
    leadTimeDays: child.leadTimeDays ?? 0,
  };

  const rowIndex = state.graph.edges.size;
  const edgeId = `${parentId}->${childId}::row${rowIndex}`;
  const edge: ConsumesEdge = {
    id: edgeId,
    parentId,
    childId,
    qtyPerParent: 1,
    rowIndex,
  };

  const nodes = new Map(state.graph.nodes);
  if (!existing) nodes.set(childId, childNode);

  const edges = new Map(state.graph.edges);
  edges.set(edgeId, edge);

  const edgesByParent = copyAndAppend(
    state.graph.edgesByParent,
    parentId,
    edgeId,
  );
  const edgesByChild = copyAndAppend(
    state.graph.edgesByChild,
    childId,
    edgeId,
  );

  const roots = state.graph.roots.filter((id) => id !== childId);

  const graph: BomGraph = {
    ...state.graph,
    nodes,
    edges,
    edgesByParent,
    edgesByChild,
    roots,
  };

  state.__setGraph(graph);

  let dirty = state.dirty;
  dirty = markNodeDirty(dirty, childId);
  dirty = markEdgeDirty(dirty, edgeId);
  state.__setDirty(dirty);

  invalidateAndRecompute(graph, parentId);
}

// ─── Edge mutations ─────────────────────────────────────────────────────────

export function updateEdgeQty(edgeId: string, qty: number): void {
  const state = useGraphStore.getState();
  const edge = state.graph.edges.get(edgeId);
  if (!edge) return;
  if (edge.qtyPerParent === qty) return;
  if (!Number.isFinite(qty)) return;

  const updated: ConsumesEdge = { ...edge, qtyPerParent: qty };
  const edges = new Map(state.graph.edges);
  edges.set(edgeId, updated);
  const graph: BomGraph = { ...state.graph, edges };

  state.__setGraph(graph);
  state.__setDirty(markEdgeDirty(state.dirty, edgeId));

  invalidateAndRecompute(graph, edge.parentId);
}

export function removeEdge(edgeId: string): void {
  const state = useGraphStore.getState();
  const edge = state.graph.edges.get(edgeId);
  if (!edge) return;

  const edges = new Map(state.graph.edges);
  edges.delete(edgeId);

  const edgesByParent = copyAndRemove(
    state.graph.edgesByParent,
    edge.parentId,
    edgeId,
  );
  const edgesByChild = copyAndRemove(
    state.graph.edgesByChild,
    edge.childId,
    edgeId,
  );

  const remainingIncoming = edgesByChild.get(edge.childId) ?? [];
  const roots =
    remainingIncoming.length === 0
      ? [...new Set([...state.graph.roots, edge.childId])]
      : state.graph.roots;

  const graph: BomGraph = {
    ...state.graph,
    edges,
    edgesByParent,
    edgesByChild,
    roots,
  };

  state.__setGraph(graph);
  state.__setDirty(markEdgeDirty(state.dirty, edgeId));

  invalidateAndRecompute(graph, edge.parentId);
}

export function reparentEdge(edgeId: string, newParentId: string): void {
  const state = useGraphStore.getState();
  const edge = state.graph.edges.get(edgeId);
  if (!edge) return;
  if (!state.graph.nodes.has(newParentId)) return;
  if (edge.parentId === newParentId) return;
  if (edge.childId === newParentId) return;
  if (isDescendant(state.graph, edge.childId, newParentId)) return;

  const updated: ConsumesEdge = {
    ...edge,
    id: `${newParentId}->${edge.childId}::row${edge.rowIndex}`,
    parentId: newParentId,
  };

  const edges = new Map(state.graph.edges);
  edges.delete(edgeId);
  edges.set(updated.id, updated);

  const edgesByParent = copyAndRemove(
    state.graph.edgesByParent,
    edge.parentId,
    edgeId,
  );
  const withNewParent = copyAndAppend(
    edgesByParent,
    newParentId,
    updated.id,
  );
  const edgesByChild = copyAndRemove(
    state.graph.edgesByChild,
    edge.childId,
    edgeId,
  );
  const withNewChild = copyAndAppend(
    edgesByChild,
    edge.childId,
    updated.id,
  );

  const graph: BomGraph = {
    ...state.graph,
    edges,
    edgesByParent: withNewParent,
    edgesByChild: withNewChild,
  };

  state.__setGraph(graph);

  let dirty = state.dirty;
  dirty = markEdgeDirty(dirty, edgeId);
  dirty = markEdgeDirty(dirty, updated.id);
  state.__setDirty(dirty);

  invalidateAndRecompute(graph, edge.parentId);
  invalidateAndRecompute(graph, newParentId);
}

export function removeNode(nodeId: string): void {
  const state = useGraphStore.getState();
  if (!state.graph.nodes.has(nodeId)) return;

  const nodes = new Map(state.graph.nodes);
  nodes.delete(nodeId);

  const edges = new Map(state.graph.edges);
  const edgesByParent = cloneMapOfLists(state.graph.edgesByParent);
  const edgesByChild = cloneMapOfLists(state.graph.edgesByChild);
  const removedEdgeIds: string[] = [];

  for (const [eid, e] of state.graph.edges) {
    if (e.parentId === nodeId || e.childId === nodeId) {
      edges.delete(eid);
      removedEdgeIds.push(eid);
      removeFromList(edgesByParent, e.parentId, eid);
      removeFromList(edgesByChild, e.childId, eid);
    }
  }

  const substitutes = new Map(state.graph.substitutes);
  const substitutesByPart = cloneMapOfLists(state.graph.substitutesByPart);
  const removedSubIds: string[] = [];

  for (const [sid, s] of state.graph.substitutes) {
    if (
      s.primaryId === nodeId ||
      s.substituteId === nodeId ||
      s.scopeParentId === nodeId
    ) {
      substitutes.delete(sid);
      removedSubIds.push(sid);
      removeFromList(substitutesByPart, s.primaryId, sid);
    }
  }

  const roots = state.graph.roots.filter((id) => id !== nodeId);

  const graph: BomGraph = {
    ...state.graph,
    nodes,
    edges,
    substitutes,
    edgesByParent,
    edgesByChild,
    substitutesByPart,
    roots,
  };

  state.__setGraph(graph);

  let dirty = markNodeDirty(state.dirty, nodeId);
  for (const eid of removedEdgeIds) dirty = markEdgeDirty(dirty, eid);
  for (const sid of removedSubIds) dirty = markSubstituteDirty(dirty, sid);
  state.__setDirty(dirty);

  rollupMemo.clear();
}

// ─── Substitute mutations ───────────────────────────────────────────────────

export function addSubstitute(
  primaryId: string,
  substituteId: string,
  scopeParentId: string | undefined,
): void {
  const state = useGraphStore.getState();
  if (!state.graph.nodes.has(primaryId)) return;
  if (!state.graph.nodes.has(substituteId)) return;
  if (primaryId === substituteId) return;

  const scope = scopeParentId ?? "global";
  const id = `${primaryId}~sub~${substituteId}::${scope}`;
  if (state.graph.substitutes.has(id)) return;

  const sub: SubstituteEdge = {
    id,
    primaryId,
    substituteId,
    scopeParentId,
    bidirectional: true,
  };

  const substitutes = new Map(state.graph.substitutes);
  substitutes.set(id, sub);
  const substitutesByPart = copyAndAppend(
    state.graph.substitutesByPart,
    primaryId,
    id,
  );

  const graph: BomGraph = {
    ...state.graph,
    substitutes,
    substitutesByPart,
  };

  state.__setGraph(graph);
  state.__setDirty(markSubstituteDirty(state.dirty, id));
}

export function removeSubstitute(substituteEdgeId: string): void {
  const state = useGraphStore.getState();
  const sub = state.graph.substitutes.get(substituteEdgeId);
  if (!sub) return;

  const substitutes = new Map(state.graph.substitutes);
  substitutes.delete(substituteEdgeId);
  const substitutesByPart = copyAndRemove(
    state.graph.substitutesByPart,
    sub.primaryId,
    substituteEdgeId,
  );

  const graph: BomGraph = {
    ...state.graph,
    substitutes,
    substitutesByPart,
  };

  state.__setGraph(graph);
  state.__setDirty(markSubstituteDirty(state.dirty, substituteEdgeId));
}

// ─── Commit ─────────────────────────────────────────────────────────────────

export interface CommitOutcome {
  newSha: string | null;
  conflicts: unknown[] | null;
}

export async function commit(message: string): Promise<CommitOutcome> {
  const state = useGraphStore.getState();

  const token = getToken();
  if (!token) {
    throw new Error("No GitHub token set");
  }

  const repoConfig = loadRepoConfig();
  if (!repoConfig.owner || !repoConfig.repo) {
    throw new Error("No repository configured");
  }

  const { commit: commitImpl } = await import("../writeBack/commit");

  const result = await commitImpl({
    graph: state.graph,
    baselineGraph: state.baselineGraph,
    dirty: state.dirty,
    owner: repoConfig.owner,
    repo: repoConfig.repo,
    path: repoConfig.path,
    branch: repoConfig.branch,
    token,
    message,
  });

  if (result.newSha && result.conflicts === null) {
    markCommitted(result.newSha);
  }

  return {
    newSha: result.newSha,
    conflicts: result.conflicts ? [...result.conflicts] : null,
  };
}

/**
 * Record a successful commit: the current graph becomes the baseline,
 * dirty state resets, sha updates. Does NOT touch the live graph.
 */
export function markCommitted(sha: string): void {
  const state = useGraphStore.getState();
  useGraphStore.setState({
    baselineGraph: state.graph,
    dirty: {
      nodes: new Set(),
      edges: new Set(),
      substitutes: new Set(),
      baselineSha: sha,
    },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function invalidateAndRecompute(graph: BomGraph, nodeId: string): void {
  invalidateAncestors(nodeId, graph, rollupMemo);
  totalAssemblyCost(graph, nodeId, rollupMemo);
  criticalPathLeadTime(graph, nodeId, rollupMemo);
}

function copyAndAppend<K, V>(
  map: ReadonlyMap<K, readonly V[]>,
  key: K,
  value: V,
): Map<K, readonly V[]> {
  const next = new Map<K, readonly V[]>();
  for (const [k, v] of map) next.set(k, v);
  const list = map.get(key) ?? [];
  if (list.includes(value)) return next;
  next.set(key, [...list, value]);
  return next;
}

function copyAndRemove<K, V>(
  map: ReadonlyMap<K, readonly V[]>,
  key: K,
  value: V,
): Map<K, readonly V[]> {
  const next = new Map<K, readonly V[]>();
  for (const [k, v] of map) next.set(k, v);
  const list = map.get(key);
  if (!list) return next;
  const filtered = list.filter((v) => v !== value);
  if (filtered.length === 0) next.delete(key);
  else next.set(key, filtered);
  return next;
}

function cloneMapOfLists<K, V>(
  map: ReadonlyMap<K, readonly V[]>,
): Map<K, readonly V[]> {
  const next = new Map<K, readonly V[]>();
  for (const [k, v] of map) next.set(k, v);
  return next;
}

function removeFromList<K, V>(
  map: Map<K, readonly V[]>,
  key: K,
  value: V,
): void {
  const list = map.get(key);
  if (!list) return;
  const filtered = list.filter((v) => v !== value);
  if (filtered.length === 0) map.delete(key);
  else map.set(key, filtered);
}

function isDescendant(
  graph: BomGraph,
  ancestorId: string,
  candidateId: string,
): boolean {
  const visited = new Set<string>();
  const queue: string[] = [ancestorId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur === candidateId && cur !== ancestorId) return true;
    for (const eid of graph.edgesByParent.get(cur) ?? []) {
      const e = graph.edges.get(eid);
      if (e) queue.push(e.childId);
    }
  }
  return false;
}