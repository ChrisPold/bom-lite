import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { runPipeline } from "./pipeline";
import { serializeGraph, deserializeGraph } from "./protocol";

const HEADERS = [
  "Part_Number",
  "Revision",
  "Description",
  "Status",
  "UOM",
  "Unit_Cost",
  "Lead_Time_Days",
  "Supplier",
  "MPN",
  "CAD_Path",
  "Drawing_Path",
  "Parent_Part_Number",
  "Parent_Revision",
  "Qty_Per_Parent",
  "Substitutes",
];

function buildFixture(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  if (out instanceof ArrayBuffer) return out;
  const u8 = out as Uint8Array;
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}

function row(values: Record<string, unknown>): unknown[] {
  return HEADERS.map((h) => values[h] ?? "");
}

const SAMPLE = [
  HEADERS,
  row({
    Part_Number: "ASM-1000",
    Revision: "A",
    Description: "Chassis",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 100,
    Lead_Time_Days: 14,
    Qty_Per_Parent: 1,
  }),
  row({
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
];

describe("runPipeline", () => {
  it("runs parser + graph builder and returns a graph", () => {
    const { graph, diagnostics } = runPipeline(buildFixture(SAMPLE));
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.size).toBe(1);
    expect(graph.roots).toEqual(["ASM-1000::A"]);
    expect(diagnostics).toEqual([]);
  });

  it("returns both parse and graph diagnostics combined", () => {
    const bad = [
      HEADERS,
      row({
        Part_Number: "P",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: "abc",
      }),
    ];
    const { diagnostics } = runPipeline(buildFixture(bad));
    expect(diagnostics.map((d) => d.code)).toContain("NON_NUMERIC_UNIT_COST");
  });

  it("returns an empty graph for garbage input rather than throwing", () => {
    const garbage = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    const { graph, diagnostics } = runPipeline(garbage);
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
    expect(graph.roots).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe("serializeGraph / deserializeGraph", () => {
  it("round-trips a graph with no data loss", () => {
    const { graph } = runPipeline(buildFixture(SAMPLE));
    const restored = deserializeGraph(serializeGraph(graph));

    expect(restored.nodes.size).toBe(graph.nodes.size);
    expect(restored.edges.size).toBe(graph.edges.size);
    expect(restored.substitutes.size).toBe(graph.substitutes.size);
    expect(restored.roots).toEqual(graph.roots);
    expect(restored.orphans).toEqual(graph.orphans);
    expect(restored.cycles).toEqual(graph.cycles);

    const originalNode = graph.nodes.get("ASM-1000::A");
    const restoredNode = restored.nodes.get("ASM-1000::A");
    expect(restoredNode).toEqual(originalNode);

    const originalEdges = graph.edgesByParent.get("ASM-1000::A");
    const restoredEdges = restored.edgesByParent.get("ASM-1000::A");
    expect(restoredEdges).toEqual(originalEdges);
  });

  it("preserves substitutes with their scope parent", () => {
    const withSubs = [
      HEADERS,
      row({
        Part_Number: "P",
        Revision: "A",
        Description: "Primary",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        Part_Number: "S",
        Revision: "A",
        Description: "Sub",
        Status: "RELEASED",
        UOM: "EA",
      }),
      row({
        Part_Number: "P",
        Revision: "A",
        Description: "Primary",
        Status: "RELEASED",
        UOM: "EA",
        Substitutes: "S::A",
      }),
    ];
    const { graph } = runPipeline(buildFixture(withSubs));
    const restored = deserializeGraph(serializeGraph(graph));
    expect(restored.substitutes.size).toBe(1);
    const sub = [...restored.substitutes.values()][0];
    expect(sub?.primaryId).toBe("P::A");
    expect(sub?.substituteId).toBe("S::A");
  });
});