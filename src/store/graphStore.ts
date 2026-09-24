// src/store/graphStore.ts
//
// The single source of truth for the app's view-layer state.
//
// Invariants:
//   - baselineGraph is set once on load, updated only on a successful
//     commit or discard. It is the "known-good" snapshot.
//   - graph is the live, mutable graph the user sees.
//   - Mutations go through actions (see actions.ts). Views never set state.
//   - The store lives on the main thread only. No worker imports.
//   - Nothing here fetches, parses, or renders.
//   - Collapsing a node clears its entire subtree from the expanded set,
//     so re-expanding shows only direct children.

import { create } from "zustand";
import type { BomGraph } from "../graph/types";
import { emptyDirtyState, type DirtyState } from "./dirtyState";

export type ActiveView = "grid" | "graph" | "3d";

export interface Selection {
  readonly selectedNodeId: string | null;
}

export interface UiState {
  readonly activeView: ActiveView;
  readonly gridExpandedRows: ReadonlySet<string>;
  readonly graphExpandedNodes: ReadonlySet<string>;
}

export interface GraphStoreState {
  graph: BomGraph;
  baselineGraph: BomGraph;
  dirty: DirtyState;
  selection: Selection;
  ui: UiState;

  __setGraph: (graph: BomGraph) => void;
  __loadFresh: (graph: BomGraph, sha: string | null) => void;
  __discard: () => void;
  __setDirty: (dirty: DirtyState) => void;
  __selectNode: (nodeId: string | null) => void;
  __setActiveView: (view: ActiveView) => void;
  __toggleGridRow: (edgeId: string) => void;
  __toggleGraphNode: (nodeId: string) => void;
}

const EMPTY_GRAPH: BomGraph = {
  nodes: new Map(),
  edges: new Map(),
  substitutes: new Map(),
  edgesByParent: new Map(),
  edgesByChild: new Map(),
  substitutesByPart: new Map(),
  roots: [],
  orphans: [],
  cycles: [],
};

const INITIAL_SELECTION: Selection = { selectedNodeId: null };

const INITIAL_UI: UiState = {
  activeView: "grid",
  gridExpandedRows: new Set(),
  graphExpandedNodes: new Set(),
};

/**
 * Walk the subtree under `startNodeId` and delete every visited node
 * from `set`. Cycle-safe.
 */
function clearSubtree(
  graph: BomGraph,
  startNodeId: string,
  set: Set<string>,
): void {
  const visited = new Set<string>();
  const queue: string[] = [startNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    set.delete(current);
    for (const eid of graph.edgesByParent.get(current) ?? []) {
      const edge = graph.edges.get(eid);
      if (edge) queue.push(edge.childId);
    }
  }
}

function toggleInSet(
  current: ReadonlySet<string>,
  key: string,
  graph: BomGraph,
): Set<string> {
  const next = new Set(current);
  if (next.has(key)) {
    // Collapse: remove the key and every descendant.
    clearSubtree(graph, key, next);
  } else {
    next.add(key);
  }
  return next;
}

export const useGraphStore = create<GraphStoreState>((set, get) => ({
  graph: EMPTY_GRAPH,
  baselineGraph: EMPTY_GRAPH,
  dirty: emptyDirtyState(),
  selection: INITIAL_SELECTION,
  ui: INITIAL_UI,

  __setGraph: (graph) => set({ graph }),

  __loadFresh: (graph, sha) =>
    set({
      graph,
      baselineGraph: graph,
      dirty: emptyDirtyState(sha),
      selection: INITIAL_SELECTION,
      ui: INITIAL_UI,
    }),

  __discard: () => {
    const { baselineGraph, dirty } = get();
    set({
      graph: baselineGraph,
      dirty: emptyDirtyState(dirty.baselineSha),
      selection: INITIAL_SELECTION,
    });
  },

  __setDirty: (dirty) => set({ dirty }),

  __selectNode: (nodeId) => set({ selection: { selectedNodeId: nodeId } }),

  __setActiveView: (view) =>
    set((state) => ({ ui: { ...state.ui, activeView: view } })),

  __toggleGridRow: (edgeId) =>
    set((state) => ({
      ui: {
        ...state.ui,
        gridExpandedRows: toggleInSet(
          state.ui.gridExpandedRows,
          edgeId,
          state.graph,
        ),
      },
    })),

  __toggleGraphNode: (nodeId) =>
    set((state) => ({
      ui: {
        ...state.ui,
        graphExpandedNodes: toggleInSet(
          state.ui.graphExpandedNodes,
          nodeId,
          state.graph,
        ),
      },
    })),
}));

export function __resetStoreForTests(): void {
  useGraphStore.setState({
    graph: EMPTY_GRAPH,
    baselineGraph: EMPTY_GRAPH,
    dirty: emptyDirtyState(),
    selection: INITIAL_SELECTION,
    ui: INITIAL_UI,
  });
}