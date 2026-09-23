// src/graph/graphBuilder.ts
//
// Transforms parsed RawRow[] into a BomGraph.
//
// This is the load-bearing module of the entire pipeline. Everything
// downstream (rollups, dirty state, write-back, views) depends on the
// graph this produces being structurally correct.
//
// Invariants (each has a corresponding test):
//   1. Nodes are deduplicated by `${Part_Number}::${Revision}`.
//   2. Conflicting intrinsic fields across duplicate rows produce an
//      INTRINSIC_FIELD_CONFLICT diagnostic. First explicit value wins;
//      a value that is missing on the first row but defined on a later
//      row is adopted (missing ≠ disagreeing).
//   3. Edges are never deduplicated. Two rows with the same (parent, child)
//      produce two distinct ConsumesEdge entries with distinct ids.
//   4. Edge id format: `${parentId}->${childId}::row${__rowIndex}`.
//   5. Rows without a Parent_Part_Number push their child id into roots.
//      They do NOT produce a ConsumesEdge.
//   6. Rows whose parent part cannot be resolved produce a diagnostic and
//      no edge. The child node still exists.
//   7. Indexes (edgesByParent, edgesByChild, substitutesByPart) are built
//      after all nodes/edges/substitutes exist.
//
// Pure function. No I/O. No worker. No store.

import {
  DIAGNOSTIC_CODES,
  type DiagnosticCode,
  type RawRow,
  type RowDiagnostic,
} from "../parser/schema";
import type {
  BomGraph,
  ConsumesEdge,
  PartNode,
  Status,
  SubstituteEdge,
} from "./types";
import {
  buildNodesIndex,
  resolveParent,
  type NodesIndex,
} from "./revisionResolver";
import { analyzeGraph } from "./cycleDetection";
import { buildSubstituteEdges } from "./substituteBuilder";

// ─── Public API ─────────────────────────────────────────────────────────────

export interface BuildGraphResult {
  graph: BomGraph;
  diagnostics: RowDiagnostic[];
}

export function buildGraph(rows: readonly RawRow[]): BuildGraphResult {
  const diagnostics: RowDiagnostic[] = [];

  // Pass 1 — nodes
  const nodes = new Map<string, PartNode>();
  const mutableNodes = new Map<string, MutableNode>();
  const explicitFields = new Map<string, Set<IntrinsicField>>();
  const rowChildId = new Map<number, string | null>();

  for (const row of rows) {
    const candidate = rowToMutableNode(row, diagnostics);
    if (candidate === null) {
      rowChildId.set(row.__rowIndex, null);
      continue;
    }

    const existing = mutableNodes.get(candidate.id);
    if (existing) {
      mergeIntrinsicFields(
        existing,
        explicitFields.get(candidate.id)!,
        candidate,
        explicitFieldsFromRow(row),
        row.__rowIndex,
        diagnostics,
      );
    } else {
      mutableNodes.set(candidate.id, candidate);
      explicitFields.set(candidate.id, explicitFieldsFromRow(row));
    }

    rowChildId.set(row.__rowIndex, candidate.id);
  }

  for (const [id, node] of mutableNodes) {
    nodes.set(id, node as PartNode);
  }

  // Pass 2 — edges and roots
  const index: NodesIndex = buildNodesIndex([...nodes.values()]);
  const edges: ConsumesEdge[] = [];
  const roots = new Set<string>();
  const parentResolution = new Map<
    number,
    { parentId: string | null; inferred: boolean }
  >();

  for (const row of rows) {
    const childId = rowChildId.get(row.__rowIndex);
    if (!childId) continue;

    const parentPn = asString(row.Parent_Part_Number);
    if (parentPn === undefined) {
      roots.add(childId);
      continue;
    }

    const parentRev = asString(row.Parent_Revision);
    const resolution = resolveParent(
      parentPn,
      parentRev,
      index,
      row.__rowIndex,
    );
    diagnostics.push(...resolution.diagnostics);
    parentResolution.set(row.__rowIndex, {
      parentId: resolution.parentId,
      inferred: resolution.inferred,
    });

    if (resolution.parentId === null) continue;

    const qty = parseQtyPerParent(row, diagnostics);
    const edgeId = `${resolution.parentId}->${childId}::row${row.__rowIndex}`;

    edges.push({
      id: edgeId,
      parentId: resolution.parentId,
      childId,
      qtyPerParent: qty,
      rowIndex: row.__rowIndex,
    });
  }

  // Pass 3 — substitutes
  const substitutes: SubstituteEdge[] = [];
  for (const row of rows) {
    const primaryNodeId = rowChildId.get(row.__rowIndex);
    if (!primaryNodeId) continue;

    const resolvedParent = parentResolution.get(row.__rowIndex);
    const parentNodeId = resolvedParent?.parentId ?? undefined;

    const subResult = buildSubstituteEdges(
      {
        primaryNodeId,
        parentNodeId,
        substitutesCell: rawString(row.Substitutes),
      },
      index,
      row.__rowIndex,
    );
    substitutes.push(...subResult.edges);
    diagnostics.push(...subResult.diagnostics);
  }

  // Pass 4 — cycles, orphans, self-references
  const analysis = analyzeGraph(edges, nodes);

  // Pass 5 — indexes
  const edgesByParent = new Map<string, string[]>();
  const edgesByChild = new Map<string, string[]>();
  for (const e of edges) {
    pushToMap(edgesByParent, e.parentId, e.id);
    pushToMap(edgesByChild, e.childId, e.id);
  }

  const substitutesByPart = new Map<string, string[]>();
  for (const s of substitutes) {
    pushToMap(substitutesByPart, s.primaryId, s.id);
  }

  const graph: BomGraph = {
    nodes,
    edges: new Map(edges.map((e) => [e.id, e])),
    substitutes: new Map(substitutes.map((s) => [s.id, s])),
    edgesByParent,
    edgesByChild,
    substitutesByPart,
    roots: [...roots],
    orphans: analysis.orphans,
    cycles: analysis.cycles,
  };

  return { graph, diagnostics };
}

