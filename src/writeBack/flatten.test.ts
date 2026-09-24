import { describe, it, expect } from "vitest";
import type { RawRow } from "../parser/schema";
import type { BomGraph } from "../graph/types";
import { buildGraph } from "../graph/graphBuilder";
import { flatten } from "./flatten";

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

function nodeFingerprints(g: BomGraph): string[] {
  return [...g.nodes.values()].map((n) => JSON.stringify(n)).sort();
}

function edgeFingerprints(g: BomGraph): string[] {
  return [...g.edges.values()]
    .map((e) => `${e.parentId}->${e.childId}@${e.qtyPerParent}`)
    .sort();
}

describe("flatten — structure", () => {
  it("emits one root row for a root-only node", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
        Revision: "A",
        Description: "Root",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 5,
        Lead_Time_Days: 2,
      }),
    ]).graph;

    const rows = flatten(g);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.Part_Number).toBe("ASM-1");
    expect(rows[0]?.Revision).toBe("A");
    expect(rows[0]?.Parent_Part_Number).toBeUndefined();
    expect(rows[0]?.Parent_Revision).toBeUndefined();
    expect(rows[0]?.Qty_Per_Parent).toBe(1);
    expect(rows[0]?.__rowIndex).toBe(0);
  });

  it("emits one edge row per edge with parent fields populated", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
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
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
        Qty_Per_Parent: 4,
      }),
    ]).graph;

    const rows = flatten(g);
    expect(rows).toHaveLength(2);

    const subRow = rows.find((r) => r.Part_Number === "SUB-1");
    expect(subRow?.Parent_Part_Number).toBe("ASM-1");
    expect(subRow?.Parent_Revision).toBe("A");
    expect(subRow?.Qty_Per_Parent).toBe(4);
  });

  it("preserves all 15 columns", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "P",
        Revision: "A",
        Description: "desc",
        Status: "WIP",
        UOM: "MM",
        Unit_Cost: 3.5,
        Lead_Time_Days: 9,
        Supplier: "Acme",
        MPN: "MPN-1",
        CAD_Path: "/cad/p.glb",
        Drawing_Path: "/drw/p.pdf",
      }),
    ]).graph;

    const r = flatten(g)[0]!;

    expect(r.Part_Number).toBe("P");
    expect(r.Revision).toBe("A");
    expect(r.Description).toBe("desc");
    expect(r.Status).toBe("WIP");
    expect(r.UOM).toBe("MM");
    expect(r.Unit_Cost).toBe(3.5);
    expect(r.Lead_Time_Days).toBe(9);
    expect(r.Supplier).toBe("Acme");
    expect(r.MPN).toBe("MPN-1");
    expect(r.CAD_Path).toBe("/cad/p.glb");
    expect(r.Drawing_Path).toBe("/drw/p.pdf");
  });

  it("assigns sequential __rowIndex values", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
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
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
      }),
    ]).graph;

    const rows = flatten(g);
    expect(rows.map((r) => r.__rowIndex)).toEqual([0, 1]);
  });

  it("emits an isolated node (no edges, not in roots) as a root row", () => {
    const isolated: BomGraph = {
      nodes: new Map([
        [
          "LONELY::A",
          {
            id: "LONELY::A",
            partNumber: "LONELY",
            revision: "A",
            description: "",
            status: "RELEASED",
            uom: "EA",
            unitCost: 0,
            leadTimeDays: 0,
          },
        ],
      ]),
      edges: new Map(),
      substitutes: new Map(),
      edgesByParent: new Map(),
      edgesByChild: new Map(),
      substitutesByPart: new Map(),
      roots: [],
      orphans: [],
      cycles: [],
    };

    const rows = flatten(isolated);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Part_Number).toBe("LONELY");
    expect(rows[0]?.Parent_Part_Number).toBeUndefined();
  });

  it("produces deterministic output across repeated calls", () => {
    const g = buildGraph([
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
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
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SUB-2",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
      }),
    ]).graph;

    const a = JSON.stringify(flatten(g));
    const b = JSON.stringify(flatten(g));
    expect(a).toBe(b);
  });
});

describe("flatten — round-trip", () => {
  it("round-trips a simple assembly", () => {
    const original = [
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Description: "Chassis",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 100,
        Lead_Time_Days: 14,
      }),
      row({
        __rowIndex: 1,
        Part_Number: "SUB-1",
        Revision: "A",
        Description: "Plate",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 12,
        Lead_Time_Days: 7,
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: 2,
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SUB-2",
        Revision: "A",
        Description: "Bracket",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 45,
        Lead_Time_Days: 21,
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: 1,
      }),
    ];

    const g1 = buildGraph(original).graph;
    const g2 = buildGraph(flatten(g1)).graph;

    expect(nodeFingerprints(g2)).toEqual(nodeFingerprints(g1));
    expect(edgeFingerprints(g2)).toEqual(edgeFingerprints(g1));
    expect([...g2.roots].sort()).toEqual([...g1.roots].sort());
  });

  it("round-trips a part that appears under multiple parents", () => {
    const original = [
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1000",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        __rowIndex: 1,
        Part_Number: "ASM-2000",
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
        Parent_Part_Number: "ASM-1000",
        Parent_Revision: "A",
        Qty_Per_Parent: 2,
      }),
      row({
        __rowIndex: 3,
        Part_Number: "SHARED",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-2000",
        Parent_Revision: "A",
        Qty_Per_Parent: 5,
      }),
    ];

    const g1 = buildGraph(original).graph;
    const g2 = buildGraph(flatten(g1)).graph;

    expect(nodeFingerprints(g2)).toEqual(nodeFingerprints(g1));
    expect(edgeFingerprints(g2)).toEqual(edgeFingerprints(g1));
  });

  it("round-trips duplicate (parent, child) pairs without collapsing them", () => {
    const original = [
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
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
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
        Qty_Per_Parent: 1,
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SUB-1",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
        Qty_Per_Parent: 5,
      }),
    ];

    const g1 = buildGraph(original).graph;
    expect(g1.edges.size).toBe(2);

    const g2 = buildGraph(flatten(g1)).graph;
    expect(g2.edges.size).toBe(2);
    expect(edgeFingerprints(g2)).toEqual(edgeFingerprints(g1));
  });

  it("round-trips substitutes", () => {
    const original = [
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
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
        Parent_Part_Number: "ASM-1",
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
    ];

    const g1 = buildGraph(original).graph;
    expect(g1.substitutes.size).toBe(1);

    const g2 = buildGraph(flatten(g1)).graph;
    expect(g2.substitutes.size).toBe(1);

    const s1 = [...g1.substitutes.values()][0]!;
    const s2 = [...g2.substitutes.values()][0]!;
    expect(s2.primaryId).toBe(s1.primaryId);
    expect(s2.substituteId).toBe(s1.substituteId);
    expect(s2.scopeParentId).toBe(s1.scopeParentId);
  });

  it("round-trips multiple revisions of the same part", () => {
    const original = [
      row({
        __rowIndex: 0,
        Part_Number: "ASM-1",
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
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
      }),
      row({
        __rowIndex: 2,
        Part_Number: "SUB-1",
        Revision: "B",
        Status: "WIP",
        UOM: "EA",
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "A",
      }),
    ];

    const g1 = buildGraph(original).graph;
    const g2 = buildGraph(flatten(g1)).graph;
    expect(nodeFingerprints(g2)).toEqual(nodeFingerprints(g1));
    expect(edgeFingerprints(g2)).toEqual(edgeFingerprints(g1));
  });
});