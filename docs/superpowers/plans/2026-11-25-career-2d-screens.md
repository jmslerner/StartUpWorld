# The Career in the 2D Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the career playable in the existing 2D screens on a desktop browser: choose Career or Quick race, play
1990 to 2038 a year at a time with the timeline, "Go public", offices, the rescue, rivals that come and go, the annual
report and the end screen, saved under its own key, with the race exactly as it is.

**Architecture:** The store gains a mode and holds the active config (`CONFIG` or `CAREER`) and the career's record
of milestones; the career is saved under its own key. Every number the view model computes is read from
`rulesForTurn(config, game.turn)`, and every period word comes from one `Words` object (`wordsFor(config)`), which
gives the race's exact words for the race. Everything the career adds to a screen is worked out in four new pure
modules (`careerTimeline.ts`, `careerPlan.ts`, `careerReport.ts`, `careerEnd.ts`) and laid out by thin components;
the race's view functions keep their signatures and their output.

**Tech Stack:** React 19, zustand 5 (vanilla store), Tailwind 3, TypeScript 5.9 strict, Vitest 4 in node, tsx, the
pre-installed Chromium through `require("playwright")`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-career-3d-design.md`, sections 2, 3, 4, 5, 6, 10.3, 10.5, 11, 12, 13 and
15 (this plan is build step 3). The rulings and the order of a year: `docs/career-rules.md`. What the last plan left
for this one: "After this plan" at the end of `docs/superpowers/plans/2026-11-25-career-rules-and-simulator.md`.

**Not in this plan:** the 3D office, the market view, sound for the career's milestones, phone layouts, new rules or
numbers. The race's four ending sounds are reused for the career's ending.

## Global Constraints

- **The race plays exactly as today:** its screens, its save (`startupworld:tb:save`, version 1, same layout), its
  tests. A person who never picks Career sees no change except the choice of mode on the first screen.
- **No existing test file is edited.** Career tests go in new files. Race view functions keep their signatures
  (`resourceView(game, config)`, `planningView(game, draft, config)`, `rivalsView(game, config)`,
  `eventView(event, game, config)`, `reportView(game, log, config)`, `endView(game, config)`) and their exact output
  for a race config; no field is added to `ResourceView`, `PlanningView`, `RivalRow`, `EventView`, `ReportView` or
  `EndView` (race tests compare some of them whole).
- **Career branches hang on `config.career !== undefined`**, the switch the engine uses. For the race,
  `rulesForTurn(config, turn)` returns the config itself, so reading through it changes nothing.
- **Every number shown in a career is the year's:** read through `rulesForTurn(config, game.turn)`; never from the base
  `CAREER` block. `projectTurn` and `estimateRivals` default to the race's `CONFIG`: always pass the config.
- **Text in a career is in years**, never "turn", "turns", "quarter", "quarterly" or `Q<n>`. Plain language. No real
  company, product or person in any text a player reads. Card names and texts come from the config as they are. A
  career's starting rivals draw their pitches from `CAREER_PITCHES` (Task 2), never from the race's `PITCHES`.
- **Two saves, one game in play** (design section 12: "a race save and a career save do not disturb each other"). Each
  mode writes and removes only its own key. The store plays one game at a time; a save of the other mode stays on disk
  and the first screen offers to resume it. Abandoning a game removes only its own key.
- **The mode the first screen preselects:** Quick race on a fresh first screen; Career after a career is left (Play
  again or abandon) or its save was refused at load, so that "a save this build cannot use starts a new career" is one
  click. (Decided here for the owner to confirm: whether a fresh first screen should preselect Career instead.)
- **No jsdom or testing-library.** Logic a screen needs is in pure `.ts` modules with Vitest tests; components only lay
  it out. Screens are checked by `scripts/career-check.mjs` (Task 12) in headless Chromium.
- **Desktop only.** Lay out for 1280 px wide. At 390 px nothing may overflow the page sideways; no other phone work.
- **Do not change what `src/world`, `src/scene` or `src/lab` read.** They import nothing from `src/ui` or `src/state`
  today; keep it so.
- TypeScript: `erasableSyntaxOnly` (no enums, no parameter properties), `verbatimModuleSyntax` (`import type` for
  types), `noUnusedLocals`, `noUnusedParameters`. ESLint with `--max-warnings=0`.
- Tests that read the shipped `CAREER` config read only what the design fixes (era names and first years, dated
  card years and names, office names and sizes, 1990 and 49 years). Every tuned number is read through
  `rulesForTurn` or the config in the test, never written as a literal. Rule-shaped tests use `CAREER_TEST` from
  `src/engine/careerKit.ts`.
- Commits: at least one per task, message `area: sentence` as in `git log`, ending with the session's attribution
  trailers.

### The checks

Run both after every task, before its commit.

```bash
npx tsc -b && npx eslint . --max-warnings=0 && npm test
```

Expected: no type errors, no lint output, every test passes.

```bash
git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'
```

Expected: prints nothing.

## Review Focus

Conditions the spec implies but no task's main tests exercise, most likely first. Each is pinned by a test in the task
named.

1. **A player with a race in progress opens the new build.** The race resumes exactly where it was, in race mode with
   the race's config; nothing is written under the career's key (Task 2).
2. **A career save that is damaged, from another version, or a race state under the career's key.** The career is
   refused and removed, and the first screen shows with Career chosen; a race save beside it is untouched and still
   loads (Task 2).
3. **"Go public" and a raise in the same plan, or a saved draft whose "Go public" is no longer on offer.** Choosing
   one turns the other off; a stale `goPublic: true` shows as not chosen, with the reason (Task 5).
4. **The second failure, then a reload.** The year's summary is read first, then the end screen; a reload on the end
   screen shows the end screen again, not a new career (Task 2; the browser check repeats it in Task 12).
5. **A rival's seat taken by a newcomer.** Every name in the report, the timeline and the end standings belongs to
   the company that did the thing, never to the newcomer in the same seat (Tasks 1 and 7).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/state/careerRecord.ts` (new) | The career's milestones by year: their type, how a year's log adds to them, their shape check. |
| `src/state/careerSave.ts` (new) | The career's save: key, version, write and checked read. |
| `src/state/save.ts` | Exports `loadedDraft` for the career save. Nothing else changes. |
| `src/state/shape.ts` | A race game refuses career fields. |
| `src/state/gameStore.ts` | Mode, active config, both configs, the record, `startCareer`, `resume`, the two keys. |
| `src/engine/cast.ts`, `src/ai/names.ts` | `CAREER_PITCHES`; `newGameSetup` takes the pitch lists to draw from. |
| `src/main.tsx` | Forgets both saves after a crash. |
| `src/engine/plan.ts`, `src/engine/index.ts` | `marketingRoom`: the cash limit on marketing (C11) as a function the screens can read. |
| `src/ui/format.ts` | `yearRunwayText`, `yearsLeft` beside the race's functions. |
| `src/ui/words.ts` (new) | `Words`: every period word, the race's or the career's. |
| `src/ui/viewModel.ts` | Reads the year's rules and `Words`; race-only listing logic gated to the race. |
| `src/ui/draft.ts` | `stepMarketing` takes a ceiling; `setGoPublic`; `setRaise` turns "Go public" off. |
| `src/ui/careerTimeline.ts` (new) | The timeline, the year's status line, dated cards. |
| `src/ui/careerPlan.ts` (new) | "Go public", the coming office move, the career's warnings. |
| `src/ui/careerReport.ts` (new) | The annual report's career lines and the rivals' career facts. |
| `src/ui/careerEnd.ts` (new) | The career's end: standings by founder's stake, companies gone, the career on the timeline. |
| `src/ui/careerHelp.ts` (new) | The how-to-play text for a career. |
| `src/ui/components/Timeline.tsx`, `CareerStatus.tsx`, `GoPublicRow.tsx`, `CareerReportLines.tsx`, `YearSummary.tsx` (new) | Thin layouts of the views above. |
| `src/ui/components/*.tsx`, `src/ui/screens/*.tsx`, `src/App.tsx` | Take `config` and `Words` from the store; career sections. |
| `scripts/race-text.mjs`, `scripts/race-text.snapshot.json` (new) | The race's on-screen text, recorded before any component changes, and the check that it is unchanged. |
| `scripts/career-fixtures.ts`, `scripts/career-check.mjs` (new) | Saves for the browser check, and the browser check. |

`src/config.ts` is not changed by this plan: the 2035 card's text was already reworded by the tuning work (Tuning log,
`docs/career-rules.md`).

---

### Task 1: The career's record of milestones

**Files:**
- Create: `src/state/careerRecord.ts`
- Test: `src/state/careerRecord.test.ts`

**Interfaces:**
- Consumes: `GameState`, `TurnLog`, `OutReason`, `CompanyId` from `src/engine/types`; `isRecord` from `src/state/shape`.
- Produces:

```ts
export type Milestone =
  | { readonly kind: "launch"; readonly turn: number }
  | { readonly kind: "office"; readonly turn: number; readonly from: number; readonly to: number }
  | { readonly kind: "listed"; readonly turn: number; readonly amount: number }
  | { readonly kind: "rescued"; readonly turn: number; readonly reason: OutReason }
  | { readonly kind: "out"; readonly turn: number; readonly reason: OutReason }
  | { readonly kind: "rivalOut"; readonly turn: number; readonly seat: CompanyId; readonly name: string; readonly founded: number; readonly reason: OutReason }
  | { readonly kind: "rivalIn"; readonly turn: number; readonly seat: CompanyId; readonly name: string; readonly pitch: string };
export type CareerRecord = readonly Milestone[];
/** The milestones one year adds: the player's (seat 0) from its report, rivals' exits and arrivals. */
export const milestonesOf: (before: GameState, log: TurnLog, after: GameState) => Milestone[];
export const isCareerRecord: (value: unknown, seats: number) => value is CareerRecord;
```

Rules: `turn` is the turn the thing happened in (`log.turn`), except `rivalIn`, whose `turn` is the year the newcomer
plays first, `log.turn + 1`, equal to its `career.founded`. Order within one call: launch, office, listed, rescued,
out, then rival exits by seat, then arrivals by seat. Read `report.quality.launchedNow`, `report.career.office`,
`report.career.listing`, `report.career.rescue`, `report.out` for seat 0; `report.out` for other seats, with `name`
and `founded` from `before.companies[seat]` (the company that left); `log.entrants` with `name` and `pitch` from
`after.companies[seat]` (the company that arrives). A race log (no `career`, no `entrants`) gives launch and out only.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { CAREER_TEST, atTurn, careerOf, newCareer, outSince, qualify, withCareerOf } from "../engine/careerKit";
import { listingOf, rulesForTurn } from "../engine/career";
import { BLITZ, BOOT, HUMAN, resolve, withCompany } from "../engine/testKit";
import { isCareerRecord, milestonesOf, type CareerRecord } from "./careerRecord";

const year = (state: Parameters<typeof resolve>[0], patches: Parameters<typeof resolve>[1] = {}) => {
  const result = resolve(state, patches, 1, CAREER_TEST);
  return { ...result, milestones: milestonesOf(state, result.log, result.state) };
};

describe("the career's record", () => {
  it("records the player's listing with the amount the year raised", () => {
    const opening = qualify(newCareer(), HUMAN);
    const expected = listingOf(opening.companies[HUMAN], opening.climate.multiplier, rulesForTurn(CAREER_TEST, 1)).amount;
    expect(year(opening, { [HUMAN]: { goPublic: true } }).milestones).toContainEqual({ kind: "listed", turn: 1, amount: expected });
  });

  it("records a move from the garage to the shared office", () => {
    const opening = withCompany(newCareer(), HUMAN, { headcount: 5, headcountAtLastClose: 5 });
    expect(year(opening).milestones).toContainEqual({ kind: "office", turn: 1, from: 0, to: 1 });
  });

  it("records a rescue, then a second failure as the player's end", () => {
    const broke = withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 });
    expect(year(broke).milestones).toContainEqual({ kind: "rescued", turn: 4, reason: "bankrupt" });
    const again = withCareerOf(broke, HUMAN, { rescue: { turn: 2, reason: "bankrupt" } });
    expect(year(again).milestones).toContainEqual({ kind: "out", turn: 4, reason: "bankrupt" });
  });

  it("records the launch in the year the product launched, first", () => {
    const almost = withCompany(newCareer(), HUMAN, { quality: 9.9 });
    expect(year(almost).milestones[0]).toEqual({ kind: "launch", turn: 1 });
  });

  it("names a rival that goes out, and the newcomer that takes its seat, each by its own name", () => {
    const opening = withCareerOf(withCompany(atTurn(newCareer(), 6), BLITZ, { cash: -1 }), BLITZ, { rescue: { turn: 3, reason: "fired" } });
    const gone = year(opening);
    expect(gone.milestones).toContainEqual({ kind: "rivalOut", turn: 6, seat: BLITZ, name: "Zipp", founded: 1, reason: "bankrupt" });
    const due = outSince(atTurn(newCareer(), 9), BOOT, 7);
    const { milestones, state } = year(due);
    const newcomer = state.companies[BOOT];
    expect(newcomer.name).not.toBe("Oakline");
    expect(milestones).toContainEqual({ kind: "rivalIn", turn: 10, seat: BOOT, name: newcomer.name, pitch: newcomer.pitch });
    expect(careerOf(state, BOOT).founded).toBe(10);
  });

  it("checks a saved record field by field", () => {
    const record: CareerRecord = [
      { kind: "launch", turn: 2 },
      { kind: "office", turn: 5, from: 0, to: 1 },
      { kind: "rivalIn", turn: 9, seat: 2, name: "Newco", pitch: "Something new." },
    ];
    expect(isCareerRecord(JSON.parse(JSON.stringify(record)), 4)).toBe(true);
    expect(isCareerRecord([], 4)).toBe(true);
    expect(isCareerRecord([{ kind: "merged", turn: 2 }], 4)).toBe(false);
    expect(isCareerRecord([{ kind: "office", turn: 5, from: 0 }], 4)).toBe(false);
    expect(isCareerRecord([{ kind: "rivalIn", turn: 9, seat: 4, name: "Newco", pitch: "x" }], 4)).toBe(false);
    expect(isCareerRecord([{ kind: "rescued", turn: 3, reason: "merged" }], 4)).toBe(false);
    expect(isCareerRecord({ 0: { kind: "launch", turn: 2 } }, 4)).toBe(false);
  });
});
```

If a crafted opening above does not produce its event under `CAREER_TEST` (for example the launch needs one more
point of quality), adjust only the crafted numbers in the test, never the expected milestone.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/state/careerRecord.test.ts`
Expected: FAIL, cannot resolve `./careerRecord`.

- [ ] **Step 3: Implement `milestonesOf` and `isCareerRecord` in `src/state/careerRecord.ts`**

`isCareerRecord`: an array; every entry a record whose `kind` is one of the seven, `turn` a positive whole number,
`from`/`to`/`seat`/`founded` whole numbers (`seat` below `seats`), `amount` a finite number, `reason` `"bankrupt"` or
`"fired"`, `name`/`pitch` strings.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/state/careerRecord.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the checks, then commit**

