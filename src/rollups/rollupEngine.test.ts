import { describe, it, expect, vi } from "vitest";
import type { BomGraph, ConsumesEdge, PartNode, Status } from "../graph/types";
import {
  criticalPathLeadTime,
  totalAssemblyCost,
} from "./rollupEngine";
import { invalidateAncestors, memoCostKey } from "./memo";

// ─── Fixture helpers ────────────────────────────────────────────────────────

interface NodeSpec {
  id: string;
  unitCost?: number;
  leadTimeDays?: number;
  status?: Status;
}

interface EdgeSpec {
  parent: string;
  child: string;
  qty: number;
  rowIndex?: number;
}

function makeNode(spec: NodeSpec): PartNode {
  const [partNumber, revision] = spec.id.split("::");
  return {
    id: spec.id,
    partNumber: partNumber!,
    revision: revision!,
    description: "",
    status: spec.status ?? "RELEASED",
    uom: "EA",
    unitCost: spec.unitCost ?? 0,
    leadTimeDays: spec.leadTimeDays ?? 0,
  };
}

function makeGraph(nodeSpecs: NodeSpec[], edgeSpecs: EdgeSpec[]): BomGraph {
  const nodes = new Map<string, PartNode>();
  for (const s of nodeSpecs) nodes.set(s.id, makeNode(s));

  const edges: ConsumesEdge[] = [];
  const edgesByParent = new Map<string, string[]>();
  const edgesByChild = new Map<string, string[]>();

  edgeSpecs.forEach((e, i) => {
    const rowIndex = e.rowIndex ?? i;
    const id = `${e.parent}->${e.child}::row${rowIndex}`;
    edges.push({ id, parentId: e.parent, childId: e.child, qtyPerParent: e.qty, rowIndex });
    push(edgesByParent, e.parent, id);
    push(edgesByChild, e.child, id);
  });

  const childIds = new Set(edgeSpecs.map((e) => e.child));
  const roots = [...nodes.keys()].filter((id) => !childIds.has(id));

  return {
    nodes,
    edges: new Map(edges.map((e) => [e.id, e])),
    substitutes: new Map(),
    edgesByParent,
    edgesByChild,
    substitutesByPart: new Map(),
    roots,
    orphans: [],
    cycles: [],
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("totalAssemblyCost", () => {
  it("returns unitCost for a leaf node", () => {
    const g = makeGraph([{ id: "P::A", unitCost: 7.5 }], []);
    expect(totalAssemblyCost(g, "P::A")).toBe(7.5);
  });

  it("sums child costs weighted by qty for a two-level assembly", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 100 },
        { id: "B::A", unitCost: 5 },
        { id: "C::A", unitCost: 2 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 2 },
        { parent: "A::A", child: "C::A", qty: 3 },
      ],
    );
    // 100 + 2*5 + 3*2 = 116
    expect(totalAssemblyCost(g, "A::A")).toBe(116);
  });

  it("rolls up through multiple levels", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 100 },
        { id: "B::A", unitCost: 10 },
        { id: "C::A", unitCost: 1 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 2 },
        { parent: "B::A", child: "C::A", qty: 5 },
      ],
    );
    // B = 10 + 5*1 = 15
    // A = 100 + 2*15 = 130
    expect(totalAssemblyCost(g, "B::A")).toBe(15);
    expect(totalAssemblyCost(g, "A::A")).toBe(130);
  });

  it("handles a diamond without double-counting", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 100 },
        { id: "B::A", unitCost: 10 },
        { id: "C::A", unitCost: 20 },
        { id: "D::A", unitCost: 1 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "A::A", child: "C::A", qty: 1 },
        { parent: "B::A", child: "D::A", qty: 2 },
        { parent: "C::A", child: "D::A", qty: 3 },
      ],
    );
    // B = 10 + 2*1 = 12
    // C = 20 + 3*1 = 23
    // A = 100 + 1*12 + 1*23 = 135
    expect(totalAssemblyCost(g, "A::A")).toBe(135);
  });

  it("returns NaN when the subtree contains a cycle", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1 },
        { id: "B::A", unitCost: 2 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "B::A", child: "A::A", qty: 1 },
      ],
    );
    expect(totalAssemblyCost(g, "A::A")).toBeNaN();
    expect(totalAssemblyCost(g, "B::A")).toBeNaN();
  });

  it("returns NaN for an unknown node", () => {
    const g = makeGraph([{ id: "A::A", unitCost: 1 }], []);
    expect(totalAssemblyCost(g, "MISSING::A")).toBeNaN();
  });

  it("does not cache a NaN result", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1 },
        { id: "B::A", unitCost: 2 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "B::A", child: "A::A", qty: 1 },
      ],
    );
    const memo = new Map<string, number>();
    totalAssemblyCost(g, "A::A", memo);
    expect(memo.has(memoCostKey("A::A"))).toBe(false);
    expect(memo.has(memoCostKey("B::A"))).toBe(false);
  });

  it("uses the memo on a repeat call without re-walking the subtree", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1 },
        { id: "B::A", unitCost: 2 },
      ],
      [{ parent: "A::A", child: "B::A", qty: 2 }],
    );
    const memo = new Map<string, number>();
    totalAssemblyCost(g, "B::A", memo);

    // Spy on the node lookup to prove no walk happens on the second call.
    const spy = vi.spyOn(g.nodes, "get");
    const second = totalAssemblyCost(g, "B::A", memo);
    expect(second).toBe(2);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("criticalPathLeadTime", () => {
  it("returns leadTimeDays for a leaf", () => {
    const g = makeGraph([{ id: "P::A", leadTimeDays: 7 }], []);
    expect(criticalPathLeadTime(g, "P::A")).toBe(7);
  });

  it("takes the max child lead time plus the parent's own", () => {
    const g = makeGraph(
      [
        { id: "A::A", leadTimeDays: 10 },
        { id: "B::A", leadTimeDays: 3 },
        { id: "C::A", leadTimeDays: 20 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "A::A", child: "C::A", qty: 1 },
      ],
    );
    // max(3, 20) + 10 = 30
    expect(criticalPathLeadTime(g, "A::A")).toBe(30);
  });

  it("ignores qty — lead time is not multiplied", () => {
    const g = makeGraph(
      [
        { id: "A::A", leadTimeDays: 1 },
        { id: "B::A", leadTimeDays: 5 },
      ],
      [{ parent: "A::A", child: "B::A", qty: 100 }],
    );
    // 1 + 5, NOT 1 + 100*5
    expect(criticalPathLeadTime(g, "A::A")).toBe(6);
  });

  it("returns NaN for a cyclic subtree", () => {
    const g = makeGraph(
      [
        { id: "A::A", leadTimeDays: 1 },
        { id: "B::A", leadTimeDays: 2 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "B::A", child: "A::A", qty: 1 },
      ],
    );
    expect(criticalPathLeadTime(g, "A::A")).toBeNaN();
  });
});

