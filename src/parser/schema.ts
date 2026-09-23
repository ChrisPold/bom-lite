// src/parser/schema.ts
//
// Excel schema contract for BOM-Lite.
// The first tab of the master workbook MUST contain these columns.
// Header comparison is case-sensitive; whitespace is trimmed only at the ends.

export interface RawRow {
  readonly __rowIndex: number;
  readonly Part_Number?: string | number;
  readonly Revision?: string | number;
  readonly Description?: string | number;
  readonly Status?: string | number;
  readonly UOM?: string | number;
  readonly Unit_Cost?: string | number;
  readonly Lead_Time_Days?: string | number;
  readonly Supplier?: string | number;
  readonly MPN?: string | number;
  readonly CAD_Path?: string | number;
  readonly Drawing_Path?: string | number;
  readonly Parent_Part_Number?: string | number;
  readonly Parent_Revision?: string | number;
  readonly Qty_Per_Parent?: string | number;
  readonly Substitutes?: string | number;
}

/**
 * Required columns. A column that is required must appear as a header,
 * but its value may be empty/undefined on individual rows (e.g. a root row
 * has no Parent_Part_Number value, but the column must exist).
 */
export const REQUIRED_HEADERS = [
  "Part_Number",
  "Revision",
  "Description",
  "Status",
  "UOM",
  "Unit_Cost",
  "Lead_Time_Days",
  "Parent_Part_Number",
  "Qty_Per_Parent",
] as const;

export const OPTIONAL_HEADERS = [
  "Parent_Revision",
  "Supplier",
  "MPN",
  "CAD_Path",
  "Drawing_Path",
  "Substitutes",
] as const;

export const ALL_HEADERS = [
  ...REQUIRED_HEADERS,
  ...OPTIONAL_HEADERS,
] as const;

export type RequiredHeader = (typeof REQUIRED_HEADERS)[number];
export type OptionalHeader = (typeof OPTIONAL_HEADERS)[number];
export type Header = (typeof ALL_HEADERS)[number];

// ─── Diagnostics ────────────────────────────────────────────────────────────

export const DIAGNOSTIC_CODES = {
  MISSING_REQUIRED_HEADER: "MISSING_REQUIRED_HEADER",
  DUPLICATE_HEADER: "DUPLICATE_HEADER",
  NON_NUMERIC_UNIT_COST: "NON_NUMERIC_UNIT_COST",
  NON_NUMERIC_QTY_PER_PARENT: "NON_NUMERIC_QTY_PER_PARENT",
  NON_NUMERIC_LEAD_TIME_DAYS: "NON_NUMERIC_LEAD_TIME_DAYS",
  UNKNOWN_STATUS: "UNKNOWN_STATUS",
  // Warning code — raised by the revision resolver (later task), not here.
  LEGACY_ROW_REVISION_INFERRED: "LEGACY_ROW_REVISION_INFERRED",
} as const;

export type DiagnosticCode =
  (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

export type DiagnosticSeverity = "error" | "warn";

export interface RowDiagnostic {
  readonly rowIndex: number;
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly severity: DiagnosticSeverity;
}

// ─── Header validation ──────────────────────────────────────────────────────

export type HeaderValidationResult =
  | { ok: true }
  | {
      ok: false;
      missing: string[];
      unexpected: string[];
      duplicates: string[];
    };

export function validateHeaders(headers: string[]): HeaderValidationResult {
  const trimmed = headers.map((h) => h.trim());

  // Detect duplicates
  const counts = new Map<string, number>();
  for (const h of trimmed) {
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const duplicates: string[] = [];
  for (const [h, c] of counts) {
    if (c > 1) duplicates.push(h);
  }

  const headerSet = new Set(trimmed);

  const missing: string[] = [];
  for (const req of REQUIRED_HEADERS) {
    if (!headerSet.has(req)) missing.push(req);
  }

  const expected = new Set<string>(ALL_HEADERS);
  const unexpected: string[] = [];
  for (const h of trimmed) {
    if (!expected.has(h) && !unexpected.includes(h)) {
      unexpected.push(h);
    }
  }

  if (missing.length === 0 && unexpected.length === 0 && duplicates.length === 0) {
    return { ok: true };
  }

  return { ok: false, missing, unexpected, duplicates };
}

// ─── Row validation ─────────────────────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "WIP",
  "RELEASED",
  "OBSOLETE",
]);

function isNumericLike(value: string | number | undefined | null): boolean {
  if (value === undefined || value === null) return true; // missing — not a numeric error
  if (typeof value === "number") return Number.isFinite(value);
  const trimmed = value.trim();
  if (trimmed === "") return true; // empty string treated as missing
  return Number.isFinite(Number(trimmed));
}

export function validateRow(row: RawRow): RowDiagnostic[] {
  const diagnostics: RowDiagnostic[] = [];
  const rowIndex = row.__rowIndex;

  if (!isNumericLike(row.Unit_Cost)) {
    diagnostics.push({
      rowIndex,
      code: DIAGNOSTIC_CODES.NON_NUMERIC_UNIT_COST,
      message: `Unit_Cost is not numeric: ${String(row.Unit_Cost)}`,
      severity: "error",
    });
  }

  if (!isNumericLike(row.Qty_Per_Parent)) {
    diagnostics.push({
      rowIndex,
      code: DIAGNOSTIC_CODES.NON_NUMERIC_QTY_PER_PARENT,
      message: `Qty_Per_Parent is not numeric: ${String(row.Qty_Per_Parent)}`,
      severity: "error",
    });
  }

  if (!isNumericLike(row.Lead_Time_Days)) {
    diagnostics.push({
      rowIndex,
      code: DIAGNOSTIC_CODES.NON_NUMERIC_LEAD_TIME_DAYS,
      message: `Lead_Time_Days is not numeric: ${String(row.Lead_Time_Days)}`,
      severity: "error",
    });
  }

  if (row.Status !== undefined && row.Status !== null) {
    const statusStr = String(row.Status).trim();
    if (statusStr !== "" && !VALID_STATUSES.has(statusStr)) {
      diagnostics.push({
        rowIndex,
        code: DIAGNOSTIC_CODES.UNKNOWN_STATUS,
        message: `Status is not a known value: ${statusStr}`,
        severity: "error",
      });
    }
  }

  return diagnostics;
}