// ─── Internal types ─────────────────────────────────────────────────────────

type IntrinsicField =
  | "description"
  | "status"
  | "uom"
  | "unitCost"
  | "leadTimeDays"
  | "supplier"
  | "mpn"
  | "cadPath"
  | "drawingPath";

interface MutableNode {
  id: string;
  partNumber: string;
  revision: string;
  description: string;
  status: Status;
  uom: string;
  unitCost: number;
  leadTimeDays: number;
  supplier?: string;
  mpn?: string;
  cadPath?: string;
  drawingPath?: string;
}

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "WIP",
  "RELEASED",
  "OBSOLETE",
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

function asString(v: string | number | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === "" ? undefined : s;
}

function rawString(v: string | number | undefined | null): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v);
}

function asNumber(v: string | number | undefined | null): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const trimmed = String(v).trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

function diag(
  rowIndex: number,
  code: DiagnosticCode,
  message: string,
  severity: "error" | "warn",
): RowDiagnostic {
  return { rowIndex, code, message, severity };
}

function pushToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function normalizeStatus(v: string | number | undefined): Status {
  const s = asString(v);
  if (s !== undefined && VALID_STATUSES.has(s)) return s as Status;
  return "WIP";
}

// ─── Node extraction and merging ────────────────────────────────────────────

