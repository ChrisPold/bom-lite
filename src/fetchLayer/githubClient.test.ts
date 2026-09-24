import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  commitMasterFile,
  fetchMasterFile,
  MAX_FILE_BYTES,
  type GitHubRepo,
} from "./githubClient";
import {
  AuthError,
  ConflictError,
  NetworkError,
  NotFoundError,
  SizeLimitError,
} from "./errors";

const REPO: GitHubRepo = {
  owner: "chris",
  repo: "bom-lite-data",
  path: "data/master.xlsx",
  branch: "main",
  token: "ghp_test",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bytesResponse(status: number, bytes: Uint8Array): Response {
  // TS strict rejects Uint8Array as BodyInit in the current DOM lib.
  // Pass a sliced ArrayBuffer so the type is unambiguously BodyInit.
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Response(ab, { status });
}

// ─── fetchMasterFile ────────────────────────────────────────────────────────

describe("fetchMasterFile", () => {
  it("returns the bytes, sha, and size on success", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { sha: "abc123", size: 4 }))
      .mockResolvedValueOnce(bytesResponse(200, bytes));

    const result = await fetchMasterFile(REPO);
    expect(result.sha).toBe("abc123");
    expect(result.size).toBe(4);
    expect(new Uint8Array(result.arrayBuffer)).toEqual(bytes);
  });

  it("sends the token as a Bearer header", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { sha: "s", size: 0 }))
      .mockResolvedValueOnce(bytesResponse(200, new Uint8Array()));

    await fetchMasterFile(REPO);

    const firstInit = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(
      (firstInit.headers as Record<string, string>).Authorization,
    ).toBe("Bearer ghp_test");
  });

  it("throws AuthError on 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: "bad" }));
    await expect(fetchMasterFile(REPO)).rejects.toBeInstanceOf(AuthError);
  });

  it("throws AuthError on 403", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "bad" }));
    await expect(fetchMasterFile(REPO)).rejects.toBeInstanceOf(AuthError);
  });

  it("throws NotFoundError on 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "no" }));
    await expect(fetchMasterFile(REPO)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws SizeLimitError when metadata size exceeds the limit", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { sha: "s", size: MAX_FILE_BYTES + 1 }),
    );
    await expect(fetchMasterFile(REPO)).rejects.toBeInstanceOf(SizeLimitError);
    // Only the metadata call was made — no bytes downloaded.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT throw when size equals the limit", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { sha: "s", size: MAX_FILE_BYTES }),
      )
      .mockResolvedValueOnce(bytesResponse(200, new Uint8Array()));
    await expect(fetchMasterFile(REPO)).resolves.toBeDefined();
  });

  it("wraps network errors as NetworkError", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(fetchMasterFile(REPO)).rejects.toBeInstanceOf(NetworkError);
  });

  it("rejects when the metadata response is missing a sha", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { size: 4 }));
    await expect(fetchMasterFile(REPO)).rejects.toBeInstanceOf(NetworkError);
  });
});

// ─── commitMasterFile ───────────────────────────────────────────────────────

describe("commitMasterFile", () => {
  it("PUTs base64-encoded content and returns the new sha", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: { sha: "newsha" } }),
    );

    const result = await commitMasterFile({
      ...REPO,
      content: "hello",
      sha: "oldsha",
      message: "update",
    });

    expect(result.newSha).toBe("newsha");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/contents/data/master.xlsx");
    expect((init as RequestInit).method).toBe("PUT");

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.sha).toBe("oldsha");
    expect(body.branch).toBe("main");
    expect(body.message).toBe("update");
    // "hello" in base64 is "aGVsbG8="
    expect(body.content).toBe("aGVsbG8=");
  });

  it("base64-encodes an ArrayBuffer", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { content: { sha: "s" } }),
    );

    const buf = new Uint8Array([104, 101, 108, 108, 111]).buffer; // "hello"
    await commitMasterFile({
      ...REPO,
      content: buf,
      sha: "x",
      message: "m",
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.content).toBe("aGVsbG8=");
  });

  it("throws AuthError on 401", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(
      commitMasterFile({ ...REPO, content: "x", sha: "s", message: "m" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("throws NotFoundError on 404", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    await expect(
      commitMasterFile({ ...REPO, content: "x", sha: "s", message: "m" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ConflictError with remoteSha on 409", async () => {
    // First call: PUT returns 409
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, {}))
      // Second call: metadata fetch to get the fresh sha
      .mockResolvedValueOnce(
        jsonResponse(200, { sha: "freshsha", size: 100 }),
      );

    try {
      await commitMasterFile({
        ...REPO,
        content: "x",
        sha: "stale",
        message: "m",
      });
      expect.fail("expected ConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).remoteSha).toBe("freshsha");
    }
  });

  it("throws ConflictError without remoteSha when metadata also fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, {}))
      .mockRejectedValueOnce(new TypeError("network down"));

    try {
      await commitMasterFile({
        ...REPO,
        content: "x",
        sha: "stale",
        message: "m",
      });
      expect.fail("expected ConflictError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).remoteSha).toBeUndefined();
    }
  });

  it("wraps network errors on the PUT", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(
      commitMasterFile({ ...REPO, content: "x", sha: "s", message: "m" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it("rejects when the commit response is missing content.sha", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));
    await expect(
      commitMasterFile({ ...REPO, content: "x", sha: "s", message: "m" }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});