// src/App.tsx
//
// Temporary shell that loads the smoke fixture into the store on mount,
// then renders the DataGridView.
//
// T25 replaces this with the real app shell (PAT entry, file loading,
// view switcher, commit/discard toolbar).

import { useEffect } from "react";
import { buildGraph } from "./graph/graphBuilder";
import { useGraphStore } from "./store/graphStore";
import { loadGraph } from "./store/actions";
import { SMOKE_FIXTURE } from "./dev/fixture";
import { DataGridView } from "./views/grid/DataGridView";

function App() {
  useEffect(() => {
    // Only load the fixture if the store is empty — do not overwrite user work.
    if (useGraphStore.getState().graph.nodes.size === 0) {
      const { graph } = buildGraph(SMOKE_FIXTURE);
      loadGraph(graph, "smoke-fixture");
    }
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid #ddd",
          background: "#fafafa",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18 }}>
          BOM-Lite <span style={{ color: "#888", fontSize: 13 }}>— dev preview</span>
        </h1>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <DataGridView />
      </div>
    </div>
  );
}

export default App;