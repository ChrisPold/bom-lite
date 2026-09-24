// src/fetchLayer/conflictMerge.ts
//
// Three-way merge for a BomGraph.
//
// Inputs:
//   base   — the graph as it existed at the last successful load/commit
//   mine   — the user's working graph (with local edits)
//   theirs — the fresh graph just fetched from GitHub
//   dirty  — which entities the user has touched since the last commit
//
// Output:
//   merged          — the graph to try to commit
//   conflicts       — any divergences the human must resolve
//   autoMergedCount — number of dirty entities that merged cleanly
//
// Rules:
//   - Non-dirty entities take `theirs` unconditionally.
//   - Dirty entities are merged field-by-field:
//       * only local changed        → take mine
//       * only remote changed       → take theirs
//       * both changed, matching    → converged, take mine
//       * both changed, different   → conflict; keep mine as working value
//   - Add/delete vs edit is a whole-entity conflict (field: "*").
//
// Pure function. No network. No store access.

import type {
  BomGraph,
  ConsumesEdge,
  PartNode,
  SubstituteEdge,
} from "../graph/types";
import type { DirtyState } from "../store/dirtyState";

export type ConflictEntityKind = "node" | "edge" | "substitute";

export interface ConflictRow {
  readonly entityKind: ConflictEntityKind;
  readonly id: string;
  /** Field name, or "*" for whole-entity add/delete conflicts. */
  readonly field: string;
  readonly base: unknown;
  readonly mine: unknown;
  readonly theirs: unknown;
}

export interface MergeInput {
  readonly base: BomGraph;
  readonly mine: BomGraph;
  readonly theirs: BomGraph;
  readonly dirty: DirtyState;
}

export interface MergeResult {
  readonly merged: BomGraph;
  readonly conflicts: readonly ConflictRow[];
  readonly autoMergedCount: number;
}

export function conflictMerge(input: MergeInput): MergeResult {
  const { base, mine, theirs, dirty } = input;

  const conflicts: ConflictRow[] = [];
  let autoMergedCount = 0;

  const mergedNodes = mergeCollection<PartNode>(
    "node",
    base.nodes,
    mine.nodes,
    theirs.nodes,
    dirty.nodes,
    conflicts,
    nodeFields,
  );
  autoMergedCount += mergedNodes.autoMerged;

  const mergedEdges = mergeCollection<ConsumesEdge>(
    "edge",
    base.edges,
    mine.edges,
    theirs.edges,
    dirty.edges,
    conflicts,
    edgeFields,
  );
  autoMergedCount += mergedEdges.autoMerged;

  const mergedSubstitutes = mergeCollection<SubstituteEdge>(
    "substitute",
    base.substitutes,
    mine.substitutes,
    theirs.substitutes,
    dirty.substitutes,
    conflicts,
    substituteFields,
  );
  autoMergedCount += mergedSubstitutes.autoMerged;

  const merged: BomGraph = rebuildGraph(
    mergedNodes.map,
    mergedEdges.map,
    mergedSubstitutes.map,
  );

  return { merged, conflicts, autoMergedCount };
}

// ─── Collection merging ─────────────────────────────────────────────────────

interface MergeCollectionResult<T> {
  map: Map<string, T>;
  autoMerged: number;
}

function mergeCollection<T>(
  kind: ConflictEntityKind,
  base: ReadonlyMap<string, T>,
  mine: ReadonlyMap<string, T>,
  theirs: ReadonlyMap<string, T>,
  dirtyIds: ReadonlySet<string>,
  conflicts: ConflictRow[],
  fieldsOf: (entity: T) => Record<string, unknown>,
): MergeCollectionResult<T> {
  const ids = new Set<string>([
    ...base.keys(),
    ...mine.keys(),
    ...theirs.keys(),
  ]);

  const result = new Map<string, T>();
  let autoMerged = 0;

  for (const id of ids) {
    const b = base.get(id);
    const m = mine.get(id);
    const t = theirs.get(id);

    // Non-dirty: take theirs.
    if (!dirtyIds.has(id)) {
      if (t !== undefined) result.set(id, t);
      continue;
    }

    // ── Dirty: local delete
    if (m === undefined) {
      if (t === undefined || entitiesEqual(b, t)) {
        // Both deleted, or remote unchanged → accept the delete.
        autoMerged += 1;
        continue;
      }
      // Delete vs remote edit.
      conflicts.push({
        entityKind: kind,
        id,
        field: "*",
        base: b,
        mine: undefined,
        theirs: t,
      });
      continue;
    }

    // ── Dirty: local add
    if (b === undefined) {
      if (t === undefined || entitiesEqual(m, t)) {
        result.set(id, m);
        autoMerged += 1;
        continue;
      }
      conflicts.push({
        entityKind: kind,
        id,
        field: "*",
        base: undefined,
        mine: m,
        theirs: t,
      });
      result.set(id, m);
      continue;
    }

    // ── Dirty: modify. Remote deleted?
    if (t === undefined) {
      conflicts.push({
        entityKind: kind,
        id,
        field: "*",
        base: b,
        mine: m,
        theirs: undefined,
      });
      result.set(id, m);
      continue;
    }

    // ── Dirty: modify on both sides. Field-by-field merge.
    const { merged: mergedFields, conflicts: fieldConflicts } = mergeFields(
      fieldsOf(b),
      fieldsOf(m),
      fieldsOf(t),
    );

    if (fieldConflicts.length === 0) {
      autoMerged += 1;
    }

    // Rebuild the entity: start from mine (preserves id and non-diffable
    // props), then overlay the merged fields.
    const mergedEntity = { ...m } as T;
    const asRecord = mergedEntity as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(mergedFields)) {
      asRecord[k] = v;
    }
    result.set(id, mergedEntity);

    for (const fc of fieldConflicts) {
      conflicts.push({
        entityKind: kind,
        id,
        field: fc.field,
        base: fc.base,
        mine: fc.mine,
        theirs: fc.theirs,
      });
    }
  }

  return { map: result, autoMerged };
}

