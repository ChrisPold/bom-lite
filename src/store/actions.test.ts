import { describe, it, expect, beforeEach } from "vitest";
import type { RawRow } from "../parser/schema";
import { buildGraph } from "../graph/graphBuilder";
import { totalAssemblyCost } from "../rollups/rollupEngine";
import { memoCostKey } from "../rollups/memo";
import { isDirty } from "./dirtyState";
import { useGraphStore, __resetStoreForTests } from "./graphStore";
import {
  addChildNode,
  addSubstitute,
  commit,
  discard,
  loadGraph,
  removeEdge,
  removeNode,
  removeSubstitute,
  reparentEdge,
  rollupMemo,
  selectNode,
  setActiveView,
  toggleGridRow,
  toggleGraphNode,
  updateEdgeQty,
  updateNodeField,
} from "./actions";

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

function seedGraph(rows: RawRow[]): void {
  const { graph } = buildGraph(rows);
  loadGraph(graph, "sha1");
}

const BASE_ROWS: RawRow[] = [
  row({
    __rowIndex: 0,
    Part_Number: "ASM-1",
    Revision: "A",
    Description: "Root",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 100,
    Lead_Time_Days: 10,
  }),
  row({
    __rowIndex: 1,
    Part_Number: "SUB-1",
    Revision: "A",
    Description: "Child",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 5,
    Lead_Time_Days: 3,
    Parent_Part_Number: "ASM-1",
    Parent_Revision: "A",
    Qty_Per_Parent: 2,
  }),
];

beforeEach(() => {
  __resetStoreForTests();
  rollupMemo.clear();
});

describe("loadGraph and discard", () => {
  it("loads a graph and resets memo", () => {
    seedGraph(BASE_ROWS);
    const s = useGraphStore.getState();
    expect(s.graph.nodes.size).toBe(2);
    expect(s.dirty.baselineSha).toBe("sha1");
    expect(rollupMemo.size).toBe(0);
  });

  it("discard restores baseline and clears dirty", () => {
    seedGraph(BASE_ROWS);
    updateNodeField("SUB-1::A", "unitCost", 999);
    expect(isDirty(useGraphStore.getState().dirty)).toBe(true);

    discard();
    expect(isDirty(useGraphStore.getState().dirty)).toBe(false);
    expect(useGraphStore.getState().graph.nodes.get("SUB-1::A")?.unitCost).toBe(5);
  });
});

describe("updateNodeField", () => {
  it("mutates the node and marks it dirty", () => {
    seedGraph(BASE_ROWS);
    updateNodeField("SUB-1::A", "description", "Updated");
    const s = useGraphStore.getState();
    expect(s.graph.nodes.get("SUB-1::A")?.description).toBe("Updated");
    expect(s.dirty.nodes.has("SUB-1::A")).toBe(true);
  });

  it("does not invalidate rollups for non-cost fields", () => {
    seedGraph(BASE_ROWS);
    totalAssemblyCost(useGraphStore.getState().graph, "ASM-1::A", rollupMemo);
    const before = rollupMemo.size;
    updateNodeField("SUB-1::A", "description", "Updated");
    expect(rollupMemo.size).toBe(before);
  });

  it("invalidates and recomputes when unitCost changes", () => {
    seedGraph(BASE_ROWS);
    const g0 = useGraphStore.getState().graph;
    const cost0 = totalAssemblyCost(g0, "ASM-1::A", rollupMemo);
    expect(cost0).toBe(110); // 100 + 2*5

    updateNodeField("SUB-1::A", "unitCost", 50);

    const g1 = useGraphStore.getState().graph;
    const cost1 = totalAssemblyCost(g1, "ASM-1::A", rollupMemo);
    expect(cost1).toBe(200); // 100 + 2*50
  });

  it("recomputes eagerly at the changed node", () => {
    seedGraph(BASE_ROWS);
    updateNodeField("SUB-1::A", "unitCost", 7);
    expect(rollupMemo.get(memoCostKey("SUB-1::A"))).toBe(7);
  });

  it("is a no-op for a missing node", () => {
    seedGraph(BASE_ROWS);
    const before = useGraphStore.getState().graph;
    updateNodeField("MISSING::A", "unitCost", 1);
    expect(useGraphStore.getState().graph).toBe(before);
  });

  it("is a no-op when the value is unchanged", () => {
    seedGraph(BASE_ROWS);
    const before = useGraphStore.getState().graph;
    updateNodeField("SUB-1::A", "unitCost", 5);
    expect(useGraphStore.getState().graph).toBe(before);
  });
});

