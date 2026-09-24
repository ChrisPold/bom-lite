// scripts/make-test-xlsx.mjs
//
// Generates test-data/drone-bom.xlsx — a realistic 3-level BOM with
// shared parts, a substitute, mixed statuses, and multiple suppliers.
//
// Run with:  node scripts/make-test-xlsx.mjs

import * as XLSX from "xlsx";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

// ─── BOM data ───────────────────────────────────────────────────────────────
// Top assembly: DRONE-1000 (quadcopter frame)
//   ├── ARM-2000 × 4 (aluminum arm)
//   │     ├── RES-001 × 2 (M3 screw)
//   │     └── MOTOR-3000 × 1 (brushless motor)
//   │           └── RES-005 × 1 (prop adapter)
//   ├── PLATE-1000 × 1 (carbon base plate)
//   │     ├── RES-002 × 4 (M4 screw)   ← has substitute RES-002B
//   │     └── PCB-5000 × 1 (flight controller)
//   │           └── RES-003 × 4 (standoff)
//   └── CANOPY-1000 × 1 (plastic canopy)
//
// Plus a standalone spare part that nobody consumes: PROP-4000

const rows = [
  // ── Top-level root
  {
    Part_Number: "DRONE-1000",
    Revision: "B",
    Description: "Quadcopter frame, rev B",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 25.0, // assembly labor/overhead
    Lead_Time_Days: 3,
    Supplier: "Internal",
    MPN: "DRN-1000-B",
    CAD_Path: "/cad/drone-1000.glb",
    Drawing_Path: "/drawings/drone-1000.pdf",
    Parent_Part_Number: "",
    Parent_Revision: "",
    Qty_Per_Parent: "",
    Substitutes: "",
  },

  // ── Level 1: ARM, PLATE, CANOPY
  {
    Part_Number: "ARM-2000",
    Revision: "A",
    Description: "Aluminum arm, 220mm",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 4.5,
    Lead_Time_Days: 7,
    Supplier: "Fabrik A/S",
    MPN: "ALU-ARM-220",
    CAD_Path: "/cad/arm-2000.glb",
    Drawing_Path: "/drawings/arm-2000.pdf",
    Parent_Part_Number: "DRONE-1000",
    Parent_Revision: "B",
    Qty_Per_Parent: 4,
    Substitutes: "",
  },
  {
    Part_Number: "PLATE-1000",
    Revision: "A",
    Description: "Carbon fiber base plate",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 12.75,
    Lead_Time_Days: 10,
    Supplier: "CarbonWorks",
    MPN: "CF-BASE-100",
    CAD_Path: "/cad/plate-1000.glb",
    Drawing_Path: "/drawings/plate-1000.pdf",
    Parent_Part_Number: "DRONE-1000",
    Parent_Revision: "B",
    Qty_Per_Parent: 1,
    Substitutes: "",
  },
  {
    Part_Number: "CANOPY-1000",
    Revision: "A",
    Description: "ABS canopy shell",
    Status: "WIP",
    UOM: "EA",
    Unit_Cost: 2.1,
    Lead_Time_Days: 4,
    Supplier: "3D Print Co",
    MPN: "ABS-CAN-1",
    CAD_Path: "/cad/canopy-1000.glb",
    Drawing_Path: "",
    Parent_Part_Number: "DRONE-1000",
    Parent_Revision: "B",
    Qty_Per_Parent: 1,
    Substitutes: "",
  },

  // ── Level 2 under ARM-2000
  {
    Part_Number: "RES-001",
    Revision: "A",
    Description: "M3 × 8mm socket screw",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.08,
    Lead_Time_Days: 3,
    Supplier: "Digi-Key",
    MPN: "91290A113",
    CAD_Path: "",
    Drawing_Path: "",
    Parent_Part_Number: "ARM-2000",
    Parent_Revision: "A",
    Qty_Per_Parent: 2,
    Substitutes: "",
  },
  {
    Part_Number: "MOTOR-3000",
    Revision: "A",
    Description: "Brushless motor 2306",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 18.4,
    Lead_Time_Days: 21,
    Supplier: "T-Motor",
    MPN: "TM-2306-1700",
    CAD_Path: "/cad/motor-3000.glb",
    Drawing_Path: "/drawings/motor-3000.pdf",
    Parent_Part_Number: "ARM-2000",
    Parent_Revision: "A",
    Qty_Per_Parent: 1,
    Substitutes: "",
  },

  // ── Level 2 under PLATE-1000
  {
    Part_Number: "RES-002",
    Revision: "A",
    Description: "M4 × 12mm socket screw",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.14,
    Lead_Time_Days: 3,
    Supplier: "Digi-Key",
    MPN: "91290A116",
    CAD_Path: "",
    Drawing_Path: "",
    Parent_Part_Number: "PLATE-1000",
    Parent_Revision: "A",
    Qty_Per_Parent: 4,
    Substitutes: "RES-002B",
  },
  {
    Part_Number: "PCB-5000",
    Revision: "C",
    Description: "Flight controller v3",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 42.0,
    Lead_Time_Days: 14,
    Supplier: "Holybro",
    MPN: "PIXHAWK-6C",
    CAD_Path: "/cad/pcb-5000.glb",
    Drawing_Path: "/drawings/pcb-5000.pdf",
    Parent_Part_Number: "PLATE-1000",
    Parent_Revision: "A",
    Qty_Per_Parent: 1,
    Substitutes: "",
  },

  // ── Level 3 under MOTOR-3000
  {
    Part_Number: "RES-005",
    Revision: "A",
    Description: "Prop adapter M5",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 1.2,
    Lead_Time_Days: 5,
    Supplier: "T-Motor",
    MPN: "TM-PA-M5",
    CAD_Path: "",
    Drawing_Path: "",
    Parent_Part_Number: "MOTOR-3000",
    Parent_Revision: "A",
    Qty_Per_Parent: 1,
    Substitutes: "",
  },

  // ── Level 3 under PCB-5000
  {
    Part_Number: "RES-003",
    Revision: "A",
    Description: "M2.5 nylon standoff",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.05,
    Lead_Time_Days: 2,
    Supplier: "McMaster",
    MPN: "92435A105",
    CAD_Path: "",
    Drawing_Path: "",
    Parent_Part_Number: "PCB-5000",
    Parent_Revision: "C",
    Qty_Per_Parent: 4,
    Substitutes: "",
  },

  // ── Substitute part (also used directly as a root)
  {
    Part_Number: "RES-002B",
    Revision: "A",
    Description: "M4 × 12mm socket screw, stainless",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.22,
    Lead_Time_Days: 5,
    Supplier: "McMaster",
    MPN: "91290A117",
    CAD_Path: "",
    Drawing_Path: "",
    Parent_Part_Number: "",
    Parent_Revision: "",
    Qty_Per_Parent: "",
    Substitutes: "",
  },

  // ── Standalone spare (no parent, no children)
  {
    Part_Number: "PROP-4000",
    Revision: "A",
    Description: "5-inch tri-blade propeller",
    Status: "OBSOLETE",
    UOM: "EA",
    Unit_Cost: 1.9,
    Lead_Time_Days: 8,
    Supplier: "HQProp",
    MPN: "HQ-5x4.3x3",
    CAD_Path: "",
    Drawing_Path: "",
    Parent_Part_Number: "",
    Parent_Revision: "",
    Qty_Per_Parent: "",
    Substitutes: "",
  },
];

// ─── Build the workbook ─────────────────────────────────────────────────────

const aoa = [HEADERS];
for (const row of rows) {
  aoa.push(HEADERS.map((h) => row[h] ?? ""));
}

const ws = XLSX.utils.aoa_to_sheet(aoa);

// Column widths for nicer viewing in Excel
ws["!cols"] = HEADERS.map(() => ({ wch: 18 }));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Master");

const outPath = "test-data/drone-bom.xlsx";
mkdirSync(dirname(outPath), { recursive: true });
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
writeFileSync(outPath, buf);

console.log(`Wrote ${rows.length} rows to ${outPath}`);
console.log(`Header row: ${HEADERS.join(", ")}`);