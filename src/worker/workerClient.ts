// src/worker/workerClient.ts
//
// Main-thread parse entry point.
//
// NOTE: The parse worker is currently bypassed. Vite 8 + Rolldown in dev
// mode has issues instantiating module workers, and the pipeline is fast
// enough on the main thread for realistic file sizes. The worker files
// (parse.worker.ts, protocol.ts) are kept so this can be re-enabled once
// the underlying toolchain stabilizes.
//
// To re-enable the worker, replace the body of parseFile with the version
// that constructed `new Worker(new URL("./parse.worker.ts", import.meta.url),
// { type: "module" })` and round-tripped a ParseRequest. The serialization
// helpers in protocol.ts handle the Map <-> array-of-tuples conversion.

import { runPipeline } from "./pipeline";
import type { BomGraph } from "../graph/types";
import type { RowDiagnostic } from "../parser/schema";

export interface ParsedGraph {
  graph: BomGraph;
  diagnostics: RowDiagnostic[];
}

export async function parseFile(
  input: File | ArrayBuffer,
): Promise<ParsedGraph> {
  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  // Yield to the event loop once so the caller's await has a chance to
  // update UI (spinner) before we block on parsing.
  await Promise.resolve();

  return runPipeline(arrayBuffer);
}