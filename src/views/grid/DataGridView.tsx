// src/views/grid/DataGridView.tsx
//
// Virtualized tree-grid of the BOM.
//
// Reads from useGraphStore: graph, selection, ui.gridExpandedRows.
// Dispatches: selectNode, toggleGridRow, updateNodeField, updateEdgeQty.
//
// Total cost and critical-path lead time are pulled from the module-level
// rollupMemo. Actions populate it; this component only reads.

import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useGraphStore } from "../../store/graphStore";
import {
  rollupMemo,
  selectNode,
  toggleGridRow,
  updateEdgeQty,
  updateNodeField,
} from "../../store/actions";
import {
  criticalPathLeadTime,
  totalAssemblyCost,
} from "../../rollups/rollupEngine";
import type { BomGraph } from "../../graph/types";
import { projectRows, type GridRow } from "./rowProjection";
import { EditableNumberCell, EditableTextCell } from "./EditableCell";

const ROW_HEIGHT = 30;

const COLUMNS = [
  { key: "part", label: "Part", width: 320, align: "left" as const },
  { key: "rev", label: "Rev", width: 60, align: "left" as const },
  { key: "description", label: "Description", width: 240, align: "left" as const },
  { key: "status", label: "Status", width: 100, align: "left" as const },
  { key: "uom", label: "UOM", width: 60, align: "left" as const },
  { key: "unitCost", label: "Unit Cost", width: 90, align: "right" as const },
  { key: "qty", label: "Qty", width: 70, align: "right" as const },
  { key: "extCost", label: "Ext Cost", width: 90, align: "right" as const },
  { key: "totalCost", label: "Total Cost", width: 110, align: "right" as const },
  { key: "leadTime", label: "Lead (d)", width: 80, align: "right" as const },
  { key: "cpLead", label: "CP Lead (d)", width: 100, align: "right" as const },
  { key: "supplier", label: "Supplier", width: 160, align: "left" as const },
];

export function DataGridView() {
  const graph = useGraphStore((s) => s.graph);
  const selectedNodeId = useGraphStore((s) => s.selection.selectedNodeId);
  const expandedRows = useGraphStore((s) => s.ui.gridExpandedRows);

  const rows = useMemo(
    () => projectRows(graph, expandedRows),
    [graph, expandedRows],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (graph.nodes.size === 0) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data loaded. Use Load Demo (dev) or open a file.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #ddd",
          background: "#f6f6f6",
          fontWeight: 600,
          fontSize: 12,
        }}
      >
        {COLUMNS.map((c) => (
          <div
            key={c.key}
            style={{
              width: c.width,
              padding: "6px 8px",
              textAlign: c.align,
              boxSizing: "border-box",
              flexShrink: 0,
            }}
          >
            {c.label}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
        }}
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            return (
              <GridRowView
                key={row.key}
                row={row}
                graph={graph}
                top={vi.start}
                isSelected={row.nodeId === selectedNodeId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface GridRowViewProps {
  row: GridRow;
  graph: BomGraph;
  top: number;
  isSelected: boolean;
}

function GridRowView({ row, graph, top, isSelected }: GridRowViewProps) {
  const { node, edgeId, qtyPerParent, hasChildren, isExpanded, depth } = row;

  const totalCost = useMemo(
    () => totalAssemblyCost(graph, node.id, rollupMemo),
    [graph, node.id],
  );
  const cpLeadTime = useMemo(
    () => criticalPathLeadTime(graph, node.id, rollupMemo),
    [graph, node.id],
  );

  const extCost =
    qtyPerParent !== null && Number.isFinite(node.unitCost)
      ? node.unitCost * qtyPerParent
      : node.unitCost;

  function handleNodeText(field: "description" | "uom" | "supplier") {
    return (next: string) => updateNodeField(node.id, field, next);
  }

  function handleNodeNumber(field: "unitCost" | "leadTimeDays") {
    return (next: string) => updateNodeField(node.id, field, Number(next));
  }

  function handleQty(next: string) {
    if (!edgeId) return;
    updateEdgeQty(edgeId, Number(next));
  }

  return (
    <div
      onClick={() => selectNode(node.id)}
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        height: ROW_HEIGHT,
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid #eee",
        background: isSelected ? "#e6f0ff" : "#fff",
        cursor: "pointer",
        fontSize: 13,
        lineHeight: `${ROW_HEIGHT}px`,
      }}
    >
      <div
        style={{
          width: COLUMNS[0]!.width,
          padding: "4px 8px",
          display: "flex",
          alignItems: "center",
          gap: 4,
          boxSizing: "border-box",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 14,
            textAlign: "center",
            color: "#888",
            userSelect: "none",
          }}
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            toggleGridRow(node.id);
          }}
        >
          {hasChildren ? (isExpanded ? "▾" : "▸") : ""}
        </span>
        <span style={{ marginLeft: depth * 16, fontWeight: 500 }}>
          {node.partNumber}
        </span>
      </div>

      <Cell width={COLUMNS[1]!.width}>{node.revision}</Cell>

      <div style={{ width: COLUMNS[2]!.width, flexShrink: 0 }}>
        <EditableTextCell
          value={node.description}
          onCommit={handleNodeText("description")}
        />
      </div>

      <Cell width={COLUMNS[3]!.width}>{node.status}</Cell>

      <div style={{ width: COLUMNS[4]!.width, flexShrink: 0 }}>
        <EditableTextCell value={node.uom} onCommit={handleNodeText("uom")} />
      </div>

      <div style={{ width: COLUMNS[5]!.width, flexShrink: 0 }}>
        <EditableNumberCell
          value={node.unitCost}
          onCommit={handleNodeNumber("unitCost")}
          align="right"
        />
      </div>

      <div style={{ width: COLUMNS[6]!.width, flexShrink: 0 }}>
        {qtyPerParent !== null ? (
          <EditableNumberCell
            value={qtyPerParent}
            onCommit={handleQty}
            align="right"
          />
        ) : (
          <Cell width={COLUMNS[6]!.width} align="right">
            —
          </Cell>
        )}
      </div>

      <Cell width={COLUMNS[7]!.width} align="right">
        {formatNumber(extCost)}
      </Cell>

      <Cell width={COLUMNS[8]!.width} align="right" bold>
        {formatNumber(totalCost)}
      </Cell>

      <div style={{ width: COLUMNS[9]!.width, flexShrink: 0 }}>
        <EditableNumberCell
          value={node.leadTimeDays}
          onCommit={handleNodeNumber("leadTimeDays")}
          align="right"
        />
      </div>

      <Cell width={COLUMNS[10]!.width} align="right">
        {formatNumber(cpLeadTime)}
      </Cell>

      <div style={{ width: COLUMNS[11]!.width, flexShrink: 0 }}>
        <EditableTextCell
          value={node.supplier}
          onCommit={handleNodeText("supplier")}
        />
      </div>
    </div>
  );
}

function Cell({
  width,
  align = "left",
  bold = false,
  children,
}: {
  width: number | string;
  align?: "left" | "right";
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width,
        padding: "4px 8px",
        textAlign: align,
        boxSizing: "border-box",
        flexShrink: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontWeight: bold ? 600 : 400,
      }}
    >
      {children}
    </div>
  );
}

function formatNumber(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2);
}