import { useGraphStore, type ActiveView } from "../store/graphStore";
import { setActiveView } from "../store/actions";

const VIEWS: { id: ActiveView; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "graph", label: "Graph" },
  { id: "3d", label: "3D" },
];

export function ViewSwitcher() {
  const active = useGraphStore((s) => s.ui.activeView);

  return (
    <div style={{ display: "flex", gap: 2 }}>
      {VIEWS.map((v) => {
        const isActive = active === v.id;
        return (
          <button
            key={v.id}
            onClick={() => setActiveView(v.id)}
            style={{
              padding: "4px 12px",
              border: "1px solid",
              borderColor: isActive ? "#4a9eff" : "#ccc",
              background: isActive ? "#e6f0ff" : "#fff",
              cursor: "pointer",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}