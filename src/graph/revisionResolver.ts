// src/graph/revisionResolver.ts
//
// Resolves a raw row's (Parent_Part_Number, Parent_Revision) into a concrete
// PartNode id, using a schema-first lookup with a heuristic fallback for
// legacy rows that lack a Parent_Revision.
//
// Pure function. No I/O. No state.

import type { PartNode, Status } from "./types";
import { DIAGNOSTIC_CODES, type RowDiagnostic } from "../parser/schema";

/**
 * Map of partNumber -> all known revisions of that part.
 * The caller (graphBuilder) builds this from the deduped PartNode set.
 */
export type NodesIndex = ReadonlyMap<string, readonly PartNode[]>;

export interface ResolveParentResult {
  /** Resolved node id (partNumber::revision), or null if the parent part is unknown. */
  parentId: string | null;
  /** True when the heuristic fallback was used instead of an explicit match. */
  inferred: boolean;
  /** Diagnostics with the caller-provided rowIndex attached. */
  diagnostics: RowDiagnostic[];
}

export function makeNodeId(partNumber: string, revision: string): string {
  return `${partNumber}::${revision}`;
}

/**
 * Compare two revision identifiers using PLM conventions:
 *   - Purely numeric revisions sort numerically ("2" < "10").
 *   - Purely alphabetic revisions sort like Excel columns:
 *     A < B < ... < Z < AA < AB < ... < AZ < BA < ...
 *   - Mixed or unrecognised formats fall back to localeCompare.
 *
 * Case-insensitive on the alphabetic path.
 */
function compareRevisions(a: string, b: string): number {
  const aTrim = a.trim();
  const bTrim = b.trim();

  const aIsNum = /^\d+$/.test(aTrim);
  const bIsNum = /^\d+$/.test(bTrim);
  if (aIsNum && bIsNum) {
    return Number(aTrim) - Number(bTrim);
  }

  const aIsAlpha = /^[A-Za-z]+$/.test(aTrim);
  const bIsAlpha = /^[A-Za-z]+$/.test(bTrim);
  if (aIsAlpha && bIsAlpha) {
    const av = bijectiveBase26(aTrim.toUpperCase());
    const bv = bijectiveBase26(bTrim.toUpperCase());
    return av - bv;
  }

  return aTrim.localeCompare(bTrim, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Excel-column-style encoding: A=1, Z=26, AA=27, AB=28, ..., ZZ=702, AAA=703.
 */
function bijectiveBase26(s: string): number {
  let value = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) return Number.NaN;
    value = value * 26 + (code - 64); // 'A' → 1
  }
  return value;
}

/**
 * Pick the newest revision from a list. Prefers non-OBSOLETE revisions;
 * falls back to OBSOLETE only when every candidate is OBSOLETE.
 * Throws if `candidates` is empty — callers should check first.
 */
export function pickNewestRevision(
  candidates: readonly PartNode[],
): PartNode {
  if (candidates.length === 0) {
    throw new Error("pickNewestRevision called with empty candidates");
  }
  const nonObsolete = candidates.filter((c) => c.status !== "OBSOLETE");
  const pool = nonObsolete.length > 0 ? nonObsolete : candidates;
  const sorted = [...pool].sort((a, b) =>
    compareRevisions(b.revision, a.revision),
  );
  return sorted[0]!;
}

export function resolveParent(
  parentPartNumber: string,
  parentRevision: string | undefined,
  index: NodesIndex,
  rowIndex: number = -1,
): ResolveParentResult {
  const candidates = index.get(parentPartNumber);

  // Case 1: parent part does not exist in the graph at all.
  if (!candidates || candidates.length === 0) {
    return {
      parentId: null,
      inferred: false,
      diagnostics: [
        {
          rowIndex,
          code: DIAGNOSTIC_CODES.PARENT_PART_NOT_FOUND,
          message: `Parent part not found: ${parentPartNumber}`,
          severity: "error",
        },
      ],
    };
  }

  // Case 2: explicit revision provided.
  if (parentRevision !== undefined && parentRevision !== "") {
    const exact = candidates.find((c) => c.revision === parentRevision);
    if (exact) {
      return { parentId: exact.id, inferred: false, diagnostics: [] };
    }

    // Explicit revision does not exist — fall back to heuristic.
    const fallback = pickNewestRevision(candidates);
    return {
      parentId: fallback.id,
      inferred: true,
      diagnostics: [
        {
          rowIndex,
          code: DIAGNOSTIC_CODES.PARENT_REVISION_NOT_FOUND,
          message: `Revision "${parentRevision}" not found for ${parentPartNumber}; falling back to "${fallback.revision}"`,
          severity: "warn",
        },
        {
          rowIndex,
          code: DIAGNOSTIC_CODES.LEGACY_ROW_REVISION_INFERRED,
          message: `Inferred revision "${fallback.revision}" for ${parentPartNumber}`,
          severity: "warn",
        },
      ],
    };
  }

  // Case 3: no revision provided — heuristic only.
  const pick = pickNewestRevision(candidates);
  return {
    parentId: pick.id,
    inferred: true,
    diagnostics: [
      {
        rowIndex,
        code: DIAGNOSTIC_CODES.LEGACY_ROW_REVISION_INFERRED,
        message: `Inferred revision "${pick.revision}" for ${parentPartNumber}`,
        severity: "warn",
      },
    ],
  };
}

/**
 * Build a NodesIndex from a flat list of PartNodes.
 * Convenience helper used by the graph builder.
 */
export function buildNodesIndex(nodes: readonly PartNode[]): NodesIndex {
  const map = new Map<string, PartNode[]>();
  for (const n of nodes) {
    const list = map.get(n.partNumber);
    if (list) list.push(n);
    else map.set(n.partNumber, [n]);
  }
  return map;
}

// Re-exported so downstream modules can import Status without a second hop.
export type { Status };