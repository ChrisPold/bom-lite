import { describe, it, expect } from "vitest";
import type { RawRow } from "../parser/schema";
import { buildGraph } from "./graphBuilder";

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

function codes(diags: { code: string }[]): string[] {
  return diags.map((d) => d.code);
}

describe("buildGraph — nodes", () => {
  it("creates one node per unique Part_Number::Revision", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Description: "Main Chassis",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 120.5,
        Lead_Time_Days: 14,
        Qty_Per_Parent: 1,
      }),
    ]);
    expect(graph.nodes.size).toBe(1);
    const node = graph.nodes.get("ASM-1000::A");
    expect(node?.partNumber).toBe("ASM-1000");
    expect(node?.revision).toBe("A");
    expect(node?.description).toBe("Main Chassis");
    expect(node?.status).toBe("RELEASED");
    expect(node?.unitCost).toBe(120.5);
    expect(node?.leadTimeDays).toBe(14);
  });

  it("dedupes the same part::revision across rows without a conflict when intrinsics match", () => {
    const base = {
      Part_Number: "ASM-1000",
      Revision: "A",
      Description: "Main Chassis",
      Status: "RELEASED",
      UOM: "EA",
      Unit_Cost: 120.5,
      Lead_Time_Days: 14,
    };
    const { graph, diagnostics } = buildGraph([
      row({
        __rowIndex: 0,
        ...base,
        Parent_Part_Number: "TOP-1",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 1,
        ...base,
        Parent_Part_Number: "TOP-2",
        Parent_Revision: "A",
      }),
    ]);
    // Both rows define the same node id. TOP-1 and TOP-2 do not exist as
    // rows, so no parent nodes are created. Only ASM-1000::A exists.
    expect(graph.nodes.size).toBe(1);
    expect(
      diagnostics.filter((d) => d.code === "INTRINSIC_FIELD_CONFLICT"),
    ).toEqual([]);
  });

  it("emits INTRINSIC_FIELD_CONFLICT when Description differs across duplicate rows", () => {
    const base = {
      Part_Number: "ASM-1000",
      Revision: "A",
      Status: "RELEASED",
      UOM: "EA",
      Unit_Cost: 120.5,
      Lead_Time_Days: 14,
    };
    const { diagnostics } = buildGraph([
      row({ __rowIndex: 0, ...base, Description: "Chassis A" }),
      row({ __rowIndex: 1, ...base, Description: "Chassis B" }),
    ]);
    const conflicts = diagnostics.filter(
      (d) => d.code === "INTRINSIC_FIELD_CONFLICT",
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.rowIndex).toBe(1);
    expect(conflicts[0]?.message).toContain("Chassis A");
    expect(conflicts[0]?.message).toContain("Chassis B");
  });

  it("adopts a value defined on a later row when the first row left it blank", () => {
    const base = {
      Part_Number: "ASM-1000",
      Revision: "A",
      Status: "RELEASED",
      UOM: "EA",
      Lead_Time_Days: 14,
    };
    const { graph, diagnostics } = buildGraph([
      row({
        __rowIndex: 0,
        ...base,
        Description: undefined,
        Unit_Cost: undefined,
      }),
      row({
        __rowIndex: 1,
        ...base,
        Description: "Real Description",
        Unit_Cost: 99,
      }),
    ]);
    expect(
      diagnostics.filter((d) => d.code === "INTRINSIC_FIELD_CONFLICT"),
    ).toEqual([]);
    const node = graph.nodes.get("ASM-1000::A");
    expect(node?.description).toBe("Real Description");
    expect(node?.unitCost).toBe(99);
  });

  it("skips rows without Part_Number or Revision and emits MISSING_REQUIRED_VALUE", () => {
    const { graph, diagnostics } = buildGraph([
      row({ __rowIndex: 0, Revision: "A" }),
      row({ __rowIndex: 1, Part_Number: "ASM-1000" }),
    ]);
    expect(graph.nodes.size).toBe(0);
    expect(codes(diagnostics)).toEqual([
      "MISSING_REQUIRED_VALUE",
      "MISSING_REQUIRED_VALUE",
    ]);
  });

  it("coerces numeric strings for Unit_Cost, Lead_Time_Days, Qty_Per_Parent", () => {
    const { graph, diagnostics } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "P",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: "10.5",
        Lead_Time_Days: "3",
        Qty_Per_Parent: "2",
      }),
    ]);
    const node = graph.nodes.get("P::A");
    expect(node?.unitCost).toBe(10.5);
    expect(node?.leadTimeDays).toBe(3);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });
});

