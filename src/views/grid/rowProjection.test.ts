import { describe, it, expect } from "vitest";
import type { RawRow } from "../../parser/schema";
import { buildGraph } from "../../graph/graphBuilder";
import { projectRows } from "./rowProjection";

function row(overrides: Partial<RawRow> & { __rowIndex: number }): RawRow {
  return {
    Part_Number: undefined,
    Revision: undefined,
    Description: undefined,
    Status: undefined,
    UOM: undefined,
    Unit_Cost: undefined,
    Lead_Time_Days: undefined,
    Supplier: undefined,
    MPN: undefined,
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: undefined,
    Parent_Revision: undefined,
    Qty_Per_Parent: undefined,
    Substitutes: undefined,
    ...overrides,
  };
}

const EMPTY_EXPANDED = new Set<string>();

describe("projectRows — roots", () => {
  it("emits one root row per root node with null edge/qty/parent", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "B",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]).graph;

    const rows = projectRows(g, EMPTY_EXPANDED);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.edgeId).toBeNull();
    expect(rows[0]?.qtyPerParent).toBeNull();
    expect(rows[0]?.parentId).toBeNull();
    expect(rows[0]?.depth).toBe(0);
    expect(rows[0]?.key).toBe(rows[0]?.nodeId);
    expect(rows.map((r) => r.nodeId)).toEqual(["A::A", "B::A"]);
  });

  it("sorts roots by part number then revision", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "Z",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "A",
        Revision: "B",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]).graph;

    const rows = projectRows(g, EMPTY_EXPANDED);
    expect(rows.map((r) => r.nodeId)).toEqual(["A::A", "A::B", "Z::A"]);
  });
});

describe("projectRows — collapsed vs expanded", () => {
  it("emits only the parent row when collapsed", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "B",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "A",
        Parent_Revision: "A",
        Qty_Per_Parent: 3,
      }),
    ]).graph;

    const rows = projectRows(g, EMPTY_EXPANDED);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nodeId).toBe("A::A");
    expect(rows[0]?.hasChildren).toBe(true);
    expect(rows[0]?.isExpanded).toBe(false);
  });

  it("emits children when the parent is expanded", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "B",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "A",
        Parent_Revision: "A",
        Qty_Per_Parent: 3,
      }),
    ]).graph;

    const expanded = new Set<string>(["A::A"]);
    const rows = projectRows(g, expanded);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.isExpanded).toBe(true);
    expect(rows[1]?.nodeId).toBe("B::A");
    expect(rows[1]?.depth).toBe(1);
    expect(rows[1]?.edgeId).toBe("A::A->B::A::row1");
    expect(rows[1]?.qtyPerParent).toBe(3);
    expect(rows[1]?.parentId).toBe("A::A");
    expect(rows[1]?.key).toBe("A::A->B::A::row1");
  });

  it("does not expand a leaf node even if it is in the expanded set", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]).graph;
    const expanded = new Set<string>(["A::A"]);
    const rows = projectRows(g, expanded);
    expect(rows[0]?.isExpanded).toBe(false);
    expect(rows[0]?.hasChildren).toBe(false);
  });
});

describe("projectRows — shared nodes", () => {
  it("emits a shared child once per parent", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "B",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SHARED",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "A",
        Parent_Revision: "A",
        Qty_Per_Parent: 1,
      }),
      row({
        __rowIndex: 3,
        Part_Number: "SHARED",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "B",
        Parent_Revision: "A",
        Qty_Per_Parent: 5,
      }),
    ]).graph;

    const expanded = new Set<string>(["A::A", "B::A"]);
    const rows = projectRows(g, expanded);
    const sharedRows = rows.filter((r) => r.nodeId === "SHARED::A");
    expect(sharedRows).toHaveLength(2);
    expect(sharedRows[0]?.parentId).toBe("A::A");
    expect(sharedRows[0]?.qtyPerParent).toBe(1);
    expect(sharedRows[1]?.parentId).toBe("B::A");
    expect(sharedRows[1]?.qtyPerParent).toBe(5);
  });
});

describe("projectRows — cycles", () => {
  it("does not infinite-loop on a cyclic graph", () => {
    // A -> B -> A
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "B",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "B",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "A",
        Parent_Revision: "A",
      }),
    ]).graph;

    // Both nodes are unreachable from any root in a pure-cycle graph, so
    // projectRows returns nothing. The point is: it must terminate.
    const expanded = new Set<string>(["A::A", "B::A"]);
    const rows = projectRows(g, expanded);
    expect(rows).toEqual([]);
  });

  it("terminates on a reachable cycle", () => {
    // A (root) -> B -> A
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "B",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "A",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "A",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "B",
        Parent_Revision: "A",
      }),
    ]).graph;

    const expanded = new Set<string>(["A::A", "B::A"]);
    // Must terminate. A's reentry under B is one level down, and stops there.
    const rows = projectRows(g, expanded);
    const nodeIds = rows.map((r) => r.nodeId);
    expect(nodeIds[0]).toBe("A::A");
    expect(nodeIds).toContain("B::A");
    // Should see A exactly twice: once as root, once re-entering under B.
    expect(nodeIds.filter((id) => id === "A::A")).toHaveLength(2);
  });
});

describe("projectRows — deep tree", () => {
  it("increments depth along a chain", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "L0",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "L1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "L0",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "L2",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "L1",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 3,
        Part_Number: "L3",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "L2",
        Parent_Revision: "A",
      }),
    ]).graph;

    const expanded = new Set<string>(["L0::A", "L1::A", "L2::A"]);
    const rows = projectRows(g, expanded);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r.nodeId)).toEqual([
      "L0::A",
      "L1::A",
      "L2::A",
      "L3::A",
    ]);
  });
});