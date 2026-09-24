import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import type { RawRow } from "../parser/schema";
import { parseXlsx } from "../parser/xlsxParser";
import { buildGraph } from "../graph/graphBuilder";
import { flatten } from "./flatten";
import { PHYSICAL_COLUMNS, rowsToXlsxBuffer } from "./serialize";

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

function readHeaders(buffer: ArrayBuffer): string[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
  });
  return (matrix[0] ?? []).map((h) => String(h ?? ""));
}

describe("rowsToXlsxBuffer — headers", () => {
  it("emits all 15 columns in physical order", () => {
    const buf = rowsToXlsxBuffer([]);
    expect(readHeaders(buf)).toEqual([...PHYSICAL_COLUMNS]);
  });

  it("round-trips headers through validateHeaders", () => {
    const buf = rowsToXlsxBuffer([]);
    const { rows } = parseXlsx(buf);
    expect(rows).toEqual([]);
  });
});

describe("rowsToXlsxBuffer — data", () => {
  it("writes a single row with all fields preserved", () => {
    const buf = rowsToXlsxBuffer([
      row({
        __rowIndex: 0,
        Part_Number: "P",
        Revision: "A",
        Description: "desc",
        Status: "WIP",
        UOM: "EA",
        Unit_Cost: 3.5,
        Lead_Time_Days: 9,
        Supplier: "Acme",
        MPN: "MPN-1",
        CAD_Path: "/c.glb",
        Drawing_Path: "/d.pdf",
        Parent_Part_Number: "ASM-1",
        Parent_Revision: "B",
        Qty_Per_Parent: 4,
        Substitutes: "RES-002::A",
      }),
    ]);

    const { rows } = parseXlsx(buf);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.Part_Number).toBe("P");
    expect(r.Revision).toBe("A");
    expect(r.Description).toBe("desc");
    expect(r.Status).toBe("WIP");
    expect(r.UOM).toBe("EA");
    expect(r.Unit_Cost).toBe(3.5);
    expect(r.Lead_Time_Days).toBe(9);
    expect(r.Supplier).toBe("Acme");
    expect(r.MPN).toBe("MPN-1");
    expect(r.CAD_Path).toBe("/c.glb");
    expect(r.Drawing_Path).toBe("/d.pdf");
    expect(r.Parent_Part_Number).toBe("ASM-1");
    expect(r.Parent_Revision).toBe("B");
    expect(r.Qty_Per_Parent).toBe(4);
    expect(r.Substitutes).toBe("RES-002::A");
  });

  it("omits undefined fields as empty cells", () => {
    const buf = rowsToXlsxBuffer([
      row({
        __rowIndex: 0,
        Part_Number: "P",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
        // All other fields undefined
      }),
    ]);

    const { rows } = parseXlsx(buf);
    const r = rows[0]!;
    expect(r.Supplier).toBeUndefined();
    expect(r.Parent_Part_Number).toBeUndefined();
    expect(r.Substitutes).toBeUndefined();
  });

  it("preserves multiple rows in order", () => {
    const buf = rowsToXlsxBuffer([
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
        Part_Number: "C",
        Revision: "A",
        Status: "RELEASED",
        UOM: "EA",
      }),
    ]);

    const { rows } = parseXlsx(buf);
    expect(rows.map((r) => r.Part_Number)).toEqual(["A", "B", "C"]);
  });
});

describe("rowsToXlsxBuffer — full round trip", () => {
  it("graph -> rows -> xlsx -> rows -> graph preserves structure", () => {
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
    ];

    const g1 = buildGraph(original).graph;
    const rows1 = flatten(g1);
    const xlsx = rowsToXlsxBuffer(rows1);
    const { rows: rows2 } = parseXlsx(xlsx);
    const g2 = buildGraph(rows2).graph;

    const fp = (g: typeof g1) =>
      [...g.nodes.values()].map((n) => JSON.stringify(n)).sort();
    const efp = (g: typeof g1) =>
      [...g.edges.values()]
        .map((e) => `${e.parentId}->${e.childId}@${e.qtyPerParent}`)
        .sort();

    expect(fp(g2)).toEqual(fp(g1));
    expect(efp(g2)).toEqual(efp(g1));
  });
});