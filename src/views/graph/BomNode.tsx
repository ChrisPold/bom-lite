import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { BomGraph, PartNode } from "../../graph/types";
import {
  criticalPathLeadTime,
  totalAssemblyCost,
} from "../../rollups/rollupEngine";
import { rollupMemo } from "../../store/actions";

export interface BomNodeData extends Record<string, unknown> {
  node: PartNode;
  graph: BomGraph;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  qtyPerParent: number | null;
  onToggleExpand: (nodeId: string) => void;
}

export type BomFlowNode = Node<BomNodeData, "bomNode">;

const STATUS_COLORS: Record<string, string> = {
  RELEASED: "#116329",
  WIP: "#8a6d00",
  OBSOLETE: "#8b1c14",
};

const STATUS_BG: Record<string, string> = {
  RELEASED: "#e7f7ed",
  WIP: "#fbf3d5",
  OBSOLETE: "#fdecea",
};

function BomNodeInner({ data }: NodeProps<BomFlowNode>) {
  const { node, graph, hasChildren, isExpanded, isSelected, qtyPerParent, onToggleExpand } =
    data;

  const totalCost = totalAssemblyCost(graph, node.id, rollupMemo);
  const leadTime = criticalPathLeadTime(graph, node.id, rollupMemo);

  return (
    <div
      style={{
        padding: 0,
        borderRadius: 6,
        border: `2px solid ${isSelected ? "#4a9eff" : "#ccc"}`,
        background: "#fff",
        boxShadow: isSelected
          ? "0 0 0 3px rgba(74, 158, 255, 0.25)"
          : "0 1px 3px rgba(0,0,0,0.08)",
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        minWidth: 200,
        cursor: "pointer",
      }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <div
        style={{
          padding: "6px 10px",
          borderBottom: "1px solid #eee",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) onToggleExpand(node.id);
          }}
          style={{
            display: "inline-block",
            width: 14,
            textAlign: "center",
            color: hasChildren ? "#4a9eff" : "#ccc",
            cursor: hasChildren ? "pointer" : "default",
            userSelect: "none",
            fontWeight: 600,
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : "·"}
        </span>
        <strong style={{ fontSize: 13 }}>{node.partNumber}</strong>
        <span style={{ color: "#888" }}>rev {node.revision}</span>
        <div style={{ flex: 1 }} />
        {qtyPerParent !== null && (
          <span
            style={{
              background: "#eef",
              color: "#448",
              padding: "1px 6px",
              borderRadius: 3,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            ×{qtyPerParent}
          </span>
        )}
      </div>

      <div
        style={{
          padding: "4px 10px",
          color: "#444",
          fontSize: 11,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: 220,
        }}
        title={node.description}
      >
        {node.description || <em style={{ color: "#aaa" }}>no description</em>}
      </div>

      <div
        style={{
          padding: "4px 10px 6px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
        }}
      >
        <span
          style={{
            background: STATUS_BG[node.status] ?? "#eee",
            color: STATUS_COLORS[node.status] ?? "#333",
            padding: "1px 6px",
            borderRadius: 3,
            fontWeight: 600,
          }}
        >
          {node.status}
        </span>
        <span style={{ color: "#666" }}>
          ${Number.isFinite(totalCost) ? totalCost.toFixed(2) : "—"}
        </span>
        <span style={{ color: "#666" }}>
          {Number.isFinite(leadTime) ? `${leadTime}d` : "—"}
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

export const BomNode = memo(BomNodeInner);