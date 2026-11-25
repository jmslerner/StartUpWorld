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
| 1 | done | a6ed44b | approved; four minor points, three fixed with Task 2 |

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

Review: approved. The reviewer tried some twenty ways round the fence in a copy of the tree and all were caught.
Minor points: (1) the world's rule looks at direct imports only, so a world file could reach a closed folder through
an open one such as `src/audio`: left as it is, since the plan's wording is "imports from", and noted for the
whole-branch review; (2) a call to something named `require` with a computed argument is refused; (3) an import that
leaves `src` is refused; (4) one bad import fails five tests and parses the tree five times. Points 2 to 4 are fixed
in a small commit at the start of Task 2.
