import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useGraphStore } from "../../store/graphStore";
import { selectNode, toggleGraphNode } from "../../store/actions";
import { projectGraph } from "./layout";
import { BomNode, type BomNodeData } from "./BomNode";

const NODE_TYPES: NodeTypes = { bomNode: BomNode };

export function NodeGraphView() {
  const graph = useGraphStore((s) => s.graph);
  const expanded = useGraphStore((s) => s.ui.graphExpandedNodes);
  const selectedNodeId = useGraphStore((s) => s.selection.selectedNodeId);

  const { nodes, edges } = useMemo(
    () => projectGraph(graph, expanded),
    [graph, expanded],
  );

  const flowNodes: Node<BomNodeData, "bomNode">[] = useMemo(
    () =>
      nodes.map((n) => {
        const partNode = graph.nodes.get(n.nodeId)!;
        const childEdgeIds = graph.edgesByParent.get(n.nodeId) ?? [];
        const hasChildren = childEdgeIds.length > 0;
        const isExpanded = hasChildren && expanded.has(n.nodeId);
        const edge = n.edgeId ? graph.edges.get(n.edgeId) : undefined;
        return {
          id: n.reactFlowId,
          type: "bomNode" as const,
          position: { x: n.x, y: n.y },
          data: {
            node: partNode,
            graph,
            hasChildren,
            isExpanded,
            isSelected: n.nodeId === selectedNodeId,
            qtyPerParent: edge ? edge.qtyPerParent : null,
            onToggleExpand: toggleGraphNode,
          },
          draggable: false,
        };
      }),
    [nodes, graph, expanded, selectedNodeId],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#888", strokeWidth: 1.5 },
      })),
    [edges],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const partNodeId = (node.data as BomNodeData).node.id;
      selectNode(partNodeId);
    },
    [],
  );

  if (graph.nodes.size === 0) {
    return (
      <div style={{ padding: 24, color: "#666" }}>
        No data loaded. Use Load… in the toolbar.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: false }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.1}
        maxZoom={2}
      >
        <Background color="#e0e0e0" gap={20} />
        <Controls />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => {
            const d = n.data as BomNodeData | undefined;
            if (!d) return "#ccc";
            return d.node.status === "OBSOLETE"
              ? "#f4b8b4"
              : d.node.status === "WIP"
                ? "#f4dfa8"
                : "#b8e0c4";
          }}
          style={{ background: "#fafafa" }}
        />
      </ReactFlow>
    </div>
  );
}