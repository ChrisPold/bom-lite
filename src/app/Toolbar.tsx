import { useState } from "react";
import { useGraphStore } from "../store/graphStore";
import { commit, discard } from "../store/actions";
import { getToken, setToken, hasToken } from "../fetchLayer/tokenStore";
import { fetchMasterFile } from "../fetchLayer/githubClient";
import { parseFile } from "../worker/workerClient";
import { loadGraph } from "../store/actions";
import {
  loadRepoConfig,
  saveRepoConfig,
  type RepoConfig,
} from "./repoConfig";
import { ViewSwitcher } from "./ViewSwitcher";
import {
  AuthError,
  ConflictError,
  NetworkError,
  SizeLimitError,
} from "../fetchLayer/errors";

export type Notification =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

interface ToolbarProps {
  onNotify: (n: Notification | null) => void;
}

export function Toolbar({ onNotify }: ToolbarProps) {
  const [showLoad, setShowLoad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<RepoConfig>(loadRepoConfig);
  const [pat, setPat] = useState(getToken() ?? "");
  const dirty = useGraphStore((s) => s.dirty);
  const hasGraph = useGraphStore((s) => s.graph.nodes.size > 0);
  const isDirty =
    dirty.nodes.size > 0 ||
    dirty.edges.size > 0 ||
    dirty.substitutes.size > 0;

  async function handleLocalFile(file: File) {
    setBusy(true);
    onNotify(null);
    try {
      const { graph, diagnostics } = await parseFile(file);
      loadGraph(graph, null);
      onNotify({
        kind: "success",
        message: `Loaded ${graph.nodes.size} nodes, ${graph.edges.size} edges${
          diagnostics.length > 0 ? ` (${diagnostics.length} diagnostics)` : ""
        }`,
      });
      setShowLoad(false);
    } catch (err) {
      onNotify({ kind: "error", message: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleGitHubLoad() {
    if (!pat) {
      onNotify({ kind: "error", message: "Enter a GitHub Personal Access Token first." });
      return;
    }
    if (!config.owner || !config.repo) {
      onNotify({ kind: "error", message: "Owner and repo are required." });
      return;
    }

    setBusy(true);
    onNotify(null);
    setToken(pat);
    saveRepoConfig(config);
    try {
      const { arrayBuffer, sha } = await fetchMasterFile({
        ...config,
        token: pat,
      });
      const { graph, diagnostics } = await parseFile(arrayBuffer);
      loadGraph(graph, sha);
      onNotify({
        kind: "success",
        message: `Loaded ${graph.nodes.size} nodes from ${config.owner}/${config.repo}${
          diagnostics.length > 0 ? ` (${diagnostics.length} diagnostics)` : ""
        }`,
      });
      setShowLoad(false);
    } catch (err) {
      onNotify({ kind: "error", message: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!hasGraph) return;
    setBusy(true);
    onNotify(null);
    try {
      const result = await commit(`BOM-Lite update ${new Date().toISOString()}`);
      if (result.conflicts) {
        onNotify({
          kind: "error",
          message: `Conflict: ${result.conflicts.length} divergent edit(s). Merge UI not yet implemented.`,
        });
      } else if (result.newSha) {
        onNotify({
          kind: "success",
          message: `Committed. New sha: ${result.newSha.slice(0, 7)}`,
        });
      }
    } catch (err) {
      onNotify({ kind: "error", message: describeError(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        borderBottom: "1px solid #ddd",
        background: "#fafafa",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
        }}
      >
        <strong style={{ fontSize: 15, marginRight: 8 }}>BOM-Lite</strong>

        <button
          onClick={() => setShowLoad((v) => !v)}
          disabled={busy}
          style={btnStyle}
        >
          Load…
        </button>

        <button onClick={handleCommit} disabled={busy || !isDirty || !hasGraph} style={btnStyle}>
          Commit
        </button>

        <button onClick={() => discard()} disabled={!isDirty} style={btnStyle}>
          Discard
        </button>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#666" }}>
          {hasToken() ? "PAT set" : "No PAT"}
          {isDirty ? " · unsaved changes" : ""}
        </span>
        <ViewSwitcher />
      </div>

      {showLoad && (
        <div
          style={{
            borderTop: "1px solid #eee",
            padding: "12px 16px",
            background: "#fff",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
            fontSize: 13,
          }}
        >
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Open local .xlsx
            </div>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleLocalFile(file);
              }}
              disabled={busy}
            />
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              Load from GitHub
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <input
                placeholder="Personal Access Token (ghp_…)"
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                style={inputStyle}
                disabled={busy}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  placeholder="owner"
                  value={config.owner}
                  onChange={(e) => setConfig({ ...config, owner: e.target.value })}
                  style={inputStyle}
                  disabled={busy}
                />
                <input
                  placeholder="repo"
                  value={config.repo}
                  onChange={(e) => setConfig({ ...config, repo: e.target.value })}
                  style={inputStyle}
                  disabled={busy}
                />
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  placeholder="path"
                  value={config.path}
                  onChange={(e) => setConfig({ ...config, path: e.target.value })}
                  style={inputStyle}
                  disabled={busy}
                />
                <input
                  placeholder="branch"
                  value={config.branch}
                  onChange={(e) => setConfig({ ...config, branch: e.target.value })}
                  style={inputStyle}
                  disabled={busy}
                />
              </div>
              <button
                onClick={handleGitHubLoad}
                disabled={busy}
                style={{ ...btnStyle, justifySelf: "flex-start" }}
              >
                {busy ? "Loading…" : "Load"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 12px",
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
  fontSize: 13,
  borderRadius: 3,
};

const inputStyle: React.CSSProperties = {
  padding: "4px 8px",
  border: "1px solid #ccc",
  fontSize: 13,
  borderRadius: 3,
  flex: 1,
  minWidth: 0,
};

function describeError(err: unknown): string {
  if (err instanceof AuthError) {
    return "GitHub rejected the token. Check that it has `repo` scope and has not expired.";
  }
  if (err instanceof NetworkError) {
    return `Network error: ${err.message}`;
  }
  if (err instanceof ConflictError) {
    return "Remote file changed since you last loaded it. Reload before committing.";
  }
  if (err instanceof SizeLimitError) {
    return `File exceeds 15 MB (${(err.actualBytes / 1024 / 1024).toFixed(1)} MB). BOM-Lite supports files up to 15 MB in Phase 1.`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}