describe("invalidateAncestors", () => {
  it("clears the node's own memo entry and every ancestor's", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1 },
        { id: "B::A", unitCost: 2 },
        { id: "C::A", unitCost: 3 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "B::A", child: "C::A", qty: 1 },
      ],
    );
    const memo = new Map<string, number>();
    totalAssemblyCost(g, "A::A", memo);
    expect(memo.has(memoCostKey("A::A"))).toBe(true);
    expect(memo.has(memoCostKey("B::A"))).toBe(true);
    expect(memo.has(memoCostKey("C::A"))).toBe(true);

    invalidateAncestors("C::A", g, memo);
    expect(memo.has(memoCostKey("C::A"))).toBe(false);
    expect(memo.has(memoCostKey("B::A"))).toBe(false);
    expect(memo.has(memoCostKey("A::A"))).toBe(false);
  });

  it("clears both cost and lead entries for each ancestor", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1, leadTimeDays: 10 },
        { id: "B::A", unitCost: 2, leadTimeDays: 5 },
      ],
      [{ parent: "A::A", child: "B::A", qty: 1 }],
    );
    const memo = new Map<string, number>();
    totalAssemblyCost(g, "A::A", memo);
    criticalPathLeadTime(g, "A::A", memo);
    expect(memo.has("cost:A::A")).toBe(true);
    expect(memo.has("lead:A::A")).toBe(true);

    invalidateAncestors("B::A", g, memo);
    expect(memo.has("cost:A::A")).toBe(false);
    expect(memo.has("lead:A::A")).toBe(false);
    expect(memo.has("cost:B::A")).toBe(false);
    expect(memo.has("lead:B::A")).toBe(false);
  });

  it("visits each ancestor once in a diamond", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1 },
        { id: "B::A", unitCost: 2 },
        { id: "C::A", unitCost: 3 },
        { id: "D::A", unitCost: 4 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "A::A", child: "C::A", qty: 1 },
        { parent: "B::A", child: "D::A", qty: 1 },
        { parent: "C::A", child: "D::A", qty: 1 },
      ],
    );
    const memo = new Map<string, number>();
    totalAssemblyCost(g, "A::A", memo);

    const deletes = vi.spyOn(memo, "delete");
    invalidateAncestors("D::A", g, memo);

    // A should only be deleted once, despite two paths reaching it.
    const aDeletes = deletes.mock.calls.filter(
      ([k]) => k === "cost:A::A",
    );
    expect(aDeletes.length).toBe(1);
    deletes.mockRestore();
  });

  it("terminates on a cyclic ancestor chain", () => {
    const g = makeGraph(
      [
        { id: "A::A", unitCost: 1 },
        { id: "B::A", unitCost: 2 },
      ],
      [
        { parent: "A::A", child: "B::A", qty: 1 },
        { parent: "B::A", child: "A::A", qty: 1 },
      ],
    );
    const memo = new Map<string, number>();
    expect(() => invalidateAncestors("A::A", g, memo)).not.toThrow();
  });

  it("is a no-op when the memo has no entries for the chain", () => {
    const g = makeGraph(
      [
        { id: "A::A" },
        { id: "B::A" },
      ],
      [{ parent: "A::A", child: "B::A", qty: 1 }],
    );
    const memo = new Map<string, number>();
    expect(() => invalidateAncestors("B::A", g, memo)).not.toThrow();
    expect(memo.size).toBe(0);
  });
});