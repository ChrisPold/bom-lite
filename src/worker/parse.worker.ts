// src/worker/parse.worker.ts
//
// Worker entry point. Receives a parse request, runs the pipeline, posts
// back a serialized graph or an error.

import { runPipeline } from "./pipeline";
import { serializeGraph, type ParseRequest, type ParseResponse } from "./protocol";

export {};

interface WorkerCtx {
  onmessage: ((event: MessageEvent<ParseRequest>) => void) | null;
  postMessage: (msg: ParseResponse) => void;
}

const ctx = self as unknown as WorkerCtx;

ctx.onmessage = (event) => {
  const msg = event.data;
  if (msg.kind !== "parse") return;

  try {
    const { graph, diagnostics } = runPipeline(msg.arrayBuffer);
    const response: ParseResponse = {
      kind: "parsed",
      payload: serializeGraph(graph),
      diagnostics,
    };
    ctx.postMessage(response);
  } catch (err) {
    const response: ParseResponse = {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    };
    ctx.postMessage(response);
  }
};