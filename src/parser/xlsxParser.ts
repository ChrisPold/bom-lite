// src/parser/xlsxParser.ts
//
// Converts a raw .xlsx ArrayBuffer into RawRow[] via SheetJS.
// Pure function. No DOM access. Runs inside the parse worker (later task).
// Does NOT validate headers — that is schema.ts's job.
//
// __rowIndex semantics: 0-based physical row offset from the header row.
// The header is at physical row 0; the first data row is __rowIndex 0.
// Blank rows are skipped from output, but their physical position still
// counts toward __rowIndex, so ids remain stable across parses.

import * as XLSX from "xlsx";
import type { RawRow, RowDiagnostic } from "./schema";

export interface ParseXlsxOptions {
  /** Sheet name. Defaults to the first sheet in the workbook. */
  sheetName?: string;
}

export interface ParseXlsxResult {
  rows: RawRow[];
  diagnostics: RowDiagnostic[];
}

function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || v === "";
}

function isBlankRow(arr: readonly unknown[]): boolean {
  for (const cell of arr) {
    if (!isBlankCell(cell)) return false;
  }
  return true;
}

export function parseXlsx(
  buffer: ArrayBuffer,
  options: ParseXlsxOptions = {},
): ParseXlsxResult {
  const workbook = XLSX.read(buffer, { type: "array" });

  const sheetName = options.sheetName ?? workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Workbook contains no sheets");
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  // header: 1      → array-of-arrays, no header inference
  // blankrows:true → preserve physical positions so __rowIndex stays stable
  // defval        → missing cells become undefined, not ""
  // raw: true     → keep numbers as numbers
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: true,
    defval: undefined,
    raw: true,
  });

  if (matrix.length === 0) {
    return { rows: [], diagnostics: [] };
  }

  const headerCells = matrix[0] ?? [];
  // Preserve exact header strings; only String()-coerce non-strings.
  const headers = headerCells.map((h) => (h == null ? "" : String(h)));

  const rows: RawRow[] = [];

  for (let physical = 1; physical < matrix.length; physical++) {
    const arr = matrix[physical] ?? [];
    if (isBlankRow(arr)) continue;

    const partial: Record<string, string | number> = {};
    for (let col = 0; col < headers.length; col++) {
      const key = headers[col];
      if (!key) continue;
      const value = arr[col];
      if (isBlankCell(value)) continue;
      if (typeof value === "number" || typeof value === "string") {
        partial[key] = value;
      } else {
        partial[key] = String(value);
      }
    }

    rows.push({
      __rowIndex: physical - 1,
      ...partial,
    } as RawRow);
  }

  return { rows, diagnostics: [] };
}