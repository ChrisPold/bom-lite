export type Status = "WIP" | "RELEASED" | "OBSOLETE";

export interface PartNode {
  readonly id: string; // Unique node identifier (e.g., `partNumber::revision`)
  readonly partNumber: string;
  readonly revision: string;
  readonly description: string;
  readonly status: Status;
  // UOM deliberately lives on PartNode (the child/part itself defines the unit of measure, e.g. "EACH" or "GRAM")
  readonly uom: string;
  readonly unitCost: number;
  readonly leadTimeDays: number;
  readonly supplier?: string;
  readonly mpn?: string;
  readonly cadPath?: string;
  readonly drawingPath?: string;
}

export interface ConsumesEdge {
  readonly id: string; // Format: `${parentId}->${childId}::row${rowIndex}`
  readonly parentId: string;
  readonly childId: string;
  readonly qtyPerParent: number;
  readonly rowIndex: number;
}

export interface SubstituteEdge {
  readonly id: string; // Format: `${primaryId}~sub~${substituteId}::${scopeParentId ?? "global"}`
  readonly primaryId: string;
  readonly substituteId: string;
  readonly scopeParentId?: string;
  readonly bidirectional: boolean;
}

export interface BomGraph {
  readonly nodes: ReadonlyMap<string, PartNode>;
  readonly edges: ReadonlyMap<string, ConsumesEdge>;
  readonly substitutes: ReadonlyMap<string, SubstituteEdge>;

  // edgesByParent and edgesByChild store edge ids, not node ids, so a caller has to do a second lookup in edges to get qty/rowIndex. That keeps duplicate (parent, child) pairs unambiguous.
  readonly edgesByParent: ReadonlyMap<string, readonly string[]>; // parentId → edge ids
  readonly edgesByChild: ReadonlyMap<string, readonly string[]>; // childId  → edge ids
  readonly substitutesByPart: ReadonlyMap<string, readonly string[]>; // primaryId → substitute edge ids
  readonly roots: readonly string[]; // node ids with no parent
  readonly orphans: readonly string[]; // edge ids whose parentId has no node
  readonly cycles: readonly (readonly string[])[]; // each cycle = list of node ids
}