function rowToMutableNode(
  row: RawRow,
  diagnostics: RowDiagnostic[],
): MutableNode | null {
  const partNumber = asString(row.Part_Number);
  const revision = asString(row.Revision);

  if (partNumber === undefined) {
    diagnostics.push(
      diag(
        row.__rowIndex,
        DIAGNOSTIC_CODES.MISSING_REQUIRED_VALUE,
        "Row is missing Part_Number",
        "error",
      ),
    );
    return null;
  }
  if (revision === undefined) {
    diagnostics.push(
      diag(
        row.__rowIndex,
        DIAGNOSTIC_CODES.MISSING_REQUIRED_VALUE,
        "Row is missing Revision",
        "error",
      ),
    );
    return null;
  }

  const rawStatus = asString(row.Status);
  if (rawStatus !== undefined && !VALID_STATUSES.has(rawStatus)) {
    diagnostics.push(
      diag(
        row.__rowIndex,
        DIAGNOSTIC_CODES.UNKNOWN_STATUS,
        `Unknown Status: ${rawStatus}`,
        "error",
      ),
    );
  }

  const unitCost = asNumber(row.Unit_Cost);
  if (row.Unit_Cost !== undefined && unitCost === undefined) {
    diagnostics.push(
      diag(
        row.__rowIndex,
        DIAGNOSTIC_CODES.NON_NUMERIC_UNIT_COST,
        `Non-numeric Unit_Cost: ${String(row.Unit_Cost)}`,
        "error",
      ),
    );
  }

  const leadTime = asNumber(row.Lead_Time_Days);
  if (row.Lead_Time_Days !== undefined && leadTime === undefined) {
    diagnostics.push(
      diag(
        row.__rowIndex,
        DIAGNOSTIC_CODES.NON_NUMERIC_LEAD_TIME_DAYS,
        `Non-numeric Lead_Time_Days: ${String(row.Lead_Time_Days)}`,
        "error",
      ),
    );
  }

  return {
    id: `${partNumber}::${revision}`,
    partNumber,
    revision,
    description: asString(row.Description) ?? "",
    status: normalizeStatus(row.Status),
    uom: asString(row.UOM) ?? "",
    unitCost: unitCost ?? 0,
    leadTimeDays: leadTime ?? 0,
    supplier: asString(row.Supplier),
    mpn: asString(row.MPN),
    cadPath: asString(row.CAD_Path),
    drawingPath: asString(row.Drawing_Path),
  };
}

function explicitFieldsFromRow(row: RawRow): Set<IntrinsicField> {
  const set = new Set<IntrinsicField>();
  if (asString(row.Description) !== undefined) set.add("description");
  if (asString(row.Status) !== undefined) set.add("status");
  if (asString(row.UOM) !== undefined) set.add("uom");
  if (asNumber(row.Unit_Cost) !== undefined) set.add("unitCost");
  if (asNumber(row.Lead_Time_Days) !== undefined) set.add("leadTimeDays");
  if (asString(row.Supplier) !== undefined) set.add("supplier");
  if (asString(row.MPN) !== undefined) set.add("mpn");
  if (asString(row.CAD_Path) !== undefined) set.add("cadPath");
  if (asString(row.Drawing_Path) !== undefined) set.add("drawingPath");
  return set;
}

function mergeIntrinsicFields(
  existing: MutableNode,
  existingExplicit: Set<IntrinsicField>,
  candidate: MutableNode,
  candidateExplicit: Set<IntrinsicField>,
  rowIndex: number,
  diagnostics: RowDiagnostic[],
): void {
  const merge = <K extends IntrinsicField>(field: K): void => {
    if (!candidateExplicit.has(field)) return;

    if (!existingExplicit.has(field)) {
      // First time this field is defined for this node — adopt it.
      existing[field] = candidate[field] as MutableNode[K];
      existingExplicit.add(field);
      return;
    }

    if (existing[field] !== candidate[field]) {
      diagnostics.push(
        diag(
          rowIndex,
          DIAGNOSTIC_CODES.INTRINSIC_FIELD_CONFLICT,
          `Conflicting ${field} for ${existing.id}: "${String(existing[field])}" vs "${String(candidate[field])}"`,
          "error",
        ),
      );
    }
  };

  merge("description");
  merge("status");
  merge("uom");
  merge("unitCost");
  merge("leadTimeDays");
  merge("supplier");
  merge("mpn");
  merge("cadPath");
  merge("drawingPath");
}

function parseQtyPerParent(
  row: RawRow,
  diagnostics: RowDiagnostic[],
): number {
  const raw = row.Qty_Per_Parent;
  if (raw === undefined || raw === null) return 1;

  const parsed = asNumber(raw);
  if (parsed === undefined) {
    diagnostics.push(
      diag(
        row.__rowIndex,
        DIAGNOSTIC_CODES.NON_NUMERIC_QTY_PER_PARENT,
        `Non-numeric Qty_Per_Parent: ${String(raw)}`,
        "error",
      ),
    );
    return 1;
  }
  return parsed;
}