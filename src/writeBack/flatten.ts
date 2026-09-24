// src/writeBack/flatten.ts
//
// BomGraph -> RawRow[].
//
// Inverse of graphBuilder.ts. Emits:
//   - One edge row per ConsumesEdge (child intrinsic fields + parent id + qty)
//   - One root row per node that is in graph.roots OR has no incoming edges
//
// Deterministic ordering: (Part_Number, Revision, Parent_Part_Number, tail)
// where tail is "" for root rows and the edge id for edge rows.

import type { BomGraph } from "../graph/types";
import type { RawRow } from "../parser/schema";

export function flatten(graph: BomGraph): RawRow[] {
  const rootIds = new Set(graph.roots);
  const nodesNeedingRootRow = new Set<string>();
  for (const id of graph.nodes.keys()) {
    const hasIncoming = (graph.edgesByChild.get(id)?.length ?? 0) > 0;
    if (rootIds.has(id) || !hasIncoming) {
      nodesNeedingRootRow.add(id);
    }
  }

  const sortable: SortableRow[] = [];

  // Edge rows — one per ConsumesEdge
  for (const edge of graph.edges.values()) {
    const child = graph.nodes.get(edge.childId);
    const parent = graph.nodes.get(edge.parentId);
    if (!child || !parent) continue;

    const substitutes = serializeSubstitutes(graph, edge.childId, edge.parentId);

    sortable.push({
      row: {
        __rowIndex: -1, // assigned after sort
        Part_Number: child.partNumber,
        Revision: child.revision,
        Description: child.description,
        Status: child.status,
        UOM: child.uom,
        Unit_Cost: child.unitCost,
        Lead_Time_Days: child.leadTimeDays,
        Supplier: child.supplier,
        MPN: child.mpn,
        CAD_Path: child.cadPath,
        Drawing_Path: child.drawingPath,
        Parent_Part_Number: parent.partNumber,
        Parent_Revision: parent.revision,
        Qty_Per_Parent: edge.qtyPerParent,
        Substitutes: substitutes,
      },
      sortPart: child.partNumber,
      sortRev: child.revision,
      sortParent: parent.partNumber,
      sortTail: edge.id,
    });
  }

  // Root rows
  for (const id of nodesNeedingRootRow) {
    const node = graph.nodes.get(id);
    if (!node) continue;

    const substitutes = serializeSubstitutes(graph, id, undefined);

    sortable.push({
      row: {
        __rowIndex: -1,
        Part_Number: node.partNumber,
        Revision: node.revision,
        Description: node.description,
        Status: node.status,
        UOM: node.uom,
        Unit_Cost: node.unitCost,
        Lead_Time_Days: node.leadTimeDays,
        Supplier: node.supplier,
        MPN: node.mpn,
        CAD_Path: node.cadPath,
        Drawing_Path: node.drawingPath,
        Parent_Part_Number: undefined,
        Parent_Revision: undefined,
        Qty_Per_Parent: 1,
        Substitutes: substitutes,
      },
      sortPart: node.partNumber,
      sortRev: node.revision,
      sortParent: "",
      sortTail: "",
    });
  }

  sortable.sort(compareRows);

  return sortable.map((s, i) => ({ ...s.row, __rowIndex: i }));
}

interface SortableRow {
  readonly row: RawRow;
  readonly sortPart: string;
  readonly sortRev: string;
  readonly sortParent: string;
  readonly sortTail: string;
}

function compareRows(a: SortableRow, b: SortableRow): number {
  if (a.sortPart !== b.sortPart) {
    return a.sortPart.localeCompare(b.sortPart);
  }
  if (a.sortRev !== b.sortRev) {
    return a.sortRev.localeCompare(b.sortRev, undefined, { numeric: true });
  }
  if (a.sortParent !== b.sortParent) {
    return a.sortParent.localeCompare(b.sortParent);
  }
  return a.sortTail.localeCompare(b.sortTail);
}

function serializeSubstitutes(
  graph: BomGraph,
  primaryId: string,
  scopeParentId: string | undefined,
): string | undefined {
  const subIds = graph.substitutesByPart.get(primaryId);
  if (!subIds || subIds.length === 0) return undefined;

  const parts: string[] = [];
  for (const sid of subIds) {
    const sub = graph.substitutes.get(sid);
    if (!sub) continue;
    if (sub.scopeParentId !== scopeParentId) continue;
    const subNode = graph.nodes.get(sub.substituteId);
    if (!subNode) continue;
    parts.push(`${subNode.partNumber}::${subNode.revision}`);
  }
  return parts.length > 0 ? parts.join(", ") : undefined;
}