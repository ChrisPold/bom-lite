// src/writeBack/commit.ts
//
// Orchestrates a full commit cycle: flatten -> xlsx -> PUT -> on conflict,
// fetch + pipeline + merge + retry once.
//
// At most one automatic retry. If the retry also conflicts, or the merge
// produces conflicts, this returns them to the caller — no more PUTs.
//
// No store access. No token logging.

import type { BomGraph } from "../graph/types";
import type { DirtyState } from "../store/dirtyState";
import type { ConflictRow } from "../fetchLayer/conflictMerge";
import { commitMasterFile, fetchMasterFile } from "../fetchLayer/githubClient";
import { ConflictError } from "../fetchLayer/errors";
import { conflictMerge } from "../fetchLayer/conflictMerge";
import { runPipeline } from "../worker/pipeline";
import { flatten } from "./flatten";
import { rowsToXlsxBuffer } from "./serialize";

export interface CommitInput {
  graph: BomGraph;
  baselineGraph: BomGraph;
  dirty: DirtyState;
  owner: string;
  repo: string;
  path: string;
  branch: string;
  token: string;
  message: string;
}

export interface CommitOutput {
  /** New SHA on a successful commit, or null if a conflict blocked it. */
  newSha: string | null;
  /** Present only when the merge could not resolve automatically. */
  conflicts: ConflictRow[] | null;
}

export async function commit(input: CommitInput): Promise<CommitOutput> {
  const { graph, dirty } = input;
  const baseSha = dirty.baselineSha;

  if (baseSha === null) {
    throw new Error("No baseline SHA — load the file before committing");
  }

  const xlsx = rowsToXlsxBuffer(flatten(graph));

  try {
    const result = await commitMasterFile({
      owner: input.owner,
      repo: input.repo,
      path: input.path,
      branch: input.branch,
      token: input.token,
      content: xlsx,
      sha: baseSha,
      message: input.message,
    });
    return { newSha: result.newSha, conflicts: null };
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    return handleConflict(input);
  }
}

// ─── Conflict handling ──────────────────────────────────────────────────────

async function handleConflict(
  input: CommitInput,
): Promise<CommitOutput> {
  // Fetch the current remote, run the full pipeline on it.
  const remote = await fetchMasterFile({
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    branch: input.branch,
    token: input.token,
  });

  const { graph: theirs } = runPipeline(remote.arrayBuffer);

  const merge = conflictMerge({
    base: input.baselineGraph,
    mine: input.graph,
    theirs,
    dirty: input.dirty,
  });

  if (merge.conflicts.length > 0) {
    // Caller must resolve. Do NOT retry the PUT.
    return { newSha: null, conflicts: [...merge.conflicts] };
  }

  // Auto-merged cleanly — retry the PUT exactly once with the fresh SHA.
  const retriedXlsx = rowsToXlsxBuffer(flatten(merge.merged));

  const retryResult = await commitMasterFile({
    owner: input.owner,
    repo: input.repo,
    path: input.path,
    branch: input.branch,
    token: input.token,
    content: retriedXlsx,
    sha: remote.sha,
    message: input.message,
  });

  return { newSha: retryResult.newSha, conflicts: null };
}