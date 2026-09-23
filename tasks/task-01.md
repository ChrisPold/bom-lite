Read GEMINI.md for project context.



Implement Task 1: Domain types.



Objective: Define the immutable domain types (PartNode, ConsumesEdge, SubstituteEdge,

BomGraph, RawRow) per spec §2.1.



Files to touch:

\- src/graph/types.ts

\- src/parser/schema.ts (RawRow type only — validation logic is a later task)



Out:

\- PartNode, ConsumesEdge, SubstituteEdge, BomGraph, RawRow interfaces per spec §2.1

\- Status = "WIP" | "RELEASED" | "OBSOLETE"



Constraints:

\- RawRow must carry \_\_rowIndex: number plus all Excel headers, typed as

&#x20; string | number | undefined (no coercion here).

\- Do not add Zustand, React Flow, three.js, pdf.js yet.

\- TypeScript strict: true.



Acceptance tests:

\- Vitest type-only smoke test that a fixture object literal satisfies each exported

&#x20; interface (satisfies PartNode, etc.).



STOP CONDITION: Before writing any files, print the exact type signatures you plan to

write for all five interfaces plus the Status union. Then stop and wait for me to

confirm or correct. Do not create files until I say "go".



Thinking level: low.

