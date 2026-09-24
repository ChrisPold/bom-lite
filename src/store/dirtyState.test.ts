import { describe, it, expect } from "vitest";
import {
  clearDirty,
  emptyDirtyState,
  isDirty,
  markEdgeDirty,
  markNodeDirty,
  markSubstituteDirty,
  withBaselineSha,
} from "./dirtyState";

describe("emptyDirtyState", () => {
  it("starts with empty sets and no sha", () => {
    const s = emptyDirtyState();
    expect(s.nodes.size).toBe(0);
    expect(s.edges.size).toBe(0);
    expect(s.substitutes.size).toBe(0);
    expect(s.baselineSha).toBeNull();
  });

  it("accepts an initial sha", () => {
    const s = emptyDirtyState("abc123");
    expect(s.baselineSha).toBe("abc123");
  });
});

describe("markNodeDirty", () => {
  it("adds a node id", () => {
    const s = markNodeDirty(emptyDirtyState(), "ASM-1000::A");
    expect(s.nodes.has("ASM-1000::A")).toBe(true);
  });

  it("is idempotent — repeated marks don't duplicate", () => {
    const once = markNodeDirty(emptyDirtyState(), "P::A");
    const twice = markNodeDirty(once, "P::A");
    expect(twice.nodes.size).toBe(1);
  });

  it("returns the same object reference when already dirty", () => {
    const s1 = markNodeDirty(emptyDirtyState(), "P::A");
    const s2 = markNodeDirty(s1, "P::A");
    expect(s2).toBe(s1);
  });

  it("does not mutate the input state", () => {
    const s1 = emptyDirtyState();
    const s2 = markNodeDirty(s1, "P::A");
    expect(s1.nodes.size).toBe(0);
    expect(s2.nodes.size).toBe(1);
  });
});

describe("markEdgeDirty and markSubstituteDirty", () => {
  it("markEdgeDirty adds to edges only", () => {
    const s = markEdgeDirty(emptyDirtyState(), "A->B::row0");
    expect(s.edges.has("A->B::row0")).toBe(true);
    expect(s.nodes.size).toBe(0);
    expect(s.substitutes.size).toBe(0);
  });

  it("markSubstituteDirty adds to substitutes only", () => {
    const s = markSubstituteDirty(emptyDirtyState(), "P~sub~S::global");
    expect(s.substitutes.has("P~sub~S::global")).toBe(true);
    expect(s.nodes.size).toBe(0);
    expect(s.edges.size).toBe(0);
  });
});

describe("clearDirty", () => {
  it("empties all three sets", () => {
    let s = emptyDirtyState("sha1");
    s = markNodeDirty(s, "P::A");
    s = markEdgeDirty(s, "A->B::row0");
    s = markSubstituteDirty(s, "P~sub~S::global");
    const cleared = clearDirty(s);
    expect(cleared.nodes.size).toBe(0);
    expect(cleared.edges.size).toBe(0);
    expect(cleared.substitutes.size).toBe(0);
  });

  it("preserves baselineSha", () => {
    let s = emptyDirtyState("sha1");
    s = markNodeDirty(s, "P::A");
    const cleared = clearDirty(s);
    expect(cleared.baselineSha).toBe("sha1");
  });
});

describe("isDirty", () => {
  it("is false for an empty state", () => {
    expect(isDirty(emptyDirtyState())).toBe(false);
  });

  it("is true when any set has entries", () => {
    expect(isDirty(markNodeDirty(emptyDirtyState(), "P::A"))).toBe(true);
    expect(isDirty(markEdgeDirty(emptyDirtyState(), "e1"))).toBe(true);
    expect(isDirty(markSubstituteDirty(emptyDirtyState(), "s1"))).toBe(true);
  });

  it("is false after clearDirty", () => {
    const s = clearDirty(markNodeDirty(emptyDirtyState(), "P::A"));
    expect(isDirty(s)).toBe(false);
  });
});

describe("withBaselineSha", () => {
  it("updates the sha without touching the sets", () => {
    let s = emptyDirtyState();
    s = markNodeDirty(s, "P::A");
    const updated = withBaselineSha(s, "newsha");
    expect(updated.baselineSha).toBe("newsha");
    expect(updated.nodes.has("P::A")).toBe(true);
  });
});