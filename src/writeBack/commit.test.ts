import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { RawRow } from "../parser/schema";
import type { BomGraph } from "../graph/types";
import { buildGraph } from "../graph/graphBuilder";
import { emptyDirtyState, markNodeDirty } from "../store/dirtyState";

vi.mock("../worker/pipeline", () => ({
  runPipeline: vi.fn(),
}));

import { commit } from "./commit";
import { runPipeline } from "../worker/pipeline";

const mockedRunPipeline = vi.mocked(runPipeline);

// ─── Fixtures ───────────────────────────────────────────────────────────────

function row(overrides: Partial<RawRow> & { __rowIndex: number }): RawRow {
  return {
    Part_Number: undefined,
    Revision: undefined,
    Description: undefined,
    Status: undefined,
    UOM: undefined,
    Unit_Cost: undefined,
    Lead_Time_Days: undefined,
    Supplier: undefined,
    MPN: undefined,
    CAD_Path: undefined,
    Drawing_Path: undefined,
    Parent_Part_Number: undefined,
    Parent_Revision: undefined,
    Qty_Per_Parent: undefined,
    Substitutes: undefined,
    ...overrides,
  };
}

const ROWS: RawRow[] = [
  row({
    __rowIndex: 0,
    Part_Number: "ASM-1",
    Revision: "A",
    Description: "root",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 100,
    Lead_Time_Days: 10,
  }),
  row({
    __rowIndex: 1,
    Part_Number: "SUB-1",
    Revision: "A",
    Description: "child",
    Status: "RELEASED",
    UOM: "EA",
    Unit_Cost: 5,
    Lead_Time_Days: 3,
    Parent_Part_Number: "ASM-1",
    Parent_Revision: "A",
    Qty_Per_Parent: 2,
  }),
];

function baseGraph(): BomGraph {
  return buildGraph(ROWS).graph;
}

function modifiedGraph(): BomGraph {
  const modified = ROWS.map((r) =>
    r.Part_Number === "SUB-1" ? { ...r, Description: "mine" } : r,
  );
  return buildGraph(modified).graph;
}

function remoteModifiedGraph(): BomGraph {
  const modified = ROWS.map((r) =>
    r.Part_Number === "SUB-1" ? { ...r, Description: "theirs" } : r,
  );
  return buildGraph(modified).graph;
}

const BASE_INPUT = {
  owner: "o",
  repo: "r",
  path: "data/master.xlsx",
  branch: "main",
  token: "ghp_x",
  message: "update",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(status: number): Response {
  // Body contents don't matter — runPipeline is mocked.
  return new Response(new Uint8Array([1, 2, 3, 4]), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockedRunPipeline.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("commit — happy path", () => {
  it("PUTs once and returns the new sha when there is no conflict", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: { sha: "sha-new" } }),
    );

    const g = baseGraph();
    const dirty = markNodeDirty(emptyDirtyState("sha-base"), "SUB-1::A");

    const result = await commit({
      ...BASE_INPUT,
      graph: g,
      baselineGraph: g,
      dirty,
    });

    expect(result.newSha).toBe("sha-new");
    expect(result.conflicts).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("commit — auto-merge retry", () => {
  it("fetches remote, merges, and retries PUT once on 409 with no conflicts", async () => {
    const base = baseGraph();
    const mine = baseGraph();
    const theirs = baseGraph(); // identical graph → no conflict
    const dirty = markNodeDirty(emptyDirtyState("sha-base"), "SUB-1::A");

    mockedRunPipeline.mockReturnValueOnce({ graph: theirs, diagnostics: [] });

    fetchMock
      // 1. First PUT → 409
      .mockResolvedValueOnce(jsonResponse(409, {}))
      // 2. fetchMasterFile metadata
      .mockResolvedValueOnce(
        jsonResponse(200, { sha: "sha-remote", size: 100 }),
      )
      // 3. fetchMasterFile raw bytes
      .mockResolvedValueOnce(bytesResponse(200))
      // 4. Retry PUT → success
      .mockResolvedValueOnce(
        jsonResponse(200, { content: { sha: "sha-final" } }),
      );

    const result = await commit({
      ...BASE_INPUT,
      graph: mine,
      baselineGraph: base,
      dirty,
    });

    expect(result.newSha).toBe("sha-final");
    expect(result.conflicts).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(mockedRunPipeline).toHaveBeenCalledTimes(1);
  });
});

describe("commit — conflicts", () => {
  it("returns conflicts without retrying when the merge cannot resolve", async () => {
    const base = baseGraph();
    const mine = modifiedGraph(); // description = "mine"
    const theirs = remoteModifiedGraph(); // description = "theirs"
    const dirty = markNodeDirty(emptyDirtyState("sha-base"), "SUB-1::A");

    mockedRunPipeline.mockReturnValueOnce({ graph: theirs, diagnostics: [] });

    fetchMock
      // 1. First PUT → 409
      .mockResolvedValueOnce(jsonResponse(409, {}))
      // 2. fetchMasterFile metadata
      .mockResolvedValueOnce(
        jsonResponse(200, { sha: "sha-remote", size: 100 }),
      )
      // 3. fetchMasterFile raw bytes
      .mockResolvedValueOnce(bytesResponse(200));

    const result = await commit({
      ...BASE_INPUT,
      graph: mine,
      baselineGraph: base,
      dirty,
    });

    expect(result.newSha).toBeNull();
    expect(result.conflicts).not.toBeNull();
    expect(result.conflicts!.length).toBeGreaterThan(0);
    // PUT + meta + raw = 3 requests; no retry PUT.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("commit — errors", () => {
  it("throws when baselineSha is null", async () => {
    const g = baseGraph();
    await expect(
      commit({
        ...BASE_INPUT,
        graph: g,
        baselineGraph: g,
        dirty: emptyDirtyState(null),
      }),
    ).rejects.toThrow(/baseline SHA/);
  });

  it("propagates non-conflict errors", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    const g = baseGraph();
    const dirty = markNodeDirty(emptyDirtyState("sha-base"), "SUB-1::A");
    await expect(
      commit({
        ...BASE_INPUT,
        graph: g,
        baselineGraph: g,
        dirty,
      }),
    ).rejects.toThrow();
  });
});