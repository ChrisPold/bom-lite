// src/worker/pipeline.ts
//
// Pure pipeline: ArrayBuffer -> BomGraph. No worker API. Testable in isolation.

import { parseXlsx } from "../parser/xlsxParser";
import { buildGraph } from "../graph/graphBuilder";
import type { BomGraph } from "../graph/types";
import type { RowDiagnostic } from "../parser/schema";

export interface PipelineResult {
  graph: BomGraph;
  diagnostics: RowDiagnostic[];
}

export function runPipeline(buffer: ArrayBuffer): PipelineResult {
  const { rows, diagnostics: parseDiags } = parseXlsx(buffer);
  const { graph, diagnostics: graphDiags } = buildGraph(rows);
  return {
    graph,
    diagnostics: [...parseDiags, ...graphDiags],
  };
}