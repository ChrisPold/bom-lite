\# BOM-Lite — Project Context



\## Hard Constraints

\- No backend, no SQL, no server, no cloud functions.

\- Client-side TypeScript only. Static-hosted Vite + React SPA.

\- Excel column contract is case-sensitive. Headers are exactly:

&#x20; Part\_Number, Revision, Description, Status, UOM, Unit\_Cost, Lead\_Time\_Days,

&#x20; Supplier, MPN, CAD\_Path, Drawing\_Path, Parent\_Part\_Number, Parent\_Revision,

&#x20; Qty\_Per\_Parent, Substitutes.

\- All logic modules must be pure and independently testable.

\- View adapters must never mutate the store directly — use store actions only.

\- Worker must not import graphStore or access the DOM.



\## Stack (actual)

\- Vite 8 (Rolldown) + React 19 + TypeScript 6 (strict: true)

\- Linter: Oxlint (not ESLint)

\- SheetJS (xlsx) for Excel parsing

\- TailwindCSS + Lucide icons

\- Three.js / @react-three/fiber + GLTFLoader for .glb

\- @xyflow/react (React Flow) for the node graph

\- Zustand for the store

\- Vitest for unit tests, Playwright for E2E



\## Key Rules

\- Never introduce a backend or database.

\- Never silently overwrite a conflicting intrinsic field on a duplicated nodeId.

\- Duplicate (parent, child) pairs remain distinct edges — never sum.

\- Edge id format: `${parentId}->${childId}::row${\_\_rowIndex}`.

\- Always run `pnpm vitest run` before declaring a task complete.

\- If you change a file, run the tests for that file.



\## File Layout (target)

src/graph/types.ts

src/graph/revisionResolver.ts

src/graph/cycleDetection.ts

src/graph/substituteBuilder.ts

src/graph/graphBuilder.ts

src/rollups/rollupEngine.ts

src/rollups/memo.ts

src/parser/schema.ts

src/parser/xlsxParser.ts

src/worker/parse.worker.ts

src/worker/workerClient.ts

src/fetchLayer/tokenStore.ts

src/fetchLayer/errors.ts

src/fetchLayer/githubClient.ts

src/fetchLayer/conflictMerge.ts

src/store/graphStore.ts

src/store/actions.ts

src/store/dirtyState.ts

src/cad/cadCache.ts

src/writeBack/flatten.ts

src/writeBack/commit.ts

src/views/grid/DataGridView.tsx

src/views/graph/NodeGraphView.tsx

src/views/threeD/ThreeDView.tsx

src/views/drawingModal/DrawingModal.tsx

src/app/App.tsx

src/app/ViewSwitcher.tsx

src/app/ErrorBoundary.tsx

