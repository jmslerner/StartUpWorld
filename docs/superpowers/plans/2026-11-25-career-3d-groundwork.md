# Career 3D Groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring this project's own three.js office back as a tested foundation for the career's main screen: an
office drawn from one plain "office scene" value and shown on a lab page, with the game's rules and screens untouched.

**Architecture:** The old office lives in commit `63b4bed` under `src/world` (125 files). It is restored group by
group, following `docs/superpowers/specs/old-3d-office-inventory.md`, which gives every file a verdict and its exact
edits. Its one input changes: the old game's weekly snapshot is replaced by `OfficeScene`, plain data that says which
of the five offices, how many people in each of three teams, who is away, arriving and leaving, the era and the
ending. A pure module outside the 3D code (`src/scene`) builds that value from the game's state. The 3D code
(`src/world`) imports nothing from the rules, and a test keeps it so. The people on screen are a pure "cast" worked
out from one scene to the next: stable ids, moves between teams, a cap on how many are drawn.

**Tech Stack:** three 0.187.0 and @types/three 0.187.0 (exact versions), TypeScript 5.9 strict, Vitest 4 in node
against the real three (no WebGL and no fake of three), React 19 for the one mounting component, Playwright with the
machine's own Chromium for the browser checks. No react-three-fiber.

**Spec:** `docs/superpowers/specs/2026-11-25-career-3d-design.md`, section 10 (the 3D world), rule C9 in section 5.2
(offices) and step 4 of section 15. This plan is the part of step 4 that needs neither the career's finished rules
nor its screens. Reference material, all in `docs/superpowers/specs/`: `old-3d-office-inventory.md` (file by file),
`old-3d-office-reuse-map.md`, `threejs-facts.md`, `3d-mock-lessons.md`.

**Where this runs:** branch `claude/career-3d-groundwork`, cut from `claude/trusting-ramanujan-gd0yok`, the branch on
which another session is building the career's rules; this plan reads that branch's engine types. Open the draft pull
request against `claude/trusting-ramanujan-gd0yok`, so that it shows this plan's files only. That branch keeps moving:
merge it in (never rebase) before Task 3 and before Task 11.

## Global Constraints

- **The game is not touched.** No file under `src/engine`, `src/ai`, `src/sim`, `src/state` or `src/ui` changes, nor
  `src/config.ts`, `src/config.design.ts`, `src/App.tsx`, `src/main.tsx`, `src/index.css`, `eslint.config.js` or
  `vitest.config.ts`. `package.json` changes by the two `three` lines only, and `vite.config.ts` only as Task 10 says.
- **One-way dependency.** `three` is imported only under `src/world`. Nothing under `src/world` imports from
  `src/engine`, `src/ai`, `src/sim`, `src/state`, `src/scene`, `src/ui`, `src/lab` or `src/config`. `src/scene`
  imports from `src/engine` and, as types only, from `src/world/types`; it never imports `three`. Its tests may also
  import the world's pure modules, to check the two sides against each other. Task 1's test enforces all of it.