```bash
git add src/state/careerRecord.ts src/state/careerRecord.test.ts
git commit -m "state: the career's record of milestones, collected from each year's log"
```

---

### Task 2: The career's save and the store's mode

**Files:**
- Create: `src/state/careerSave.ts`
- Modify: `src/state/save.ts` (export `loadedDraft`), `src/state/shape.ts:115` (`careerField`), `src/state/gameStore.ts`,
  `src/main.tsx:9-15`, `src/engine/cast.ts` (`CAREER_PITCHES`), `src/engine/index.ts` (export it), `src/ai/names.ts`
  (`newGameSetup` takes the pitch lists)
- Test: `src/state/careerSave.test.ts`, `src/state/gameStore.career.test.ts`, `src/ai/names.career.test.ts`

**Interfaces:**
- Consumes: `CareerRecord`, `milestonesOf`, `isCareerRecord` (Task 1); `SavedGame`, `SAVE_KEY`, `parseSave`,
  `serializeSave` from `src/state/save.ts`; `CONFIG`, `CAREER`, `PlayConfig` from `src/config.ts`.
- Produces:

```ts
// src/engine/cast.ts
/** A career's starting rivals' lines: the race's lists, but for the lines that speak of quarters. Same lengths, so the
 *  draws, and every name, are the race's. */
export const CAREER_PITCHES: Readonly<Record<CpuKind, readonly string[]>>;

// src/ai/names.ts
export const newGameSetup: (seed: number, playerName: string, playerController?: "human" | "baseline", pitches?: Readonly<Record<CpuKind, readonly string[]>> /* = PITCHES */) => GameSetup;

// src/state/careerSave.ts
export const CAREER_SAVE_KEY = "startupworld:career:save";
export const CAREER_SAVE_VERSION = 1;
export interface SavedCareer extends SavedGame { readonly record: CareerRecord }
export const serializeCareerSave: (save: SavedCareer) => string;
export const parseCareerSave: (raw: string | null, config?: RulesConfig /* = CAREER */) => SavedCareer | null;

// src/state/save.ts (now exported, unchanged body)
export const loadedDraft: (game: GameState, draft: Plan, config: RulesConfig) => Plan;

// src/state/gameStore.ts
export type Mode = "race" | "career";
export interface GameStore {
  // …every existing field and action, unchanged…
  /** null with no game; otherwise the mode the game in progress is played in. */
  readonly mode: Mode | null;
  /** The config of the game in progress; the race's when there is none. */
  readonly config: PlayConfig;
  readonly configs: { readonly race: PlayConfig; readonly career: PlayConfig };
  /** The career's milestones by year; [] in a race. */
  readonly record: CareerRecord;
  /** The turn of a save on disk the first screen can resume, by mode; null for none, and always null for the mode in play. */
  readonly resumable: { readonly race: number | null; readonly career: number | null };
  /** The mode the first screen preselects (see Global Constraints). */
  readonly preferred: Mode;
  startCareer(name: string, seed: number): void;
  /** Load that mode's save and play it; a save that no longer parses is removed and its `resumable` set to null. */
  resume(mode: Mode): void;
  /** Back to the first screen, keeping the game's save to resume later. `abandon` is the one that deletes it. */
  leave(): void;
}
export const createGameStore: (storage: StorageLike | null, config?: PlayConfig /* = CONFIG */, careerConfig?: PlayConfig /* = CAREER */) => StoreApi<GameStore>;
```

Behaviour:
- `parseCareerSave` refuses (returns null) a wrong version, a non-integer seed, a game that fails
  `isGame(game, config)`, a draft that fails `isPlan`, or a record that fails `isCareerRecord(record, game.companies.length)`.
  The draft goes through `loadedDraft`; a `lastLog` failing `isTurnLog` is dropped as in `parseSave`.
- `shape.ts`: `careerField` for a config without `career` accepts only `undefined`, so a race load refuses
  `Company.career` and `GameState.wave`.
- At creation the store reads both keys. A career key that is present but refused is removed then and there, and
  `preferred` becomes `"career"`. Exactly one save parses: the store resumes it, as today for the race. Both parse:
  no game, `mode` null, and `resumable` holds both turns, so the first screen asks which to resume. Neither: no game.
  `resumable` holds the turn of every parsed save that is not in play.
- `startGame(name, seed)` is unchanged and sets `mode: "race"`, `config` to the race config, `record: []`,
  `resumable.race: null` (a new race replaces the race save). `startCareer(name, seed)` does the same with
  `createGame(newGameSetup(seed, name, "human", CAREER_PITCHES), careerConfig)`, `mode: "career"`, `resumable.career: null`.
- `resume(mode)` parses that mode's key again and plays it (`resumable[mode]: null`); refused, it removes the key.
- `endQuarter` resolves with the active config. In career mode it appends `milestonesOf(game, result.log, result.state)`
  to `record`. `over` keeps today's rule: a career's first failure is a rescue and leaves `out` null, so `over`
  becomes true only on the second failure or after the last year.
- `abandon` also sets `mode: null`, `record: []`, `config` back to the race config, and `preferred` to the mode left,
  and removes that mode's key (in a `try`). The other mode's key and `resumable` are kept.
- `leave` does what `abandon` does but keeps the key, and sets `resumable[mode]` to the game's turn.
- The subscriber, in a `try`: with a game, write the active mode's key only (`serializeSave` for the race, unchanged;
  `serializeCareerSave` with the record for the career). With no game it writes and removes nothing. Neither mode ever
  touches the other's key.
- `src/main.tsx` `forgetSave` removes `SAVE_KEY` and `CAREER_SAVE_KEY`, each in its own `try`.
- `CAREER_PITCHES` is `PITCHES` with `"Why switch? We'll have that feature next quarter."` replaced by
  `"Why switch? We'll have that feature by next year."`; every other line is the race's. The race and the simulator
  keep calling `newGameSetup` without the fourth argument.
- A career draft comes back from the save with `goPublic` set: `loadedDraft` sends it through `normalizePlan`, which in
  a career always writes `goPublic` (`false` when not chosen).

- [ ] **Step 1: Write the failing save tests (`src/state/careerSave.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, newGame } from "../engine/testKit";
import { CAREER_SAVE_KEY, CAREER_SAVE_VERSION, parseCareerSave, serializeCareerSave } from "./careerSave";
import { SAVE_KEY, parseSave, serializeSave } from "./save";
import { isGame } from "./shape";

const career = newCareer();
// A career draft is saved, and read back, with goPublic set: the plan check always writes it in a career.
const save = { seed: 7, game: career, draft: { ...defaultPlan(career.companies[HUMAN]), goPublic: false }, lastLog: null, reportOpen: false, record: [{ kind: "launch", turn: 1 }] as const };

describe("the career's save", () => {
  it("has its own key and version", () => {
    expect(CAREER_SAVE_KEY).toBe("startupworld:career:save");
    expect(CAREER_SAVE_KEY).not.toBe(SAVE_KEY);
    expect(CAREER_SAVE_VERSION).toBe(1);
  });

  it("reads back what it wrote, record included", () => {
    expect(parseCareerSave(serializeCareerSave(save), CAREER_TEST)).toEqual(save);
  });

  it.each<[string, (data: Record<string, unknown>) => void]>([
    ["another version", (data) => { data.version = 2; }],
    ["a seed that is not a whole number", (data) => { data.seed = 1.5; }],
    ["a damaged record", (data) => { data.record = [{ kind: "launch" }]; }],
    ["no record", (data) => { delete data.record; }],
    ["a race game", (data) => { data.game = newGame(); }],
  ])("refuses %s", (_name, damage) => {
    const data = JSON.parse(serializeCareerSave(save)) as Record<string, unknown>;
    damage(data);
    expect(parseCareerSave(JSON.stringify(data), CAREER_TEST)).toBeNull();
  });

  it("a race load refuses a game carrying career fields", () => {
    expect(isGame(JSON.parse(JSON.stringify(career)), DESIGN)).toBe(false);
    expect(parseSave(serializeSave({ ...save, game: career }), DESIGN)).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing store tests (`src/state/gameStore.career.test.ts`)**

Use a `MemoryStorage` class like the one in `gameStore.test.ts` (copy it; do not import from a test file).

```ts
const RACE = { ...DESIGN, events: { ...DESIGN.events, chance: 0 } };
const store = (storage: StorageLike) => createGameStore(storage, RACE, CAREER_TEST);

it("starts a career in its own mode, config and key", () => {
  const storage = new MemoryStorage();
  const s = store(storage);
  s.getState().startCareer("Acme", 7);
  expect(s.getState()).toMatchObject({ mode: "career", seed: 7, record: [], over: false });
  expect(s.getState().config).toBe(CAREER_TEST);
  expect(s.getState().game?.wave).toEqual({ multiplier: 1, turnsLeft: 0 });
  expect(storage.getItem(CAREER_SAVE_KEY)).not.toBeNull();
  expect(storage.getItem(SAVE_KEY)).toBeNull();
});

it("adds each year's milestones to the record and saves them", () => {
  const storage = new MemoryStorage();
  const s = store(storage);
  s.getState().startCareer("Acme", 7);
  const before = s.getState().game!;
  s.getState().endQuarter();
  const { game, lastLog, record } = s.getState();
  expect(record).toEqual(milestonesOf(before, lastLog!, game!));
  expect(parseCareerSave(storage.getItem(CAREER_SAVE_KEY), CAREER_TEST)?.record).toEqual(record);
});

it("resumes a career after a reload, with its record", () => {
  const storage = new MemoryStorage();
  const first = store(storage);
  first.getState().startCareer("Acme", 7);
  first.getState().endQuarter();
  const second = store(storage).getState();
  expect(second.mode).toBe("career");
  expect(second.game).toEqual(first.getState().game);
  expect(second.record).toEqual(first.getState().record);
});

it("a rescued player plays on; a second failure ends the career, and stays ended after a reload", () => {
  const storage = new MemoryStorage();
  const broke = withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 });
  const write = (game: GameState) => storage.setItem(CAREER_SAVE_KEY, serializeCareerSave({ seed: 3, game, draft: defaultPlan(game.companies[HUMAN]), lastLog: null, reportOpen: false, record: [] }));
  write(broke);
  const rescued = store(storage);
  rescued.getState().endQuarter();
  expect(rescued.getState().over).toBe(false);
  expect(rescued.getState().record).toContainEqual({ kind: "rescued", turn: 4, reason: "bankrupt" });
  write(withCareerOf(broke, HUMAN, { rescue: { turn: 2, reason: "bankrupt" } }));
  const ended = store(storage);
  ended.getState().endQuarter();
  expect(ended.getState()).toMatchObject({ over: true, reportOpen: true });
  expect(store(storage).getState()).toMatchObject({ mode: "career", over: true });
});

it("resumes a race saved by the previous build exactly as it was, and writes no career save", () => {
  const storage = new MemoryStorage();
  const race = createGameStore(storage, RACE);
  race.getState().startGame("Acme", 11);
  race.getState().endQuarter();
  const raw = storage.getItem(SAVE_KEY);
  const resumed = store(storage).getState();
  expect(resumed).toMatchObject({ mode: "race", record: [] });
  expect(resumed.config).toBe(RACE);
  expect(resumed.game).toEqual(race.getState().game);
  expect(storage.getItem(SAVE_KEY)).toBe(raw);
  expect(storage.getItem(CAREER_SAVE_KEY)).toBeNull();
});

it("a broken career save leaves a race save to load", () => {
  const storage = new MemoryStorage();
  createGameStore(storage, RACE).getState().startGame("Acme", 11);
  storage.setItem(CAREER_SAVE_KEY, "{ not json");
  expect(store(storage).getState().mode).toBe("race");
});

it("keeps both saves: leaving a career for a race leaves the career's save as it was", () => {
  const storage = new MemoryStorage();
  const s = store(storage);
  s.getState().startCareer("Acme", 7);
  s.getState().endQuarter();
  const kept = storage.getItem(CAREER_SAVE_KEY);
  s.getState().leave();
  expect(s.getState()).toMatchObject({ mode: null, game: null, resumable: { race: null, career: 2 }, preferred: "career" });
  s.getState().startGame("Acme", 11);
  s.getState().endQuarter();
  expect(storage.getItem(CAREER_SAVE_KEY)).toBe(kept);
  s.getState().abandon();
  expect(storage.getItem(SAVE_KEY)).toBeNull();
  expect(storage.getItem(CAREER_SAVE_KEY)).toBe(kept);
  expect(s.getState()).toMatchObject({ mode: null, game: null, record: [], resumable: { race: null, career: 2 }, preferred: "race" });
  expect(s.getState().config).toBe(RACE);
});

it("abandoning a career removes its save only", () => {
  const storage = new MemoryStorage();
  createGameStore(storage, RACE).getState().startGame("Acme", 11);
  const raw = storage.getItem(SAVE_KEY);
  const s = store(storage);
  s.getState().leave();
  s.getState().startCareer("Acme", 7);
  s.getState().abandon();
  expect(storage.getItem(CAREER_SAVE_KEY)).toBeNull();
  expect(storage.getItem(SAVE_KEY)).toBe(raw);
});

it("with both saves on disk, opens on the first screen and resumes the one chosen", () => {
  const storage = new MemoryStorage();
  createGameStore(storage, RACE).getState().startGame("Acme", 11);
  const career = store(new MemoryStorage());
  career.getState().startCareer("Acme", 7);
  career.getState().endQuarter();
  storage.setItem(CAREER_SAVE_KEY, serializeCareerSave({ seed: 7, game: career.getState().game!, draft: career.getState().draft!, lastLog: null, reportOpen: false, record: career.getState().record }));
  const s = store(storage);
  expect(s.getState()).toMatchObject({ mode: null, game: null, resumable: { race: 1, career: 2 } });
  s.getState().resume("career");
  expect(s.getState()).toMatchObject({ mode: "career", resumable: { race: 1, career: null } });
  expect(s.getState().game).toEqual(career.getState().game);
});

it("removes a career save it refuses, and preselects Career", () => {
  const storage = new MemoryStorage();
  storage.setItem(CAREER_SAVE_KEY, "{ not json");
  expect(store(storage).getState()).toMatchObject({ mode: null, preferred: "career" });
  expect(storage.getItem(CAREER_SAVE_KEY)).toBeNull();
});

it("preselects the mode just left", () => {
  const s = store(new MemoryStorage());
  expect(s.getState().preferred).toBe("race");
  s.getState().startCareer("Acme", 7);
  s.getState().abandon();
  expect(s.getState().preferred).toBe("career");
});
```

Imports: `DESIGN`, `CAREER_TEST`, `atTurn`, `newCareer`, `withCareerOf`, `HUMAN`, `withCompany`, `defaultPlan`,
`GameState`, `createGameStore`, `StorageLike`, `SAVE_KEY`, `CAREER_SAVE_KEY`, `parseCareerSave`,
`serializeCareerSave`, `milestonesOf`.

- [ ] **Step 3: Write the failing pitch test (`src/ai/names.career.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { CAREER_PITCHES, PITCHES } from "../engine/cast";
import { newGameSetup } from "./names";

