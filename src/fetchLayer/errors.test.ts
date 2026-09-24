import { describe, it, expect } from "vitest";
import {
  AuthError,
  ConflictError,
  FetchLayerError,
  NetworkError,
  NotFoundError,
  SizeLimitError,
} from "./errors";

describe("FetchLayerError hierarchy", () => {
  it("AuthError is an Error and a FetchLayerError", () => {
    const e = new AuthError("bad token");
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(FetchLayerError);
    expect(e).toBeInstanceOf(AuthError);
    expect(e.kind).toBe("auth");
    expect(e.name).toBe("AuthError");
  });

  it("NetworkError has kind 'network'", () => {
    const e = new NetworkError("offline");
    expect(e.kind).toBe("network");
    expect(e).toBeInstanceOf(FetchLayerError);
  });

  it("NotFoundError has kind 'not-found'", () => {
    const e = new NotFoundError("no such repo");
    expect(e.kind).toBe("not-found");
  });

  it("ConflictError carries remoteSha", () => {
    const e = new ConflictError("remote changed", "abc123");
    expect(e.kind).toBe("conflict");
    expect(e.remoteSha).toBe("abc123");
    expect(e).toBeInstanceOf(FetchLayerError);
  });

  it("ConflictError tolerates an undefined remoteSha", () => {
    const e = new ConflictError("remote changed");
    expect(e.remoteSha).toBeUndefined();
  });

  it("SizeLimitError carries both byte counts", () => {
    const e = new SizeLimitError(20_000_000, 15_000_000);
    expect(e.kind).toBe("size-limit");
    expect(e.actualBytes).toBe(20_000_000);
    expect(e.limitBytes).toBe(15_000_000);
    expect(e.message).toContain("20000000");
    expect(e.message).toContain("15000000");
  });

  it("instanceof works across the prototype chain in every direction", () => {
    const cases = [
      new AuthError("a"),
      new NetworkError("n"),
      new ConflictError("c"),
      new SizeLimitError(1, 0),
      new NotFoundError("nf"),
    ];
    for (const e of cases) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(FetchLayerError);
    }
  });

  it("each subclass has a distinct kind", () => {
    const kinds = [
      new AuthError("").kind,
      new NetworkError("").kind,
      new ConflictError("").kind,
      new SizeLimitError(0, 0).kind,
      new NotFoundError("").kind,
    ];
    expect(new Set(kinds).size).toBe(5);
  });
});