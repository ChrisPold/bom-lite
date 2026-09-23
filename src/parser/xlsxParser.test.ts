import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseXlsx } from "./xlsxParser";

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
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  if (out instanceof ArrayBuffer) return out;
  const u8 = out as Uint8Array;
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

function row(values: Partial<Record<(typeof HEADERS)[number], unknown>>): unknown[] {
  return HEADERS.map((h) => values[h] ?? "");
}

describe("parseXlsx", () => {
  it("parses a minimal valid sheet with __rowIndex starting at 0", () => {
    const buffer = buildFixture([
      HEADERS,
      row({
        Part_Number: "ASM-1000",
        Revision: "A",
        Description: "Main Chassis",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 120.5,
        Lead_Time_Days: 14,
        Supplier: "Internal CNC",
        MPN: "CHS-001",
        CAD_Path: "/cad/asm-1000.glb",
        Drawing_Path: "/drawings/asm-1000.pdf",
        Qty_Per_Parent: 1,
      }),
    ]);

    const { rows, diagnostics } = parseXlsx(buffer);

    expect(diagnostics).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.__rowIndex).toBe(0);
    expect(rows[0]?.Part_Number).toBe("ASM-1000");
    expect(rows[0]?.Revision).toBe("A");
    expect(rows[0]?.Unit_Cost).toBe(120.5);
    expect(rows[0]?.Qty_Per_Parent).toBe(1);
  });

  it("preserves exact header keys — case sensitive", () => {
    const buffer = buildFixture([
      ["part_number", "Revision"],
      ["ASM-1000", "A"],
    ]);
    const { rows } = parseXlsx(buffer);
    expect(rows[0]).toHaveProperty("part_number");
    expect(rows[0]).not.toHaveProperty("Part_Number");
  });

  it("leaves a missing cell as undefined, not empty string", () => {
    const buffer = buildFixture([
      HEADERS,
      row({
        Part_Number: "ASM-1000",
        Revision: "A",
        Description: "Main Chassis",
        Status: "RELEASED",
        UOM: "EA",
        Unit_Cost: 120.5,
        Lead_Time_Days: 14,
      }),
    ]);
    const { rows } = parseXlsx(buffer);
    expect(rows[0]?.Qty_Per_Parent).toBeUndefined();
    expect(rows[0]?.Qty_Per_Parent).not.toBe("");
  });

  it("skips blank rows but keeps __rowIndex aligned to physical position", () => {
    const blankRow = HEADERS.map(() => "");
    const buffer = buildFixture([
      HEADERS,
      row({ Part_Number: "ASM-1000", Revision: "A", Qty_Per_Parent: 1 }),
      blankRow,
      row({ Part_Number: "ASM-2000", Revision: "A", Qty_Per_Parent: 2 }),
    ]);

    const { rows } = parseXlsx(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.Part_Number).toBe("ASM-1000");
    expect(rows[0]?.__rowIndex).toBe(0);
    expect(rows[1]?.Part_Number).toBe("ASM-2000");
    expect(rows[1]?.__rowIndex).toBe(2);
  });

  it("handles an empty sheet gracefully", () => {
    const buffer = buildFixture([]);
    const { rows, diagnostics } = parseXlsx(buffer);
    expect(rows).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("handles a header-only sheet", () => {
    const buffer = buildFixture([HEADERS]);
    const { rows } = parseXlsx(buffer);
    expect(rows).toEqual([]);
  });

  it("keeps numeric strings as strings", () => {
    const buffer = buildFixture([
      ["Part_Number", "Unit_Cost"],
      ["ASM-1000", "120.5"],
    ]);
    const { rows } = parseXlsx(buffer);
    expect(rows[0]?.Unit_Cost).toBe("120.5");
    expect(typeof rows[0]?.Unit_Cost).toBe("string");
  });

  it("can select a named sheet explicitly", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Wrong_Column"], ["ignore"]]),
      "First",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Part_Number"], ["ASM-9999"]]),
      "Second",
    );
    const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const buffer =
      out instanceof ArrayBuffer
        ? out
        : (out as Uint8Array).buffer.slice(
            (out as Uint8Array).byteOffset,
            (out as Uint8Array).byteOffset + (out as Uint8Array).byteLength,
          );

    const { rows } = parseXlsx(buffer as ArrayBuffer, { sheetName: "Second" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.Part_Number).toBe("ASM-9999");
  });
});