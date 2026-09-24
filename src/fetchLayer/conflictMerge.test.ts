import { describe, it, expect } from "vitest";
import type { BomGraph, ConsumesEdge, PartNode } from "../graph/types";
import {
  emptyDirtyState,
  markEdgeDirty,
  markNodeDirty,
} from "../store/dirtyState";
import { conflictMerge } from "./conflictMerge";

function node(id: string, overrides: Partial<PartNode> = {}): PartNode {
  const [partNumber, revision] = id.split("::");
  return {
    id,
    partNumber: partNumber!,
    revision: revision!,
    description: "d",
    status: "RELEASED",
    uom: "EA",
    unitCost: 1,
    leadTimeDays: 1,
    ...overrides,
  };
}

function edge(
  parentId: string,
  childId: string,
  rowIndex: number,
  qtyPerParent = 1,
): ConsumesEdge {
  return {
    id: `${parentId}->${childId}::row${rowIndex}`,
    parentId,
    childId,
    qtyPerParent,
    rowIndex,
  };
}

function graph(nodes: PartNode[], edges: ConsumesEdge[] = []): BomGraph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edgeMap = new Map(edges.map((e) => [e.id, e]));

  const edgesByParent = new Map<string, string[]>();
  const edgesByChild = new Map<string, string[]>();
  for (const e of edges) {
    push(edgesByParent, e.parentId, e.id);
    push(edgesByChild, e.childId, e.id);
  }

  const childIds = new Set(edges.map((e) => e.childId));
  const roots = nodes.map((n) => n.id).filter((id) => !childIds.has(id));

  return {
    nodes: nodeMap,
    edges: edgeMap,
    substitutes: new Map(),
    edgesByParent,
    edgesByChild,
    substitutesByPart: new Map(),
    roots,
    orphans: [],
    cycles: [],
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

describe("conflictMerge — no changes", () => {
  it("returns an empty merge when nothing is dirty and nothing changed", () => {
    const g = graph([node("A::A")]);
    const result = conflictMerge({
      base: g,
      mine: g,
      theirs: g,
      dirty: emptyDirtyState(),
    });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMergedCount).toBe(0);
    expect(result.merged.nodes.size).toBe(1);
  });

  it("adopts theirs on a non-dirty node even when it changed remotely", () => {
    const base = graph([node("A::A", { description: "old" })]);
    const theirs = graph([node("A::A", { description: "new" })]);
    const result = conflictMerge({
      base,
      mine: base,
      theirs,
      dirty: emptyDirtyState(),
    });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.nodes.get("A::A")?.description).toBe("new");
  });
});

describe("conflictMerge — modify on both sides", () => {
  it("auto-merges when local edit matches remote edit", () => {
    const base = graph([node("A::A", { description: "old" })]);
    const mine = graph([node("A::A", { description: "new" })]);
    const theirs = graph([node("A::A", { description: "new" })]);
    const dirty = markNodeDirty(emptyDirtyState(), "A::A");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMergedCount).toBe(1);
    expect(result.merged.nodes.get("A::A")?.description).toBe("new");
  });

  it("keeps mine when remote did not change", () => {
    const base = graph([node("A::A", { description: "old" })]);
    const mine = graph([node("A::A", { description: "new" })]);
    const dirty = markNodeDirty(emptyDirtyState(), "A::A");

    const result = conflictMerge({ base, mine, theirs: base, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.autoMergedCount).toBe(1);
    expect(result.merged.nodes.get("A::A")?.description).toBe("new");
  });

  it("flags a conflict when both sides changed differently", () => {
    const base = graph([node("A::A", { description: "old" })]);
    const mine = graph([node("A::A", { description: "mine" })]);
    const theirs = graph([node("A::A", { description: "theirs" })]);
    const dirty = markNodeDirty(emptyDirtyState(), "A::A");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toHaveLength(1);
    const c = result.conflicts[0]!;
    expect(c.entityKind).toBe("node");
    expect(c.id).toBe("A::A");
    expect(c.field).toBe("description");
    expect(c.base).toBe("old");
    expect(c.mine).toBe("mine");
    expect(c.theirs).toBe("theirs");
    expect(result.merged.nodes.get("A::A")?.description).toBe("mine");
  });

  it("flags multiple field conflicts on the same entity", () => {
    const base = graph([node("A::A", { description: "d", unitCost: 1 })]);
    const mine = graph([node("A::A", { description: "m", unitCost: 2 })]);
    const theirs = graph([node("A::A", { description: "t", unitCost: 3 })]);
    const dirty = markNodeDirty(emptyDirtyState(), "A::A");

    const result = conflictMerge({ base, mine, theirs, dirty });
    const fields = result.conflicts.map((c) => c.field).sort();
    expect(fields).toEqual(["description", "unitCost"]);
  });

  it("does not flag a conflict when only untouched fields differ remotely", () => {
    const base = graph([node("A::A", { description: "d", unitCost: 1 })]);
    const mine = graph([node("A::A", { description: "m", unitCost: 1 })]);
    const theirs = graph([node("A::A", { description: "d", unitCost: 99 })]);
    const dirty = markNodeDirty(emptyDirtyState(), "A::A");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toEqual([]);
  });
});

