// src/App.tsx
//
// TEMPORARY dev smoke harness. Renders the graph built from SMOKE_FIXTURE
// as a nested text tree so you can eyeball the pipeline output.
//
// This file will be replaced by the real app shell in T25.

import { useMemo } from "react";
import { buildGraph } from "./graph/graphBuilder";
import type { BomGraph, PartNode } from "./graph/types";
import { SMOKE_FIXTURE } from "./dev/fixture";

interface TreeNode {
  node: PartNode;
  edgeId: string | null;
  qty: number | null;
  children: TreeNode[];
}

function buildTree(graph: BomGraph): TreeNode[] {
  const visited = new Set<string>();

  function walk(nodeId: string, edgeId: string | null, qty: number | null): TreeNode {
    const node = graph.nodes.get(nodeId);
    if (!node) {
      throw new Error(`Missing node: ${nodeId}`);
    }
    if (visited.has(nodeId)) {
      return { node, edgeId, qty, children: [] };
    }
    visited.add(nodeId);

    const edgeIds = graph.edgesByParent.get(nodeId) ?? [];
    const children: TreeNode[] = edgeIds.map((eid) => {
      const edge = graph.edges.get(eid);
      if (!edge) throw new Error(`Missing edge: ${eid}`);
      return walk(edge.childId, edge.id, edge.qtyPerParent);
    });

    return { node, edgeId, qty, children };
  }

  return graph.roots.map((rootId) => walk(rootId, null, null));
}

function TreeRow({ tree, depth }: { tree: TreeNode; depth: number }) {
  const { node, qty, children } = tree;
  return (
    <div>
      <div style={{ paddingLeft: depth * 24, fontFamily: "monospace" }}>
        {depth > 0 ? "└─ " : "● "}
        <strong>{node.id}</strong>
        {qty !== null && <span style={{ color: "#888" }}> × {qty}</span>}
        {" — "}
        {node.description || <em>(no description)</em>}
        <span style={{ color: "#888" }}>
          {" "}
          [{node.status}, {node.uom}, cost {node.unitCost}, LT {node.leadTimeDays}d]
        </span>
      </div>
      {children.map((c) => (
        <TreeRow key={c.edgeId ?? c.node.id} tree={c} depth={depth + 1} />
      ))}
    </div>
  );
}

function App() {
  const { graph, diagnostics } = useMemo(
    () => buildGraph(SMOKE_FIXTURE),
    [],
  );

  const tree = useMemo(() => buildTree(graph), [graph]);

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>BOM-Lite — T7 smoke harness</h1>
      <p style={{ color: "#666" }}>
        This is a temporary debug view. It loads a hardcoded fixture, runs it
        through <code>buildGraph</code>, and renders the result as a tree.
      </p>

      <h2>Summary</h2>
      <ul>
        <li>Nodes: {graph.nodes.size}</li>
        <li>Edges: {graph.edges.size}</li>
        <li>Substitutes: {graph.substitutes.size}</li>
        <li>Roots: {graph.roots.length}</li>
        <li>Cycles: {graph.cycles.length}</li>
        <li>Orphans: {graph.orphans.length}</li>
        <li>Diagnostics: {diagnostics.length}</li>
      </ul>

      <h2>Tree</h2>
      <div>
        {tree.map((t) => (
          <TreeRow key={t.node.id} tree={t} depth={0} />
        ))}
      </div>

      <h2>Substitutes</h2>
      {graph.substitutes.size === 0 ? (
        <p><em>none</em></p>
      ) : (
        <ul>
          {[...graph.substitutes.values()].map((s) => (
            <li key={s.id} style={{ fontFamily: "monospace" }}>
              {s.primaryId} ⇄ {s.substituteId}
              {s.scopeParentId ? ` (scope: ${s.scopeParentId})` : " (global)"}
            </li>
          ))}
        </ul>
      )}

      <h2>Diagnostics</h2>
      {diagnostics.length === 0 ? (
        <p><em>none</em></p>
      ) : (
        <ul>
          {diagnostics.map((d, i) => (
            <li key={i} style={{ fontFamily: "monospace", color: d.severity === "error" ? "red" : "#b86e00" }}>
              [{d.severity}] row {d.rowIndex}: {d.code} — {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;