describe("buildGraph — edges", () => {
  it("creates one edge per row with a resolvable parent", () => {
    const { graph, diagnostics } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: 2,
      }),
    ]);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.size).toBe(1);
    const edge = [...graph.edges.values()][0];
    expect(edge?.parentId).toBe("ASM-1000::A");
    expect(edge?.childId).toBe("SUB-1::A");
    expect(edge?.qtyPerParent).toBe(2);
    expect(edge?.id).toBe("ASM-1000::A->SUB-1::A::row1");
    expect(edge?.rowIndex).toBe(1);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("keeps duplicate (parent, child) pairs as distinct edges with distinct ids", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: 1,
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: 5,
      }),
    ]);
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.size).toBe(2);
    const ids = [...graph.edges.keys()].sort();
    expect(ids).toEqual([
      "ASM-1000::A->SUB-1::A::row1",
      "ASM-1000::A->SUB-1::A::row2",
    ]);
  });

  it("adds root rows to graph.roots without creating an edge", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-TOP",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);
    expect(graph.roots).toEqual(["ASM-TOP::A"]);
    expect(graph.edges.size).toBe(0);
  });

  it("does not create an edge when the parent part is unknown, but still creates the child node", () => {
    const { graph, diagnostics } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "MISSING-PARENT",
        Parent_Revision: "A",
      }),
    ]);
    expect(graph.nodes.size).toBe(1);
    expect(graph.edges.size).toBe(0);
    expect(codes(diagnostics)).toContain("PARENT_PART_NOT_FOUND");
  });

  it("defaults Qty_Per_Parent to 1 when missing", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
      }),
    ]);
    const edge = [...graph.edges.values()][0];
    expect(edge?.qtyPerParent).toBe(1);
  });

  it("emits NON_NUMERIC_QTY_PER_PARENT and falls back to 1", () => {
    const { graph, diagnostics } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: "many",
      }),
    ]);
    expect(codes(diagnostics)).toContain("NON_NUMERIC_QTY_PER_PARENT");
    const edge = [...graph.edges.values()][0];
    expect(edge?.qtyPerParent).toBe(1);
  });
});

describe("buildGraph — indexes", () => {
  it("populates edgesByParent and edgesByChild with edge ids", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SUB-2",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
      }),
    ]);

    const parentEdges = [
      ...(graph.edgesByParent.get("ASM-1000::A") ?? []),
    ].sort();
    expect(parentEdges).toEqual([
      "ASM-1000::A->SUB-1::A::row1",
      "ASM-1000::A->SUB-2::A::row2",
    ]);

    const childEdges = [
      ...(graph.edgesByChild.get("SUB-1::A") ?? []),
    ];
    expect(childEdges).toEqual(["ASM-1000::A->SUB-1::A::row1"]);
  });

  it("leaves orphans empty when all parents resolve", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
      }),
    ]);
    expect(graph.orphans).toEqual([]);
  });
});

describe("buildGraph — cycles and substitutes integration", () => {
  it("detects a two-node cycle through the graph", () => {
    const { graph } = buildGraph([
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
    ]);
    expect(graph.cycles).toHaveLength(1);
    expect(new Set(graph.cycles[0])).toEqual(new Set(["A::A", "B::A"]));
  });

  it("builds substitutes with parent scope when the row has a parent", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "RES-001",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Substitutes: "RES-002::A",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "RES-002",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);
    expect(graph.substitutes.size).toBe(1);
    const sub = [...graph.substitutes.values()][0];
    expect(sub?.id).toBe("RES-001::A~sub~RES-002::A::ASM-1000::A");
    expect(sub?.scopeParentId).toBe("ASM-1000::A");
    expect(graph.substitutesByPart.get("RES-001::A")).toEqual([
      "RES-001::A~sub~RES-002::A::ASM-1000::A",
    ]);
  });

  it("builds global-scope substitutes when the row is a root", () => {
    const { graph } = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "RES-001",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Substitutes: "RES-002::A",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "RES-002",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);
    expect(graph.substitutes.size).toBe(1);
    const sub = [...graph.substitutes.values()][0];
    expect(sub?.id).toBe("RES-001::A~sub~RES-002::A::global");
    expect(sub?.scopeParentId).toBeUndefined();
  });
});