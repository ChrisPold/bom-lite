import { describe, it, expect } from "vitest";
import {
  ALL_HEADERS,
  DIAGNOSTIC_CODES,
  REQUIRED_HEADERS,
  validateHeaders,
  validateRow,
  type RawRow,
} from "./schema";

describe("validateHeaders", () => {
  it("accepts all required headers with no optional ones", () => {
    const result = validateHeaders([...REQUIRED_HEADERS]);
    expect(result.ok).toBe(true);
  });

  it("accepts the full 15-column contract", () => {
    const result = validateHeaders([...ALL_HEADERS]);
    expect(result.ok).toBe(true);
  });

  it("rejects headers missing Part_Number", () => {
    const headers: string[] = REQUIRED_HEADERS.filter((h) => h !== "Part_Number");
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("Part_Number");
    }
  });

  it("flags duplicate Part_Number", () => {
    const headers: string[] = [...REQUIRED_HEADERS, "Part_Number"];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.duplicates).toContain("Part_Number");
    }
  });

  it("flags unexpected columns", () => {
    const headers: string[] = [...REQUIRED_HEADERS, "NotAColumn"];
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.unexpected).toContain("NotAColumn");
    }
  });

  it("trims whitespace at header ends", () => {
    const headers: string[] = REQUIRED_HEADERS.map((h) => `  ${h}  `);
    const result = validateHeaders(headers);
    expect(result.ok).toBe(true);
  });

  it("is case-sensitive", () => {
    const headers: string[] = REQUIRED_HEADERS.map((h) =>
      h === "Part_Number" ? "part_number" : h,
    );
    const result = validateHeaders(headers);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toContain("Part_Number");
      expect(result.unexpected).toContain("part_number");
    }
  });
});

describe("validateRow", () => {
  function makeRow(overrides: Partial<RawRow> = {}): RawRow {
    return {
      __rowIndex: 0,
      Part_Number: "ASM-1000",
      Revision: "A",
      Description: "Main Chassis",
      Status: "RELEASED",
      UOM: "EA",
      Unit_Cost: 120.5,
      Lead_Time_Days: 14,
      Parent_Part_Number: undefined,
      Parent_Revision: undefined,
      Qty_Per_Parent: 1,
      Substitutes: undefined,
      ...overrides,
    };
  }

  it("returns no diagnostics for a valid row", () => {
    expect(validateRow(makeRow())).toEqual([]);
  });

  it("flags non-numeric Unit_Cost", () => {
    const d = validateRow(makeRow({ Unit_Cost: "abc" }));
    expect(d.map((x) => x.code)).toContain(
      DIAGNOSTIC_CODES.NON_NUMERIC_UNIT_COST,
    );
  });

  it("flags non-numeric Qty_Per_Parent", () => {
    const d = validateRow(makeRow({ Qty_Per_Parent: "many" }));
    expect(d.map((x) => x.code)).toContain(
      DIAGNOSTIC_CODES.NON_NUMERIC_QTY_PER_PARENT,
    );
  });

  it("flags non-numeric Lead_Time_Days", () => {
    const d = validateRow(makeRow({ Lead_Time_Days: "soon" }));
    expect(d.map((x) => x.code)).toContain(
      DIAGNOSTIC_CODES.NON_NUMERIC_LEAD_TIME_DAYS,
    );
  });

  it("flags unknown Status", () => {
    const d = validateRow(makeRow({ Status: "DRAFT" }));
    expect(d.map((x) => x.code)).toContain(DIAGNOSTIC_CODES.UNKNOWN_STATUS);
  });

  it("accepts numeric strings for numeric fields", () => {
    const row = makeRow({
      Unit_Cost: "120.5",
      Qty_Per_Parent: "2",
      Lead_Time_Days: "14",
    });
    expect(validateRow(row)).toEqual([]);
  });

  it("does not flag undefined numeric fields (missing ≠ invalid)", () => {
    const row = makeRow({
      Unit_Cost: undefined,
      Qty_Per_Parent: undefined,
      Lead_Time_Days: undefined,
    });
    expect(validateRow(row)).toEqual([]);
  });

  it("preserves the row index on diagnostics", () => {
    const d = validateRow(makeRow({ __rowIndex: 42, Unit_Cost: "abc" }));
    expect(d[0]?.rowIndex).toBe(42);
  });

  it("accepts all three valid statuses", () => {
    for (const s of ["WIP", "RELEASED", "OBSOLETE"] as const) {
      expect(validateRow(makeRow({ Status: s }))).toEqual([]);
    }
  });
});