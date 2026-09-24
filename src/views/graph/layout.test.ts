import { describe, it, expect } from "vitest";
import type { RawRow } from "../../parser/schema";
import { buildGraph } from "../../graph/graphBuilder";
import { projectGraph, X_STEP, Y_STEP } from "./layout";

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

const EMPTY = new Set<string>();

describe("projectGraph — roots only", () => {
  it("emits one node per root, no edges, when nothing is expanded", () => {
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

    const { nodes, edges } = projectGraph(g, EMPTY);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(0);
    expect(nodes.map((n) => n.reactFlowId)).toEqual(["A::A", "B::A"]);
    expect(nodes[0]?.depth).toBe(0);
    expect(nodes[1]?.depth).toBe(0);
    expect(nodes[0]?.y).toBe(0);
    expect(nodes[1]?.y).toBe(0);
  });

  it("spaces root nodes apart on the x axis", () => {
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
    const { nodes } = projectGraph(g, EMPTY);
    expect(nodes[0]?.x).toBe(0);
    expect(nodes[1]?.x).toBe(X_STEP);
  });
});

describe("projectGraph — expansion", () => {
  it("adds children and edges when the parent is expanded", () => {
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
      row({
        __rowIndex: 2,
        Part_Number: "C",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "A",
        Parent_Revision: "A",
        Qty_Per_Parent: 5,
      }),
    ]).graph;

    const expanded = new Set(["A::A"]);
    const { nodes, edges } = projectGraph(g, expanded);

    expect(nodes).toHaveLength(3);
    expect(edges).toHaveLength(2);

    const a = nodes.find((n) => n.nodeId === "A::A")!;
    const b = nodes.find((n) => n.nodeId === "B::A")!;
    const c = nodes.find((n) => n.nodeId === "C::A")!;

    expect(a.depth).toBe(0);
    expect(b.depth).toBe(1);
    expect(c.depth).toBe(1);
    expect(b.y).toBe(Y_STEP);
    expect(c.y).toBe(Y_STEP);

    // B and C should be at slots 0 and 1; A should be at their midpoint (0.5)
    expect(b.x).toBe(0);
    expect(c.x).toBe(X_STEP);
    expect(a.x).toBe(0.5 * X_STEP);

    expect(edges.map((e) => [e.source, e.target])).toEqual([
      ["A::A", "A::A->B::A::row1"],
      ["A::A", "A::A->C::A::row2"],
    ]);
    expect(edges[0]?.qtyPerParent).toBe(3);
    expect(edges[1]?.qtyPerParent).toBe(5);
  });

  it("does not descend into unexpanded children", () => {
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
        Part_Number: "C",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "B",
        Parent_Revision: "A",
      }),
    ]).graph;

    const expanded = new Set(["A::A"]);
    const { nodes } = projectGraph(g, expanded);
    expect(nodes.map((n) => n.nodeId).sort()).toEqual(["A::A", "B::A"]);
  });

  it("descends through multiple expansion levels", () => {
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
        Part_Number: "C",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "B",
        Parent_Revision: "A",
      }),
    ]).graph;

    const expanded = new Set(["A::A", "B::A"]);
    const { nodes } = projectGraph(g, expanded);
    const c = nodes.find((n) => n.nodeId === "C::A")!;
    expect(c.depth).toBe(2);
    expect(c.y).toBe(2 * Y_STEP);
  });
});

describe("projectGraph — shared nodes", () => {
  it("creates a distinct reactFlowId per instance for shared nodes", () => {
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
      }),
      row({
        __rowIndex: 3,
        Part_Number: "SHARED",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "B",
        Parent_Revision: "A",
      }),
    ]).graph;

    const expanded = new Set(["A::A", "B::A"]);
    const { nodes } = projectGraph(g, expanded);

    const sharedInstances = nodes.filter((n) => n.nodeId === "SHARED::A");
    expect(sharedInstances).toHaveLength(2);
    expect(sharedInstances[0]?.reactFlowId).not.toBe(
      sharedInstances[1]?.reactFlowId,
    );
    expect(sharedInstances.map((n) => n.parentId).sort()).toEqual([
      "A::A",
      "B::A",
    ]);
  });
});

describe("projectGraph — cycles", () => {
  it("terminates on a cycle without infinite recursion", () => {
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

    const expanded = new Set(["A::A", "B::A"]);
    // Pure-cycle graph has no roots reachable, so nothing is emitted.
    const { nodes, edges } = projectGraph(g, expanded);
    expect(nodes).toHaveLength(0);
    expect(edges).toHaveLength(0);
  });
});

describe("projectGraph — empty graph", () => {
  it("returns empty arrays", () => {
    const g = buildGraph([]).graph;
    const { nodes, edges } = projectGraph(g, EMPTY);
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});