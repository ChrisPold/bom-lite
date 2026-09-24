// src/fetchLayer/tokenStore.ts
//
// Client-side storage for the user's GitHub PAT.
//
// Never logs the token. Falls back to in-memory storage when localStorage
// is unavailable (private browsing, quota exceeded, disabled by policy).

const STORAGE_KEY = "bom-lite.pat";

const memoryFallback = new Map<string, string>();

function safeGet(key: string): string | null {
  // Memory fallback wins: if a value landed there, it means localStorage
  // was unavailable at write time, so reads can't be trusted either.
  if (memoryFallback.has(key)) {
    return memoryFallback.get(key) ?? null;
  }
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      // Write succeeded — drop any stale memory entry for this key.
      memoryFallback.delete(key);
      return;
    }
  } catch {
    // fall through to memory
  }
  memoryFallback.set(key, value);
}

function safeRemove(key: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
  memoryFallback.delete(key);
}

export function getToken(): string | null {
  const value = safeGet(STORAGE_KEY);
  if (value === null || value === "") return null;
  return value;
}

export function setToken(pat: string): void {
  safeSet(STORAGE_KEY, pat);
}

export function clearToken(): void {
  safeRemove(STORAGE_KEY);
}

export function hasToken(): boolean {
  return getToken() !== null;
}