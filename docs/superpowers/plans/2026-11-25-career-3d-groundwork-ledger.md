# Ledger: career 3D groundwork

The running record of the plan `2026-11-25-career-3d-groundwork.md`: what each task did, what its review found, and
every decision taken where the plan left something open.

## Method

One fresh implementer per task, an independent reviewer after each, a whole-branch review at the end. The named
skill for this method is not installed on this machine; the method is followed by hand.

## Decisions

- This ledger lives beside the plan, on the groundwork branch, so that it survives the machine.

## Tasks

| Task | State | Commits | Review |
|---|---|---|---|
| 1 | done, in review | a6ed44b | pending |

## Task notes

### Task 1

Decisions the implementer took, kept unless the review says otherwise:

- The boundary test finds imports with the TypeScript parser, not with patterns, and refuses what it cannot follow
  (an import that resolves to no file, a computed `import()`, `import.meta.glob`). Every relative import must
  therefore resolve at each test run.
- Only `import type` and `export type` count as type imports. `import { type A }` counts as a real import.
- "The world's pure modules", which the scene builder's tests may import, are those from which no chain of static
  imports reaches `three`.
- The world is also barred from `src/App.*` and `src/main.*`. `src/audio` is left open, as the plan does not close it.
- `boundary.test.ts` carries `/// <reference types="node" />`, because the app's type program does not load node's
  types and the tsconfig is better left alone.