const FORBIDDEN = /\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i;

describe("a career's starting rivals", () => {
  it("never speak of quarters, in any line a career can draw", () => {
    for (const lines of Object.values(CAREER_PITCHES)) for (const line of lines) expect(line).not.toMatch(FORBIDDEN);
    for (let seed = 1; seed <= 300; seed++) {
      for (const seat of newGameSetup(seed, "Acme", "human", CAREER_PITCHES).seats) expect(seat.pitch, `seed ${seed}`).not.toMatch(FORBIDDEN);
    }
  });

  it("draw the race's names, from lists of the race's lengths", () => {
    for (const kind of Object.keys(PITCHES) as (keyof typeof PITCHES)[]) expect(CAREER_PITCHES[kind]).toHaveLength(PITCHES[kind].length);
    for (let seed = 1; seed <= 50; seed++) {
      const names = (pitches?: typeof PITCHES) => newGameSetup(seed, "Acme", "human", pitches).seats.map((seat) => seat.name);
      expect(names(CAREER_PITCHES)).toEqual(names());
    }
    expect(newGameSetup(3, "Acme")).toEqual(newGameSetup(3, "Acme", "human", PITCHES));
  });
});
```

- [ ] **Step 4: Run the three files to see them fail**

Run: `npx vitest run src/state/careerSave.test.ts src/state/gameStore.career.test.ts src/ai/names.career.test.ts`
Expected: FAIL, cannot resolve `./careerSave`; `CAREER_PITCHES` is not exported.

- [ ] **Step 5: Implement `careerSave.ts`, export `loadedDraft`, tighten `careerField`, extend the store, update `forgetSave`, add `CAREER_PITCHES` and the `newGameSetup` parameter**

`createGameStore`'s config parameter widens from `GameConfig` to `PlayConfig` (CAREER is not a `GameConfig`); existing
calls keep working.

- [ ] **Step 6: Run the new files, then the state and AI suites**

Run: `npx vitest run src/state src/ai src/sim`
Expected: PASS, including the unchanged `gameStore.test.ts`, `save.test.ts`, `shape.test.ts`,
`shape.career.test.ts`, `names.test.ts` and the simulator's golden tests.

- [ ] **Step 7: Run the checks, then commit**

```bash
git add src/state src/main.tsx src/engine/cast.ts src/engine/index.ts src/ai/names.ts src/ai/names.career.test.ts
git commit -m "state: the career is saved under its own key with its record, and the store plays either mode"
```

---

### Task 3: Years in words, and the year's numbers in the view model

**Files:**
- Create: `src/ui/words.ts`
- Modify: `src/ui/format.ts`, `src/ui/viewModel.ts`, `src/ui/draft.ts` (`stepMarketing`), `src/engine/plan.ts:107-121`,
  `src/engine/index.ts`
- Test: `src/ui/words.test.ts`, `src/ui/viewModel.career.test.ts`, `src/engine/career.marketingRoom.test.ts`

**Interfaces:**
- Consumes: `rulesForTurn`, `yearOf`, `closingValuation`, `hiresWithinCap`, `peopleCap`, `boardPaused` from `src/engine`.
- Produces:

```ts
// src/ui/format.ts, beside quarter(), runwayText() and quartersLeft(), which do not change
export const yearRunwayText: (runway: number | null) => string;
export const yearsLeft: (turnsLeft: number) => string;

// src/ui/words.ts
export interface Words {
  readonly career: boolean;
  /** "quarter" or "year". */
  readonly period: string;
  /** "quarters" or "years". */
  readonly periods: string;
  /** "Quarterly" or "Annual". */
  readonly report: string;
  /** A turn by name: "Q3" or "1992". */
  readonly when: (turn: number) => string;
  /** A count of runway units: "2 turns" in the race, "2 years" in a career. */
  readonly units: (n: number) => string;
  /** A short count for tight spaces: "1 qtr", "3 qtrs" in the race; "1 yr", "3 yrs" in a career. */
  readonly short: (n: number) => string;
  readonly runway: (runway: number | null) => string;
  readonly left: (turnsLeft: number) => string;
}
export const wordsFor: (config: RulesConfig) => Words;

// src/engine/plan.ts (exported from src/engine/index.ts)
/** The most marketing a plan may budget in a career (C11), step-rounded; null outside a career. */
export const marketingRoom: (company: Company, plan: Plan, climateMultiplier: number, rules: RulesConfig) => number | null;

// src/ui/draft.ts
export const stepMarketing: (plan: Plan, steps: number, config: RulesConfig, max?: number /* = config.pull.maxMarketing */) => Plan;

// src/ui/viewModel.ts (new export)
/** The engine's marketing note, worded for where the room came from in a career. */
export const marketingNote: (note: string, proceeds: "raise" | "listing" | null) => string;
```

`marketingRoom` reads `plan.goPublic === true` (the listing's amount) or `plan.raisePercent > 0` (the raise's amount),
as `normalizePlanFor` does today. `normalizePlanFor` calls
`marketingRoom(company, { ...wanted, goPublic, raisePercent }, climateMultiplier, rules)` at the place where it now
works out `room` (`plan.ts:107-121`), with `goPublic` and `raisePercent` as it has already settled them, so its notes and
its tests do not change.

What changes in `viewModel.ts`, for a career only (a race gives the same output as today):
- Every own read of a number goes through `const rules = rulesForTurn(config, game.turn)`: valuation, runway
  (`companyRunway(self, rules)`), `ipoUsers`, `launchAt`, `workExponent`, raise options and limits, the cautious case,
  prices, poach cost, floor and chance, hiring fee and candidates, layoffs, marketing step and pull.
- Valuations shown for a company (resource bar, raise panel, rivals) are
  `closingValuation(valuationOf(users, hype, climate, rules), company, false, rules)` in a career: a public company
  carries the premium.
- Every period word goes through `wordsFor(config)`: "end the quarter at" becomes ``end the ${w.period} at``, "turns"
  in the board warning becomes `w.units(...)`, `quarter(...)` becomes `w.when(...)`.
- `raiseView` gives blocker `"public"` the text `"A public company cannot raise privately."`.
- These race lines run only when `rules.career === undefined`; Task 5 adds the career's own in their place: the
  `projection.cash < 0` warning ("…Below $0 you go bankrupt."), the auto-listing that suppresses the board warning, the
  whole `projection.users >= ipo.users` block ("…the users to go public, but not the profit…", "On course to go
  public…", "You could go public…"), and "Final quarter…".
- In a career the "Close call…" caution is also skipped when `boardPaused(self, game.turn)`: the board does not vote.
- `hiring.capacity` is `hiresWithinCap(hiringCapacity(...), self.headcount - draft.layoffs, rules)`.
- A poach option is not allowed when `self.headcount - draft.layoffs >= peopleCap(career)`, with reason
  ``Your ${last office name, lower case} is full: nobody more can join.``
- `marketing.max` is `Math.min(rules.pull.maxMarketing, room)` where `room = marketingRoom(self, projection.plan, game.climate.multiplier, rules)`, when not null.
- Notes from the projection pass through `marketingNote(note, projection.plan.goPublic === true ? "listing" : projection.plan.raisePercent > 0 ? "raise" : null)`.
  `marketingNote` replaces the ending `"it cannot exceed the cash in hand."` with
  `"it cannot exceed the cash in hand plus what the raise brings."` or `"…plus what going public brings."`; any other
  note, or `proceeds` null, comes back unchanged. (This is the last plan's second wording point.)

- [ ] **Step 1: Write the failing word tests (`src/ui/words.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST } from "../engine/careerKit";
import { quarter, quartersLeft, runwayText, yearRunwayText, yearsLeft } from "./format";
import { wordsFor } from "./words";

describe("words for a year", () => {
  it("writes runway in years, cut to one decimal", () => {
    expect(yearRunwayText(null)).toBe("profitable");
    expect(yearRunwayText(0)).toBe("0 years");
    expect(yearRunwayText(1.04)).toBe("1.0 year");
    expect(yearRunwayText(1.96)).toBe("1.9 years");
    expect(yearRunwayText(3.46)).toBe("3.4 years");
    expect(yearRunwayText(41)).toBe("40+ years");
  });

  it("counts a climate's years", () => {
    expect(yearsLeft(1)).toBe("this year only");
    expect(yearsLeft(2)).toBe("this year and the next");
    expect(yearsLeft(4)).toBe("this year and 3 more");
  });

  it("gives the race its own words, unchanged", () => {
    const w = wordsFor(DESIGN);
    expect(w).toMatchObject({ career: false, period: "quarter", periods: "quarters", report: "Quarterly" });
    expect(w.short(1)).toBe("1 qtr");
    expect(w.short(3)).toBe("3 qtrs");
    expect(w.when(3)).toBe(quarter(3));
    expect(w.units(2)).toBe("2 turns");
    expect(w.units(1)).toBe("1 turn");
    expect(w.runway(2.5)).toBe(runwayText(2.5));
    expect(w.left(3)).toBe(quartersLeft(3));
  });

  it("gives a career its years", () => {
    const w = wordsFor(CAREER_TEST);
    expect(w).toMatchObject({ career: true, period: "year", periods: "years", report: "Annual" });
    expect(w.short(1)).toBe("1 yr");
    expect(w.short(3)).toBe("3 yrs");
    expect(w.when(1)).toBe("1990");
    expect(w.when(49)).toBe("2038");
    expect(w.units(2)).toBe("2 years");
    expect(w.units(1)).toBe("1 year");
    expect(w.runway(2.5)).toBe("2.5 years");
    expect(w.left(2)).toBe("this year and the next");
  });
});
```

- [ ] **Step 2: Write the failing view-model tests (`src/ui/viewModel.career.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { CAREER_TEST, atTurn, newCareer, qualify, withCareerOf } from "../engine/careerKit";
import { closingValuation, rulesForTurn, valuationOf } from "../engine";
import { defaultPlan } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { createGame } from "../engine/setup";
import { HUMAN, launchedCompany, withCompany } from "../engine/testKit";
import { viewFor } from "../engine/view";
import type { GameState, Plan } from "../engine/types";
import { marketingNote, planningView, resourceView, rivalsView } from "./viewModel";

const real = (turn: number): GameState => atTurn(createGame(newGameSetup(1, "Acme"), CAREER), turn);
const draftOf = (game: GameState, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(game.companies[HUMAN]), ...patch });

describe("the view model reads the year's numbers", () => {
  it("shows the listing bar of the year's era", () => {
    expect(resourceView(real(1), CAREER).ipoUsers).toBe(rulesForTurn(CAREER, 1).ipo.users);
    expect(resourceView(real(6), CAREER).ipoUsers).toBe(rulesForTurn(CAREER, 6).ipo.users);
    expect(rulesForTurn(CAREER, 6).ipo.users).not.toBe(rulesForTurn(CAREER, 1).ipo.users);
  });

  it("prices a raise exactly as the engine will pay it", () => {
    const game = launchedCompany(real(20), HUMAN, { users: rulesForTurn(CAREER, 20).raise.minUsers, hype: 30 });
    const option = planningView(game, draftOf(game), CAREER).raise.options[0];
    const projection = projectTurn(viewFor(game, HUMAN), draftOf(game, { raisePercent: option.percent }), CAREER);
    expect(option.amount).toBe(projection.raise?.amount);
  });

  it("asks the year's hiring fee", () => {
    // 2001 is in the bust era, which sets its own fee; the base CAREER fee differs.
    expect(rulesForTurn(CAREER, 12).hiring.fee).not.toBe(CAREER.hiring.fee);
    expect(planningView(real(12), draftOf(real(12)), CAREER).hiring.fee).toBe(rulesForTurn(CAREER, 12).hiring.fee);
  });

  it("values a public company with the listing premium", () => {
    const listed = withCareerOf(launchedCompany(newCareer(), HUMAN, { users: 100_000, hype: 40 }), HUMAN, { listed: { turn: 1, valuation: 1, amount: 1 } });
    const rules = rulesForTurn(CAREER_TEST, 1);
    const plain = valuationOf(100_000, 40, listed.climate.multiplier, rules);
    expect(resourceView(listed, CAREER_TEST).valuation).toBe(closingValuation(plain, listed.companies[HUMAN], false, rules));
    expect(resourceView(listed, CAREER_TEST).valuation).toBeGreaterThan(plain);
    const rivalListed = withCareerOf(launchedCompany(listed, 1, { users: 100_000 }), 1, { listed: { turn: 1, valuation: 1, amount: 1 } });
    const rivalPlain = valuationOf(rivalListed.companies[1].users, rivalListed.companies[1].hype, 1, rules);
    expect(rivalsView(rivalListed, CAREER_TEST)[0].valuation).toBe(closingValuation(rivalPlain, rivalListed.companies[1], false, rules));
    expect(rivalsView(rivalListed, CAREER_TEST)[0].valuation).toBeGreaterThan(rivalPlain);
  });

  it("explains a raise a public company cannot make", () => {
    const listed = withCareerOf(launchedCompany(newCareer(), HUMAN, { users: 100_000 }), HUMAN, { listed: { turn: 1, valuation: 1, amount: 1 } });
    expect(planningView(listed, draftOf(listed), CAREER_TEST).raise).toMatchObject({ blocked: "public", blockedText: "A public company cannot raise privately." });
  });

  it("never says a career company is on course to list, that it ends the game, or that $0 is bankruptcy", () => {
    const game = withCompany(qualify(newCareer(), HUMAN), HUMAN, { cash: 1_000 });
    const texts = planningView(game, draftOf(game), CAREER_TEST).warnings.map((warning) => warning.text).join(" ");
    expect(texts).not.toMatch(/quarter|turns?\b|On course to go public|could go public this|you go bankrupt/i);
  });

  it("never tells a public company it has the users to go public", () => {
    const listed = withCareerOf(launchedCompany(newCareer(), HUMAN, { users: 10 * rulesForTurn(CAREER_TEST, 1).ipo.users }), HUMAN, { listed: { turn: 1, valuation: 1, amount: 1 } });
    expect(planningView(listed, draftOf(listed), CAREER_TEST).warnings.map((w) => w.text).join(" ")).not.toMatch(/to go public/);
  });

  it("gives no close call in the year the board sits out", () => {
    const rescued = atTurn(withCareerOf(withCompany(newCareer(), HUMAN, { investorSeats: 3, users: 5_000, usersAtLastClose: 50_000, launched: true, quality: 40 }), HUMAN, { rescue: { turn: 4, reason: "fired" } }), 5);
    expect(planningView(rescued, draftOf(rescued), CAREER_TEST).warnings.map((w) => w.text).join(" ")).not.toMatch(/Close call|board fires you/);
  });

  it("stops hiring and poaching at the campus", () => {
    const full = withCareerOf(withCompany(newCareer(), HUMAN, { headcount: 150, headcountAtLastClose: 150 }), HUMAN, { office: 4 });
    const view = planningView(full, draftOf(full), CAREER_TEST);
    expect(view.hiring.capacity).toBe(0);
    expect(view.poach.options.every((option) => !option.allowed && option.reason === "Your campus is full: nobody more can join.")).toBe(true);
  });

  it("caps the marketing control at the cash in hand", () => {
    const poor = withCompany(newCareer(), HUMAN, { cash: 30_000 });
    const step = rulesForTurn(CAREER_TEST, 1).pull.marketingStep;
    expect(planningView(poor, draftOf(poor), CAREER_TEST).marketing.max).toBe(Math.floor(30_000 / step) * step);
  });
});

