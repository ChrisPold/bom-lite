import { describe, it, expect } from "vitest";
import type {
  Status,
  PartNode,
  ConsumesEdge,
  SubstituteEdge,
  BomGraph,
} from "../graph/types";
import type { RawRow } from "../parser/schema";

describe("domain types (compile-time smoke)", () => {
  it("Status union accepts valid values", () => {
    const a: Status = "WIP";
    const b: Status = "RELEASED";
    const c: Status = "OBSOLETE";
    expect([a, b, c]).toHaveLength(3);
  });

  it("RawRow satisfies the Excel contract", () => {
    const row = {
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
    } satisfies RawRow;
    expect(row.__rowIndex).toBe(0);
  });

  it("PartNode satisfies the interface", () => {
    const node = {
      id: "ASM-1000::A",
      partNumber: "ASM-1000",
      revision: "A",
      description: "Main Chassis",
      status: "RELEASED",
      uom: "EA",
      unitCost: 120.5,
      leadTimeDays: 14,
      supplier: "Internal CNC",
      mpn: "CHS-001",
      cadPath: "/cad/asm-1000.glb",
      drawingPath: "/drawings/asm-1000.pdf",
    } satisfies PartNode;
    expect(node.id).toBe("ASM-1000::A");
  });

  it("ConsumesEdge satisfies the interface", () => {
    const edge = {
      id: "ASM-1000::A->ASM-1000::A::row0",
      parentId: "ASM-1000::A",
      childId: "ASM-1000::A",
      qtyPerParent: 1,
      rowIndex: 0,
    } satisfies ConsumesEdge;
    expect(edge.qtyPerParent).toBe(1);
  });

  it("SubstituteEdge satisfies the interface", () => {
    const sub = {
      id: "RES-001::A~sub~RES-002::A::global",
      primaryId: "RES-001::A",
      substituteId: "RES-002::A",
      scopeParentId: undefined,
      bidirectional: true,
    } satisfies SubstituteEdge;
    expect(sub.bidirectional).toBe(true);
  });

  it("BomGraph satisfies the interface (all nine fields)", () => {
    const graph = {
      nodes: new Map<string, PartNode>(),
      edges: new Map<string, ConsumesEdge>(),
      substitutes: new Map<string, SubstituteEdge>(),
      edgesByParent: new Map<string, readonly string[]>(),
      edgesByChild: new Map<string, readonly string[]>(),
      substitutesByPart: new Map<string, readonly string[]>(),
      roots: [] as readonly string[],
      orphans: [] as readonly string[],
      cycles: [] as readonly (readonly string[])[],
    } satisfies BomGraph;
    expect(graph.nodes.size).toBe(0);
  });
});