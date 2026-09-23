import { describe, it, expect } from "vitest";
import type { PartNode, Status } from "./types";
import {
  buildNodesIndex,
  resolveParent,
  type NodesIndex,
} from "./revisionResolver";

function makeNode(pn: string, rev: string, status: Status): PartNode {
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

function indexOf(...nodes: PartNode[]): NodesIndex {
  return buildNodesIndex(nodes);
}

describe("resolveParent", () => {
  it("resolves an explicit revision that exists", () => {
    const idx = indexOf(
      makeNode("ASM-100", "A", "RELEASED"),
      makeNode("ASM-100", "B", "RELEASED"),
    );
    const r = resolveParent("ASM-100", "A", idx, 5);
    expect(r.parentId).toBe("ASM-100::A");
    expect(r.inferred).toBe(false);
    expect(r.diagnostics).toEqual([]);
  });

  it("falls back to newest non-obsolete when explicit revision is missing", () => {
    const idx = indexOf(
      makeNode("ASM-100", "A", "RELEASED"),
      makeNode("ASM-100", "B", "RELEASED"),
      makeNode("ASM-100", "C", "RELEASED"),
    );
    const r = resolveParent("ASM-100", "X", idx, 5);
    expect(r.parentId).toBe("ASM-100::C");
    expect(r.inferred).toBe(true);
    const codes = r.diagnostics.map((d) => d.code);
    expect(codes).toContain("PARENT_REVISION_NOT_FOUND");
    expect(codes).toContain("LEGACY_ROW_REVISION_INFERRED");
    expect(r.diagnostics.every((d) => d.rowIndex === 5)).toBe(true);
  });

  it("picks newest non-obsolete when no revision is provided", () => {
    const idx = indexOf(
      makeNode("ASM-100", "A", "RELEASED"),
      makeNode("ASM-100", "B", "WIP"),
      makeNode("ASM-100", "C", "OBSOLETE"),
    );
    const r = resolveParent("ASM-100", undefined, idx);
    expect(r.parentId).toBe("ASM-100::B");
    expect(r.inferred).toBe(true);
  });

  it("falls back to newest overall when all revisions are obsolete", () => {
    const idx = indexOf(
      makeNode("ASM-100", "A", "OBSOLETE"),
      makeNode("ASM-100", "B", "OBSOLETE"),
    );
    const r = resolveParent("ASM-100", undefined, idx);
    expect(r.parentId).toBe("ASM-100::B");
    expect(r.inferred).toBe(true);
  });

  it("returns null with PARENT_PART_NOT_FOUND when the part is unknown", () => {
    const idx = indexOf(makeNode("ASM-100", "A", "RELEASED"));
    const r = resolveParent("NOPE-999", undefined, idx, 7);
    expect(r.parentId).toBeNull();
    expect(r.inferred).toBe(false);
    expect(r.diagnostics[0]?.code).toBe("PARENT_PART_NOT_FOUND");
    expect(r.diagnostics[0]?.rowIndex).toBe(7);
  });

  it("sorts numeric revisions numerically, not lexicographically", () => {
    const idx = indexOf(
      makeNode("P", "1", "RELEASED"),
      makeNode("P", "9", "RELEASED"),
      makeNode("P", "10", "RELEASED"),
      makeNode("P", "2", "RELEASED"),
    );
    const r = resolveParent("P", undefined, idx);
    expect(r.parentId).toBe("P::10");
  });

  it("sorts double-letter revisions after single letters", () => {
    const idx = indexOf(
      makeNode("P", "Z", "RELEASED"),
      makeNode("P", "AA", "RELEASED"),
      makeNode("P", "B", "RELEASED"),
    );
    const r = resolveParent("P", undefined, idx);
    expect(r.parentId).toBe("P::AA");
  });

  it("treats empty-string parentRevision as missing", () => {
    const idx = indexOf(makeNode("P", "A", "RELEASED"));
    const r = resolveParent("P", "", idx);
    expect(r.parentId).toBe("P::A");
    expect(r.inferred).toBe(true);
  });
});

describe("buildNodesIndex", () => {
  it("groups multiple revisions under the same part number", () => {
    const idx = buildNodesIndex([
      makeNode("A", "A", "RELEASED"),
      makeNode("A", "B", "RELEASED"),
      makeNode("B", "A", "RELEASED"),
    ]);
    expect(idx.get("A")).toHaveLength(2);
    expect(idx.get("B")).toHaveLength(1);
    expect(idx.get("C")).toBeUndefined();
  });
});