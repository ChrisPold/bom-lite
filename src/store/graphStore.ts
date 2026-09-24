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

import { create } from "zustand";
import type { BomGraph } from "../graph/types";
import {
  emptyDirtyState,
  type DirtyState,
} from "./dirtyState";

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

  // Low-level setters. Higher-level actions live in actions.ts and call
  // these through the store's setter.
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

  __selectNode: (nodeId) =>
    set({ selection: { selectedNodeId: nodeId } }),

  __setActiveView: (view) =>
    set((state) => ({ ui: { ...state.ui, activeView: view } })),

  __toggleGridRow: (edgeId) =>
    set((state) => {
      const next = new Set(state.ui.gridExpandedRows);
      if (next.has(edgeId)) next.delete(edgeId);
      else next.add(edgeId);
      return { ui: { ...state.ui, gridExpandedRows: next } };
    }),

  __toggleGraphNode: (nodeId) =>
    set((state) => {
      const next = new Set(state.ui.graphExpandedNodes);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return { ui: { ...state.ui, graphExpandedNodes: next } };
    }),
}));

/**
 * Reset the store to its initial state. Test helper only.
 * Not exported from the app — used by unit tests to isolate cases.
 */
export function __resetStoreForTests(): void {
  useGraphStore.setState({
    graph: EMPTY_GRAPH,
    baselineGraph: EMPTY_GRAPH,
    dirty: emptyDirtyState(),
    selection: INITIAL_SELECTION,
    ui: INITIAL_UI,
  });
}