describe("updateEdgeQty", () => {
  it("updates the qty and recomputes parent cost", () => {
    seedGraph(BASE_ROWS);
    const edgeId = "ASM-1::A->SUB-1::A::row1";
    updateEdgeQty(edgeId, 4);

    const g = useGraphStore.getState().graph;
    expect(g.edges.get(edgeId)?.qtyPerParent).toBe(4);
    expect(totalAssemblyCost(g, "ASM-1::A", rollupMemo)).toBe(120); // 100 + 4*5
  });

  it("rejects non-finite values", () => {
    seedGraph(BASE_ROWS);
    const before = useGraphStore.getState().graph.edges.get("ASM-1::A->SUB-1::A::row1");
    updateEdgeQty("ASM-1::A->SUB-1::A::row1", Number.NaN);
    const after = useGraphStore.getState().graph.edges.get("ASM-1::A->SUB-1::A::row1");
    expect(after).toBe(before);
  });
});

describe("addChildNode", () => {
  it("creates a new node, edge, and marks both dirty", () => {
    seedGraph(BASE_ROWS);
    addChildNode("ASM-1::A", {
      partNumber: "NEW-1",
      revision: "A",
      description: "Fresh",
      unitCost: 3,
    });

    const s = useGraphStore.getState();
    expect(s.graph.nodes.has("NEW-1::A")).toBe(true);
    expect(s.graph.edgesByParent.get("ASM-1::A")?.length).toBe(2);
    expect(s.dirty.nodes.has("NEW-1::A")).toBe(true);
    expect(s.dirty.edges.size).toBe(1);
  });

  it("reuses an existing child node without duplicating it", () => {
    seedGraph(BASE_ROWS);
    const countBefore = useGraphStore.getState().graph.nodes.size;
    addChildNode("SUB-1::A", {
      partNumber: "ASM-1",
      revision: "A",
    });
    expect(useGraphStore.getState().graph.nodes.size).toBe(countBefore);
  });

  it("removes the child from roots when it becomes a child", () => {
    seedGraph(BASE_ROWS);
    // ASM-1::A is a root. Add it as a child of SUB-1::A.
    addChildNode("SUB-1::A", { partNumber: "ASM-1", revision: "A" });
    expect(useGraphStore.getState().graph.roots).not.toContain("ASM-1::A");
  });

  it("is a no-op for a missing parent", () => {
    seedGraph(BASE_ROWS);
    const before = useGraphStore.getState().graph;
    addChildNode("MISSING::A", { partNumber: "X", revision: "A" });
    expect(useGraphStore.getState().graph).toBe(before);
  });
});

describe("removeEdge", () => {
  it("removes the edge and marks it dirty", () => {
    seedGraph(BASE_ROWS);
    removeEdge("ASM-1::A->SUB-1::A::row1");
    const s = useGraphStore.getState();
    expect(s.graph.edges.size).toBe(0);
    expect(s.dirty.edges.has("ASM-1::A->SUB-1::A::row1")).toBe(true);
  });

  it("promotes the orphaned child to a root", () => {
    seedGraph(BASE_ROWS);
    removeEdge("ASM-1::A->SUB-1::A::row1");
    expect(useGraphStore.getState().graph.roots).toContain("SUB-1::A");
  });

  it("does not promote a child that has other parents", () => {
    seedGraph([
      ...BASE_ROWS,
      row({
        __rowIndex: 2,
        Part_Number: "ASM-2",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 3,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-2",
        Parent_Revision: "A",
      }),
    ]);

    removeEdge("ASM-1::A->SUB-1::A::row1");
    const roots = useGraphStore.getState().graph.roots;
    expect(roots).not.toContain("SUB-1::A");
  });
});

