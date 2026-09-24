// src/worker/protocol.ts
//
// Message protocol between the main thread and the parse worker.
//
// Maps don't survive structured clone reliably across all runtimes, so we
// flatten them to tuples on the way out and rebuild them on the way in.

import type {
  BomGraph,
  ConsumesEdge,
  PartNode,
  SubstituteEdge,
} from "../graph/types";
import type { RowDiagnostic } from "../parser/schema";

export interface SerializedGraph {
  nodes: Array<[string, PartNode]>;
  edges: ConsumesEdge[];
  substitutes: SubstituteEdge[];
  edgesByParent: Array<[string, string[]]>;
  edgesByChild: Array<[string, string[]]>;
  substitutesByPart: Array<[string, string[]]>;
  roots: string[];
  orphans: string[];
  cycles: string[][];
}

export interface ParseRequest {
  kind: "parse";
  arrayBuffer: ArrayBuffer;
}

export type ParseResponse =
  | { kind: "parsed"; payload: SerializedGraph; diagnostics: RowDiagnostic[] }
  | { kind: "error"; message: string; stack?: string };

export function serializeGraph(graph: BomGraph): SerializedGraph {
  return {
    nodes: [...graph.nodes.entries()],
    edges: [...graph.edges.values()],
    substitutes: [...graph.substitutes.values()],
    edgesByParent: [...graph.edgesByParent.entries()].map(([k, v]) => [k, [...v]]),
    edgesByChild: [...graph.edgesByChild.entries()].map(([k, v]) => [k, [...v]]),
    substitutesByPart: [...graph.substitutesByPart.entries()].map(([k, v]) => [k, [...v]]),
    roots: [...graph.roots],
    orphans: [...graph.orphans],
    cycles: graph.cycles.map((c) => [...c]),
  };
}

export function deserializeGraph(s: SerializedGraph): BomGraph {
  return {
    nodes: new Map(s.nodes),
    edges: new Map(s.edges.map((e) => [e.id, e])),
    substitutes: new Map(s.substitutes.map((x) => [x.id, x])),
    edgesByParent: new Map(s.edgesByParent),
    edgesByChild: new Map(s.edgesByChild),
    substitutesByPart: new Map(s.substitutesByPart),
    roots: s.roots,
    orphans: s.orphans,
    cycles: s.cycles,
  };
}