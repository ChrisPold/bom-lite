import { useState } from "react";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { Toolbar, type Notification } from "./app/Toolbar";
import { useGraphStore } from "./store/graphStore";
import { DataGridView } from "./views/grid/DataGridView";
import { NodeGraphView } from "./views/graph/NodeGraphView";

function App() {
  const [notification, setNotification] = useState<Notification | null>(null);
  const activeView = useGraphStore((s) => s.ui.activeView);

  return (
    <ErrorBoundary>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <Toolbar onNotify={setNotification} />

        {notification && (
          <div
            style={{
              padding: "8px 16px",
              fontSize: 13,
              background: notification.kind === "error" ? "#fdecea" : "#e7f7ed",
              color: notification.kind === "error" ? "#8b1c14" : "#116329",
              borderBottom: "1px solid #eee",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <span style={{ flex: 1 }}>{notification.message}</span>
            <button
              onClick={() => setNotification(null)}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                fontSize: 16,
              }}
            >
              ×
            </button>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0 }}>
          <ActiveView active={activeView} />
        </div>
      </div>
    </ErrorBoundary>
  );
}

function ActiveView({ active }: { active: string }) {
  if (active === "grid") return <DataGridView />;
  if (active === "graph") return <NodeGraphView />;
  if (active === "3d") {
    return <Placeholder title="3D CAD view" note="Coming in T23." />;
  }
  return null;
}

function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div
      style={{
        padding: 40,
        textAlign: "center",
        color: "#666",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h2 style={{ fontSize: 16 }}>{title}</h2>
      <p>{note}</p>
    </div>
  );
}

export default App;