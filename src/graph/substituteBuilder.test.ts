import { describe, it, expect } from "vitest";
import type { PartNode, Status } from "./types";
import { buildNodesIndex } from "./revisionResolver";
import { buildSubstituteEdges } from "./substituteBuilder";

function makeNode(
  pn: string,
  rev: string,
  status: Status = "RELEASED",
): PartNode {
  return {
    id: `${pn}::${rev}`,
    partNumber: pn,
    revision: rev,
    description: "",
    status,
    uom: "EA",
    unitCost: 0,
    leadTimeDays: 0,
  };
}

const IDX = buildNodesIndex([
  makeNode("RES-001", "A"),
  makeNode("RES-002", "A"),
  makeNode("RES-002", "B"),
  makeNode("RES-003", "A", "OBSOLETE"),
]);

describe("buildSubstituteEdges", () => {
  it("returns nothing for undefined cell", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: undefined },
      IDX,
    );
    expect(r.edges).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("returns nothing for empty cell", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "   " },
      IDX,
    );
    expect(r.edges).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });

  it("parses a single substitute without revision and infers newest", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002" },
      IDX,
    );
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]?.substituteId).toBe("RES-002::B");
    expect(r.edges[0]?.scopeParentId).toBe("ASM-100::A");
    expect(r.edges[0]?.bidirectional).toBe(true);
    expect(r.diagnostics.map((d) => d.code)).toContain(
      "LEGACY_ROW_REVISION_INFERRED",
    );
  });

  it("respects an explicit substitute revision", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::A" },
      IDX,
    );
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]?.substituteId).toBe("RES-002::A");
    expect(r.diagnostics).toEqual([]);
  });

  it("falls back to newest when explicit revision is missing", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::Z" },
      IDX,
    );
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]?.substituteId).toBe("RES-002::B");
    expect(r.diagnostics.map((d) => d.code)).toContain(
      "SUBSTITUTE_REVISION_NOT_FOUND",
    );
  });

  it("splits on commas", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::A, RES-003::A" },
      IDX,
    );
    expect(r.edges).toHaveLength(2);
    expect(r.edges.map((e) => e.substituteId).sort()).toEqual([
      "RES-002::A",
      "RES-003::A",
    ]);
  });

  it("splits on semicolons", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::A; RES-003::A" },
      IDX,
    );
    expect(r.edges).toHaveLength(2);
  });

  it("handles mixed separators and surrounding whitespace", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "  RES-002::A ,RES-003::A;  " },
      IDX,
    );
    expect(r.edges).toHaveLength(2);
  });

  it("deduplicates repeated substitutes", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::A, RES-002::A" },
      IDX,
    );
    expect(r.edges).toHaveLength(1);
  });

  it("flags unknown substitute parts and skips the edge", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "NOPE-999" },
      IDX,
    );
    expect(r.edges).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).toEqual([
      "SUBSTITUTE_PART_NOT_FOUND",
    ]);
  });

  it("uses 'global' scope when parentNodeId is undefined", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: undefined, substitutesCell: "RES-002::A" },
      IDX,
    );
    expect(r.edges[0]?.id).toBe("RES-001::A~sub~RES-002::A::global");
    expect(r.edges[0]?.scopeParentId).toBeUndefined();
  });

  it("uses parentNodeId as scope when present", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::A" },
      IDX,
    );
    expect(r.edges[0]?.id).toBe("RES-001::A~sub~RES-002::A::ASM-100::A");
  });

  it("flags self-reference and skips the edge", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-001::A" },
      IDX,
    );
    expect(r.edges).toEqual([]);
    expect(r.diagnostics.map((d) => d.code)).toContain(
      "SUBSTITUTE_SELF_REFERENCE",
    );
  });

  it("does not flag newer-revision-as-substitute as self-reference", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-002::A", parentNodeId: "ASM-100::A", substitutesCell: "RES-002::B" },
      IDX,
    );
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0]?.substituteId).toBe("RES-002::B");
  });

  it("attaches the rowIndex to diagnostics", () => {
    const r = buildSubstituteEdges(
      { primaryNodeId: "RES-001::A", parentNodeId: "ASM-100::A", substitutesCell: "NOPE-999" },
      IDX,
      17,
    );
    expect(r.diagnostics[0]?.rowIndex).toBe(17);
  });
});