describe("reparentEdge", () => {
  it("moves the edge to a new parent", () => {
    seedGraph([
      ...BASE_ROWS,
      row({
        __rowIndex: 2,
        Part_Number: "ASM-2",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);

    const edgeId = "ASM-1::A->SUB-1::A::row1";
    reparentEdge(edgeId, "ASM-2::A");

    const g = useGraphStore.getState().graph;
    expect(g.edgesByParent.get("ASM-1::A")?.length ?? 0).toBe(0);
    expect(g.edgesByParent.get("ASM-2::A")?.length).toBe(1);
    expect(g.edgesByChild.get("SUB-1::A")?.length).toBe(1);
  });

  it("refuses to create a self-reference", () => {
    seedGraph(BASE_ROWS);
    const before = useGraphStore.getState().graph;
    reparentEdge("ASM-1::A->SUB-1::A::row1", "SUB-1::A");
    expect(useGraphStore.getState().graph).toBe(before);
  });

  it("refuses to create a cycle", () => {
    seedGraph([
      ...BASE_ROWS,
      row({
        __rowIndex: 2,
        Part_Number: "LEAF",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "SUB-1",
        Parent_Revision: "A",
      }),
    ]);
    // Reparenting the ASM-1 -> SUB-1 edge to LEAF would make
    // ASM-1 a descendant of itself (ASM-1 -> ... -> LEAF -> ASM-1).
    const before = useGraphStore.getState().graph;
    reparentEdge("ASM-1::A->SUB-1::A::row1", "LEAF::A");
    expect(useGraphStore.getState().graph).toBe(before);
  });
});

describe("removeNode", () => {
  it("removes the node and its incident edges", () => {
    seedGraph(BASE_ROWS);
    removeNode("SUB-1::A");
    const s = useGraphStore.getState();
    expect(s.graph.nodes.has("SUB-1::A")).toBe(false);
    expect(s.graph.edges.size).toBe(0);
    expect(s.dirty.nodes.has("SUB-1::A")).toBe(true);
  });

  it("removes incident substitutes", () => {
    seedGraph([
      ...BASE_ROWS,
      row({
        __rowIndex: 2,
        Part_Number: "RES-002",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 3,
        Part_Number: "RES-001",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Substitutes: "RES-002::A",
      }),
    ]);

    expect(useGraphStore.getState().graph.substitutes.size).toBe(1);
    removeNode("RES-002::A");
    expect(useGraphStore.getState().graph.substitutes.size).toBe(0);
  });

  it("clears the entire memo", () => {
    seedGraph(BASE_ROWS);
    totalAssemblyCost(useGraphStore.getState().graph, "ASM-1::A", rollupMemo);
    expect(rollupMemo.size).toBeGreaterThan(0);
    removeNode("SUB-1::A");
    expect(rollupMemo.size).toBe(0);
  });
});

describe("addSubstitute and removeSubstitute", () => {
  it("adds a substitute and marks it dirty", () => {
    seedGraph([
      ...BASE_ROWS,
      row({
        __rowIndex: 2,
        Part_Number: "RES-002",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);
    addSubstitute("SUB-1::A", "RES-002::A", "ASM-1::A");
    const s = useGraphStore.getState();
    expect(s.graph.substitutes.size).toBe(1);
    const sub = [...s.graph.substitutes.values()][0]!;
    expect(sub.id).toBe("SUB-1::A~sub~RES-002::A::ASM-1::A");
    expect(s.dirty.substitutes.has(sub.id)).toBe(true);
  });

  it("refuses to add a substitute for a missing node", () => {
    seedGraph(BASE_ROWS);
    addSubstitute("SUB-1::A", "MISSING::A", undefined);
    expect(useGraphStore.getState().graph.substitutes.size).toBe(0);
  });

  it("refuses to add a self-substitute", () => {
    seedGraph(BASE_ROWS);
    addSubstitute("SUB-1::A", "SUB-1::A", undefined);
    expect(useGraphStore.getState().graph.substitutes.size).toBe(0);
  });

  it("removeSubstitute deletes the edge and marks it dirty", () => {
    seedGraph([
      ...BASE_ROWS,
      row({
        __rowIndex: 2,
        Part_Number: "RES-002",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);
    addSubstitute("SUB-1::A", "RES-002::A", undefined);
    const id = [...useGraphStore.getState().graph.substitutes.keys()][0]!;
    removeSubstitute(id);
    expect(useGraphStore.getState().graph.substitutes.size).toBe(0);
    expect(useGraphStore.getState().dirty.substitutes.has(id)).toBe(true);
  });
});

describe("view/selection actions", () => {
  it("selectNode updates selection without marking dirty", () => {
    seedGraph(BASE_ROWS);
    selectNode("SUB-1::A");
    const s = useGraphStore.getState();
    expect(s.selection.selectedNodeId).toBe("SUB-1::A");
    expect(isDirty(s.dirty)).toBe(false);
  });

  it("setActiveView switches views", () => {
    setActiveView("graph");
    expect(useGraphStore.getState().ui.activeView).toBe("graph");
  });

  it("toggleGridRow and toggleGraphNode toggle their respective sets", () => {
    toggleGridRow("e1");
    expect(useGraphStore.getState().ui.gridExpandedRows.has("e1")).toBe(true);
    toggleGridRow("e1");
    expect(useGraphStore.getState().ui.gridExpandedRows.has("e1")).toBe(false);

    toggleGraphNode("P::A");
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("P::A")).toBe(true);
  });
});

describe("commit", () => {
  it("throws when no GitHub token is set", async () => {
    seedGraph(BASE_ROWS);
    await expect(commit("msg")).rejects.toThrow(/No GitHub token set/);
  });
});