describe("the marketing note", () => {
  const note = "Marketing set to $40,000: it cannot exceed the cash in hand.";
  it("says where the extra room came from", () => {
    expect(marketingNote(note, "raise")).toBe("Marketing set to $40,000: it cannot exceed the cash in hand plus what the raise brings.");
    expect(marketingNote(note, "listing")).toBe("Marketing set to $40,000: it cannot exceed the cash in hand plus what going public brings.");
    expect(marketingNote(note, null)).toBe(note);
    expect(marketingNote("Raise dropped: it needs 5,000 users.", "raise")).toBe("Raise dropped: it needs 5,000 users.");
  });
});
```

- [ ] **Step 3: Write the failing engine test (`src/engine/career.marketingRoom.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer, qualify } from "./careerKit";
import { listingOf, rulesForTurn } from "./career";
import { marketingRoom, normalizePlan } from "./plan";
import { HUMAN, newGame, planOf, withCompany } from "./testKit";

describe("marketing room", () => {
  const rules = rulesForTurn(CAREER_TEST, 1);
  const step = rules.pull.marketingStep;

  it("is the cash in hand, never below $0, rounded down to a step", () => {
    const game = withCompany(newCareer(), HUMAN, { cash: 31_000 });
    expect(marketingRoom(game.companies[HUMAN], planOf(game, HUMAN), 1, rules)).toBe(Math.floor(31_000 / step) * step);
    const broke = withCompany(newCareer(), HUMAN, { cash: -5_000 });
    expect(marketingRoom(broke.companies[HUMAN], planOf(broke, HUMAN), 1, rules)).toBe(0);
  });

  it("counts what going public brings", () => {
    const game = withCompany(qualify(newCareer(), HUMAN), HUMAN, { cash: 0 });
    const amount = listingOf(game.companies[HUMAN], 1, rules).amount;
    expect(marketingRoom(game.companies[HUMAN], planOf(game, HUMAN, { goPublic: true }), 1, rules)).toBe(Math.floor(amount / step) * step);
  });

  it("is the limit the plan check applies", () => {
    const game = withCompany(newCareer(), HUMAN, { cash: 31_000 });
    const checked = normalizePlan(game, HUMAN, planOf(game, HUMAN, { marketing: 10 * step }), CAREER_TEST).plan;
    expect(checked.marketing).toBe(marketingRoom(game.companies[HUMAN], checked, 1, rules));
  });

  it("is null in a race", () => {
    const game = newGame();
    expect(marketingRoom(game.companies[HUMAN], planOf(game, HUMAN), 1, DESIGN)).toBeNull();
  });
});
```

- [ ] **Step 4: Run the three files to see them fail**

Run: `npx vitest run src/ui/words.test.ts src/ui/viewModel.career.test.ts src/engine/career.marketingRoom.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 5: Implement `yearRunwayText`, `yearsLeft`, `words.ts`, `marketingRoom`, the `stepMarketing` ceiling, and the view-model changes listed above**

- [ ] **Step 6: Run the UI and engine suites**

