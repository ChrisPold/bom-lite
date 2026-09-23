// src/graph/substituteBuilder.ts
//
// Parses a row's Substitutes cell into SubstituteEdge[].
//
// Pure function. No I/O.
//
// Semantics:
//   - A substitute edge means: "in the context of scopeParentId, primaryId
//     can be replaced by substituteId." If scopeParentId is undefined, the
//     substitution is global (applies wherever primaryId appears).
//   - Substitutes may be written as "RES-002" (revision inferred) or
//     "RES-002::B" (explicit revision).
//   - Separators are comma or semicolon; whitespace is trimmed.

import { DIAGNOSTIC_CODES, type RowDiagnostic } from "../parser/schema";
import type { SubstituteEdge } from "./types";
import {
  type NodesIndex,
  pickNewestRevision,
} from "./revisionResolver";

export interface BuildSubstitutesInput {
  /** Canonical id of the part this row describes, e.g. "RES-001::A". */
  primaryNodeId: string;
  /** Parent this row is attached to, or undefined for root rows. */
  parentNodeId: string | undefined;
  /** Raw value of the Substitutes cell. */
  substitutesCell: string | undefined;
}

export interface BuildSubstitutesResult {
  edges: SubstituteEdge[];
  diagnostics: RowDiagnostic[];
}

function parseToken(token: string): { partNumber: string; revision: string | undefined } {
  const idx = token.indexOf("::");
  if (idx === -1) {
    return { partNumber: token, revision: undefined };
  }
  const partNumber = token.slice(0, idx);
  const revision = token.slice(idx + 2);
  return {
    partNumber,
    revision: revision === "" ? undefined : revision,
  };
}

function makeDiagnostic(
  rowIndex: number,
  code: (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES],
  message: string,
  severity: "error" | "warn",
): RowDiagnostic {
  return { rowIndex, code, message, severity };
}

export function buildSubstituteEdges(
  input: BuildSubstitutesInput,
  index: NodesIndex,
  rowIndex: number = -1,
): BuildSubstitutesResult {
  const diagnostics: RowDiagnostic[] = [];
  const edges: SubstituteEdge[] = [];

  const raw = input.substitutesCell;
  if (raw === undefined || raw === null) {
    return { edges, diagnostics };
  }
  const text = String(raw).trim();
  if (text === "") {
    return { edges, diagnostics };
  }

  const tokens = text
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const seen = new Set<string>();
  const scope = input.parentNodeId ?? "global";

  for (const token of tokens) {
    const { partNumber, revision } = parseToken(token);
    if (partNumber === "") {
      diagnostics.push(
        makeDiagnostic(
          rowIndex,
          DIAGNOSTIC_CODES.SUBSTITUTE_PART_NOT_FOUND,
          `Empty substitute part number in token "${token}"`,
          "error",
        ),
      );
      continue;
    }

    const candidates = index.get(partNumber);
    if (!candidates || candidates.length === 0) {
      diagnostics.push(
        makeDiagnostic(
          rowIndex,
          DIAGNOSTIC_CODES.SUBSTITUTE_PART_NOT_FOUND,
          `Substitute part not found: ${partNumber}`,
          "error",
        ),
      );
      continue;
    }

    let resolvedId: string;

    if (revision !== undefined) {
      const exact = candidates.find((c) => c.revision === revision);
      if (exact) {
        resolvedId = exact.id;
      } else {
        const fallback = pickNewestRevision(candidates);
        resolvedId = fallback.id;
        diagnostics.push(
          makeDiagnostic(
            rowIndex,
            DIAGNOSTIC_CODES.SUBSTITUTE_REVISION_NOT_FOUND,
            `Revision "${revision}" not found for substitute ${partNumber}; using "${fallback.revision}"`,
            "warn",
          ),
        );
      }
    } else {
      const pick = pickNewestRevision(candidates);
      resolvedId = pick.id;
      diagnostics.push(
        makeDiagnostic(
          rowIndex,
          DIAGNOSTIC_CODES.LEGACY_ROW_REVISION_INFERRED,
          `Inferred revision "${pick.revision}" for substitute ${partNumber}`,
          "warn",
        ),
      );
    }

    if (resolvedId === input.primaryNodeId) {
      diagnostics.push(
        makeDiagnostic(
          rowIndex,
          DIAGNOSTIC_CODES.SUBSTITUTE_SELF_REFERENCE,
          `Substitute resolves to the same node as primary: ${resolvedId}`,
          "warn",
        ),
      );
      continue;
    }

    const id = `${input.primaryNodeId}~sub~${resolvedId}::${scope}`;
    if (seen.has(id)) continue;
    seen.add(id);

    edges.push({
      id,
      primaryId: input.primaryNodeId,
      substituteId: resolvedId,
      scopeParentId: input.parentNodeId,
      bidirectional: true,
    });
  }

  return { edges, diagnostics };
}