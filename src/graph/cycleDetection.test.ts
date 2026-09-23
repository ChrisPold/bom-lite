import { describe, it, expect } from "vitest";
import type { ConsumesEdge, PartNode } from "./types";
import {
  analyzeGraph,
  detectCycles,
  detectOrphans,
  detectSelfReferences,
} from "./cycleDetection";

function edge(id: string, parentId: string, childId: string, rowIndex: number): ConsumesEdge {
  return { id, parentId, childId, qtyPerParent: 1, rowIndex };
}

function node(id: string): PartNode {
  const [partNumber, revision] = id.split("::");
  return {
    id,
    partNumber: partNumber!,
    revision: revision!,
    description: "",
    status: "RELEASED",
    uom: "EA",
    unitCost: 0,
    leadTimeDays: 0,
  };
}

function nodes(...ids: string[]): Map<string, PartNode> {
  return new Map(ids.map((i) => [i, node(i)]));
}

describe("detectSelfReferences", () => {
  it("returns an empty array when there are none", () => {
    const edges = [edge("A->B::row0", "A", "B", 0)];
    expect(detectSelfReferences(edges)).toEqual([]);
  });

  it("detects a single self-reference", () => {
    const edges = [edge("A->A::row0", "A", "A", 0)];
    expect(detectSelfReferences(edges)).toEqual(["A"]);
  });

  it("deduplicates multiple self-references on the same node", () => {
    const edges = [
      edge("A->A::row0", "A", "A", 0),
      edge("A->A::row1", "A", "A", 1),
    ];
    expect(detectSelfReferences(edges)).toEqual(["A"]);
  });
});

describe("detectOrphans", () => {
  it("returns an empty array when every parent exists", () => {
    const edges = [edge("A->B::row0", "A", "B", 0)];
    expect(detectOrphans(edges, nodes("A", "B"))).toEqual([]);
  });

  it("flags edges whose parentId is not in the node map", () => {
    const edges = [edge("X->Y::row0", "X", "Y", 0)];
    expect(detectOrphans(edges, nodes("Y"))).toEqual(["X->Y::row0"]);
  });

  it("flags only the orphan edges when some parents exist", () => {
    const edges = [
      edge("A->B::row0", "A", "B", 0),
      edge("X->Y::row1", "X", "Y", 1),
    ];
    expect(detectOrphans(edges, nodes("A", "B", "Y"))).toEqual(["X->Y::row1"]);
  });
});

describe("detectCycles", () => {
  it("returns no cycles for a simple chain", () => {
    const edges = [
      edge("A->B::row0", "A", "B", 0),
      edge("B->C::row1", "B", "C", 1),
    ];
    expect(detectCycles(edges)).toEqual([]);
  });

  it("returns no cycles for a diamond", () => {
    const edges = [
      edge("A->B::row0", "A", "B", 0),
      edge("A->C::row1", "A", "C", 1),
      edge("B->D::row2", "B", "D", 2),
      edge("C->D::row3", "C", "D", 3),
    ];
    expect(detectCycles(edges)).toEqual([]);
  });

  it("detects a two-node cycle", () => {
    const edges = [
      edge("A->B::row0", "A", "B", 0),
      edge("B->A::row1", "B", "A", 1),
    ];
    const cycles = detectCycles(edges);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(["A", "B"]));
  });

  it("detects a three-node cycle", () => {
    const edges = [
      edge("A->B::row0", "A", "B", 0),
      edge("B->C::row1", "B", "C", 1),
      edge("C->A::row2", "C", "A", 2),
    ];
    const cycles = detectCycles(edges);
    expect(cycles).toHaveLength(1);
    expect(new Set(cycles[0])).toEqual(new Set(["A", "B", "C"]));
  });

  it("ignores self-references — those are reported separately", () => {
    const edges = [edge("A->A::row0", "A", "A", 0)];
    expect(detectCycles(edges)).toEqual([]);
  });
});

describe("analyzeGraph", () => {
  it("reports cycles, orphans, and self-references together", () => {
    const edges = [
      edge("A->B::row0", "A", "B", 0),
      edge("B->A::row1", "B", "A", 1),
      edge("C->C::row2", "C", "C", 2),
      edge("X->Y::row3", "X", "Y", 3),
    ];
    const result = analyzeGraph(edges, nodes("A", "B", "C", "Y"));
    expect(result.cycles).toHaveLength(1);
    expect(new Set(result.cycles[0])).toEqual(new Set(["A", "B"]));
    expect(result.selfReferences).toEqual(["C"]);
    expect(result.orphans).toEqual(["X->Y::row3"]);
  });
});