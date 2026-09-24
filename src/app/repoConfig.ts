// src/app/repoConfig.ts
//
// Persists the GitHub owner/repo/path/branch the user last loaded from.
// Token is stored separately in tokenStore.

const KEY = "bom-lite.repoConfig";

export interface RepoConfig {
  owner: string;
  repo: string;
  path: string;
  branch: string;
}

const DEFAULT_CONFIG: RepoConfig = {
  owner: "",
  repo: "",
  path: "data/master.xlsx",
  branch: "main",
};

export function loadRepoConfig(): RepoConfig {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CONFIG;
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<RepoConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveRepoConfig(config: RepoConfig): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}