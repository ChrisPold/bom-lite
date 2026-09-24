// src/writeBack/serialize.ts
//
// RawRow[] -> xlsx ArrayBuffer.
//
// Columns are emitted in the physical order that the schema expects. The
// header row is written verbatim; each data row pulls fields by name from
// the RawRow.

import * as XLSX from "xlsx";
import type { RawRow } from "../parser/schema";

/**
 * Physical column order for the master sheet. This is the order the app
 * writes; validateHeaders accepts any order as long as required columns
 * are present.
 */
export const PHYSICAL_COLUMNS = [
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
] as const;

export type PhysicalColumn = (typeof PHYSICAL_COLUMNS)[number];

export function rowsToXlsxBuffer(
  rows: readonly RawRow[],
  sheetName: string = "Sheet1",
): ArrayBuffer {
  const aoa: unknown[][] = [PHYSICAL_COLUMNS.slice()];
  for (const row of rows) {
    aoa.push(PHYSICAL_COLUMNS.map((col) => row[col] ?? ""));
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);

  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  if (out instanceof ArrayBuffer) return out;
  const u8 = out as Uint8Array;
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}