Run: `npx vitest run src/ui src/engine`
Expected: PASS, including the unchanged `viewModel.test.ts`, `format.test.ts`, `draft.test.ts` and every
`career.*.test.ts` (the marketing note's engine text is unchanged).

- [ ] **Step 7: Run the checks, then commit**

```bash
git add src/ui/format.ts src/ui/words.ts src/ui/words.test.ts src/ui/viewModel.ts src/ui/viewModel.career.test.ts src/ui/draft.ts src/engine/plan.ts src/engine/index.ts src/engine/career.marketingRoom.test.ts
git commit -m "ui: the view model reads the year's numbers and words, and the engine says how much marketing cash allows"
```

---

### Task 4: The timeline and the year's status

**Files:**
- Create: `src/ui/careerTimeline.ts`
- Test: `src/ui/careerTimeline.test.ts`

**Interfaces:**
- Consumes: `CareerRecord`, `Milestone` (Task 1); `yearOf`, `eraIndexOf`, `upcomingShift`, `datedCardFor`, `findCard`,
  `boardPaused` from `src/engine`; `money` from `format.ts`.
- Produces:

```ts
export interface TimelineEra { readonly id: string; readonly name: string; readonly firstYear: number; readonly lastYear: number; readonly invented: boolean; readonly current: boolean }
export interface TimelineCard { readonly year: number; readonly name: string; readonly shift: boolean }
export interface TimelineMark { readonly year: number; readonly kind: Milestone["kind"]; readonly yours: boolean; readonly text: string }
export interface ShiftView { readonly name: string; readonly year: number; readonly yearsAway: number; readonly ceiling: number; readonly text: string }
export interface TimelineView {
  readonly year: number; readonly firstYear: number; readonly lastYear: number;
  readonly era: TimelineEra; readonly eras: readonly TimelineEra[];
  /** The last year of history; later years are invented. */
  readonly historyEnds: number;
  /** Dated cards of past years and this one. Future cards stay hidden, but for the shift's notice. */
  readonly cards: readonly TimelineCard[];
  readonly shift: ShiftView | null;
  readonly marks: readonly TimelineMark[];
}
export const timelineView: (game: GameState, record: CareerRecord, config: RulesConfig) => TimelineView | null; // null in a race
export const marksOf: (record: CareerRecord, config: RulesConfig) => TimelineMark[]; // [] in a race
export interface CareerStatusView {
  /** "2021 · year 32 of 49" */
  readonly heading: string;
  readonly eraName: string; readonly invented: boolean;
  readonly office: { readonly name: string; readonly capacity: number; readonly headcount: number };
  readonly nextOffice: { readonly name: string; readonly capacity: number } | null;
  readonly listedYear: number | null;
  readonly rescueYear: number | null;
  readonly boardPaused: boolean;
}
export const careerStatusView: (game: GameState, config: RulesConfig) => CareerStatusView | null; // null in a race
/** The year a card in force is dated to, or null for a random draw (and always in a race). */
export const datedYear: (event: ActiveEvent | null, turn: number, config: RulesConfig) => number | null;
/** An office in a sentence: "Own office" → "your own office" / "its own office"; any other → "the shared office". */
export const officePhrase: (name: string, whose: "your" | "its") => string;
```

Every office named in a sentence, here and in Tasks 5 and 6, goes through `officePhrase` (`"your"` for the player,
`"its"` for a rival). Mark texts (exact): launch `"Product launched"`; office ``Moved to ${officePhrase(to name, "your")}``; listed
``Went public, raising ${money(amount)}``; rescued `"Rescued from bankruptcy"` / `"Rescued when the board fired you"`;
out `"Out: bankrupt a second time"` / `"Out: fired a second time"`; rivalOut ``${name} went bankrupt`` /
``${name}'s founder was fired``; rivalIn ``${name} entered``. `yours` is true for the first five kinds. Marks keep the
record's order. Shift text: ``${name} arrives in ${year}, ${yearsAway === 1 ? "next year" : `in ${yearsAway} years`}: that year no product keeps more than quality ${ceiling}.``

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { CAREER_TEST, atTurn, newCareer, withCareerOf } from "../engine/careerKit";
import { upcomingShift } from "../engine";
import { createGame } from "../engine/setup";
import { DESIGN } from "../config.design";
import { HUMAN, newGame, withCompany } from "../engine/testKit";
import type { CareerRecord } from "../state/careerRecord";
import { careerStatusView, datedYear, marksOf, officePhrase, timelineView } from "./careerTimeline";

const real = (turn: number) => atTurn(createGame(newGameSetup(1, "Acme"), CAREER), turn);
const datedUpTo = (year: number) => CAREER.career.dated.filter((card) => card.year <= year).map((card) => card.year);

describe("the timeline", () => {
  it("shows the year, its era, the whole career's eras and where history ends", () => {
    const view = timelineView(real(32), [], CAREER)!;
    expect(view).toMatchObject({ year: 2021, firstYear: 1990, lastYear: 2038, historyEnds: 2026 });
    expect(view.era).toMatchObject({ name: "Cheap money years", firstYear: 2014, lastYear: 2021, current: true });
    expect(view.eras.map((era) => [era.name, era.firstYear, era.lastYear, era.invented])).toEqual([
      ["Dial-up dawn", 1990, 1994, false],
      ["Browser gold rush", 1995, 1999, false],
      ["Bust and broadband", 2000, 2006, false],
      ["Phones and cloud", 2007, 2013, false],
      ["Cheap money years", 2014, 2021, false],
      ["Winter and AI", 2022, 2026, false],
      ["Agent economy", 2027, 2032, true],
      ["Ambient age", 2033, 2038, true],
    ]);
  });

  it("shows dated cards up to this year, and announces a platform shift two years ahead, never earlier", () => {
    const view = timelineView(real(32), [], CAREER)!;
    expect(view.cards.map((card) => card.year)).toEqual(datedUpTo(2021));
    expect(view.cards.find((card) => card.year === 2007)).toEqual({ year: 2007, name: "The touchscreen phone", shift: true });
    const notice = upcomingShift(32, CAREER)!;
    expect(view.shift).toEqual({ name: "The chatbot", year: 2023, yearsAway: 2, ceiling: notice.ceiling, text: `The chatbot arrives in 2023, in 2 years: that year no product keeps more than quality ${notice.ceiling}.` });
    expect(timelineView(real(33), [], CAREER)!.shift?.text).toMatch(/^The chatbot arrives in 2023, next year:/);
    expect(timelineView(real(31), [], CAREER)!.shift).toBeNull();
    expect(timelineView(real(34), [], CAREER)!.shift).toBeNull();
  });

  it("marks the career's milestones by year", () => {
    const record: CareerRecord = [
      { kind: "launch", turn: 2 },
      { kind: "office", turn: 5, from: 0, to: 1 },
      { kind: "rivalOut", turn: 8, seat: 2, name: "Zed", founded: 1, reason: "fired" },
      { kind: "rivalIn", turn: 10, seat: 2, name: "Newco", pitch: "Something new." },
      { kind: "rescued", turn: 12, reason: "bankrupt" },
      { kind: "listed", turn: 23, amount: 4_000_000 },
      { kind: "office", turn: 30, from: 1, to: 2 },
    ];
    expect(marksOf(record, CAREER)).toEqual([
      { year: 1991, kind: "launch", yours: true, text: "Product launched" },
      { year: 1994, kind: "office", yours: true, text: "Moved to the shared office" },
      { year: 1997, kind: "rivalOut", yours: false, text: "Zed's founder was fired" },
      { year: 1999, kind: "rivalIn", yours: false, text: "Newco entered" },
      { year: 2001, kind: "rescued", yours: true, text: "Rescued from bankruptcy" },
      { year: 2012, kind: "listed", yours: true, text: "Went public, raising $4.00M" },
      { year: 2019, kind: "office", yours: true, text: "Moved to your own office" },
    ]);
    expect(officePhrase("Own office", "its")).toBe("its own office");
    expect(officePhrase("Full floor", "your")).toBe("the full floor");
  });

  it("is not there in a race", () => {
    expect(timelineView(newGame(), [], DESIGN)).toBeNull();
    expect(careerStatusView(newGame(), DESIGN)).toBeNull();
    expect(marksOf([{ kind: "launch", turn: 2 }], DESIGN)).toEqual([]);
  });

  it("tells a dated card from a random draw", () => {
    expect(datedYear({ cardId: "the-browser", targetId: null }, 6, CAREER)).toBe(1995);
    expect(datedYear({ cardId: "some-random-card", targetId: null }, 7, CAREER)).toBeNull();
    expect(datedYear(null, 6, CAREER)).toBeNull();
  });
});

describe("the year's status", () => {
  it("says the year, the office and what comes next", () => {
    const view = careerStatusView(newCareer(), CAREER_TEST)!;
    expect(view).toMatchObject({ heading: "1990 · year 1 of 49", eraName: "Flat", invented: false, listedYear: null, rescueYear: null, boardPaused: false });
    expect(view.office).toEqual({ name: "Garage", capacity: 4, headcount: 3 });
    expect(view.nextOffice).toEqual({ name: "Shared office", capacity: 9 });
    const campus = withCareerOf(withCompany(newCareer(), HUMAN, { headcount: 60 }), HUMAN, { office: 4 });
    expect(careerStatusView(campus, CAREER_TEST)!.nextOffice).toBeNull();
  });

  it("says when the rescue was used and that the board sits out the year after", () => {
    const rescued = atTurn(withCareerOf(newCareer(), HUMAN, { rescue: { turn: 4, reason: "fired" }, listed: { turn: 2, valuation: 1, amount: 1 } }), 5);
    expect(careerStatusView(rescued, CAREER_TEST)).toMatchObject({ heading: "1994 · year 5 of 49", rescueYear: 1993, listedYear: 1991, boardPaused: true });
    expect(careerStatusView(atTurn(rescued, 6), CAREER_TEST)!.boardPaused).toBe(false);
  });
});
```

`datedYear` compares the card in force with `datedCardFor(turn, config)`; it needs no lookup of the card itself.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ui/careerTimeline.test.ts`
Expected: FAIL, cannot resolve `./careerTimeline`.

- [ ] **Step 3: Implement `src/ui/careerTimeline.ts`**

An era's `lastYear` is the next era's `firstYear - 1`, or `yearOf(config.game.maxTurns)` for the last.
`historyEnds` is the first invented era's `firstYear - 1` (or the last year when none is invented). The status's
`office` reads `config.career.offices[self.career.office]`; `nextOffice` is the next entry, or null at the last.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/ui/careerTimeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the checks, then commit**

```bash
git add src/ui/careerTimeline.ts src/ui/careerTimeline.test.ts
git commit -m "ui: the career's timeline, milestones and the year's status, worked out for the screens"
```

---

### Task 5: Going public, the coming move, and the career's warnings

**Files:**
- Create: `src/ui/careerPlan.ts`
- Modify: `src/ui/draft.ts` (`setGoPublic`, `setRaise`), `src/ui/viewModel.ts` (`planningView` appends
  `careerWarnings` in a career)
- Test: `src/ui/careerPlan.test.ts`, `src/ui/draft.career.test.ts`

**Interfaces:**
- Consumes: `listingBlocker`, `listingOf`, `listingEffects`, `rulesForTurn`, `boardPaused`, `yearOf` from `src/engine`;
  `officePhrase` (Task 4); `Projection`; `Warning`, `WarningLevel` types from `viewModel.ts` (`import type`); `wordsFor` (Task 3).
- Produces:

```ts
// src/ui/careerPlan.ts
export interface ListingView {
  readonly blocked: "listed" | "users" | "profit" | null;
  /** Why it is not on offer; null when it is. */
  readonly blockedText: string | null;
  /** The year's bar in users. */
  readonly bar: number;
  readonly valuation: number;
  readonly amount: number;
  readonly equityAfter: number;
  readonly investorSeatsAfter: number;
  readonly hype: number;
  /** True only when chosen and on offer. */
  readonly selected: boolean;
  /** What it does, or what choosing it drops. */
  readonly text: string;
}
export const listingView: (game: GameState, draft: Plan, config: RulesConfig) => ListingView | null; // null in a race
export interface OfficeMoveView { readonly from: string; readonly to: string; readonly bill: number; readonly text: string }
export const officeMoveView: (projection: Projection, config: RulesConfig) => OfficeMoveView | null;
export const careerWarnings: (game: GameState, draft: Plan, projection: Projection, config: RulesConfig) => Warning[];

// src/ui/draft.ts
/** Choose or drop going public; choosing it drops a raise and gives the raiser back to the team. */
export const setGoPublic: (company: Company, plan: Plan, on: boolean) => Plan;
// setRaise: unchanged, except that a percent above 0 on a plan whose goPublic is true also sets goPublic: false.
// A plan without the key never gains it.
```

Exact texts:
- `blockedText` for `"users"`: ``Going public takes a year that closes with ${count(bar)} users and a profit. You have ${count(users)}.``
- for `"profit"`: ``You have the users. Going public takes a year that closes with ${count(bar)} users and a profit.``
- for `"listed"`: ``Public since ${yearOf(listed.turn)}.``
- `text` when on offer: ``Sell ${percent}% of the company for ${money(amount)}, at a ${money(valuation)} valuation. You keep ${percent(equityAfter)}, investors gain a board seat, and the company gains ${hype} hype. From then on the company is worth ${premium%} more, and it can no longer raise privately.`` with `premium%` = `percent(listing.premium - 1)` and `hype` = `listing.hype`, both from the config; when chosen and `draft.raisePercent > 0`, append `" Going public drops this year's raise."`.
- Office move `text`: ``If the team ends the year above ${capacity of from}, you move from ${officePhrase(from, "your")} to ${officePhrase(to, "your")}: a one-off bill of up to ${money(bill)}, already counted in the costs.``
- `careerWarnings`, in a career only, appended to `planningView`'s warnings before they are sorted:
  - `projection.cash < 0` and no rescue used (`danger`): ``This plan is expected to end ${year} at ${money(cash)}. Below $0 the company is rescued once: you keep half your stake and investors take the board.`` With the rescue used: ``… Below $0 your company is out, and your career ends.`` This replaces the race's cash warning, which Task 3 keeps out of a career, so it is the only warning about $0. ("half" is `rescue.equityKept` 0.5 in words; any other value as `percent(...)` "of your stake".)
  - No rescue used and `projection.boardRisk > 0` (`note`), beside the race's board warning: `"If your board fires you, the company is rescued once: you keep half your stake and investors take the board."`
  - `boardPaused(self, game.turn)` (`note`): `"After the rescue your board does not vote this year."`
  - With the rescue used and `projection.boardRisk > 0`, the race's board warning stands and this is added (`danger`): `"You have used your one rescue: if your board fires you, your career ends."`
  - Not qualified, not public, `projection.users >= bar` and `projection.profitable` (`note`): ``Close ${year} with ${count(bar)} users and a profit, and you may go public next year.``
  - Not qualified, not public, `projection.users >= bar` and not `projection.profitable` (`caution`): ``You have the users to go public, but not the profit: revenue ${money(revenue)} against costs ${money(costs.total)}. Close ${year} with a profit, and you may go public next year.``
  - On offer and not chosen (`note`): `"You may go public this year: see Go public in the plan."`
  - `projection.career?.office` not null (`caution` when `projection.cash - bill < 0`, else `note`): the office move's text.
  - `game.turn >= config.game.maxTurns` (`note`): ``Final year: after ${lastYear} the largest founder's stake (equity × valuation) wins.``

- [ ] **Step 1: Write the failing tests (`src/ui/careerPlan.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { CAREER_TEST, atTurn, newCareer, qualify, withCareerOf } from "../engine/careerKit";
import { listingOf, rulesForTurn } from "../engine";
import { defaultPlan } from "../engine/plan";
import { projectTurn } from "../engine/project";
import { HUMAN, withCompany } from "../engine/testKit";
import { viewFor } from "../engine/view";
import type { GameState, Plan } from "../engine/types";
import { count, money } from "./format";
import { listingView, officeMoveView } from "./careerPlan";
import { planningView } from "./viewModel";

const draftOf = (game: GameState, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(game.companies[HUMAN]), ...patch });
const texts = (game: GameState, draft: Plan) => planningView(game, draft, CAREER_TEST).warnings.map((w) => w.text);
const bar = rulesForTurn(CAREER_TEST, 1).ipo.users;

describe("going public in the plan", () => {
  it("offers the exact amount the year will bring", () => {
    const game = qualify(newCareer(), HUMAN);
    const view = listingView(game, draftOf(game, { goPublic: true }), CAREER_TEST)!;
    const expected = listingOf(game.companies[HUMAN], game.climate.multiplier, rulesForTurn(CAREER_TEST, 1));
    expect(view).toMatchObject({ blocked: null, blockedText: null, selected: true, amount: expected.amount, valuation: expected.valuation, equityAfter: 0.8, hype: 20 });
    expect(view.investorSeatsAfter).toBe(game.companies[HUMAN].investorSeats + 1);
    expect(projectTurn(viewFor(game, HUMAN), draftOf(game, { goPublic: true }), CAREER_TEST).career?.listing?.amount).toBe(view.amount);
    expect(view.text).toBe(`Sell 20% of the company for ${money(expected.amount)}, at a ${money(expected.valuation)} valuation. You keep 80%, investors gain a board seat, and the company gains 20 hype. From then on the company is worth 25% more, and it can no longer raise privately.`);
  });

  it("says why it is not on offer", () => {
    const fresh = newCareer();
    expect(listingView(fresh, draftOf(fresh), CAREER_TEST)).toMatchObject({ blocked: "users", blockedText: `Going public takes a year that closes with ${count(bar)} users and a profit. You have 0.` });
    const atBar = withCompany(newCareer(), HUMAN, { users: bar });
    expect(listingView(atBar, draftOf(atBar), CAREER_TEST)?.blockedText).toBe(`You have the users. Going public takes a year that closes with ${count(bar)} users and a profit.`);
    const listed = atTurn(withCareerOf(newCareer(), HUMAN, { listed: { turn: 23, valuation: 1, amount: 1 } }), 30);
    expect(listingView(listed, draftOf(listed), CAREER_TEST)).toMatchObject({ blocked: "listed", blockedText: "Public since 2012." });
  });

  it("shows a saved choice that is no longer on offer as not chosen, with the reason", () => {
    const fresh = newCareer();
    expect(listingView(fresh, draftOf(fresh, { goPublic: true }), CAREER_TEST)).toMatchObject({ selected: false, blocked: "users" });
  });

  it("says that it drops a raise chosen with it", () => {
    const game = qualify(newCareer(), HUMAN);
    expect(listingView(game, draftOf(game, { goPublic: true, raisePercent: 10 }), CAREER_TEST)!.text).toMatch(/ Going public drops this year's raise\.$/);
  });
});

describe("the career's warnings", () => {
  it("names the rescue before it is used and the end after", () => {
    const broke = withCompany(newCareer(), HUMAN, { cash: 1_000 });
    expect(texts(broke, draftOf(broke)).join(" ")).toMatch(/Below \$0 the company is rescued once: you keep half your stake and investors take the board\./);
    const used = withCareerOf(broke, HUMAN, { rescue: { turn: 1, reason: "bankrupt" } });
    expect(texts(atTurn(used, 3), draftOf(used)).join(" ")).toMatch(/Below \$0 your company is out, and your career ends\./);
  });

  it("gives one warning about $0, first, and never says bankrupt", () => {
    const broke = withCompany(newCareer(), HUMAN, { cash: 1_000 });
    const warnings = planningView(broke, draftOf(broke), CAREER_TEST).warnings;
    expect(warnings.filter((w) => w.level === "danger" && w.text.includes("$0"))).toHaveLength(1);
    expect(warnings[0].text).toMatch(/rescued once/);
    expect(warnings.map((w) => w.text).join(" ")).not.toMatch(/you go bankrupt/);
  });

  it("says the board sits out the year after a rescue", () => {
    const rescued = atTurn(withCareerOf(newCareer(), HUMAN, { rescue: { turn: 4, reason: "fired" } }), 5);
    expect(texts(rescued, draftOf(rescued))).toContain("After the rescue your board does not vote this year.");
  });

  it("shows a coming office move and its bill, and the final year", () => {
    const growing = withCompany(newCareer(), HUMAN, { headcount: 4, headcountAtLastClose: 4 });
    const draft = draftOf(growing, { allocation: { product: 1, growth: 0, recruiting: 3 }, hireLimit: null });
    const projection = projectTurn(viewFor(growing, HUMAN), draft, CAREER_TEST);
    const move = officeMoveView(projection, CAREER_TEST);
    expect(move).toMatchObject({ from: "Garage", to: "Shared office", bill: projection.career?.office?.bill });
    expect(texts(growing, draft)).toContain(move!.text);
    const last = atTurn(newCareer(), 49);
    expect(texts(last, draftOf(last))).toContain("Final year: after 2038 the largest founder's stake (equity × valuation) wins.");
  });

  it("tells a company at the bar how to qualify, and one that has qualified that it may list", () => {
    const qualified = qualify(newCareer(), HUMAN);
    expect(texts(qualified, draftOf(qualified))).toContain("You may go public this year: see Go public in the plan.");
    expect(texts(qualified, draftOf(qualified, { goPublic: true }))).not.toContain("You may go public this year: see Go public in the plan.");
  });
});
```

If `growing` does not project a move under `CAREER_TEST` (recruiting finds no one), raise its recruiting or cash in
the test until `projection.career?.office` is set; keep the assertions.

- [ ] **Step 2: Write the failing draft tests (`src/ui/draft.career.test.ts`)**

```ts
import { describe, expect, it } from "vitest";
import { newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, newGame, withCompany } from "../engine/testKit";
import { peopleAvailable, setGoPublic, setRaise } from "./draft";

describe("going public in the draft", () => {
  const game = withCompany(newCareer(), HUMAN, { headcount: 6 });
  const company = game.companies[HUMAN];
  const plan = defaultPlan(company);

  it("choosing it drops a raise and gives the raiser back", () => {
    const raising = setRaise(company, plan, 20);
    expect(peopleAvailable(company, raising)).toBe(5);
    const listing = setGoPublic(company, raising, true);
    expect(listing).toMatchObject({ goPublic: true, raisePercent: 0 });
    expect(peopleAvailable(company, listing)).toBe(6);
  });

  it("choosing a raise drops going public", () => {
    expect(setRaise(company, setGoPublic(company, plan, true), 10)).toMatchObject({ goPublic: false, raisePercent: 10 });
  });

  it("a race plan never gains the key", () => {
    const race = newGame().companies[HUMAN];
    expect("goPublic" in setRaise(race, defaultPlan(race), 20)).toBe(false);
  });
});
```

- [ ] **Step 3: Run both files to see them fail**

Run: `npx vitest run src/ui/careerPlan.test.ts src/ui/draft.career.test.ts`
Expected: FAIL, missing exports.

- [ ] **Step 4: Implement `careerPlan.ts`, `setGoPublic`, the `setRaise` change, and append `careerWarnings` in `planningView` when `config.career` is set**

`listingView` reads the blocker with `listingBlocker(self, game.turn, config)`; the amounts with
`listingOf(self, game.climate.multiplier, rules)` and `listingEffects(self, rules)`; `selected` is
`draft.goPublic === true && blocked === null`. `careerWarnings` reads `rescue` and `listed` from `self.career`.

- [ ] **Step 5: Run the UI suite**

Run: `npx vitest run src/ui`
Expected: PASS, including the unchanged race tests.

- [ ] **Step 6: Run the checks, then commit**

```bash
git add src/ui/careerPlan.ts src/ui/careerPlan.test.ts src/ui/draft.ts src/ui/draft.career.test.ts src/ui/viewModel.ts
git commit -m "ui: going public in the plan with its exact amount, the coming office move, and the career's warnings"
```

---

### Task 6: The annual report and the rivals' careers

**Files:**
- Create: `src/ui/careerReport.ts`
- Test: `src/ui/careerReport.test.ts`

**Interfaces:**
- Consumes: `CareerRecord`, `marksOf`, `TimelineMark`, `officePhrase` (Tasks 1, 4); `marketingNote` (Task 3);
  `publicCompany`, `publicReport`, `yearOf`, `boardPaused` from `src/engine`.
- Produces:

```ts
export interface CareerReportView {
  /** "Acme: 1995 annual report" */
  readonly title: string;
  /** The year in brief: this year's milestones, the player's first. */
  readonly summary: readonly string[];
  readonly listing: { readonly valuation: number; readonly amount: number; readonly equityAfter: number; readonly hype: number; readonly text: string } | null;
  readonly rescue: { readonly reason: OutReason; readonly cashBefore: number; readonly equityBefore: number; readonly equityAfter: number; readonly hype: number; readonly text: string } | null;
  readonly office: { readonly from: string; readonly to: string; readonly bill: number } | null;
  /** Quality the year's card took before the year was played. */
  readonly qualityLostToEvent: number;
  /** The board in a career's words, shown in place of the race's board lines; null leaves the race's lines. */
  readonly boardText: string | null;
  /** The one line the year's short summary leads with; null for a quiet year. */
  readonly headline: string | null;
  /** The year each seat's company went public, by seat; null for a private one. */
  readonly publicSince: readonly (number | null)[];
  readonly entrants: readonly { readonly name: string; readonly pitch: string; readonly year: number }[];
  /** Rivals going public, rescued or moving office, by name. */
  readonly moves: readonly string[];
  /** The player's plan notes, with the marketing note worded for its source. */
  readonly notes: readonly string[];
}
export const careerReportView: (game: GameState, log: TurnLog, record: CareerRecord, config: RulesConfig) => CareerReportView | null; // null in a race, or with no player report
export interface RivalCareerRow {
  readonly id: CompanyId;
  readonly foundedYear: number;
  readonly newcomer: boolean;
  readonly office: string;
  readonly listedYear: number | null;
  readonly rescueYear: number | null;
  /** For a rival that is out: the year a new startup takes its seat. */
  readonly newcomerYear: number | null;
}
export const rivalCareerRows: (game: GameState, config: RulesConfig) => RivalCareerRow[]; // [] in a race
```

Exact texts:
- `title`: ``${self.name}: ${year} annual report``.
- `summary`: the texts of `marksOf(record)` whose year is the log's year, then for `rivalIn` the following year's
  entries that this log made (their `turn` is `log.turn + 1`).
- `listing.text`: ``You went public: sold ${listingPercent}% for ${money(amount)} at a ${money(valuation)} valuation. You now own ${percent(equityAfter)}.``
- `rescue.text` for `"bankrupt"`: ``You ended the year below $0. Investors rescued the company: you went from ${percent(equityBefore)} to ${percent(equityAfter)}, they took the board, and cash was reset to ${money(cashAfter)}. A second failure ends your career.`` (`cashAfter` = `report.cash.end`); for `"fired"`: ``Your board voted to fire you. Investors rescued the company instead: you went from ${percent(equityBefore)} to ${percent(equityAfter)} and they took the board. A second failure ends your career.``
- `boardText` (the last plan's first wording point): `report.board?.fired` with a rescue →
  `"Your board voted to fire you, and this time the rescue kept you on."`; `report.board?.fired` with `report.out === "fired"` →
  `"Your board voted to fire you. You had used your one rescue: your career is over."`; `boardPaused(self, log.turn)` →
  `"After the rescue your board did not vote this year."`; otherwise null.
- `headline`: the first that is set of: `"Your company is out, and your career is over."` when `report.out` is set;
  `rescue.text`; `listing.text`; `boardText`; `summary[0]`; else null.
- `publicSince[seat]`: `yearOf(company.career.listed.turn)` for a listed company, else null.
- `moves`: from each rival's `publicReport(...).career`: ``${name} went public.``, ``${name} was rescued after going bankrupt.`` / ``${name} was rescued after its board fired the founder.``, ``${name} moved to ${officePhrase(office, "its")}.``
- `RivalCareerRow.newcomer` is `career.founded > 1`.
- `entrants`: from `log.entrants`, name and pitch from `game.companies[seat]`, `year` = `yearOf(log.turn + 1)`.
- `notes`: `report.notes` through `marketingNote(note, report.career?.listing ? "listing" : report.raise ? "raise" : null)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { CAREER_TEST, atTurn, newCareer, outSince, qualify, withCareerOf } from "../engine/careerKit";
import { BLITZ, BOOT, HUMAN, newGame, reportFor, resolve, withCompany } from "../engine/testKit";
import { DESIGN } from "../config.design";
import { milestonesOf } from "../state/careerRecord";
import type { GameState } from "../engine/types";
import { money, percent } from "./format";
import { careerReportView, rivalCareerRows } from "./careerReport";

const played = (opening: GameState, patches = {}) => {
  const result = resolve(opening, patches, 1, CAREER_TEST);
  const record = milestonesOf(opening, result.log, result.state);
  return { ...result, view: careerReportView(result.state, result.log, record, CAREER_TEST)! };
};

describe("the annual report", () => {
  it("is titled by the year and sums the year up", () => {
    const { view } = played(withCompany(newCareer(), HUMAN, { headcount: 5, headcountAtLastClose: 5 }));
    expect(view.title).toBe("Acme: 1990 annual report");
    expect(view.summary).toContain("Moved to the shared office");
    expect(view.office).toMatchObject({ from: "Garage", to: "Shared office" });
  });

  it("reports a listing with what it brought", () => {
    const { view, ...result } = played(qualify(newCareer(), HUMAN), { [HUMAN]: { goPublic: true } });
    const report = reportFor(result, HUMAN);
    const listing = report.career!.listing!;
    expect(view.listing).toMatchObject({ amount: listing.amount, valuation: listing.valuation, equityAfter: report.equity, hype: 20 });
    expect(view.listing!.text).toBe(`You went public: sold 20% for ${money(listing.amount)} at a ${money(listing.valuation)} valuation. You now own ${percent(report.equity)}.`);
  });

  it("reports a rescue, and does not call it the end", () => {
    const { view, ...result } = played(withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 }));
    const report = reportFor(result, HUMAN);
    expect(view.rescue).toMatchObject({ reason: "bankrupt", equityBefore: 1, equityAfter: report.equity });
    expect(view.rescue!.text).toMatch(/^You ended the year below \$0\. Investors rescued the company: you went from 100% to 50%, they took the board, and cash was reset to \$[\d.,KM]+\. A second failure ends your career\.$/);
  });

  it("words a board that fires the founder by what follows", () => {
    // Investors control the board, users fall, and the vote is certain in DESIGN's numbers once fireChance is 1.
    const sure = { ...CAREER_TEST, board: { ...CAREER_TEST.board, fireChance: 1 } };
    const shaky = withCompany(newCareer(), HUMAN, { investorSeats: 3, users: 5_000, usersAtLastClose: 50_000, launched: true, quality: 40 });
    const first = resolve(shaky, {}, 1, sure);
    expect(careerReportView(first.state, first.log, [], sure)!.boardText).toBe("Your board voted to fire you, and this time the rescue kept you on.");
    const again = withCareerOf(shaky, HUMAN, { rescue: { turn: 1, reason: "bankrupt" } });
    const second = resolve(atTurn(again, 3), {}, 1, sure);
    expect(careerReportView(second.state, second.log, [], sure)!.boardText).toBe("Your board voted to fire you. You had used your one rescue: your career is over.");
    const paused = resolve(atTurn(withCareerOf(shaky, HUMAN, { rescue: { turn: 4, reason: "fired" } }), 5), {}, 1, sure);
    expect(careerReportView(paused.state, paused.log, [], sure)!.boardText).toBe("After the rescue your board did not vote this year.");
  });

  it("leads the short summary with the year's most important line", () => {
    const { view } = played(withCompany(atTurn(newCareer(), 4), HUMAN, { cash: 1_000 }));
    expect(view.headline).toBe(view.rescue!.text);
    const { view: moved } = played(withCompany(newCareer(), HUMAN, { headcount: 5, headcountAtLastClose: 5 }));
    expect(moved.headline).toBe("Moved to the shared office");
    const { view: listed } = played(qualify(newCareer(), HUMAN), { [HUMAN]: { goPublic: true } });
    expect(listed.headline).toBe(listed.listing!.text);
    expect(listed.publicSince[HUMAN]).toBe(1990);
    expect(listed.publicSince[BLITZ]).toBeNull();
  });

  it("names the newcomers and the rivals' career moves", () => {
    const { view, state } = played(outSince(atTurn(newCareer(), 9), BOOT, 7));
    expect(view.entrants).toEqual([{ name: state.companies[BOOT].name, pitch: state.companies[BOOT].pitch, year: 1999 }]);
    const { view: listed } = played(qualify(newCareer(), BLITZ), { [BLITZ]: { goPublic: true } });
    expect(listed.moves).toContain("Zipp went public.");
  });

  it("is not there in a race", () => {
    const result = resolve(newGame(), {}, 1, DESIGN);
    expect(careerReportView(result.state, result.log, [], DESIGN)).toBeNull();
    expect(rivalCareerRows(newGame(), DESIGN)).toEqual([]);
  });
});

describe("the rivals' careers", () => {
  it("says when each was founded, where it works, and when a seat is refilled", () => {
    const game = withCareerOf(withCareerOf(outSince(atTurn(newCareer(), 12), BOOT, 11), BLITZ, { office: 2, listed: { turn: 8, valuation: 1, amount: 1 } }), BLITZ, { rescue: { turn: 10, reason: "fired" } });
    const rows = rivalCareerRows(game, CAREER_TEST);
    expect(rows.find((row) => row.id === BLITZ)).toEqual({ id: BLITZ, foundedYear: 1990, newcomer: false, office: "Own office", listedYear: 1997, rescueYear: 1999, newcomerYear: null });
    expect(rows.find((row) => row.id === BOOT)?.newcomerYear).toBe(2002);
  });
});
```

If the board scenario does not fire under `CAREER_TEST` with `fireChance: 1`, change the crafted company (fewer users,
low runway) until `reportFor(first, HUMAN).board?.fired` is true; keep the two expected texts.

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ui/careerReport.test.ts`
Expected: FAIL, cannot resolve `./careerReport`.

- [ ] **Step 3: Implement `src/ui/careerReport.ts`**

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/ui/careerReport.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the checks, then commit**

```bash
git add src/ui/careerReport.ts src/ui/careerReport.test.ts
git commit -m "ui: the annual report's career lines, with the board's vote worded for the rescue, and the rivals' careers"
```

---

### Task 7: The end of a career

**Files:**
- Create: `src/ui/careerEnd.ts`
- Test: `src/ui/careerEnd.test.ts`

**Interfaces:**
- Consumes: `Standing` and `TYPE_LABEL`-style labels from `viewModel.ts` (export the existing `TYPE_LABEL` constant;
  its value does not change); `marksOf`, `TimelineMark` (Task 4); `closingValuation`, `valuationOf`, `founderStake`,
  `rulesForTurn`, `yearOf` from `src/engine`; `GameEndSound` from `sound.ts`.
- Produces:

```ts
export type CareerEndKind = "stake-win" | "stake-loss" | "bankrupt" | "fired";
export interface GoneCompany { readonly name: string; readonly foundedYear: number; readonly outYear: number; readonly reason: OutReason }
/** A standing with its public mark (C5: a public company is marked as public everywhere it appears). */
export interface CareerStanding extends Standing { readonly publicSince: number | null }
export interface CareerEndView {
  readonly kind: CareerEndKind;
  readonly won: boolean;
  readonly sound: GameEndSound;
  /** The year the player's career ended in. */
  readonly year: number;
  readonly title: string;
  readonly text: string;
  /** Companies in the game at the end, the winner first, then by founder's stake; those out at the end follow, latest first. */
  readonly standings: readonly CareerStanding[];
  /** Rivals that went out and whose seat a newcomer took: no longer in the game, so not in the standings. */
  readonly gone: readonly GoneCompany[];
  readonly marks: readonly TimelineMark[];
}
export const careerEndView: (game: GameState, record: CareerRecord, config: RulesConfig) => CareerEndView | null;
```

Rules: null while the player is in and there is no outcome, and in a race. Valuation of a company still in is
`closingValuation(valuationOf(users, hype, game.climate.multiplier, rules), company, false, rules)` with
`rules = rulesForTurn(config, game.turn)`, which is what the engine ranks by; a company out has valuation and stake 0.
Sort as `endView` does. `gone`: each `rivalOut` milestone of the record (it carries `seat`, `name` and `founded`) whose
seat is now held by a company with a later `founded`. `publicSince` is `yearOf(career.listed.turn)` or null.
Kind: `self.out.reason` when the player is out, else stake-win/stake-loss by `outcome.winnerId`. Sounds: win, loss,
bankrupt, fired.

Copy (exact):
- stake-win: title `"You finished on top."`, text ``After ${lastYear}, your founder's stake, ${money(stake)}, is the largest.``
- stake-loss: title ``${winner} finished on top.``, text ``After ${lastYear}, ${winner}'s founder holds ${money(winnerStake)}; your stake is ${money(stake)}.``
- bankrupt: title ``${self.name} ran out of cash again.``, text ``You ended ${year} below $0 for the second time. Your one rescue was in ${rescueYear}, so your career is over.``
- fired: title `"Your board fired you again."`, text ``Investors held your board, and ${year} was a bad year. Your one rescue was in ${rescueYear}, so your career is over.``

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { choosePlans } from "../ai/choosePlans";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { CAREER_TEST, atTurn, newCareer, withCareerOf } from "../engine/careerKit";
import { createGame, defaultPlan, resolveTurn } from "../engine";
import { BOOT, HUMAN, resolve, withCompany } from "../engine/testKit";
import type { GameState, TurnLog } from "../engine/types";
import { milestonesOf, type CareerRecord } from "../state/careerRecord";
import { careerEndView } from "./careerEnd";

/** A whole career as the store plays it: the player's plan is the default plan every year. */
const wholeCareer = (seed: number): { game: GameState; log: TurnLog; record: CareerRecord } => {
  let game = createGame(newGameSetup(seed, "Acme"), CAREER);
  let log: TurnLog | null = null;
  let record: CareerRecord = [];
  while (game.outcome === null && game.companies[HUMAN].out === null) {
    const human = game.companies.map((company) => (company.id === HUMAN ? defaultPlan(company) : null));
    const result = resolveTurn(game, choosePlans(game, seed, CAREER, human), seed, CAREER);
    record = [...record, ...milestonesOf(game, result.log, result.state)];
    game = result.state;
    log = result.log;
  }
  return { game, log: log!, record };
};

describe("the end of a career", () => {
  it("ranks by founder's stake exactly as the engine chose the winner", () => {
    const { game, log, record } = wholeCareer(1);
    const view = careerEndView(game, record, CAREER)!;
    expect(view.year).toBe(2038);
    expect(view.standings[0].id).toBe(game.outcome!.winnerId);
    for (const standing of view.standings.filter((each) => each.out === null)) expect(standing.valuation).toBe(log.companies[standing.id]!.valuation);
    expect(view.kind).toBe(game.outcome!.winnerId === HUMAN ? "stake-win" : "stake-loss");
    expect(view.text).toMatch(/^After 2038, /);
    expect(view.marks.length).toBe(record.length);
    for (const standing of view.standings) {
      const listed = game.companies[standing.id].career?.listed ?? null;
      expect(standing.publicSince).toBe(listed === null ? null : listed.turn + 1989);
    }
  });

  it("ends the career at a second failure, after the rescue", () => {
    const again = withCareerOf(withCompany(atTurn(newCareer(), 12), HUMAN, { cash: 1_000 }), HUMAN, { rescue: { turn: 4, reason: "bankrupt" } });
    const { state } = resolve(again, {}, 1, CAREER_TEST);
    expect(careerEndView(state, [], CAREER_TEST)).toMatchObject({
      kind: "bankrupt",
      won: false,
      sound: "bankrupt",
      year: 2001,
      title: "Acme ran out of cash again.",
      text: "You ended 2001 below $0 for the second time. Your one rescue was in 1993, so your career is over.",
    });
  });

  it("lists a rival whose seat was taken by a newcomer, by its own name", () => {
    const record: CareerRecord = [{ kind: "rivalOut", turn: 8, seat: BOOT, name: "Oakline", founded: 1, reason: "fired" }];
    const replaced = withCareerOf(withCompany(newCareer(), BOOT, { name: "Newco" }), BOOT, { founded: 10 });
    const ended = withCareerOf(withCompany(atTurn(replaced, 12), HUMAN, { cash: 1_000 }), HUMAN, { rescue: { turn: 4, reason: "bankrupt" } });
    const { state } = resolve(ended, {}, 1, CAREER_TEST);
    const view = careerEndView(state, record, CAREER_TEST)!;
    expect(view.gone).toEqual([{ name: "Oakline", foundedYear: 1990, outYear: 1997, reason: "fired" }]);
    expect(view.standings.map((standing) => standing.name)).toContain("Newco");
    expect(view.standings.map((standing) => standing.name)).not.toContain("Oakline");
  });

  it("is null while the career goes on", () => {
    expect(careerEndView(newCareer(), [], CAREER_TEST)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ui/careerEnd.test.ts`
Expected: FAIL, cannot resolve `./careerEnd`.

- [ ] **Step 3: Implement `src/ui/careerEnd.ts`, exporting `TYPE_LABEL` from `viewModel.ts`**

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run src/ui/careerEnd.test.ts`
Expected: PASS (the whole-career test plays 49 years; it should take a few seconds).

- [ ] **Step 5: Run the checks, then commit**

```bash
git add src/ui/careerEnd.ts src/ui/careerEnd.test.ts src/ui/viewModel.ts
git commit -m "ui: the end of a career, ranked by founder's stake as the engine ranks it, with the companies gone"
```

---

### Task 8: How to play a career

**Files:**
- Create: `src/ui/careerHelp.ts`
- Modify: `src/ui/components/HowToPlay.tsx` (a career branch; the race's text does not change)
- Test: `src/ui/careerHelp.test.ts`

**Interfaces:**
- Consumes: `yearOf`, `rulesForTurn` from `src/engine`; `count`, `money`, `percent` from `format.ts`.
- Produces:

```ts
export interface HelpSection { readonly title: string; readonly text: string }
export const careerHelp: (config: RulesConfig) => readonly HelpSection[]; // [] in a race
```

Titles, in order (exact): "The goal", "One year at a time", "Eras and history", "Product, Growth, Recruiting",
"Cash and raising money", "Going public", "Offices", "One rescue", "Rivals come and go". Every number comes from the
config: first and last year, the listing's percent, premium and hype, the offices' names and sizes, the moving bill
in years of salary ("half a year" for 0.5), the rescue's share kept ("half" for 0.5), the shift notice in years.
Numbers that change with the era (salaries, prices, the bar) are not given as numbers: the text says the plan shows
the year's.

No config change: the `home-helper-recall` card's text was already reworded by the tuning work (`src/config.ts`,
recorded in the Tuning log of `docs/career-rules.md`); keep it.

`HowToPlay.tsx`: when `config.career !== undefined`, render `careerHelp(config)` as the same `dl` of `dt`/`dd`;
otherwise the existing JSX, untouched.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { careerHelp } from "./careerHelp";

describe("how to play a career", () => {
  const help = careerHelp(CAREER);
  const all = help.map((section) => `${section.title} ${section.text}`).join(" ");

  it("has its sections in order", () => {
    expect(help.map((section) => section.title)).toEqual(["The goal", "One year at a time", "Eras and history", "Product, Growth, Recruiting", "Cash and raising money", "Going public", "Offices", "One rescue", "Rivals come and go"]);
  });

  it("speaks in years, never turns or quarters", () => {
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
    expect(help[0].text).toContain("1990");
    expect(help[0].text).toContain("2038");
  });

  it("takes its numbers from the config", () => {
    const sizes = CAREER.career.offices.map((office) => `${office.name} ${office.capacity}`).join(", ");
    expect(help.find((s) => s.title === "Offices")!.text).toContain(sizes);
    expect(help.find((s) => s.title === "Going public")!.text).toMatch(/20%.*25%/);
    expect(help.find((s) => s.title === "One rescue")!.text).toContain("half");
  });

  it("is empty for a race", () => {
    expect(careerHelp(DESIGN)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run src/ui/careerHelp.test.ts`
Expected: FAIL, cannot resolve `./careerHelp`.

- [ ] **Step 3: Implement `careerHelp.ts` and the `HowToPlay.tsx` branch**

- [ ] **Step 4: Run the UI and config tests**

Run: `npx vitest run src/ui`
Expected: PASS.

- [ ] **Step 5: Run the checks, then commit**

```bash
git add src/ui/careerHelp.ts src/ui/careerHelp.test.ts src/ui/components/HowToPlay.tsx
git commit -m "ui: how to play a career, in years, with its numbers from the config"
```

---

### Task 9: Choosing the mode, and the game screen in years with the timeline

**Files:**
- Create: `src/ui/components/Timeline.tsx`, `src/ui/components/CareerStatus.tsx`, `scripts/race-text.mjs`,
  `scripts/race-text.snapshot.json`
- Modify: `src/App.tsx`, `src/ui/screens/NewGameScreen.tsx`, `src/ui/screens/GameScreen.tsx`,
  `src/ui/components/ResourceBar.tsx`, `src/ui/components/EventBanner.tsx`

**Interfaces:**
- Consumes: store fields `mode`, `config`, `configs`, `record`, `resumable`, `preferred`, `startCareer`, `resume`,
  `leave` (Task 2); `wordsFor`, `Words` (Task 3);
  `timelineView`, `careerStatusView`, `datedYear` (Task 4); `careerEndView` (Task 7) for the ending sound; `careerHelp`
  through `HowToPlay` (Task 8).
- Produces (props later tasks rely on):

```ts
// Timeline.tsx
export const Timeline: (props: { view: TimelineView; marks?: readonly TimelineMark[] }) => JSX.Element; // <section aria-label="Timeline">
// CareerStatus.tsx
export const CareerStatus: (props: { view: CareerStatusView }) => JSX.Element; // <section aria-label="Your career">
// ResourceBar: props become { view: ResourceView; boardRunwayTurns: number; words: Words; rescueUsed: boolean } (false in a race)
// EventBanner: props become { event: EventView; words: Words; datedYear: number | null; historyEnds: number | null }
//   (historyEnds is the timeline's, null in a race: a dated year after it shows "Ahead", up to it "History")
// race-text.mjs
// node scripts/race-text.mjs [--no-build] [--write]: plays the race and compares its text with the snapshot, or writes it
```

**The race's text is recorded first.** `scripts/race-text.mjs` builds (`npx vite build`) unless `--no-build`, serves
`dist` with `vite preview` on port 4181, and in headless Chromium at 1280×800 with fresh storage: stubs the analytics
script (as Task 12 does), starts a Quick race named "Race Co" with seed 20417 (typed into "Replay a game with its
seed"), and for three quarters collects, in order, the game screen's text and then the open report's text, then clicks
the report's button. "Text" is `document.querySelector("main")`'s `innerText` (the dialog's root for the report) plus,
in document order, every `title` and `aria-label` attribute under it, one per line. The first screen is not recorded:
it gains the mode choice. With `--write` it saves the list as `scripts/race-text.snapshot.json`; without, it exits 1
naming the first line that differs. It exports `raceText(page)` for Task 12 to reuse.

What each screen does:
- `NewGameScreen`: a `Segmented` labelled "Mode" with `{ key: "race", label: "Quick race", sub: "20 quarters" }` and
  `{ key: "career", label: "Career", sub: "1990 to 2038" }`, preselected from the store's `preferred`. Race: today's
  heading, text and button, unchanged. Career: heading `"Run one company from 1990 to 2038."`, text
  ``Play ${maxTurns} years, one at a time, from a garage through eight eras of technology. Go public when you choose; survive one rescue; the largest founder's stake after ${lastYear} wins.``,
  button `"Start in 1990"`, calling `startCareer(name, seed)`. "How to play" below shows `HowToPlay` with
  `configs[mode]`. No `CONFIG` import. When `resumable.career` or `resumable.race` is set, a row above the form offers
  ``Resume your career (${yearOf(turn)})`` / ``Resume your race (${quarter(turn)})``, each calling `resume(mode)`;
  under the start button of a mode with a save, the line `"Starting anew replaces the saved one."`.
- `App.tsx`: unchanged routing; comments say "year or quarter".
- `GameScreen`: in a career, the "New game" confirmation offers "Save and leave" (`leave`) beside "Abandon game"
  and "Keep playing"; the race's confirmation is unchanged. `const config = useGame((s) => s.config)`, `const record = useGame((s) => s.record)`,
  `const words = useMemo(() => wordsFor(config), [config])`; every view called with `config`; no `CONFIG` import. The
  header's second part is `status.heading` in a career (``${words.when(turn)} of ${maxTurns}`` stays in the race). In a
  career, below the header: `Timeline` then `CareerStatus` above the `ResourceBar`. `ResourceBar` gets
  `boardRunwayTurns={rulesForTurn(config, game.turn).board.runwayTurns}` and `words`; `EventBanner` gets
  `datedYear={datedYear(game.event, game.turn, config)}` and `historyEnds={timeline?.historyEnds ?? null}`. The bottom bar says ``Cash after ${words.when(turn)}`` and
  ``End ${words.when(turn)}``. The ending sound comes from `careerEndView(...).sound` in a career, `endView` in the
  race. `PlanningPanel` receives `config={rulesForTurn(config, game.turn)}`.
- `ResourceBar`: every period word through `words` (the race's strings come out the same): "how many quarters it
  lasts" through `words.periods`, "qtr"/"qtrs" through `words.short`. In a career the users tooltip says
  ``Close a year with ${count(ipoUsers)} users and a profit, and you may go public.``, the stake tooltip
  ``After ${lastYear}, the largest founder's stake wins.``, and the cash tooltip
  ``Cash in the bank. Runway is how many years it lasts at last year's burn: ${words.runway(runway)}. End a year below $0 and the company is rescued once; a second time ends your career.``
  (with the rescue used: ``… End a year below $0 and your career ends.``, which needs `rescueUsed: boolean` passed
  from `careerStatusView(...).rescueYear !== null`); the race's tooltips are unchanged.
- `EventBanner`: `aria-label` ``This ${words.period}'s event``; in a career a dated card shows `"History"` (or
  `"Ahead"` when `datedYear > historyEnds`) with its year in place of `"Event"`, a random draw shows `"Event"`. The
  card's name and text carry `data-card-text` (the browser check skips config text).
- `Timeline`: one row of eras whose widths are proportional to their years, the current era highlighted, a dashed
  line after `historyEnds` labelled "history ends", a tick for each card (◇ for a shift), a "you are here" marker at
  the year, a mark per milestone (title = its text), and the shift notice's text under the row when there is one.
  It draws `marks` when the prop is given (the end screen), else `view.marks`. Under the strip, a visually hidden
  (`sr-only`) `<ul aria-label="Milestones">` with one `<li>` per mark, ``${year}: ${text}``, and one per card,
  ``${year}: ${name}``, so a screen reader and the browser check can read them.
  Fits 1280 px; at 390 px it may scroll inside its own box but not widen the page.
- `CareerStatus`: one line: era (with "(imagined)" when invented), ``${office.name}: ${headcount} of ${capacity} people``,
  the next office and its size, `Public since ${listedYear}` or `Private`, `Rescue used in ${rescueYear}` or
  `Rescue not used`, and the board note when `boardPaused`.

- [ ] **Step 1: Record the race's text before any component changes**

Write `scripts/race-text.mjs`, then run `node scripts/race-text.mjs --write` on the commit before this task's
component changes. Expected: `scripts/race-text.snapshot.json` written with six entries (three game screens, three
reports). Run it again without `--write`: exit 0. Commit both files on their own:
`git commit -m "scripts: record the race's on-screen text, to prove the career leaves it unchanged"`.

- [ ] **Step 2: Make the changes above**

- [ ] **Step 3: Run the checks and the race's text**

Run: `npx tsc -b && npx eslint . --max-warnings=0 && npm test && node scripts/race-text.mjs`
Expected: PASS; the race's text matches the snapshot exactly. Never rewrite the snapshot to make it pass.

- [ ] **Step 4: Look at it in a browser**

Run `npm run dev`, then with Playwright (a throwaway script in the scratchpad, not committed) at 1280×800: start a
Quick race and check the header reads "Q1 of 20" and the button "End Q1"; abandon; start a Career with seed 1 and
check the header contains "1990 · year 1 of 49", the timeline shows "Dial-up dawn", the status shows "Garage: 3 of 4
people", the button reads "End 1990"; take a screenshot of each and look at them.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/ui/screens/NewGameScreen.tsx src/ui/screens/GameScreen.tsx src/ui/components/Timeline.tsx src/ui/components/CareerStatus.tsx src/ui/components/ResourceBar.tsx src/ui/components/EventBanner.tsx
git commit -m "ui: choose Career or Quick race; the career's game screen in years, with the timeline and the year's status"
```

---

### Task 10: The plan and its projection in a career

**Files:**
- Create: `src/ui/components/GoPublicRow.tsx`
- Modify: `src/ui/components/PlanningPanel.tsx`, `src/ui/components/ProjectionCard.tsx`,
  `src/ui/screens/GameScreen.tsx` (pass the new props)

**Interfaces:**
- Consumes: `listingView`, `officeMoveView` (Task 5); `setGoPublic` (Task 5); `stepMarketing` with its ceiling
  (Task 3); `Words` (Task 3).
- Produces:

```ts
// PlanningPanel props become { company, turn, draft, view, config, words: Words, listing: ListingView | null, onChange }
// ProjectionCard props become { company, view, words: Words, move: OfficeMoveView | null }
export const GoPublicRow: (props: { listing: ListingView; company: Company; draft: Plan; onChange: (plan: Plan) => void }) => JSX.Element;
```

- `PlanningPanel`: every "quarter" through `words` (race output unchanged: "Plan for Q3", "No spend this quarter.", …;
  "No raise for the 2 quarters after" is ``plural(n, words.period, words.periods)``).
  `config` is the year's rules (Task 9 passes them), so the salary, growth coefficient and raise cooldown it reads are
  the year's. Marketing steps call `stepMarketing(draft, n, config, view.marketing.max)`. When `listing` is not null,
  a "Go public" section sits between "Raise money" and "Poach": `GoPublicRow`.
- `GoPublicRow`: a `Segmented` labelled "Go public" with `{ key: "private", label: "Stay private" }` and
  `{ key: "public", label: "Go public", sub: money(amount), disabled: blocked !== null, title: blockedText }`, selected
  `"public"` when `listing.selected`; choosing calls `onChange(setGoPublic(company, draft, key === "public"))`. Under it,
  `listing.blockedText ?? listing.text`. When `blocked === "listed"`, only the line "Public since 2012." shows, no
  control.
- `ProjectionCard`: "Cash at quarter end" becomes ``Cash at ${words.period} end``, "Team next quarter ~" becomes
  ``Team next ${words.period} ~``, runway through `words.runway`. In a career, when `move` is not null, a line
  "Office move" with ``${move.from} → ${move.to}, ${money(move.bill)}`` and, when the projection's costs include
  `moving`, a "Moving" amount beside revenue and costs.

- [ ] **Step 1: Make the changes above**

- [ ] **Step 2: Run the checks and the race's text**

Run: `npx tsc -b && npx eslint . --max-warnings=0 && npm test && node scripts/race-text.mjs`
Expected: PASS; the race's text matches the snapshot exactly.

- [ ] **Step 3: Look at it in a browser**

With a throwaway Playwright script: start a career with seed 1, check "Go public" shows disabled with the "Going
public takes a year that closes with … users and a profit." line; choose "Sell 10%" if on offer and check the hint
says "year"; set Recruiting to 3 and "Hire at most" to no limit and check the projection shows "Office move" with
"Garage → Shared office". Screenshot and look.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/GoPublicRow.tsx src/ui/components/PlanningPanel.tsx src/ui/components/ProjectionCard.tsx src/ui/screens/GameScreen.tsx
git commit -m "ui: the plan offers Go public with its exact amount, and the projection shows a coming move and its bill"
```

---

### Task 11: The annual report, the rivals and the end screen in a career

**Files:**
- Create: `src/ui/components/CareerReportLines.tsx`, `src/ui/components/YearSummary.tsx`
- Modify: `src/ui/components/QuarterReport.tsx`, `src/ui/components/RivalsPanel.tsx`,
  `src/ui/screens/EndScreen.tsx`, `src/ui/screens/GameScreen.tsx` (pass the new props)

**Interfaces:**
- Consumes: `careerReportView`, `rivalCareerRows` (Task 6); `careerEndView` (Task 7); `Timeline`, `marksOf` (Tasks 4, 9);
  `Words` (Task 3); `ReportView` from `viewModel.ts`.
- Produces:

```ts
// QuarterReport props become { companyName, view, over, words: Words, career: CareerReportView | null, datedNext: number | null, onClose }
// RivalsPanel props become { you, rivals, words: Words, careers: readonly RivalCareerRow[] }
export const CareerReportLines: (props: { view: CareerReportView }) => JSX.Element;
export const YearSummary: (props: { career: CareerReportView; view: ReportView; over: boolean; onFull: () => void; onClose: () => void }) => JSX.Element;
```

- **The short summary comes first** (design sections 4 and 17). In a career the report dialog opens on `YearSummary`:
  label `"The year in brief"`, title `career.title`, `career.headline` when set, the `career.summary` lines, cash at the
  year's end (`view.books.cashEnd`) and users at its end (`view.users`), and two buttons: "Full report" (`onFull`,
  which shows `QuarterReport` in the same dialog) and ``Plan ${words.when(turn + 1)}`` (or "See how it ended" when
  `over`). The full report has the same close button. Which of the two shows is local state in `GameScreen`, reset to
  the summary each time the dialog opens. The race opens straight on `QuarterReport`, as today.

- `QuarterReport`: race output unchanged. In a career: the title is `career.title`, the label `words.report`
  ("Annual"); "The year in brief" (`career.summary`) under the title when not empty; `CareerReportLines` after the
  books (listing, rescue, office move and bill, quality lost to the year's card, hype from listing and rescue); a
  "Moving" cost line when `books.costs.moving` is set; when `career.boardText` is set it replaces both of the race's
  board lines ("…They voted, and kept you on." and "…voted, and fired you."), so a year after a rescue reads "After the
  rescue your board did not vote this year."; notes are `career.notes`; rivals' moves are `view.moves` then `career.moves`, then
  one line per entrant: ``${name}, a new startup, enters in ${year}: ${pitch}``; "A quiet year…", "next year",
  ``Coming in ${words.when(turn + 1)}``, ``Plan ${words.when(turn + 1)}`` through `words`. The next card is marked as
  dated when `datedNext` is set. Card texts carry `data-card-text`.
- `RivalsPanel`: race output unchanged. In a career the bar's heading is
  ``This year's bar to go public: ${count(ipoUsers)} users`` and its hint
  `"A company that closes a year at the bar with a profit may go public. Going public ends nothing."`; each rival card
  adds a line from its row: founded year (and "new" for a newcomer), office, `Public since …` / `Private`,
  `Rescued in …`; an out rival shows ``Out in ${year}. A new startup takes this seat in ${newcomerYear}.``; "Qn" texts
  go through `words.when`.
- `EndScreen`: reads `config` and `record` from the store. Race: unchanged. Career: `careerEndView`; label
  ``${won ? "You win" : "Career over"} · ${year}``; title and text; "Final standings" as today (stake line in years:
  ``Bankrupt in ${year}`` / ``Founder fired in ${year}``), with ``Public since ${publicSince}`` on each listed company; "Gone" with each `GoneCompany` as
  ``${name}, founded ${foundedYear}: ${reason === "bankrupt" ? "went bankrupt" : "founder fired"} in ${outYear}.``;
  "Your career" with `Timeline` (marks = `view.marks`); buttons "Play again" and "Last year's report"; the seed hint
  says "start a new career with it". "Play again" calls `abandon`, which sets `preferred: "career"`, so the first
  screen comes back with Career chosen.

- [ ] **Step 1: Make the changes above**

- [ ] **Step 2: Run the checks and the race's text**

Run: `npx tsc -b && npx eslint . --max-warnings=0 && npm test && node scripts/race-text.mjs`
Expected: PASS; the race's text matches the snapshot exactly.

- [ ] **Step 3: Look at it in a browser**

With a throwaway Playwright script: play a career with seed 1 to 1993; each year read the summary (label "The year
in brief", button "Full report"), open the full report (title "…: 1990 annual report", label "Annual", button
"Plan 1991"); check the rivals panel's heading; screenshot and look.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/CareerReportLines.tsx src/ui/components/YearSummary.tsx src/ui/components/QuarterReport.tsx src/ui/components/RivalsPanel.tsx src/ui/screens/EndScreen.tsx src/ui/screens/GameScreen.tsx
git commit -m "ui: the annual report, the rivals' careers and the end of a career on screen"
```

---

### Task 12: The browser check of a whole career

**Files:**
- Create: `scripts/career-fixtures.ts`, `scripts/career-check.mjs`

**Interfaces:**
- Consumes: `CAREER`; `createGame`, `resolveTurn`, `defaultPlan`, `rulesForTurn`, `listingOf`, `viewFor`,
  `projectTurn`, `CAREER_PITCHES` from `src/engine`; `choosePlans`, `newGameSetup`, `baselinePlan` from `src/ai`;
  `serializeCareerSave`, `parseCareerSave` (Task 2); `money` from `src/ui/format.ts`; `raceText` and the snapshot
  (Task 9).
- Produces: `npx tsx scripts/career-fixtures.ts` prints one JSON object to stdout:

```ts
{
  listing: { save: string; year: number; amount: string }; // a career save, qualified and private, amount as money() writes it
  rescue: { save: string; year: number };                  // a career save in which the year ends below $0, rescue unused
  failure: { save: string; year: number };                 // the same with the rescue used: the year ends the career
  board: { save: string; year: number };                   // investors hold the board, and this save's seed makes the vote fire the founder
  office: { save: string; year: number };                  // 1990, 4 people in the garage, a draft that recruits past it
  campus: { save: string; year: number };                  // 150 people on the campus
}
```

Every fixture's game is made with `createGame(newGameSetup(seed, "Check Co", "human", CAREER_PITCHES), CAREER)`.
`listing`: play seeds from 1, seat 0 planned by `baselinePlan(viewFor(state, 0), CAREER)` and the rest by
`choosePlans` (as `src/sim/runCareer.ts` does), until an opening state in which seat 0 has `career.qualified` and
`listed === null`; save it with `defaultPlan`, `record: []`, `reportOpen: false`; `amount` =
`money(listingOf(self, climate, rulesForTurn(CAREER, turn)).amount)`. `rescue`: a new career (seed 1) dated to turn 12
with the player's cash set to 1,000. `failure`: the same with `career.rescue = { turn: 5, reason: "bankrupt" }`.
`board`: a new career dated to turn 20, the player launched with `investorSeats` above `founderSeats`, users well
below `usersAtLastClose`, cash enough to stay above $0; try seeds from 1 until resolving the year with the default
plan fires the founder (`board.fired`), and save with that seed. `office`: a new career (seed 1), headcount 4, a draft
of `{ allocation: { product: 1, growth: 0, recruiting: 3 }, hireLimit: null }` whose projection has
`career.office` set. `campus`: a new career (seed 1) dated to turn 30 with headcount 150 and `career.office: 4`. Each
save must pass `parseCareerSave` before it is printed. The script exits 1 if a search finds nothing within 200 seeds
or a crafted fixture does not show its event.

`node scripts/career-check.mjs [--no-build] [--shots <dir>]` builds (`npx vite build`) unless `--no-build`, serves
`dist` with `vite preview` on port 4180, runs headless Chromium at 1280×800, and exits 1 on the first failed assertion,
naming it. It fails on any console error or page error. Before the first navigation of every page it stubs the
analytics script that `App.tsx` loads in a production build, which `vite preview` cannot serve:
`page.route("**/_vercel/insights/**", (route) => route.fulfill({ contentType: "text/javascript", body: "" }))`.
`App.tsx` does not change. "Forbidden words" means the page's text, with every element carrying `data-card-text`
removed, matching `/\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i`. "The milestones" means the `li` texts of the
timeline's `ul[aria-label="Milestones"]`.

Assertions, in order:

1. **Race unchanged.** Fresh storage. The first screen offers "Quick race" and "Career", Quick race chosen.
   `raceText(page)` from `scripts/race-text.mjs` matches `scripts/race-text.snapshot.json` exactly. Then start a Quick
   race named "Race Co": the header contains "Q1 of 20", the button reads "End Q1"; end it: the dialog's title is
   "Race Co: Q1 report" and its button "Plan Q2". Abandon. Storage has neither key.
2. **The first screen in Career.** Choose Career: no forbidden words; open "How to play": no forbidden words.
3. **A whole career.** Start a Career named "Check Co" with seed 1. For each year from 1990 to 2038: the header
   contains ``${year} · year ${year - 1989} of 49``; the timeline section is visible and names the year's era (Dial-up
   dawn from 1990, Browser gold rush 1995, Bust and broadband 2000, Phones and cloud 2007, Cheap money years 2014,
   Winter and AI 2022, Agent economy 2027, Ambient age 2033) and its "history ends" line; the bottom button reads
   ``End ${year}``; no forbidden words; in 2021 and 2022 the timeline shows "The chatbot arrives in 2023"; in 1995 the
   event card's label is "History 1995"; from 2027, a dated card in force is labelled ``Ahead ${year}``, and at least
   one such year is seen. Click the button: the summary shows, labelled "The year
   in brief", with no forbidden words; click "Full report": the title is ``Check Co: ${year} annual report``, the label
   "Annual", no forbidden words; its button reads ``Plan ${year + 1}``, or "See how it ended" in 2038. When the
   milestones gain a line ending "entered", the rivals panel shows "new" on that rival. In 2005, reload: the header
   still reads 2005. In 2010, choose "New game" then "Save and leave": the first screen offers "Resume your career
   (2010)"; choose it: the header reads 2010. By the end the milestones include "Product launched". After 2038 the end
   screen shows "Final standings" with four entries, "Your career" with the timeline, "Gone" when the milestones name a
   rival that went out and was replaced, and no forbidden words. Reload: the end screen is still there. "Last year's
   report" opens the 2038 report. "Play again": the first screen, Career chosen, and no career key in storage. Take a
   screenshot of 1990, 2007, 2023 and the end with `--shots`.
4. **Going public.** Fresh storage with `listing.save` under `startupworld:career:save`; load. The "Go public" control
   is enabled and shows `listing.amount`. Choose it, end the year, open the full report: it says "You went public" and
   shows the amount; close it: the plan shows ``Public since ${listing.year}`` and the raise options are disabled with
   "A public company cannot raise privately."
5. **The rescue.** Fresh storage with `rescue.save`; load; the bottom bar's warning mentions "rescued once"; end the
   year: the summary's headline says "Investors rescued the company"; close it: the game goes on, the status says
   ``Rescue used in ${rescue.year}``, and the plan says "After the rescue your board does not vote this year."
6. **Fired and rescued.** Fresh storage with `board.save`; load; end the year: the full report says "Your board voted
   to fire you, and this time the rescue kept you on."; close it: the game goes on.
7. **The second failure.** Fresh storage with `failure.save`; load; end the year: the summary is shown first and its
   button reads "See how it ended"; close it: the end screen's title is "Check Co ran out of cash again." and its text
   names 2001 and the rescue's year 1994; reload: the end screen is still there.
8. **An office move.** Fresh storage with `office.save`; load: the projection shows "Office move" and
   "Garage → Shared office"; end the year: the full report has a "Moving" line, and the status names the shared office.
9. **A full campus.** Fresh storage with `campus.save`; load: every poach option is disabled, and "Your campus is full:
   nobody more can join." is on the page (as text or a `title`).
10. **No sideways scroll at a narrow width.** At 390×844 with a career in progress:
   `document.documentElement.scrollWidth <= 390`.

- [ ] **Step 1: Write `scripts/career-fixtures.ts` and run it**

Run: `npx tsx scripts/career-fixtures.ts | head -c 300`
Expected: a JSON object beginning `{"listing":{"save":"{\"version\":1,`.

- [ ] **Step 2: Write `scripts/career-check.mjs` in the style of `scripts/world-check.mjs` and run it**

Run: `node scripts/career-check.mjs --shots /tmp/career-shots`
Expected: every assertion printed as passed, exit 0, four screenshots written. Look at the screenshots.

- [ ] **Step 3: Fix what the check finds in the screens, then run it again**

Any forbidden word or failed assertion is fixed in the screen or view module that produced it (with a unit test
added to that module's career test file when the fix is in a `.ts` module), never by loosening the check.

- [ ] **Step 4: Run the checks, then commit**

```bash
git add scripts/career-fixtures.ts scripts/career-check.mjs
git commit -m "scripts: a browser check that plays a whole career, a listing, a rescue, a move and a second failure"
```

---

## Coverage of the spec

| What the spec asks | Task |
|---|---|
| Choosing Career or Quick race; the race unchanged, its on-screen text recorded and compared (sections 2, 11) | 2, 9, 12 |
| A race save and a career save do not disturb each other; a save this build cannot use starts a new career (12) | 2, 9 |
| The year, the era, the timeline: dated cards, the shift's notice, milestones, where history ends (4, 5 C3 C4, 6) | 4, 9 |
| "Go public" with the exact amount and the reason when not on offer; no private raise after (C5, C6) | 3, 5, 10 |
| Marketing paid from cash in hand, worded for a raise or a listing (C11) | 3 |
| The office and a coming move with its bill in the projection (C9) | 3, 5, 10 |
| The rescue, its price, the board's year off; the end at a second failure (C7) | 2, 5, 6, 7, 9 |
| Rivals that go out and newcomers (C8) | 1, 6, 7, 11 |
| The short summary after each year, with the full annual report one tap away (4, 15, 17) | 6, 11 |
| The end after 2038 with standings by founder's stake and the career along the timeline (4, C10) | 7, 11 |
| The career's own save, version and record of milestones (12) | 1, 2 |
| Every number read from the year's rules (C2) | 3, 9, 10 |
| Every text in years; the two wording points; the starting rivals' pitches | 2, 3, 6, 8, 9 to 12 |
| How to play a career | 8 |
| A real-browser check of a whole career on desktop (13) | 12 |
