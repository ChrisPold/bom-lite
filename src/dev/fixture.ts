// src/dev/fixture.ts
//
// Hardcoded RawRow[] used by the smoke harness. Represents what a real
// master.xlsx sheet would produce after parseXlsx runs.
//
// Layout (as it would appear in Excel):
//   ASM-1000::A (top-level chassis)
//     ├── SUB-1000::A  x 2  "Aluminum plate"
//     │     └── RES-001::A  x 4  "M4 screw"
//     │     └── RES-002::A  x 4  "M4 screw, substitute"
//     └── SUB-2000::A  x 1  "Chassis bracket"
//           └── RES-001::A  x 6  "M4 screw"  ← same part, different parent

import type { RawRow } from "../parser/schema";

export const SMOKE_FIXTURE: RawRow[] = [
  // Root
  {
    __rowIndex: 0,
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
    Parent_Part_Number: undefined,
    Parent_Revision: undefined,
    Qty_Per_Parent: 1,
    Substitutes: undefined,
  },
  // SUB-1000 under ASM-1000
  {
    __rowIndex: 1,
    Part_Number: "SUB-1000",
    Revision: "A",
    Description: "Aluminum plate 3mm",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 12.0,
    Lead_Time_Days: 7,
    Supplier: "Fabrik A/S",
    MPN: "ALU-3MM",
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: "ASM-1000",
    Parent_Revision: "A",
    Qty_Per_Parent: 2,
    Substitutes: undefined,
  },
  // SUB-2000 under ASM-1000
  {
    __rowIndex: 2,
    Part_Number: "SUB-2000",
    Revision: "A",
    Description: "Chassis bracket",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 45.75,
    Lead_Time_Days: 21,
    Supplier: "Acme Metal",
    MPN: "BRK-2000",
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: "ASM-1000",
    Parent_Revision: "A",
    Qty_Per_Parent: 1,
    Substitutes: undefined,
  },
  // RES-001 under SUB-1000 — appears again under SUB-2000 later
  {
    __rowIndex: 3,
    Part_Number: "RES-001",
    Revision: "A",
    Description: "M4 socket screw",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.12,
    Lead_Time_Days: 3,
    Supplier: "Digi-Key",
    MPN: "91290A115",
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: "SUB-1000",
    Parent_Revision: "A",
    Qty_Per_Parent: 4,
    Substitutes: "RES-002::A",
  },
  // RES-002 — substitute part, used as a node
  {
    __rowIndex: 4,
    Part_Number: "RES-002",
    Revision: "A",
    Description: "M4 socket screw, SS",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.18,
    Lead_Time_Days: 5,
    Supplier: "Digi-Key",
    MPN: "91290A116",
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: undefined,
    Parent_Revision: undefined,
    Qty_Per_Parent: undefined,
    Substitutes: undefined,
  },
  // RES-001 again, this time under SUB-2000 — same node, different edge
  {
    __rowIndex: 5,
    Part_Number: "RES-001",
    Revision: "A",
    Description: "M4 socket screw",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 0.12,
    Lead_Time_Days: 3,
    Supplier: "Digi-Key",
    MPN: "91290A115",
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: "SUB-2000",
    Parent_Revision: "A",
    Qty_Per_Parent: 6,
    Substitutes: undefined,
  },
];