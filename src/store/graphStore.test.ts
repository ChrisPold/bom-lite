import { describe, it, expect, beforeEach } from "vitest";
import type { BomGraph, ConsumesEdge, PartNode } from "../graph/types";
import { useGraphStore, __resetStoreForTests } from "./graphStore";
import { isDirty, markNodeDirty } from "./dirtyState";

function tinyGraph(): BomGraph {
  const nodes = new Map<string, PartNode>();
  nodes.set("P::A", {
    id: "P::A",
    partNumber: "P",
    revision: "A",
    description: "Part",
    status: "RELEASED",
    uom: "EA",
    unitCost: 10,
    leadTimeDays: 1,
  });
  const edges = new Map<string, ConsumesEdge>();
  const edgesByParent = new Map<string, string[]>();
  const edgesByChild = new Map<string, string[]>();
  return {
    nodes,
    edges,
    substitutes: new Map(),
    edgesByParent,
    edgesByChild,
    substitutesByPart: new Map(),
    roots: ["P::A"],
    orphans: [],
    cycles: [],
  };
}

function makeNode(id: string): PartNode {
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

function makeEdge(
  parentId: string,
  childId: string,
  rowIndex: number,
): ConsumesEdge {
  return {
    id: `${parentId}->${childId}::row${rowIndex}`,
    parentId,
    childId,
    qtyPerParent: 1,
    rowIndex,
  };
}

function chainGraph(): BomGraph {
  // A::A -> B::A -> C::A
  const nodes = new Map<string, PartNode>([
    ["A::A", makeNode("A::A")],
    ["B::A", makeNode("B::A")],
    ["C::A", makeNode("C::A")],
  ]);

  const e1 = makeEdge("A::A", "B::A", 0);
  const e2 = makeEdge("B::A", "C::A", 1);

  return {
    nodes,
    edges: new Map([
      [e1.id, e1],
      [e2.id, e2],
    ]),
    substitutes: new Map(),
    edgesByParent: new Map([
      ["A::A", [e1.id]],
      ["B::A", [e2.id]],
    ]),
    edgesByChild: new Map([
      ["B::A", [e1.id]],
      ["C::A", [e2.id]],
    ]),
    substitutesByPart: new Map(),
    roots: ["A::A"],
    orphans: [],
    cycles: [],
  };
}

beforeEach(() => {
  __resetStoreForTests();
});

describe("graphStore — initial state", () => {
  it("starts with empty graph and baseline equal to graph", () => {
    const s = useGraphStore.getState();
    expect(s.graph.nodes.size).toBe(0);
    expect(s.baselineGraph).toBe(s.graph);
    expect(s.selection.selectedNodeId).toBeNull();
    expect(s.ui.activeView).toBe("grid");
    expect(isDirty(s.dirty)).toBe(false);
  });
});

describe("__loadFresh", () => {
  it("sets graph and baselineGraph to the same object", () => {
    const g = tinyGraph();
    useGraphStore.getState().__loadFresh(g, "sha1");
    const s = useGraphStore.getState();
    expect(s.graph).toBe(g);
    expect(s.baselineGraph).toBe(g);
    expect(s.dirty.baselineSha).toBe("sha1");
    expect(isDirty(s.dirty)).toBe(false);
  });

  it("resets selection and ui", () => {
    const g = tinyGraph();
    useGraphStore.getState().__loadFresh(g, null);
    const s = useGraphStore.getState();
    expect(s.selection.selectedNodeId).toBeNull();
    expect(s.ui.activeView).toBe("grid");
  });
});

describe("__setGraph", () => {
  it("replaces graph without touching baselineGraph", () => {
    const baseline = tinyGraph();
    useGraphStore.getState().__loadFresh(baseline, "sha1");

    const newGraph = tinyGraph();
    useGraphStore.getState().__setGraph(newGraph);

    const s = useGraphStore.getState();
    expect(s.graph).toBe(newGraph);
    expect(s.baselineGraph).toBe(baseline);
  });
});

describe("__discard", () => {
  it("restores graph from baselineGraph and clears dirty", () => {
    const baseline = tinyGraph();
    useGraphStore.getState().__loadFresh(baseline, "sha1");

    const dirtyGraph = tinyGraph();
    useGraphStore.getState().__setGraph(dirtyGraph);
    useGraphStore.getState().__setDirty(
      markNodeDirty(useGraphStore.getState().dirty, "P::A"),
    );
    expect(isDirty(useGraphStore.getState().dirty)).toBe(true);

    useGraphStore.getState().__discard();

    const s = useGraphStore.getState();
    expect(s.graph).toBe(baseline);
    expect(isDirty(s.dirty)).toBe(false);
    expect(s.dirty.baselineSha).toBe("sha1");
    expect(s.selection.selectedNodeId).toBeNull();
  });
});

describe("__selectNode", () => {
  it("sets selection without touching the graph", () => {
    const g = tinyGraph();
    useGraphStore.getState().__loadFresh(g, null);
    useGraphStore.getState().__selectNode("P::A");

    const s = useGraphStore.getState();
    expect(s.selection.selectedNodeId).toBe("P::A");
    expect(s.graph).toBe(g);
    expect(isDirty(s.dirty)).toBe(false);
  });

  it("clears selection when null is passed", () => {
    useGraphStore.getState().__selectNode("P::A");
    useGraphStore.getState().__selectNode(null);
    expect(useGraphStore.getState().selection.selectedNodeId).toBeNull();
  });
});

describe("__setActiveView", () => {
  it("switches views", () => {
    useGraphStore.getState().__setActiveView("graph");
    expect(useGraphStore.getState().ui.activeView).toBe("graph");
    useGraphStore.getState().__setActiveView("3d");
    expect(useGraphStore.getState().ui.activeView).toBe("3d");
  });
});

describe("__toggleGridRow / __toggleGraphNode", () => {
  it("toggles a grid row expanded state on and off", () => {
    useGraphStore.getState().__toggleGridRow("e1");
    expect(useGraphStore.getState().ui.gridExpandedRows.has("e1")).toBe(true);
    useGraphStore.getState().__toggleGridRow("e1");
    expect(useGraphStore.getState().ui.gridExpandedRows.has("e1")).toBe(false);
  });

  it("toggles a graph node expanded state on and off", () => {
    useGraphStore.getState().__toggleGraphNode("P::A");
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("P::A")).toBe(
      true,
    );
    useGraphStore.getState().__toggleGraphNode("P::A");
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("P::A")).toBe(
      false,
    );
  });

  it("toggling one grid row does not affect others", () => {
    useGraphStore.getState().__toggleGridRow("e1");
    useGraphStore.getState().__toggleGridRow("e2");
    const s = useGraphStore.getState();
    expect(s.ui.gridExpandedRows.has("e1")).toBe(true);
    expect(s.ui.gridExpandedRows.has("e2")).toBe(true);
  });

  it("collapsing a node clears its descendants from the graph expanded set", () => {
    useGraphStore.setState({ graph: chainGraph() });

    useGraphStore.getState().__toggleGraphNode("A::A");
    useGraphStore.getState().__toggleGraphNode("B::A");
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("A::A")).toBe(
      true,
    );
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("B::A")).toBe(
      true,
    );

    // Collapse A: B and C should also be removed.
    useGraphStore.getState().__toggleGraphNode("A::A");
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("A::A")).toBe(
      false,
    );
    expect(useGraphStore.getState().ui.graphExpandedNodes.has("B::A")).toBe(
      false,
    );
  });

  it("collapsing a node clears its descendants from the grid expanded set", () => {
    useGraphStore.setState({ graph: chainGraph() });

    useGraphStore.getState().__toggleGridRow("A::A");
    useGraphStore.getState().__toggleGridRow("B::A");
    expect(useGraphStore.getState().ui.gridExpandedRows.has("A::A")).toBe(true);
    expect(useGraphStore.getState().ui.gridExpandedRows.has("B::A")).toBe(true);

    useGraphStore.getState().__toggleGridRow("A::A");
    expect(useGraphStore.getState().ui.gridExpandedRows.has("A::A")).toBe(
      false,
    );
    expect(useGraphStore.getState().ui.gridExpandedRows.has("B::A")).toBe(
      false,
    );
  });
});