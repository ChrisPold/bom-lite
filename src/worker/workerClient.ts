// src/worker/workerClient.ts
//
// Main-thread wrapper around the parse worker.
//
// NOTE: when you pass an ArrayBuffer, it is transferred to the worker and
// becomes detached on the caller side. Use the File overload if you want
// to keep a reference to the bytes.

import type { BomGraph } from "../graph/types";
import type { RowDiagnostic } from "../parser/schema";
import {
  deserializeGraph,
  type ParseRequest,
  type ParseResponse,
} from "./protocol";

export interface ParsedGraph {
  graph: BomGraph;
  diagnostics: RowDiagnostic[];
}

export async function parseFile(
  input: File | ArrayBuffer,
): Promise<ParsedGraph> {
  const arrayBuffer =
    input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  return new Promise<ParsedGraph>((resolve, reject) => {
    const worker = new Worker(
      new URL("./parse.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<ParseResponse>) => {
      worker.terminate();
      const msg = event.data;
      if (msg.kind === "parsed") {
        resolve({
          graph: deserializeGraph(msg.payload),
          diagnostics: msg.diagnostics,
        });
      } else {
        const err = new Error(msg.message);
        if (msg.stack) err.stack = msg.stack;
        reject(err);
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(`Worker error: ${event.message}`));
    };

    const request: ParseRequest = { kind: "parse", arrayBuffer };
    worker.postMessage(request, [arrayBuffer]);
  });
}