describe("conflictMerge — local add", () => {
  it("keeps a locally added node when theirs is unchanged", () => {
    const base = graph([node("A::A")]);
    const mine = graph([node("A::A"), node("B::B")]);
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs: base, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.nodes.has("B::B")).toBe(true);
  });

  it("converges when theirs also added the same node identically", () => {
    const base = graph([node("A::A")]);
    const mine = graph([node("A::A"), node("B::B")]);
    const theirs = graph([node("A::A"), node("B::B")]);
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.nodes.has("B::B")).toBe(true);
  });

  it("flags a conflict when theirs added the same id with different fields", () => {
    const base = graph([node("A::A")]);
    const mine = graph([node("A::A"), node("B::B", { description: "mine" })]);
    const theirs = graph([
      node("A::A"),
      node("B::B", { description: "theirs" }),
    ]);
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe("*");
  });
});

describe("conflictMerge — local delete", () => {
  it("accepts a local delete when theirs is unchanged", () => {
    const base = graph([node("A::A"), node("B::B")]);
    const mine = graph([node("A::A")]);
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs: base, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.nodes.has("B::B")).toBe(false);
  });

  it("accepts a local delete when theirs also deleted", () => {
    const base = graph([node("A::A"), node("B::B")]);
    const mine = graph([node("A::A")]);
    const theirs = graph([node("A::A")]);
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.nodes.has("B::B")).toBe(false);
  });

  it("flags a delete-vs-edit conflict", () => {
    const base = graph([node("A::A"), node("B::B", { description: "old" })]);
    const mine = graph([node("A::A")]);
    const theirs = graph([
      node("A::A"),
      node("B::B", { description: "new" }),
    ]);
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe("*");
    expect(result.merged.nodes.has("B::B")).toBe(false);
  });
});

  it("flags a modify-vs-remote-delete conflict", () => {
    const base = graph([node("A::A"), node("B::B", { description: "old" })]);
    const mine = graph([
      node("A::A"),
      node("B::B", { description: "mine" }),
    ]);
    const theirs = graph([node("A::A")]); // remote deleted B::B
    const dirty = markNodeDirty(emptyDirtyState(), "B::B");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe("*");
    expect(result.conflicts[0]?.theirs).toBeUndefined();
    // Mine is kept as working value.
    expect(result.merged.nodes.get("B::B")?.description).toBe("mine");
  });

describe("conflictMerge — edges", () => {
  it("merges an edge qty change without conflict when remote did not change", () => {
    const base = graph(
      [node("A::A"), node("B::B")],
      [edge("A::A", "B::B", 0, 1)],
    );
    const mine = graph(
      [node("A::A"), node("B::B")],
      [edge("A::A", "B::B", 0, 5)],
    );
    const dirty = markEdgeDirty(emptyDirtyState(), "A::A->B::B::row0");

    const result = conflictMerge({ base, mine, theirs: base, dirty });
    expect(result.conflicts).toEqual([]);
    expect(result.merged.edges.get("A::A->B::B::row0")?.qtyPerParent).toBe(5);
  });

  it("flags a qty conflict when both changed differently", () => {
    const base = graph(
      [node("A::A"), node("B::B")],
      [edge("A::A", "B::B", 0, 1)],
    );
    const mine = graph(
      [node("A::A"), node("B::B")],
      [edge("A::A", "B::B", 0, 5)],
    );
    const theirs = graph(
      [node("A::A"), node("B::B")],
      [edge("A::A", "B::B", 0, 9)],
    );
    const dirty = markEdgeDirty(emptyDirtyState(), "A::A->B::B::row0");

    const result = conflictMerge({ base, mine, theirs, dirty });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.entityKind).toBe("edge");
    expect(result.conflicts[0]?.field).toBe("qtyPerParent");
  });
});

describe("conflictMerge — index rebuild", () => {
  it("rebuilds indexes from merged nodes and edges", () => {
    const base = graph(
      [node("A::A"), node("B::B")],
      [edge("A::A", "B::B", 0)],
    );
    const mine = graph([node("A::A"), node("B::B")]);
    const dirty = markNodeDirty(emptyDirtyState(), "A::A");

    const result = conflictMerge({ base, mine, theirs: base, dirty });
    expect(result.merged.edges.size).toBe(1);
    expect(result.merged.edgesByParent.get("A::A")).toEqual([
      "A::A->B::B::row0",
    ]);
    expect(result.merged.edgesByChild.get("B::B")).toEqual([
      "A::A->B::B::row0",
    ]);
    expect(result.merged.roots).toEqual(["A::A"]);
  });
});