// ─── Field-level merge ──────────────────────────────────────────────────────

interface FieldConflict {
  field: string;
  base: unknown;
  mine: unknown;
  theirs: unknown;
}

function mergeFields(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): {
  merged: Record<string, unknown>;
  conflicts: FieldConflict[];
} {
  const merged: Record<string, unknown> = {};
  const conflicts: FieldConflict[] = [];
  const keys = new Set<string>([
    ...Object.keys(base),
    ...Object.keys(mine),
    ...Object.keys(theirs),
  ]);

  for (const field of keys) {
    const b = base[field];
    const m = mine[field];
    const t = theirs[field];

    const localChanged = !sameValue(m, b);
    const remoteChanged = !sameValue(t, b);

    if (!localChanged && !remoteChanged) {
      merged[field] = b;
      continue;
    }

    if (!localChanged && remoteChanged) {
      // Only remote changed → adopt theirs silently.
      merged[field] = t;
      continue;
    }

    if (localChanged && !remoteChanged) {
      // Only local changed → keep mine silently.
      merged[field] = m;
      continue;
    }

    // Both changed.
    if (sameValue(m, t)) {
      merged[field] = m; // converged
      continue;
    }

    merged[field] = m; // keep mine as working value
    conflicts.push({ field, base: b, mine: m, theirs: t });
  }

  return { merged, conflicts };
}

function entitiesEqual<T>(a: T | undefined, b: T | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  return sameValue(a, b);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ─── Field extraction ───────────────────────────────────────────────────────

function nodeFields(n: PartNode): Record<string, unknown> {
  return {
    partNumber: n.partNumber,
    revision: n.revision,
    description: n.description,
    status: n.status,
    uom: n.uom,
    unitCost: n.unitCost,
    leadTimeDays: n.leadTimeDays,
    supplier: n.supplier,
    mpn: n.mpn,
    cadPath: n.cadPath,
    drawingPath: n.drawingPath,
  };
}

function edgeFields(e: ConsumesEdge): Record<string, unknown> {
  return {
    parentId: e.parentId,
    childId: e.childId,
    qtyPerParent: e.qtyPerParent,
    rowIndex: e.rowIndex,
  };
}

function substituteFields(s: SubstituteEdge): Record<string, unknown> {
  return {
    primaryId: s.primaryId,
    substituteId: s.substituteId,
    scopeParentId: s.scopeParentId,
    bidirectional: s.bidirectional,
  };
}

// ─── Index rebuild ──────────────────────────────────────────────────────────

function rebuildGraph(
  nodes: Map<string, PartNode>,
  edges: Map<string, ConsumesEdge>,
  substitutes: Map<string, SubstituteEdge>,
): BomGraph {
  const edgesByParent = new Map<string, readonly string[]>();
  const edgesByChild = new Map<string, readonly string[]>();
  const substitutesByPart = new Map<string, readonly string[]>();

  for (const e of edges.values()) {
    append(edgesByParent, e.parentId, e.id);
    append(edgesByChild, e.childId, e.id);
  }
  for (const s of substitutes.values()) {
    append(substitutesByPart, s.primaryId, s.id);
  }

  const childIds = new Set<string>();
  for (const e of edges.values()) childIds.add(e.childId);

  const roots = [...nodes.keys()].filter((id) => !childIds.has(id));

  return {
    nodes,
    edges,
    substitutes,
    edgesByParent,
    edgesByChild,
    substitutesByPart,
    roots,
    orphans: [],
    cycles: [],
  };
}

function append(
  map: Map<string, readonly string[]>,
  key: string,
  value: string,
): void {
  const list = map.get(key);
  if (list) {
    map.set(key, [...list, value]);
  } else {
    map.set(key, [value]);
  }
}