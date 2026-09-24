// src/store/dirtyState.ts
//
// Tracks what the user has changed since the last successful load or commit.
//
// This is NOT rollup invalidation — that's handled separately by the rollup
// memo (see src/rollups/memo.ts). This tracks "things that need to go back
// to GitHub on the next commit".
//
// The baseline graph and its SHA live on the store, not here.

export interface DirtyState {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
  readonly substitutes: ReadonlySet<string>;
  /** SHA of the remote file at load / last successful commit. */
  readonly baselineSha: string | null;
}

export function emptyDirtyState(baselineSha: string | null = null): DirtyState {
  return {
    nodes: new Set(),
    edges: new Set(),
    substitutes: new Set(),
    baselineSha,
  };
}

export function markNodeDirty(state: DirtyState, nodeId: string): DirtyState {
  if (state.nodes.has(nodeId)) return state;
  const nodes = new Set(state.nodes);
  nodes.add(nodeId);
  return { ...state, nodes };
}

export function markEdgeDirty(state: DirtyState, edgeId: string): DirtyState {
  if (state.edges.has(edgeId)) return state;
  const edges = new Set(state.edges);
  edges.add(edgeId);
  return { ...state, edges };
}

export function markSubstituteDirty(
  state: DirtyState,
  substituteId: string,
): DirtyState {
  if (state.substitutes.has(substituteId)) return state;
  const substitutes = new Set(state.substitutes);
  substitutes.add(substituteId);
  return { ...state, substitutes };
}

export function clearDirty(state: DirtyState): DirtyState {
  return emptyDirtyState(state.baselineSha);
}

export function isDirty(state: DirtyState): boolean {
  return (
    state.nodes.size > 0 ||
    state.edges.size > 0 ||
    state.substitutes.size > 0
  );
}

export function withBaselineSha(
  state: DirtyState,
  sha: string | null,
): DirtyState {
  return { ...state, baselineSha: sha };
}