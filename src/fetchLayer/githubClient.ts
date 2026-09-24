// src/fetchLayer/githubClient.ts
//
// Minimal GitHub Contents API client.
//
// Two operations:
//   fetchMasterFile  — read the .xlsx bytes + its git SHA
//   commitMasterFile — write new bytes with SHA-based concurrency check
//
// Every error is a typed FetchLayerError subclass. Auth tokens are never
// logged. No callers outside this module issue raw fetch() to GitHub.

import {
  AuthError,
  ConflictError,
  NetworkError,
  NotFoundError,
  SizeLimitError,
} from "./errors";

const API_BASE = "https://api.github.com";
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_ROW_COUNT = 8000;

export interface GitHubRepo {
  owner: string;
  repo: string;
  /** Path within the repo, e.g. "data/master.xlsx". */
  path: string;
  /** Branch name, e.g. "main". */
  branch: string;
  /** GitHub Personal Access Token with `repo` scope. */
  token: string;
}

export interface FetchedFile {
  arrayBuffer: ArrayBuffer;
  sha: string;
  size: number;
}

export interface CommitOptions extends GitHubRepo {
  /** New file contents. ArrayBuffer for binary, string for text. */
  content: ArrayBuffer | string;
  /** SHA of the version we based our edit on. */
  sha: string;
  /** Commit message. */
  message: string;
}

export interface CommitResult {
  newSha: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function fetchMasterFile(opts: GitHubRepo): Promise<FetchedFile> {
  const metadataUrl = buildContentsUrl(opts);
  const metadata = await ghFetchJson(metadataUrl, opts.token);

  const sha = metadata.sha;
  const size = typeof metadata.size === "number" ? metadata.size : 0;

  if (typeof sha !== "string" || sha === "") {
    throw new NetworkError("GitHub response missing sha");
  }

  if (size > MAX_FILE_BYTES) {
    throw new SizeLimitError(size, MAX_FILE_BYTES);
  }

  const rawUrl = buildContentsUrl(opts);
  const arrayBuffer = await ghFetchRaw(rawUrl, opts.token);

  return { arrayBuffer, sha, size: arrayBuffer.byteLength };
}

export async function commitMasterFile(
  opts: CommitOptions,
): Promise<CommitResult> {
  const url = buildContentsUrl(opts);
  const contentBase64 = toBase64(opts.content);

  const body = {
    message: opts.message,
    content: contentBase64,
    sha: opts.sha,
    branch: opts.branch,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : "Network failure",
    );
  }

  if (response.status === 409 || response.status === 412) {
    // Fetch the current remote SHA so the caller can run a 3-way merge.
    let remoteSha: string | undefined;
    try {
      const meta = await ghFetchJson(url, opts.token);
      if (typeof meta.sha === "string") remoteSha = meta.sha;
    } catch {
      // best-effort; ConflictError.remoteSha may be undefined
    }
    throw new ConflictError(
      "Remote file changed since last fetch",
      remoteSha,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError(
      `GitHub rejected the token (HTTP ${response.status})`,
    );
  }

  if (response.status === 404) {
    throw new NotFoundError(
      `Not found: ${opts.owner}/${opts.repo}/${opts.path}`,
    );
  }

  if (!response.ok) {
    throw new NetworkError(
      `GitHub commit failed: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const result = (await response.json()) as {
    content?: { sha?: string };
  };

  const newSha = result.content?.sha;
  if (typeof newSha !== "string" || newSha === "") {
    throw new NetworkError("GitHub commit response missing content.sha");
  }

  return { newSha };
}

// ─── Internal ───────────────────────────────────────────────────────────────

function buildContentsUrl(opts: GitHubRepo): string {
  const path = opts.path
    .split("/")
    .filter((s) => s.length > 0)
    .map(encodeURIComponent)
    .join("/");
  return `${API_BASE}/repos/${opts.owner}/${opts.repo}/contents/${path}`;
}

interface ContentsMetadata {
  sha: string;
  size: number;
}

async function ghFetchJson(
  url: string,
  token: string,
): Promise<{ sha: string; size: number } & Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : "Network failure",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError(`GitHub rejected the token (HTTP ${response.status})`);
  }
  if (response.status === 404) {
    throw new NotFoundError(`Not found: ${url}`);
  }
  if (!response.ok) {
    throw new NetworkError(
      `GitHub metadata fetch failed: HTTP ${response.status}`,
    );
  }

  const json = (await response.json()) as ContentsMetadata &
    Record<string, unknown>;
  return json;
}

async function ghFetchRaw(url: string, token: string): Promise<ArrayBuffer> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.raw+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (err) {
    throw new NetworkError(
      err instanceof Error ? err.message : "Network failure",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new AuthError(`GitHub rejected the token (HTTP ${response.status})`);
  }
  if (response.status === 404) {
    throw new NotFoundError(`Not found: ${url}`);
  }
  if (!response.ok) {
    throw new NetworkError(`GitHub raw fetch failed: HTTP ${response.status}`);
  }

  return response.arrayBuffer();
}

function toBase64(content: ArrayBuffer | string): string {
  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);

  // Chunked to avoid V8's argument-count ceiling on large buffers.
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(chunks.join(""));
}