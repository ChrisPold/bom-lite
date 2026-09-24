import { describe, it, expect, beforeEach, vi } from "vitest";
import { clearToken, getToken, hasToken, setToken } from "./tokenStore";

beforeEach(() => {
  clearToken();
});

describe("tokenStore", () => {
  it("returns null when no token is stored", () => {
    expect(getToken()).toBeNull();
    expect(hasToken()).toBe(false);
  });

  it("round-trips a token", () => {
    setToken("ghp_abc123");
    expect(getToken()).toBe("ghp_abc123");
    expect(hasToken()).toBe(true);
  });

  it("clears a stored token", () => {
    setToken("ghp_abc123");
    clearToken();
    expect(getToken()).toBeNull();
    expect(hasToken()).toBe(false);
  });

  it("treats an empty string as no token", () => {
    setToken("");
    expect(getToken()).toBeNull();
    expect(hasToken()).toBe(false);
  });

  it("uses a single localStorage key", () => {
    setToken("ghp_xyz");
    expect(localStorage.getItem("bom-lite.pat")).toBe("ghp_xyz");
  });

  it("falls back to in-memory storage when localStorage.setItem throws", () => {
    const setSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });

    expect(() => setToken("ghp_fallback")).not.toThrow();
    expect(getToken()).toBe("ghp_fallback");
    setSpy.mockRestore();
  });
});