- **The 3D code stays out of the game's first load.** No chain of static imports from `src/main.tsx` reaches
  `src/world` or `three` (Task 1's test), and after Task 10 `dist/index.html` references no file that contains three.
- **All art is built in code.** No model, image or font files are added.
- **No founder figure.** Every figure is one of the company's head count. The old founder and cofounder seats,
  outfits and scripts are not restored.
- **At most 56 figures are drawn:** 50 of the staff and 6 people waiting at the door. The design allows 64; the
  largest restored plan seats 50. A bigger team shows the rest as a count on the office's sign, and the 50 drawn keep
  the teams' proportions.
- **Old stations stay as furniture.** The eight stations of the old game keep their places in the plans, because the
  plans were drawn around them, and lose everything that belonged to the old game: command plates, labels that name
  commands, and behaviour driven by old game values.
- **A look is a parameter from the start.** Every factory that was keyed by the old company phase takes the office
  index and a look. This plan ships one look, `"classic"`, which is the old polish for that size of office.
- **Reduced motion** (`prefers-reduced-motion`): walks and camera moves snap, as the old code already does.
- **No text a player reads names a real company, product or person.**
- TypeScript and ESLint as the repository has them (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUnusedLocals`,
  `noUnusedParameters`, `--max-warnings=0`). Vitest picks up `src/**/*.test.ts` only, so logic stays out of `.tsx`.
- **Tests come back with their files.** A restored file's tests are restored or ported in the same task. A test that
  is dropped is named in the task's report, with what replaces it.
- Commits: at least one per task, message `area: sentence` as in `git log` (areas here: `world`, `scene`, `lab`,
  `build`, `docs`), ending with the session's attribution trailers. Push after each task.

### The checks

Run after every task, before its commit.

```bash
npx tsc -b && npx eslint . --max-warnings=0 && npm test && npx vite build
```

Expected: no type errors, no lint output, every test passes, the build succeeds.

```bash
git diff --stat origin/claude/trusting-ramanujan-gd0yok...HEAD -- src/engine src/ai src/sim src/state src/ui src/config.ts src/config.design.ts src/App.tsx src/main.tsx src/index.css eslint.config.js vitest.config.ts
```

Expected: prints nothing. The three dots compare with the point where this branch last met the rules branch, so the
rules branch's own changes do not show after a merge.

## Review Focus

Conditions the design implies but does not spell out, most likely first. Each is pinned by tests in the task named.

1. A scene the office cannot hold, or whose counts are odd: more people than desks, a team of none, everyone
   leaving. Nobody is invented or lost; people without a desk are counted on the sign. (Tasks 2, 7)
2. Everything changes at once from one year to the next: people leave, arrive and change team, and the office
   changes. Nobody who stayed changes id or face, and a person who changed team walks to a desk instead of leaving
   and coming back. (Tasks 2, 7)
3. The view is created, hidden, sized to nothing, shown again, loses its graphics context and is disposed twice.
   Nothing is left behind: no listener, no timer, no observer, no geometry. (Task 9)
4. 150 people: 50 drawn in the teams' proportions, 100 on the sign, and the draw calls the report states. (Tasks 2,
   5, 11)
5. No WebGL at all: the lab page says so in plain words and nothing throws. (Tasks 9, 10)

## File structure

| Path | Responsibility |
|---|---|
| `src/world/types/*.ts`, `src/world/types.ts` | The world's own types. `types/scene.ts` is its one input |
| `src/world/cast.ts`, `src/world/sceneEvents.ts`, `src/world/hash.ts` | Pure: the people of a scene, what changed between two scenes, seeded looks |
| `src/scene/officeScene.ts` | Pure: the game's state to an `OfficeScene`. The only file that knows both sides |
| `src/world/core/**` | Art kit, camera, lighting, the systems runner, quality, the resting loop, `World` |
| `src/world/office/**` | The five plans, furniture, pathfinding, the office system |
| `src/world/interaction/**` | Picking and gestures |
| `src/world/people/**` | Figures, seating by team, walking, the crew |
| `src/world/fx/**`, `src/world/ui/**` | Particles, float text, bubbles; the shell, the stage store, card placement |
| `src/world/mountWorld.ts`, `src/world/WorldView.tsx`, `src/world/world.css` | Mounting one world on one canvas |
| `src/world/boundary.test.ts` | The one-way dependency and the first-load rule |
| `office-lab.html`, `src/lab/**` | The lab page: an office from made-up numbers |
| `scripts/world-check.mjs` | The browser checks |
| `docs/superpowers/specs/3d-groundwork-check.md` | What the browser checks measured |

## Shared contract

Every task uses these names exactly.

```ts
// src/world/types/scene.ts (imports nothing)
export type Team = "product" | "growth" | "recruiting";      // the engine's Department, spelt the same
export const TEAMS: readonly Team[] = ["product", "growth", "recruiting"];
export type OfficeIndex = 0 | 1 | 2 | 3 | 4;
export type LookId = "classic";
export interface OfficeScene {
  /** Changes when another company or another game is shown: everything is rebuilt. */
  readonly runId: string;
  /** Seeds every face. The same seed and the same history give the same faces. */
  readonly seed: number;
  readonly year: number;
  readonly office: OfficeIndex;
  /** How many people this office holds: 4, 9, 22, 40 or 150 at the starting numbers. */
  readonly capacity: number;
  /** The era's id. `lookFor(era)` turns it into a look. */
  readonly era: string;
  /** People at work this year, by team. */
  readonly teams: Readonly<Record<Team, number>>;
  /** People away raising money this year (0 or 1). They keep their desk. */
  readonly away: number;
  /** People let go this year. They stand at the door until the year has played out. */
  readonly leaving: number;
  /** Hires expected this year. They wait at the door. */
  readonly arriving: number;
  readonly ending: "won" | "lost" | null;
}

// src/world/types/events.ts
export type SceneEvent =
  | { readonly kind: "run-reset" }
  | { readonly kind: "year-advanced"; readonly from: number; readonly to: number }
  | { readonly kind: "office-changed"; readonly from: OfficeIndex; readonly to: OfficeIndex }
  | { readonly kind: "ended"; readonly ending: "won" | "lost" };

// src/world/cast.ts
export const MAX_STAFF_DRAWN = 50;
export const MAX_WAITING_DRAWN = 6;
export type Standing = "working" | "away" | "leaving" | "waiting";
export interface CastMember {
  readonly id: string;                 // "p0", "p1", ...: never reused within a run
  readonly standing: Standing;
  /** The team whose desks they sit at: set for people working or away, null for people leaving or waiting. */
  readonly team: Team | null;
  readonly look: number;               // hashText32(scene.seed, id)
}
export interface Cast {
  readonly runId: string;
  readonly year: number;
  /** Everyone drawn, in the order they joined. */
  readonly people: readonly CastMember[];
  /** Staff who exist and are not drawn. */
  readonly hidden: number;
  /** Ids in `people` that the previous cast did not have, and ids it had that are gone. Both empty in a fresh cast. */
  readonly arrived: readonly string[];
  readonly left: readonly string[];
  readonly nextId: number;
}
export const nextCast: (prev: Cast | null, scene: OfficeScene) => Cast;

// src/world/sceneEvents.ts
export const sceneEvents: (prev: OfficeScene | null, next: OfficeScene) => SceneEvent[];

// src/world/types/system.ts
export interface WorldFrame { readonly scene: OfficeScene; readonly cast: Cast; readonly events: readonly SceneEvent[] }
export interface WorldSystem {
  applyFrame(next: WorldFrame, prev: WorldFrame | null): void;
  update(dt: number, elapsed: number): void;
  /** True while something of this system is still moving. The loop rests when no system is busy. */
  busy(): boolean;
  dispose(): void;
}

// src/world/types/handle.ts: WorldHandle.setScene(scene: OfficeScene): void replaces setSnapshot

// src/world/types/office.ts: the old OfficeLayout with `phase` replaced by `office: OfficeIndex`; without
// `founderSeat`, `cofounderSeat` and `assetAnchors`; `overflowSpots` renamed `waitingSpots`
// src/world/office/layouts.ts
export const DESKS: readonly number[];                                   // [4, 9, 22, 40, 50]
export const getOfficeLayout: (office: OfficeIndex) => OfficeLayout;     // frozen and cached; an index out of range gives the garage

// src/scene/officeScene.ts
export interface OfficeSceneInput {
  readonly game: GameState;
  readonly companyId: CompanyId;
  readonly config: RulesConfig;
  /** The game's seed. The store has it; the state does not. */
  readonly seed: number;
  /** The plan being drafted for the coming year. Without one, the company's last plan. */
  readonly draft?: Plan;
  /** Hires the projection expects for that plan. 0 without one. */
  readonly expectedHires?: number;
}
export const officeSceneFor: (input: OfficeSceneInput) => OfficeScene;
```

---

### Task 1: three comes back, the boundary is fenced, the leaves are restored

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create (restored unchanged from `63b4bed`): `src/world/core/math.ts`, `src/world/core/adaptiveQuality.ts`,
  `src/world/core/adaptiveQuality.test.ts`, `src/world/core/lightingState.ts`, `src/world/hash.ts`,
  `src/world/types/geometry.ts`, `src/world/types/fx.ts`
- Test: `src/world/hash.test.ts`, `src/world/boundary.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `mix32`, `hashText32(seed, text)` and the other exports of `hash.ts` as they were; the boundary test
  every later task runs under.

- [ ] **Step 1: Install three at exact versions**

```bash
npm install --save-exact three@0.187.0 && npm install --save-dev --save-exact @types/three@0.187.0
```

Expected: `package.json` has `"three": "0.187.0"` and `"@types/three": "0.187.0"`, with no caret.

- [ ] **Step 2: Write the tests**

```ts
// src/world/hash.test.ts
it("gives the same number for the same seed and text, every time", () => {
  expect(hashText32(7, "p0")).toBe(hashText32(7, "p0"));
  expect(Number.isInteger(hashText32(7, "p0")) && hashText32(7, "p0") >= 0 && hashText32(7, "p0") <= 0xffffffff).toBe(true);
});
it("tells neighbours apart: p0 to p49 under one seed share no value, and their low byte takes at least 40 values", () => { /* … */ });
it("changes with the seed", () => { expect(hashText32(7, "p0")).not.toBe(hashText32(8, "p0")); });

// src/world/boundary.test.ts: reads the source files with node:fs and resolves every relative import
it("three is imported only under src/world", () => { /* every .ts and .tsx under src, tests included */ });
it("the world imports nothing from the rules, the store, the screens, the scene builder or the lab", () => {
  /* no file under src/world imports from src/engine, src/ai, src/sim, src/state, src/scene, src/ui, src/lab, src/config or src/config.design */
});
it("the scene builder never imports three, and from the world only types under src/world/types", () => {
  /* every file under src/scene that is not a test; its tests may also import the world's pure modules */
});
it("no chain of static imports from src/main.tsx reaches src/world or three", () => {
  /* follow `import … from` and `export … from`; a dynamic `import()` is where a chain is allowed to stop */
});
```

- [ ] **Step 3: Run them.** `npx vitest run src/world` — Expected: `hash.test.ts` fails (no `hash.ts`); the
  boundary tests pass on an empty `src/world`. To see that the boundary test can fail, add a scratch file under
  `src/world` that imports `../engine/types`, run it, and delete the file.

- [ ] **Step 4: Restore the seven files** with `git show 63b4bed:<path> > <path>`. They change no line.

- [ ] **Step 5: Run the tests, then the checks.** Expected: `adaptiveQuality.test.ts` passes its 44 tests.

- [ ] **Step 6: Commit**

```bash
git commit -m "world: three is back at an exact version, with the first restored files and a fenced boundary"
```

---

### Task 2: The scene, the cast and what changed

**Files:**
- Create: `src/world/types/scene.ts`, `src/world/types/events.ts`, `src/world/cast.ts`, `src/world/sceneEvents.ts`
- Create (restored with the inventory's edits): `src/world/types/office.ts`, `types/interaction.ts`,
  `types/seating.ts`, `types/system.ts`, `types/handle.ts`, and the barrel `src/world/types.ts`
- Not restored: `types/snapshot.ts`, `snapshot.ts`, `events.ts`, `names.ts`, `outcomes.ts`, `phase.ts` and their
  tests. `cast.test.ts` and `sceneEvents.test.ts` replace them.
- Test: `src/world/cast.test.ts`, `src/world/sceneEvents.test.ts`

**Interfaces:**
- Consumes: `hashText32` (Task 1).
- Produces: everything in "Shared contract" down to `WorldHandle.setScene`. `InteractableTarget` becomes
  `{ kind: "person"; personId: string } | { kind: "desk"; desk: number } | { kind: "team"; team: Team } | { kind: "station"; station: StationKind } | { kind: "door" } | { kind: "sign" }`.

The cast's rules, each a ruling to write at the top of `cast.ts`:

1. The scene's people are five groups, in this order: Product, Growth, Recruiting, away, leaving. `total` is their
   sum. `staff = min(total, MAX_STAFF_DRAWN)` of them are drawn, shared out between the groups by largest
   remainder, ties to the earlier group. `hidden = total − staff`.
2. A fresh cast (no previous cast, another `runId`, or an earlier year) numbers people `p0`, `p1`, … group by group.
   People away get the team Product. `arrived` and `left` are empty: everyone is simply there.
3. Otherwise, from the previous cast. When the year has moved on, the people who were leaving have left before
   anything else is worked out. Then each group keeps its longest-serving members, up to its share; the rest are
   released, most recent joiner first. Groups that are short take released people, group by group in the order
   above, people released from work or from being away before people released from leaving, longest-serving first.
   Released people nobody takes have left. Groups still short take the people waiting at the door, longest-waiting
   first, and then new ids. So within a year a planned layoff can be undone and the same person returns; once the
   year has played out, that person is gone and a hire is someone new.
4. A person who goes from working to away keeps their team. A person who returns to work takes the team of the
   group that took them.
5. `min(scene.arriving, MAX_WAITING_DRAWN)` people wait at the door: those already waiting stay, longest-waiting
   first; any others have left; new ones get new ids.
6. `people` is in id order. `look` is `hashText32(scene.seed, id)`.

- [ ] **Step 1: Write the failing tests**

```ts
const scene = (teams: [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "r", seed: 7, year: 1990, office: 0, capacity: 4, era: "dial-up",
  teams: { product: teams[0], growth: teams[1], recruiting: teams[2] }, away: 0, leaving: 0, arriving: 0, ending: null, ...patch });
const who = (cast: Cast) => cast.people.map((p) => `${p.id}:${p.standing}:${p.team ?? "-"}`);
const play = (...scenes: OfficeScene[]) => scenes.reduce<Cast | null>((cast, next) => nextCast(cast, next), null)!;

it("a fresh cast numbers people group by group, and nobody has arrived", () => {
  const cast = nextCast(null, scene([2, 1, 1], { away: 1, leaving: 1, arriving: 2 }));
  expect(who(cast)).toEqual(["p0:working:product", "p1:working:product", "p2:working:growth", "p3:working:recruiting",
    "p4:away:product", "p5:leaving:-", "p6:waiting:-", "p7:waiting:-"]);
  expect([cast.hidden, cast.arrived, cast.left, cast.nextId]).toEqual([0, [], [], 8]);
});
it("a face comes from the seed and the id", () => {
  expect(nextCast(null, scene([3, 0, 0])).people[1].look).toBe(hashText32(7, "p1"));
});
it("a move between teams keeps the person: the most recent joiner of the team that shrank goes", () => {
  expect(who(play(scene([3, 0, 0]), scene([2, 1, 0])))).toEqual(["p0:working:product", "p1:working:product", "p2:working:growth"]);
});
it("a planned layoff sends the most recent joiner to the door, and undoing it brings the same person back", () => {
  const planned = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1 }));
  expect(who(planned)[4]).toBe("p4:leaving:-");
  expect(who(nextCast(planned, scene([3, 2, 0])))[4]).toBe("p4:working:growth");
});
it("when the year has played out, the person leaving has left", () => {
  const after = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1 }), scene([3, 1, 0], { year: 1991 }));
  expect([after.people.map((p) => p.id), after.left]).toEqual([["p0", "p1", "p2", "p3"], ["p4"]]);
});
it("someone away keeps their team and comes back to it", () => {
  const away = play(scene([3, 2, 0]), scene([3, 1, 0], { away: 1 }));
  expect(who(away)[4]).toBe("p4:away:growth");
  expect(who(nextCast(away, scene([3, 2, 0], { year: 1991 })))[4]).toBe("p4:working:growth");
});
it("people expected wait at the door, and the ones hired walk in from there", () => {
  const waiting = play(scene([2, 1, 0]), scene([2, 1, 0], { arriving: 2 }));
  expect([who(waiting).slice(3), waiting.arrived]).toEqual([["p3:waiting:-", "p4:waiting:-"], ["p3", "p4"]]);
  const hired = nextCast(waiting, scene([3, 2, 0], { year: 1991 }));
  expect([who(hired).slice(3), hired.arrived, hired.left]).toEqual([["p3:working:product", "p4:working:growth"], [], []]);
});
it("fewer hired than expected: the rest walk away", () => {
  const cast = play(scene([2, 1, 0]), scene([2, 1, 0], { arriving: 2 }), scene([3, 1, 0], { year: 1991 }));
  expect([who(cast)[3], cast.left]).toEqual(["p3:working:product", ["p4"]]);
});
it("more hired than waited at the door: new people arrive, and an id is never used twice", () => {
  const cast = play(scene([3, 2, 0]), scene([3, 1, 0], { leaving: 1 }), scene([3, 3, 0], { year: 1991 }));
  expect([cast.people.map((p) => p.id), cast.arrived, cast.left]).toEqual([["p0", "p1", "p2", "p3", "p5", "p6"], ["p5", "p6"], ["p4"]]);
});
it("draws 50 of 150 in the teams' proportions and counts the rest (Review Focus 4)", () => {
  const cast = nextCast(null, scene([75, 60, 15], { office: 4, capacity: 150 }));
  const count = (team: Team) => cast.people.filter((p) => p.team === team).length;
  expect([cast.people.length, count("product"), count("growth"), count("recruiting"), cast.hidden]).toEqual([50, 25, 20, 5, 100]);
});
it("at the cap a year in which the hidden ones change leaves the drawn ones alone", () => {
  const next = play(scene([75, 60, 15], { office: 4, capacity: 150 }), scene([72, 58, 14], { office: 4, capacity: 150, year: 1991 }));
  expect([next.arrived, next.left, next.hidden]).toEqual([[], [], 94]);
});
it("shares odd numbers out by largest remainder, ties to the earlier team", () => {
  const cast = nextCast(null, scene([34, 33, 33], { office: 4, capacity: 150 }));
  expect(TEAMS.map((team) => cast.people.filter((p) => p.team === team).length)).toEqual([17, 17, 16]);
});
it("at most six wait at the door, whatever is expected", () => {
  expect(nextCast(null, scene([3, 0, 0], { arriving: 20 })).people.filter((p) => p.standing === "waiting")).toHaveLength(6);
});
it("another run, or an earlier year, starts afresh", () => {
  const first = play(scene([3, 0, 0]), scene([4, 0, 0], { year: 1991 }));
  for (const fresh of [nextCast(first, scene([2, 0, 0], { runId: "other" })), nextCast(first, scene([2, 0, 0], { year: 1990 }))]) {
    expect([fresh.people.map((p) => p.id), fresh.arrived, fresh.left, fresh.nextId]).toEqual([["p0", "p1"], [], [], 2]);
  }
});
it("a company with nobody has an empty cast (Review Focus 1)", () => {
  expect(nextCast(null, scene([0, 0, 0])).people).toEqual([]);
  const emptied = play(scene([3, 0, 0]), scene([0, 0, 0], { year: 1991, ending: "lost" }));
  expect([emptied.people, emptied.left]).toEqual([[], ["p0", "p1", "p2"]]);
});

// sceneEvents.test.ts
it("the first scene has no events", () => { expect(sceneEvents(null, scene([3, 0, 0]))).toEqual([]); });
it("a changed plan within the year is no event", () => { expect(sceneEvents(scene([3, 0, 0]), scene([2, 1, 0]))).toEqual([]); });
it("a year, a move and an ending come in that order", () => {
  expect(sceneEvents(scene([3, 0, 0]), scene([5, 0, 0], { year: 1991, office: 1, capacity: 9, ending: "lost" }))).toEqual([
    { kind: "year-advanced", from: 1990, to: 1991 }, { kind: "office-changed", from: 0, to: 1 }, { kind: "ended", ending: "lost" }]);
});
it("another run, or an earlier year, is a reset and nothing else", () => {
  expect(sceneEvents(scene([3, 0, 0]), scene([3, 0, 0], { runId: "other", office: 2 }))).toEqual([{ kind: "run-reset" }]);
  expect(sceneEvents(scene([3, 0, 0], { year: 1995 }), scene([3, 0, 0], { year: 1990 }))).toEqual([{ kind: "run-reset" }]);
});
it("an ending is reported once", () => {
  expect(sceneEvents(scene([3, 0, 0], { ending: "won" }), scene([3, 0, 0], { ending: "won" }))).toEqual([]);
});
```

- [ ] **Step 2: Run them to see them fail.** `npx vitest run src/world/cast.test.ts src/world/sceneEvents.test.ts` —
  Expected: FAIL (`./cast` does not exist).

- [ ] **Step 3: Implement** the two pure files, then the types layer as one step, because the barrel needs all of it
  (the inventory's core section, steps 1 and 2 of its order, lists each file's edits).

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -m "world: an office scene as the one input, with a cast that keeps every face from year to year"
```

---

### Task 3: The scene builder

**Files:**
- Create: `src/scene/officeScene.ts`
- Test: `src/scene/officeScene.test.ts`

**Interfaces:**
- Consumes: `OfficeScene` (Task 2); from `src/engine/index.ts`: the types, `yearOf`, `eraIndexOf`, and the engine's
  own plan check, `normalizePlan(game, companyId, draft ?? null, config)`, whose `.plan` is the plan as the year
  will play it (with `null` it resolves the company's last plan). Tests use `src/engine/careerKit.ts`.
- Produces: `officeSceneFor`. It throws `Error("an office scene needs a career game")` for a config without a career
  or a company without career facts. `runId` is `` `${seed}:${companyId}:${career.founded}` ``. `year` is
  `yearOf(game.turn, career)`. `office` is the company's `career.office`, kept within 0 to 4, and `capacity` that
  office's. `era` is the id of the turn's era. The plan shown is the draft, or without one the company's last plan,
  as the engine's plan check resolves it for this turn: `teams` is its allocation, `away` is 1 when it raises,
  `leaving` its layoffs. `arriving` is `expectedHires`, as a whole number not below 0. `ending` is `"won"` when the
  outcome names this company, `"lost"` when it names another or the company is out, else null.

- [ ] **Step 1: Merge the rules branch in.** `git fetch origin claude/trusting-ramanujan-gd0yok && git merge --no-edit FETCH_HEAD`

- [ ] **Step 2: Write the failing tests**

```ts
const sceneOf = (game: GameState, companyId: CompanyId, extra: Partial<OfficeSceneInput> = {}) =>
  officeSceneFor({ game, companyId, config: CAREER_TEST, seed: 7, ...extra });

it("a new career opens in the garage, in 1990, with the team its last plan gave it", () => {
  const game = newCareer();
  expect(sceneOf(game, 0)).toEqual({ runId: "7:0:1", seed: 7, year: 1990, office: 0, capacity: 4, era: "flat",
    teams: normalizePlan(game, 0, null, CAREER_TEST).plan.allocation, away: 0, leaving: 0, arriving: 0, ending: null });
});
it("the people always add up to the head count", () => {
  // every company of a new career, and again after each of five years played on everyone's default plan
  for (const { game, id } of everyCompanyOverFiveYears) {
    const s = sceneOf(game, id);
    expect(s.teams.product + s.teams.growth + s.teams.recruiting + s.away + s.leaving).toBe(game.companies[id].headcount);
  }
});
it("shows a draft as the engine will play it", () => {
  // a draft that raises 20% and lays one person off, for a company of 8 allowed to raise
  expect(sceneOf(game, 3, { draft })).toMatchObject({ away: 1, leaving: 1 });
  // a draft whose teams do not add up is refitted, not shown as written
  expect(Object.values(sceneOf(game, 3, { draft: lopsided }).teams).reduce((a, b) => a + b, 0)).toBe(game.companies[3].headcount);
});
it("the office and its size come from the company's career and the config's offices", () => {
  expect(sceneOf(withCareerOf(newCareer(), 0, { office: 3 }), 0)).toMatchObject({ office: 3, capacity: 40 });
  expect(sceneOf(withCareerOf(newCareer(), 0, { office: 9 }), 0)).toMatchObject({ office: 4, capacity: 150 });
});
it("names the era of the year", () => { /* withEras: "a" from 1990, "b" from 1993; turn 3 gives "a", turn 4 gives "b" */ });
it("expected hires are whole and never negative", () => {
  expect([2.7, -1, undefined].map((expectedHires) => sceneOf(newCareer(), 0, { expectedHires }).arriving)).toEqual([2, 0, 0]);
});
it("says how it ended", () => { /* outcome winner 0: "won" for 0, "lost" for 1; a company that is out: "lost", teams all 0 */ });
it("a race game has no office scene", () => {
  expect(() => officeSceneFor({ game: newGame(), companyId: 0, config: DESIGN, seed: 7 })).toThrow("an office scene needs a career game");
});
it("the world's team names are the engine's departments", () => { expect([...TEAMS]).toEqual([...DEPARTMENTS]); });
```

- [ ] **Step 3: Run them to see them fail**, implement, run them and the checks. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -m "scene: the game's state as an office scene, checked against the engine's own plan rules"
```

---

### Task 4: The art kit and the core

**Files:**
- Create (restored; edits per the inventory's core section): `src/world/core/colors.ts`, `materials.ts`,
  `geometry.ts`, `textures.ts`, `models.ts`, `sharedResources.ts`, `palette.ts`, `SystemRunner.ts`,
  `SystemRunner.test.ts`, `rendererLook.ts`, `CameraRig.ts`, `CameraRig.test.ts`, `Lighting.ts`, `Lighting.test.ts`

**Interfaces:**
- Consumes: Task 2's types.
- Produces: the art kit as it was, with `ROLE_COLORS` keyed by `Team` and the tables that were keyed by company phase
  keyed by `(office: OfficeIndex, look: LookId)`; `lookFor(era: string): LookId` in `colors.ts` (every era gives
  `"classic"` in this plan); `SystemRunner` calling `applyFrame` and reporting `busy()` as true while any system is;
  `Lighting` with one resting daytime look for each office, no clock, and the old slow fade on `ended`.

- [ ] **Step 1: Restore the test files first, with their edits,** and run them. Expected: FAIL (the files under test
  do not exist).
- [ ] **Step 2: Restore the files** in the inventory's order (its steps 3 to 5). Keep the old exported names: files in
  other folders import them.
- [ ] **Step 3: Add the new tests**

```ts
it("the runner is busy while any system is, and rests when none is", () => { /* two stub systems */ });
it("a system that throws is reported and the others still run", () => { /* kept from the old test */ });
it("every era has a look", () => { expect(["dial-up", "ambient", "anything"].map(lookFor)).toEqual(["classic", "classic", "classic"]); });
it("each team has its own colour", () => { expect(new Set(TEAMS.map((team) => ROLE_COLORS[team])).size).toBe(3); });
it("lighting has no clock: two frames a year apart give the same light", () => { /* same office, year + 1 */ });
```

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS. The camera's framing tests that call the old
  `getOfficeLayout(phase, assets)` move to Task 5, where the layouts are.
- [ ] **Step 5: Commit**

```bash
git commit -m "world: the art kit, camera, lighting and systems runner restored"
```

---

### Task 5: The five offices

**Files:**
- Create (restored; edits per the inventory's office section): everything under `src/world/office` except
  `AssetSlots.ts` and `props/assets.ts`, which are dropped; `OfficeStage.ts` and `OfficeSystem.test.ts` are rewritten.
  `src/world/core/layoutBounds.ts` and its test come with this task.
- Modify: `src/scene/officeScene.test.ts` (the cross-check in Step 4)
- Test: the restored `layouts.test.ts`, `props.test.ts`, `pathfinding` tests, `OfficeSystem.test.ts`, plus the new
  tests below.

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces: `getOfficeLayout(office)` and `DESKS` as in "Shared contract"; `OfficeSystem`, which rebuilds the office
  on `office-changed` and `run-reset` (instantly on the first frame, on a reset and under reduced motion; with the old
  sink-and-rise otherwise) and shows `hiddenCount` on the sign beside the door.

What changes in the plans, and nothing else:

1. The five plans are an array by office index. The founder's and cofounder's seats join `deskSeats`. The garage and
   the shared office each lose one desk, and the full floor gains a pair on its last bench (the inventory records
   the one clash that causes and its fix), so the desks are 4, 9, 22, 40 and 50.
2. `deskSeats` stays in fill order, bench by bench: Task 7 seats teams along it.
3. The beanbag spots become `waitingSpots`, where people leaving and people expected stand. The beanbags go.
4. The purchasable assets go, with their floor patches, obstacles and framing.
5. The eight stations keep their places and sizes as obstacles and furniture. They lose their command plates, their
   labels and their old-game behaviour, and `OfficeStage` no longer reads game values into them. The coffee machine
   stays the spot people wander to.
6. A desk's accent colour is its team's (Task 7 says which team a desk belongs to); a desk no team has is neutral.

- [ ] **Step 1: Restore `layouts.test.ts` with its edits, and add:**

```ts
it("each office has as many desks as it holds, and the campus as many as are drawn", () => {
  expect([0, 1, 2, 3, 4].map((office) => getOfficeLayout(office as OfficeIndex).deskSeats.length)).toEqual([4, 9, 22, 40, 50]);
  expect(DESKS).toEqual([4, 9, 22, 40, 50]);
});
it("at least four people can stand at the door in every office", () => { /* waitingSpots.length >= 4 */ });
it("every desk, waiting spot and wander spot can be walked to from the door", () => { /* findPath, all five */ });
it("an index out of range gives the garage", () => { expect(getOfficeLayout(9 as OfficeIndex)).toBe(getOfficeLayout(0)); });
it("no plan knows a founder or an asset", () => { /* no key named founderSeat, cofounderSeat or assetAnchors */ });
```

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL (`./layouts` does not exist).
- [ ] **Step 3: Restore and edit** in the inventory's order for this folder: layouts, footprints and pathfinding
  first; then the props; then `DeskSlots`, dressing, shell, the stage kit; then `OfficeStage` and `OfficeSystem`.
- [ ] **Step 4: New tests for the system**

```ts
it("builds the office of the frame, and rebuilds it when the office changes", () => { /* a real three Scene in node, as the old test does */ });
it("the first office appears at once; a later one sinks and rises unless motion is reduced", () => { /* busy() true during the swap, false after */ });
it("the sign by the door shows how many people are not drawn, and nothing when all are", () => { /* 100, then 0 */ });
it("no station carries a command or a label from the old game", () => { /* no registered target label contains ">" or an old command word */ });

// src/scene/officeScene.test.ts: the world may not read the engine, so the two sides are checked against each other here
it("the world has a desk for everyone an office holds, up to the figures it draws", () => {
  expect(DESKS).toEqual(CAREER_RULES.offices.map((office) => Math.min(office.capacity, MAX_STAFF_DRAWN)));
});
```

- [ ] **Step 5: Run the tests, then the checks.** Expected: PASS, with the layout rules (nothing overlaps, 0.9 clear
  behind each seat, every seat reachable) holding for all five plans.
- [ ] **Step 6: Commit**

```bash
git commit -m "world: the five offices, for 4, 9, 22, 40 and 150 people"
```

---

### Task 6: Picking and gestures

**Files:**
- Create (restored; six unchanged, tests with the inventory's edits): everything under `src/world/interaction`

**Interfaces:**
- Consumes: Task 2 (`InteractableTarget`).
- Produces: `Interaction` as it was. It reports what was tapped and never acts on it.

- [ ] **Step 1: Restore `Interaction.test.ts` with its edits** (the nine old station target literals) and add:

```ts
it("a tap inside a team's area that hits no figure picks the team", () => { /* a registered { kind: "team" } box behind a person box */ });
it("a figure in front of a team's area wins the tap", () => { /* the same, tapping the figure */ });
```

- [ ] **Step 2: Run to see them fail, restore the files, run again.** Expected: 36 tests pass (the old 34 and these
  two), with the path follower untouched.
- [ ] **Step 3: Run the checks and commit**

```bash
git commit -m "world: picking and gestures restored, with a team's area as something to tap"
```

---

### Task 7: The people

**Files:**
- Create (restored; edits per the inventory's people section): `src/world/people/random.ts`, `pathFollower.ts`,
  `pathFollower.test.ts`, `approach.ts`, `seating.ts`, `seating.test.ts`, `Character.ts`, `Character.test.ts`,
  `actor.ts`, `actor.test.ts`, `crew.ts`, `crew.test.ts`, `EmployeeSystem.ts`, `EmployeeSystem.test.ts`
- Create (rewritten): `src/world/people/testKit.ts`, on scenes and casts
- Not restored: `markers.ts`, `footfall.ts` and their tests (old staff stats; sound)

**Interfaces:**
- Consumes: the cast (Task 2), the layouts (Task 5), the art kit (Task 4).
- Produces: `SeatingPlan.reconcile(cast, layout)`, `seatOf(id): { kind: "desk" | "waiting"; index: number } | null`,
  `teamOfDesk(index): Team | null`, `hiddenCount(): number`; `EmployeeSystem`, which draws one figure for each cast
  member with a seat.

Seating, each a ruling to write at the top of `seating.ts`:

1. Desks are taken in fill order. Product has the first desks, Growth the next, Recruiting the next, each as many as
   it has people working or away. That run of desks is the team's area, and `teamOfDesk` reports it.
2. A person whose desk is still in their team's area keeps it. The others give their desks up first, and then
   take, in id order, the lowest free desk of their team's area. So when one person changes team, at most two
   people walk.
3. Someone away keeps a desk and is not drawn at it: the chair is empty and the screen dark.
4. People leaving stand on the waiting spots nearest the door, then people expected. More of them than spots: the
   rest have no seat and are not drawn.
5. More people working than desks: the last ones in fill order have no seat. `hiddenCount()` is `cast.hidden` plus
   the working people without a seat.
6. In another office everyone is seated afresh, in id order, by the same rules.

How the crew moves, replacing the old scripted reactions: a member in `cast.arrived` walks in through the door; a
member in `cast.left` walks out, carrying a box if they were working; a member whose seat changed walks to it; a
member whose team changed changes shirt (`Character.setTeam`); on a fresh cast, a reset or reduced motion everyone is
simply placed. The door queue, the staggered arrivals and the walk watchdogs stay as they were.

- [ ] **Step 1: Write the failing seating tests**

```ts
const seats = (plan: SeatingPlan, cast: Cast) => cast.people.map((p) => { const s = plan.seatOf(p.id); return s === null ? `${p.id}:-` : `${p.id}:${s.kind}${s.index}`; });

it("teams sit along the benches in order: Product, then Growth, then Recruiting", () => {
  // the shared office, nine desks; a fresh cast of 3 / 2 / 1
  expect(seats(plan, cast)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk3", "p4:desk4", "p5:desk5"]);
  expect([0, 3, 5, 6].map((desk) => plan.teamOfDesk(desk))).toEqual(["product", "growth", "recruiting", null]);
});
it("a person who changes team keeps the desk when it falls in the new team's area", () => {
  // 3 / 0 / 0 becomes 2 / 1 / 0: p2 is now Growth, and desk 2 is Growth's first
  expect(seats(plan, moved)[2]).toBe("p2:desk2");
});
it("when a team grows, only the people its area displaces walk (Review Focus 2)", () => {
  // 3 / 2 / 0, then a hire into Product: p3 gives up desk 3 for desk 5, the newcomer p5 takes desk 3
  expect(seats(plan, grown)).toEqual(["p0:desk0", "p1:desk1", "p2:desk2", "p3:desk5", "p4:desk4", "p5:desk3"]);
});
it("someone away keeps the desk", () => { /* seatOf("p4") is the same desk before, during and after */ });
it("people leaving stand nearest the door, then people expected", () => { /* waiting0 for the leaver, waiting1 and waiting2 for two expected */ });
it("more people at the door than spots: the rest are not drawn", () => { /* the garage's four spots, six waiting */ });
it("more people working than desks: the last have no seat and are counted (Review Focus 1)", () => {
  // six working people in the garage's four desks
  expect([seats(plan, crowded).slice(4), plan.hiddenCount()]).toEqual([["p4:-", "p5:-"], 2]);
});
it("another office seats everyone afresh, teams together (Review Focus 2)", () => { /* after scattered moves, the full floor: desks 0..n-1 in team order */ });
it("the count on the sign is the people not drawn plus the people without a seat", () => { /* cast.hidden 100, none unseated: 100 */ });
```

- [ ] **Step 2: Run them to see them fail,** then restore in the inventory's order for this folder: `random` and
  `pathFollower`; `approach` and `seating`; `Character`; `actor`; the new `testKit`; `crew`; `EmployeeSystem`.
- [ ] **Step 3: Port the old tests and add**

```ts
it("the same cast member has the same face in every office and every year", () => { /* deriveLook from the cast's look */ });
it("a shirt is the team's colour, and changing team changes the shirt and nothing else", () => { /* Character.setTeam */ });
it("someone who arrives walks in from the door; someone who leaves walks out and is gone", () => { /* crew, then EmployeeSystem's figure count */ });
it("someone whose desk changed walks to it; nobody else gets up", () => { /* the grown case above */ });
it("a fresh cast, a reset and reduced motion place everyone without a walk", () => { /* busy() is false at once */ });
it("the system is busy while anyone is walking or settling, and rests when all are still", () => { /* busy() */ });
it("a figure exists for every cast member with a seat, and for nobody else", () => { /* 50 drawn at the campus, 100 on the sign */ });
```

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS, the path follower's 14 tests among them.
- [ ] **Step 5: Commit**

```bash
git commit -m "world: the people restored, seated by team and moved by the cast"
```

---

### Task 8: Effects and the shell

**Files:**
- Create (restored; edits per the inventory's last section): `src/world/fx/particles.ts`, `format.ts`,
  `bubbleIcons.ts`, `BubbleLayer.ts`, `FloatTextLayer.ts`, `ParticleRenderer.ts`, `FxSystem.ts`, `FxSystem.test.ts`;
  `src/world/ui/placement.ts`, `placement.test.ts`, `stage.ts`, `environment.ts`, `WorldShell.tsx`
- Create: `src/world/world.css` (the old `.world-viewport` and the classes the shell uses, taken from the old
  `src/index.css`), `src/world/ui/environment.test.ts`, `src/world/ui/stage.test.ts`
- Not restored: the inspector, the HUD, the overlay, the hover chip, the selection keeper, the action signal, the
  world sounds and their tests (old commands, old store, sound)

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces: `FxApi` as it was (burst, stream, float text, bubble, shake); `FxSystem` reacting to three things only: a
  float "+N" at the door when N people arrive, "−N" when N leave, and the old dust when the office rises;
  `WorldShell` with its placeholder, its note when 3D is not available and its error boundary, in words that do not
  mention a terminal.

- [ ] **Step 1: Restore the tests with their edits and add**

```ts
it("says how many arrived and how many left, once each, at the door", () => { /* a frame with arrived 2, left 1: two float texts, "+2" and "−1" */ });
it("a fresh cast says nothing", () => { /* no float text on the first frame */ });
it("detects reduced motion, a fine pointer and the quality to start from", () => { /* stubbed matchMedia, screen and navigator */ });
it("the stage store hands the latest anchor to whoever asks, and forgets it on reset", () => { /* stage.ts */ });
```

- [ ] **Step 2: Run to see them fail, restore, run again, run the checks.** Expected: PASS, with the particle
  simulation's 23 tests and the placement's 14 among them.
- [ ] **Step 3: Commit**

```bash
git commit -m "world: effects and the shell restored, without the old game's cards and sounds"
```

---

### Task 9: One world on one canvas, resting when nothing moves

**Files:**
- Create: `src/world/core/rest.ts`, `src/world/core/rest.test.ts`
- Create (restored with edits): `src/world/core/World.ts`, `src/world/WorldView.tsx`
- Create (rewritten): `src/world/mountWorld.ts`, `src/world/mountWorld.test.ts`

**Interfaces:**
- Consumes: every system above.
- Produces:

```ts
// src/world/core/rest.ts
export const REST_AFTER_SECONDS = 1;
export interface RestState { readonly running: boolean; readonly quiet: number }
export const AWAKE: RestState;
/** One frame's worth: `busy` is whether any system or the camera is still moving, `woken` whether something asked for a frame. */
export const restStep: (state: RestState, frame: { readonly dt: number; readonly busy: boolean; readonly woken: boolean }) => RestState;

// src/world/mountWorld.ts
export interface SceneSource { get(): OfficeScene; subscribe(listener: () => void): () => void }
export const mountWorld: (canvas: HTMLCanvasElement, viewport: HTMLElement, stage: WorldStage, source: SceneSource) => () => void;

// src/world/WorldView.tsx: default export, props { source: SceneSource }, loaded lazily by whoever shows it
```

  `World.setScene(scene)` works out the cast (`nextCast`) and the events (`sceneEvents`), picks the layout, and hands
  every system one `WorldFrame`. The loop draws frames while it is running in the sense of `restStep`; a new scene, a
  pointer event, a resize, a change of quality and a restored context each wake it. At rest nothing is drawn: this is
  the design's "redrawn only when something changes". Only one world exists at a time, because the art kit's caches
  belong to the module.

- [ ] **Step 1: Write the failing tests**

```ts
// rest.test.ts
it("keeps running while something moves", () => { /* busy frames for 10 s: still running */ });
it("rests one second after the last movement", () => {
  let state = AWAKE;
  for (let i = 0; i < 59; i++) state = restStep(state, { dt: 1 / 60, busy: false, woken: false });
  expect(state.running).toBe(true);
  state = restStep(state, { dt: 2 / 60, busy: false, woken: false });
  expect(state.running).toBe(false);
});
it("wakes when asked, and when something starts to move", () => { /* from rest: woken, or busy, gives running with quiet 0 */ });
it("a long frame counts as it is, not as a second of quiet", () => { /* dt is taken as given; World clamps it before */ });

// mountWorld.test.ts, with the old fake handle and the stubbed window, document, ResizeObserver and IntersectionObserver
it("feeds the world its first scene, and every later one", () => { /* setScene called once at mount, again on each change */ });
it("resizes with the viewport, skipping sizes of nothing and repeats", () => { /* handle.resize */ });
it("pauses when the page is hidden or the view is off screen", () => { /* handle.setPaused */ });
it("leaves nothing behind when it is torn down, twice over, or when a step of the teardown throws (Review Focus 3)", () => { /* expectNothingLeft */ });
it("says the view is not supported when no context can be had, and throws nothing (Review Focus 5)", () => { /* createWorld throws WorldUnsupportedError: stage status "unsupported" */ });
it("an office index out of range shows the garage", () => { /* through the layout's own rule */ });
```

- [ ] **Step 2: Run them to see them fail, then implement.** `World.ts` keeps its proven parts as the inventory
  lists them: the context is acquired before the renderer is built; the render loop clamps a frame to 0.1 s; the
  dispose order is unchanged, the second pass over materials included; a lost context stops the loop and a restored
  one wakes it. React renders the canvas, and a lost context is answered by a keyed remount ("Reload 3D view").
- [ ] **Step 3: Run the tests, then the checks.** Expected: PASS. `World.ts` itself is covered by Task 11 in a real
  browser, as it always was.
- [ ] **Step 4: Commit**

```bash
git commit -m "world: one world on one canvas, drawn only while something moves"
```

---

### Task 10: The lab page

**Files:**
- Create: `office-lab.html`, `src/lab/main.tsx`, `src/lab/OfficeLab.tsx`, `src/lab/labScene.ts`
- Modify: `vite.config.ts` (`build.rollupOptions.input: { main: "index.html", lab: "office-lab.html" }`)
- Test: `src/lab/labScene.test.ts`

**Interfaces:**
- Consumes: `WorldView`, `WorldShell`, `OfficeScene`, `DESKS`.
- Produces: a page at `/office-lab.html`, not linked from the game, that shows one office from numbers typed into it
  or given in its address. It does not use the game's state or its store.

```ts
// src/lab/labScene.ts (pure)
export const CAPACITY: readonly number[];                              // [4, 9, 22, 40, 150]: the lab's own copy
export const sceneFromQuery: (query: string) => OfficeScene;          // ?office=2&product=9&growth=8&recruiting=3&away=1&leaving=0&arriving=2&year=2004&era=bust&seed=7
export const queryFromScene: (scene: OfficeScene) => string;
/** The year plays out: people leaving leave, people expected are hired into the smallest team, nobody is away, the
    year goes up by one, and the office is the smallest that holds everyone. */
export const endYear: (scene: OfficeScene) => OfficeScene;
```

  On the page: steppers for the three teams, away, leaving and expected hires; the office (worked out from the head
  count, or forced); the year, the era id and the seed; "End year"; "Reset"; a switch that keeps the loop running
  (for looking at idle movement); a line of figures read from the renderer (draw calls, triangles, people drawn and
  counted, frames drawn in the last second); the scene as JSON. `window.__officeLab` gives the browser checks
  `ready` (a promise), `setScene(scene)`, `stats()`, `loseContext()` and `restoreContext()`. Without WebGL the page
  shows the shell's note and the controls still work.

- [ ] **Step 1: Write the failing tests**

```ts
it("reads a scene from the address, and writes the same address back", () => {
  const query = "?office=2&product=9&growth=8&recruiting=3&away=1&leaving=0&arriving=2&year=2004&era=bust&seed=7";
  expect(sceneFromQuery(query)).toEqual({ runId: "lab:7", seed: 7, year: 2004, office: 2, capacity: 22, era: "bust",
    teams: { product: 9, growth: 8, recruiting: 3 }, away: 1, leaving: 0, arriving: 2, ending: null });
  expect(queryFromScene(sceneFromQuery(query))).toBe(query);
});
it("an empty address is three people in a garage in 1990", () => {
  expect(sceneFromQuery("")).toMatchObject({ year: 1990, office: 0, capacity: 4, teams: { product: 3, growth: 0, recruiting: 0 } });
});
it("nonsense in the address is read as nothing: no negative people, no office 9, no NaN (Review Focus 1)", () => {
  expect(sceneFromQuery("?office=9&product=-4&growth=abc&year=x")).toMatchObject({ office: 0, year: 1990, teams: { product: 0, growth: 0, recruiting: 0 } });
});
it("ending a year hires, lets go, and moves when the room is too small", () => {
  const before = sceneFromQuery("?office=0&product=2&growth=1&recruiting=1&leaving=1&arriving=3");
  expect(endYear(before)).toMatchObject({ year: 1991, office: 1, capacity: 9, leaving: 0, arriving: 0, away: 0,
    teams: { product: 3, growth: 2, recruiting: 2 } });
});
it("ending a year never shrinks the office", () => { /* 30 people in office 3 lay off 25: still office 3 */ });
```

- [ ] **Step 2: Run them to see them fail, implement, run them and the checks.**
- [ ] **Step 3: Look at the build**

Run: `npx vite build && grep -c "office-lab" dist/index.html; ls dist`
Expected: the count is 0, `dist/office-lab.html` exists, and no script that `dist/index.html` references contains
the string `WebGLRenderer` (check with `grep -l`).

- [ ] **Step 4: Commit**

```bash
git commit -m "lab: a page that shows an office from made-up numbers"
```

---

### Task 11: The browser checks

**Files:**
- Create: `scripts/world-check.mjs`, `docs/superpowers/specs/3d-groundwork-check.md`
- Modify: whatever the checks show to be wrong, each fix with a failing test first where a test can reach it

**Interfaces:**
- Consumes: the lab page and `window.__officeLab`.
- Produces: a script that builds, serves `dist` with `vite preview`, and drives the lab page in headless Chromium
  (`require("playwright")` works on this machine; launch with no options); and a short report of what it measured.

- [ ] **Step 1: Merge the rules branch in, and run the checks.**
- [ ] **Step 2: Write the script.** For each of the five offices full (4, 9, 22, 40 and 150 people in the
  proportions 5 : 4 : 1), at 1280×800 and at 390×844:
  1. open the page with that scene, wait for `ready`, and fail on any console error or warning;
  2. record draw calls, triangles, people drawn and people counted;
  3. wait two seconds and assert that no frame was drawn in the second of them (the loop rests);
  4. take a screenshot (scale 1 for the report's own reading; scale 2 for the ones sent to the owner);
  5. end a year with three hires and two layoffs and assert that the walks finish and the loop rests again within
     15 seconds, and within 1 second under reduced motion.
  Then, once: lose the graphics context and restore it through "Reload 3D view"; open the page with WebGL switched
  off and assert the note is shown and nothing was thrown; mount and unmount the view twenty times and assert that
  the renderer's count of geometries and textures after the last unmount is what it was after the first.
- [ ] **Step 3: Run it and write the report:** the table of offices against draw calls and triangles at both sizes;
  where the 300 draw calls of the design's phone budget are crossed; how long a year takes to play out; what failed
  and was fixed. Say plainly that this machine renders in software, so its frame rates say nothing about a phone,
  and that the owner's own phone is the check the design names. Send the owner the screenshots of the five offices
  at both sizes, with the address of the lab page on this branch's preview deployment.
- [ ] **Step 4: Run the checks, commit and push**

```bash
git commit -m "world: checked in a real browser, with what it measured"
```

Then update the pull request's description: what is restored, what is new, the report's table, and how to open the
lab page.

---

## After this plan

The office draws again and nothing in the game shows it. What step 4 of the design still needs, in the order this
plan's measurements suggest:

- **Cheaper figures.** A restored figure costs eight draw calls, so about thirty people already cross the phone
  budget before any furniture. The design's answer is simple instanced figures for the far ones; Task 11's table
  says from which office on.
- **The year playing out,** with its beats and their lengths in the scene model, and the cut to the market view.
- **Era looks:** three furniture sets and eight palettes over the five plans. `lookFor` and the look parameter are
  their seam. The old garage style (plywood, a beige tower, a tube monitor) is a ready 1990s set.
- **What the stations and the walls show** in the new game: the year on the calendar, the users on the server rack.
- **Wiring into the game:** the scene from the store through `officeSceneFor`, the career's screens laid over the
  view, moving a person by touching a team's area, and playing in 2D when 3D is not available. This waits for the
  career's screens (step 3).
- **Sound** for footsteps and milestones.
