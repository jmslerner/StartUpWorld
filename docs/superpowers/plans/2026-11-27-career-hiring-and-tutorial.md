# Hiring That Works, a Page That Fits the Phone, and a Start Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer the owner's report from an iPhone ("Looks like the hiring isn't working and we need a start
tutorial"). In a career, "+" on a team works even when everyone already has a job: it moves one person over and says
from where. The plan says plainly why hiring may bring nobody, and that hires join next year. The page no longer
shows up shifted on an iPhone. A first career opens with a short guided tour of the real controls in 1990, which the
player can skip and replay from How to play.

**Architecture:** Nothing in the rules, the store, the saves or the config changes. Three new pure modules carry the
logic, each with its own test file:
- `src/ui/careerTeam.ts`: the career's "+" and the notes on where moved people came from. It sits beside the race's
  `stepDepartment`, which stays as it is, frozen by `src/ui/draft.test.ts`.
- `src/ui/careerHiring.ts`: the career's hiring words, built from the `PlanningView` that `planningView` already
  makes. The shared `expectedHires` in `src/engine/project.ts` is not touched.
- `src/ui/careerTour.ts`: the tour's steps, their order, when a step counts as done, where its card docks, and the
  localStorage flag `startupworld:tour:v1`, which is kept apart from both saves.

The screens get thin wiring:
- `PlanningPanel` gains two optional props that the race never passes (`career`, `hiring`).
- `GameScreen` owns the tour's state and renders a new thin `CareerTour` card outside the page's `inert` subtree.
- `HowToPlayDialog` gains an optional `onTour`.
- Career-only `data-tutorial` attributes mark the controls the tour points at. A race renders none.

The phone fix is CSS only. The two text boxes on the first screen get 16px type on phones, so iOS Safari no longer
zooms in when one is tapped and keeps the zoom for the whole game.

**Tech Stack:** React 19, zustand 5, Tailwind 3, TypeScript 5.9 strict, Vitest 4 in node, Playwright with this
machine's Chromium (`require("playwright")`, resolved from `/opt/node-tools/node_modules/playwright`; never install
its browsers). No new dependencies.

**Inputs:**
- The owner's report and screenshot: 1991 on a phone, Product 2 / Growth 0 / Recruiting 0 with both "+" greyed out,
  marketing $50K, Premium, Sell 10%, every panel's left edge cut off by about 30px.
- Three read-only diagnoses made for this plan: hiring, phone and tour. Their findings are summarised in "Decisions"
  and "Notes for the owner".
- Rules: `docs/career-rules.md`. Design: `docs/superpowers/specs/2026-11-25-career-3d-design.md`.

## Decisions this plan makes

1. **Career "+" takes from another team (controller's decision).** In a career, "+" on a team with nobody free takes
   one person from the largest other team, Product first on ties, then Growth, then Recruiting. With someone free it
   does what the race does.
   - "+" is disabled only when every person available is already on that team.
   - "−" is unchanged.
   - The team's row then says, for that year, where its people came from ("1 moved from Product"). The note resets
     when the year changes, and pressing "−" on that team takes back one noted move.
   - The race keeps `stepDepartment` and `canIncrease={view.unassigned > 0}` exactly.
2. **Hiring words in a career.** When Recruiting is 0, a line under the teams reads "Nobody is recruiting. Put one
   person on Recruiting to hire: N candidates this year." When the last office is full it reads "Your campus is full:
   nobody more can join." instead.
   - The "Hire at most" row keeps its stepper and its limit note. Its fine print becomes: the fee now and the salary
     a year; "Hires join next year."; then what to expect.
   - When the plan cannot promise every hire, it says why in plain words. Candidates go out one at a time, the most
     hype first. It says how many rivals pick before the player, gives "none for sure" or "at least N", and "up to M
     if rivals hire fewer" (M = the fewer of hires wanted and candidates).
   - When there are no candidates, or Hire at most is 0, it says that instead. When the plan already ends the year
     below $0, it adds that.
   - The 3D office keeps showing `projection.hires` as today (see "Notes for the owner").
3. **No config change.** The hiring diagnosis recommended none, so there is nothing to apply. The extra-candidate
   trial was measured anyway: it passes strict at the default 1,000 careers only just, and fails on 200 (numbers in
   "Notes for the owner"). `src/config.ts` is not edited.
4. **The phone clipping is iOS Safari's zoom on focus, not an overflow.**
   - The name box (`NewGameScreen.tsx:107`) and the seed box (`:127`) have 14px type (`text-sm`). iOS zooms in to
     16/14 when one is tapped and never zooms back in a page that never reloads.
   - Fix: `text-base sm:text-sm` on both, so they are 16px under 640px. They are the only text boxes in the game.
   - The viewport meta is not changed: `maximum-scale=1` would take pinch-zoom away from Android users.
   - This is a styling change on the first screen, which the race shares. No race test, text or snapshot changes;
     the race's first-screen box grows by 2px on phones (see "Notes for the owner").
   - Chromium cannot reproduce the zoom. So the browser check asserts the cause (every text box is at least 16px at
     390px) and the effect we can see (no sideways overflow after every step of a played year, with the tooltips
     open).
5. **The tour has seven short steps** (the controller's list of six plus a closing card), as data from
   `tourSteps(config, { office })`:

   | Step | Points at | Moves on when |
   |---|---|---|
   | goal | the career status line | Next |
   | team | the three team rows | the split changes, or Next |
   | money | the marketing and price blocks | marketing or price changes, or Next |
   | cash | the bottom bar's cash figure | Next |
   | end | the End button | the year is played, or Next |
   | report | "Last report" on wide screens, the Report tab on phones | Next |
   | done | nothing | Done |

   - Ending the year at any earlier step jumps the tour to "report".
   - The card hides, and the tour waits, while a report, How to play or a year's playback is open, and after the
     career ends.
   - Every step has "Skip the tour". Finishing writes `done` and skipping writes `skipped` to `startupworld:tour:v1`.
     After either, the tour never starts by itself again.
   - The tour starts by itself only in a career, in 1990, before any report, with the flag unset. Missing or blocked
     storage counts as seen, so a browser that cannot remember never shows the tour on every load.
   - How to play in a career gets "Show me around", which starts the tour from step 1 at any year.
   - The flag is not cleared by `forgetSave()`, and the save shapes and `SAVE_VERSION`s are untouched.
6. **Tour card and ring.** The card is a `<section aria-label="Tour">`, deliberately not `role="dialog"`: the check
   scripts treat any dialog as a report, and the tour must never block the page. It docks at the top or the bottom of
   the screen, whichever side has more room beside its target (`dockFor`).
   - The page scrolls so the card never covers the target. A bottom card sits above the fixed End bar.
   - A ring with `pointer-events: none` outlines the target, so the 3D office and every control stay clickable.
   - On a phone, a step that points into the plan presses the Plan tab first (`tabFor`).
   - The card is `fixed`, 12px from each side, at most 28rem wide, and at most 45% of the screen's height, scrolling
     inside itself if it must. It adds nothing to the page's layout, so the 3D office cell's measured height is
     unchanged.
   - The card does not take focus. Its text is `aria-live="polite"`.
7. **Text.** The tour, the hiring words and the help say years, never "turn" or "quarter". Every number comes from the
   year's rules (fee, salary, candidates, the last year).

## Global Constraints

- **The race is unchanged.**
  - `git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'` prints nothing.
    So `src/ui/draft.test.ts`, `src/ui/viewModel.test.ts` and the other frozen tests are not edited, and
    `stepDepartment` keeps refusing "+" with nobody free.
  - `scripts/race-text.snapshot.json` is not edited, and `node scripts/career-check.mjs --only 1` still passes.
  - Every change to a shared screen hangs on a prop the race never passes, or on `config.career !== undefined`. A race
    renders no new node and no new attribute.
- **The rules, the store, the saves and the config do not change.** There is no edit under `src/engine`, `src/ai` or
  `src/sim`, nor to `src/state/*` or `src/config.ts`.
- New logic lives in pure `.ts` modules with tests. Components only call those modules and lay out the result. There
  is no jsdom or testing-library.
- **Career text says years**, never "turn", "turns", "quarter", "quarterly" or `Q<n>`. Use plain language. No real
  company, product or person names. No AI model names in code, docs or commits.
- TypeScript strict as configured; ESLint `--max-warnings=0`; component files export components only.
- Tests added after `b0d38b0` may be edited only where a task says so.
- Commits: at least one per task, with the message `area: sentence` as in `git log` (areas `ui`, `scripts`, `docs`).
  End each with the session's attribution lines as a last `-m`:
  `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01LWHxzPv43RqaY3zbE1LF9A"`.
  Branch `claude/trusting-ramanujan-gd0yok`.

### The checks

Run after every task, before its commit.

```bash
npx tsc -b && npx eslint . --max-warnings=0 && npm test && npx vite build
git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'
git diff --stat d4a1307 -- src/engine src/ai src/sim src/state src/config.ts scripts/race-text.snapshot.json
```

Expected: no type errors, no lint output, every test passes, the build succeeds, and both `git diff` lines print
nothing.

## Review Focus

These are the conditions the request implies that no feature test would meet by itself, most likely to break first.
Each is pinned in the task named.

1. **The race gets nothing new.** That means no moved person, no new hiring words, no `data-tutorial`, no tour, and no
   "Show me around".
   - Task 1: `stepDepartment` still refuses.
   - Task 2: `careerHiringView` returns `null` for `DESIGN`.
   - Task 4: `tourSteps(DESIGN)` is `[]` and `shouldStartTour` is false outside a career.
   - Task 6 step 1: the race-text snapshot.
2. **The tour never blocks the game.**
   - It never covers its target and is never a dialog.
   - It waits while a report, How to play or a playback is open.
   - Ending the year at any step moves it to the report step, not back to an earlier one.
   - It never starts by itself in a fixture save or in a whole-career run.
   - Task 4: `observeTour` and `dockFor` tables. Task 5: both check scripts' `freshPage` seed the flag. Task 6 steps
     3 to 5 and the office-check step.
3. **Storage.** The tour flag is written only on Done or Skip. Blocked storage means no tour and no throw. The flag
   survives a crash's `forgetSave()`. (Task 4: storage tests. Task 6: reload after Done.)
4. **A moved person comes from the right team, and the note matches what happened.** The raise's fitted split is the
   owner's case (Product 2 after "Sell 10%"). (Task 1: tables.)
5. **The hiring words never promise hires the year may not bring, and never say "expect 0" alone.** The office-check
   helper that reads the expected hires still agrees with the office. (Task 2: text tables and the office-check
   regex.)
6. **Nothing spills past the edges at 390px** after every step of a played year, with the tooltips opened, and every
   text box is at least 16px. (Task 3; Task 6 step 6.)

## File Structure

| Path | Responsibility |
|---|---|
| `src/ui/careerTeam.ts`, `src/ui/careerTeam.test.ts` | Career "+" that moves a person; move notes (Task 1) |
| `src/ui/components/PlanningPanel.tsx`, `src/ui/screens/GameScreen.tsx` | Wiring of the career "+" and the hiring words (Tasks 1, 2, 5) |
| `src/ui/careerHiring.ts`, `src/ui/careerHiring.test.ts`, `src/ui/careerHelp.ts`, `src/ui/careerHelp.test.ts`, `scripts/office-check.mjs` | Hiring words; the help says how "+" works; the office-check helper reads the new words (Task 2) |
| `src/ui/screens/NewGameScreen.tsx` | 16px text boxes on phones (Task 3) |
| `src/ui/careerTour.ts`, `src/ui/careerTour.test.ts` | Pure tour: steps, order, done-ness, dock, tab, flag (Task 4) |
| `src/ui/components/CareerTour.tsx`, `src/ui/components/CareerStatus.tsx`, `src/ui/components/HowToPlay.tsx`, `src/ui/screens/GameScreen.tsx`, `src/ui/components/PlanningPanel.tsx`, `scripts/career-check.mjs`, `scripts/office-check.mjs` | Tour card, anchors, replay; check scripts seed the flag (Task 5) |
| `scripts/career-check.mjs`, `scripts/office-check.mjs`, `README.md`, `docs/career-rules.md` | Browser checks; documents (Task 6) |

---

### Task 1: Career "+" moves a person from another team

**Files:**
- Create: `src/ui/careerTeam.ts`, `src/ui/careerTeam.test.ts`
- Modify: `src/ui/components/PlanningPanel.tsx`
  - new optional prop `career?: boolean`
  - the team rows' `onStep` and `canIncrease` (l.83-95)
  - the row hint (`departmentHint`, l.73-77)
- Modify: `src/ui/screens/GameScreen.tsx`: pass `career` to both `PlanningPanel`s (l.512 and l.540)

**Interfaces:**
- Consumes:
  - `stepDepartment(company, plan, department, delta)`, `unassigned(company, plan)` and
    `peopleAvailable(company, plan)` (`src/ui/draft.ts:10,14,23`)
  - `Department`, `Plan`, `Company` (`src/engine/types.ts`)
  - test kits `newCareer` (`src/engine/careerKit.ts:48`), `HUMAN`, `withCompany` (`src/engine/testKit.ts`),
    `defaultPlan` (`src/engine/plan.ts`), `setRaise` (`src/ui/draft.ts:37`)
- Produces:
  ```ts
  // src/ui/careerTeam.ts
  export const TEAMS: readonly Department[]; // ["product", "growth", "recruiting"]: the order ties are broken in
  export interface TeamStep { readonly plan: Plan; readonly from: Department | null }
  /** Career "+": as stepDepartment with someone free; with nobody free, one person from the largest other team
   *  (Product, then Growth, then Recruiting on ties). "−" is stepDepartment's. Unchanged: the same plan object, from null. */
  export const careerStepDepartment: (company: Company, plan: Plan, department: Department, delta: 1 | -1) => TeamStep;
  /** Whether "+" can do anything: someone is free, or another team has someone. */
  export const careerCanIncrease: (company: Company, plan: Plan, department: Department) => boolean;
  /** Moves made into each team this year, by the team they came from. */
  export type MoveNotes = Readonly<Partial<Record<Department, Readonly<Partial<Record<Department, number>>>>>>;
  export const NO_MOVES: MoveNotes;
  export const noteMove: (notes: MoveNotes, from: Department, to: Department) => MoveNotes;
  /** "−" on a team takes back one noted move into it: from the source with the most, TEAMS order on ties. */
  export const dropMove: (notes: MoveNotes, department: Department) => MoveNotes;
  /** "1 moved from Product", "2 moved from Product, 1 from Growth"; null with none. Sources in TEAMS order. */
  export const moveNote: (notes: MoveNotes, department: Department) => string | null;
  ```

- [ ] **Step 1: Write the failing tests** (`src/ui/careerTeam.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { HUMAN, withCompany } from "../engine/testKit";
import type { Allocation, Plan } from "../engine/types";
import { setRaise, stepDepartment } from "./draft";
import { careerCanIncrease, careerStepDepartment, dropMove, moveNote, NO_MOVES, noteMove } from "./careerTeam";

const three = newCareer().companies[HUMAN];
const six = withCompany(newCareer(), HUMAN, { headcount: 6 }).companies[HUMAN];
const plan = (allocation: Allocation, patch: Partial<Plan> = {}): Plan => ({ ...defaultPlan(three), allocation, ...patch });

describe("the career's + on a team", () => {
  it("with nobody free takes one person from the largest other team", () => {
    expect(careerStepDepartment(three, plan({ product: 3, growth: 0, recruiting: 0 }), "recruiting", 1)).toEqual({
      plan: plan({ product: 2, growth: 0, recruiting: 1 }),
      from: "product",
    });
    expect(careerStepDepartment(six, plan({ product: 1, growth: 3, recruiting: 2 }), "product", 1).from).toBe("growth");
  });

  it("breaks ties Product first, then Growth", () => {
    const four = withCompany(newCareer(), HUMAN, { headcount: 4 }).companies[HUMAN];
    expect(careerStepDepartment(four, plan({ product: 2, growth: 2, recruiting: 0 }), "recruiting", 1).from).toBe("product");
    expect(careerStepDepartment(four, plan({ product: 0, growth: 2, recruiting: 2 }), "product", 1).from).toBe("growth");
  });

  it("does what the race does when someone is free, and for −", () => {
    const free = plan({ product: 3, growth: 0, recruiting: 0 });
    expect(careerStepDepartment(six, free, "growth", 1)).toEqual({ plan: stepDepartment(six, free, "growth", 1), from: null });
    const full = plan({ product: 2, growth: 0, recruiting: 1 });
    expect(careerStepDepartment(three, full, "recruiting", -1)).toEqual({ plan: stepDepartment(three, full, "recruiting", -1), from: null });
  });

  it("works in the owner's case: a raise takes one person, and + Recruiting still works", () => {
    const raising = setRaise(three, plan({ product: 3, growth: 0, recruiting: 0 }), 10);
    expect(raising.allocation).toEqual({ product: 2, growth: 0, recruiting: 0 });
    expect(careerCanIncrease(three, raising, "recruiting")).toBe(true);
    expect(careerStepDepartment(three, raising, "recruiting", 1)).toEqual({
      plan: { ...raising, allocation: { product: 1, growth: 0, recruiting: 1 } },
      from: "product",
    });
  });

  it("does nothing when everyone is already on that team", () => {
    const all = plan({ product: 3, growth: 0, recruiting: 0 });
    expect(careerCanIncrease(three, all, "product")).toBe(false);
    expect(careerStepDepartment(three, all, "product", 1)).toEqual({ plan: all, from: null });
    expect(careerStepDepartment(three, all, "product", 1).plan).toBe(all);
  });

  it("leaves the race's stepDepartment refusing", () => {
    const all = plan({ product: 3, growth: 0, recruiting: 0 });
    expect(stepDepartment(three, all, "recruiting", 1)).toBe(all);
  });
});

describe("where moved people came from", () => {
  it("says it in plain words, sources in team order", () => {
    const once = noteMove(NO_MOVES, "product", "recruiting");
    expect(moveNote(once, "recruiting")).toBe("1 moved from Product");
    expect(moveNote(once, "product")).toBeNull();
    const more = noteMove(noteMove(once, "growth", "recruiting"), "product", "recruiting");
    expect(moveNote(more, "recruiting")).toBe("2 moved from Product, 1 from Growth");
  });

  it("takes one back on −, from the source with the most", () => {
    const notes = noteMove(noteMove(noteMove(NO_MOVES, "product", "recruiting"), "product", "recruiting"), "growth", "recruiting");
    expect(moveNote(dropMove(notes, "recruiting"), "recruiting")).toBe("1 moved from Product, 1 from Growth");
    expect(moveNote(dropMove(dropMove(dropMove(notes, "recruiting"), "recruiting"), "recruiting"), "recruiting")).toBeNull();
    expect(dropMove(NO_MOVES, "growth")).toEqual(NO_MOVES);
  });
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/ui/careerTeam.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement `careerTeam.ts`.**
  - `careerStepDepartment`: for `delta < 0`, or when `unassigned > 0`, return
    `{ plan: stepDepartment(...), from: null }`.
  - Otherwise pick the donor: the team other than `department` with the most people, the first in `TEAMS` on ties,
    and at least 1. With none, return `{ plan, from: null }`.
  - Move one person from the donor to `department` in a new allocation.
  - `careerCanIncrease` is `unassigned(company, plan) > 0 || TEAMS.some((t) => t !== department && plan.allocation[t] > 0)`.
  - Notes are immutable nested records. `moveNote` lists sources in `TEAMS` order with their counts, as the test words
    them: the first source gets "moved from", later ones "from".
- [ ] **Step 4: Wire `PlanningPanel`.**
  - Add `career?: boolean` to `PlanningPanelProps`, with the comment "A career: "+" moves someone from another team.
    The race never passes it."
  - Keep notes in `useState<{ turn: number; notes: MoveNotes }>({ turn, notes: NO_MOVES })`, read as
    `moves.turn === turn ? moves.notes : NO_MOVES`.
  - Without `career`, a team row's `onStep` is exactly today's `onChange(stepDepartment(...))`.
  - With `career`, `onStep` calls `careerStepDepartment`. It returns at once when `plan === draft`. Otherwise it sets
    the notes for this `turn` (`noteMove` when `from !== null`, `dropMove` for `delta < 0`) and calls `onChange(plan)`.
  - `canIncrease` is `career ? careerCanIncrease(company, draft, department) : view.unassigned > 0`.
  - In a career with a note, the row hint is `` `${departmentHint[department]} · ${note}` ``; otherwise it is today's
    hint exactly.
  - In `GameScreen`, pass `career={career}` to both `PlanningPanel`s. `career` is `false` in a race, which renders the
    same as no prop.
- [ ] **Step 5: Run the tests, then the checks.** Expected: PASS. Then run
  `node scripts/career-check.mjs --only 1`. Expected: "career-check: every assertion passed" (the race text is
  unchanged).
- [ ] **Step 6: Commit**

```bash
git add src/ui/careerTeam.ts src/ui/careerTeam.test.ts src/ui/components/PlanningPanel.tsx src/ui/screens/GameScreen.tsx
git commit -m "ui: in a career, + on a team with nobody free moves one person from the largest other team and the row says from where"
```

---

### Task 2: Hiring words that say why, and that hires join next year

**Files:**
- Create: `src/ui/careerHiring.ts`, `src/ui/careerHiring.test.ts`
- Modify: `src/ui/components/PlanningPanel.tsx`
  - new optional prop `hiring?: CareerHiringView | null`
  - a line under the "N people to assign" hint
  - the "Hire at most" row's `hint` in a career
- Modify: `src/ui/screens/GameScreen.tsx`: a `hiring` memo, passed to both `PlanningPanel`s
- Modify: `src/ui/careerHelp.ts`: the "Product, Growth, Recruiting" text. `src/ui/careerHelp.test.ts` gains one
  test (the file is new since `b0d38b0`).
- Modify: `scripts/office-check.mjs:420-423`: `expectedHires` reads the new words

**Interfaces:**
- Consumes:
  - `PlanningView.hiring` `{ capacity, wanted, expected, fee, candidates }` and `PlanningView.projection.cash`
    (`src/ui/viewModel.ts:180-189,360-366`)
  - `rulesForTurn(config, turn)` with `.salary`, `.career.offices` (`src/engine/career.ts`); `peopleCap`
    (`src/engine/career.ts:141`)
  - `viewFor(game, PLAYER_ID).rivals[].hype`, `.out` (`src/engine/view.ts:35`); `PLAYER_ID` (`src/state/player.ts`)
  - `money` (`src/ui/format.ts:16`)
  - the order candidates are handed out in: one at a time, most hype first, and rivals win ties against the player in
    the projection (`src/engine/hiring.ts:14,28`; `src/engine/project.ts:165`)
- Produces:
  ```ts
  // src/ui/careerHiring.ts
  export interface CareerHiringView {
    /** One line under the teams: nobody recruiting, or the last office full; null when there is nothing to say. */
    readonly teamLine: string | null;
    /** The "Hire at most" row's fine print after its limit note. */
    readonly hireText: string;
  }
  /** The career's hiring words for this plan; null in a race. */
  export const careerHiringView: (game: GameState, draft: Plan, view: PlanningView, config: RulesConfig) => CareerHiringView | null;
  ```

- [ ] **Step 1: Write the failing tests** (`src/ui/careerHiring.test.ts`). The real 1990 starting state (measured
  with `planningView` at d4a1307): 3 people, all on Product, 2 candidates, rival hype 10, 20 and 10 against the
  player's 10. One recruiter has capacity 3 and wants 3, and the projection expects 0.

```ts
import { describe, expect, it } from "vitest";
import { newGameSetup } from "../ai/names";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import { CAREER_TEST, newCareer } from "../engine/careerKit";
import { defaultPlan } from "../engine/plan";
import { createGame } from "../engine/setup";
import { HUMAN, newGame, withCompany } from "../engine/testKit";
import type { Allocation, GameState, Plan, RulesConfig } from "../engine/types";
import { careerHiringView } from "./careerHiring";
import { planningView } from "./viewModel";

const real = (): GameState => createGame(newGameSetup(1, "Acme"), CAREER);
const words = (game: GameState, allocation: Allocation, patch: Partial<Plan> = {}, config: RulesConfig = CAREER) => {
  const draft = { ...defaultPlan(game.companies[HUMAN]), allocation, ...patch };
  return careerHiringView(game, draft, planningView(game, draft, config), config);
};
const one = { product: 2, growth: 0, recruiting: 1 };

describe("the career's hiring words", () => {
  it("says how to hire when nobody is recruiting", () => {
    expect(words(real(), { product: 3, growth: 0, recruiting: 0 })?.teamLine).toBe("Nobody is recruiting. Put one person on Recruiting to hire: 2 candidates this year.");
  });

  it("explains an expectation of none: the order, the rivals ahead, the most it can be, and when hires join", () => {
    expect(words(real(), one)).toEqual({
      teamLine: null,
      hireText:
        "$20K fee each now, then $50K a year in salary. Hires join next year. " +
        "2 candidates this year, handed out one at a time with the most hype first; 3 rivals pick before you. " +
        "Up to 2 of 2 candidates could join, handed out most hype first; 3 rivals pick before you, so none is certain.",
    });
  });

  it("says at least what it can, when the player picks first", () => {
    expect(words(withCompany(real(), HUMAN, { hype: 30 }), one)?.hireText).toMatch(/; you pick first\. Expect at least 1, and up to 2 if rivals hire fewer\.$/);
  });

  it("gives a plain number when every hire wanted is expected", () => {
    expect(words(newCareer(), one, {}, CAREER_TEST)?.hireText).toBe("$10K fee each now, then $50K a year in salary. Hires join next year. 6 candidates this year: expect 2.");
  });

  it("names a hire limit of 0, a full campus, and a plan that already ends below $0", () => {
    expect(words(real(), one, { hireLimit: 0 })?.hireText).toMatch(/Hire at most is 0: nobody joins\.$/);
    const full = withCompany(real(), HUMAN, { headcount: 150, headcountAtLastClose: 150 });
    expect(words(full, { product: 140, growth: 5, recruiting: 5 })?.teamLine).toBe("Your campus is full: nobody more can join.");
    expect(words(withCompany(real(), HUMAN, { cash: 1_000 }), one)?.hireText).toMatch(/ This plan already ends the year below \$0\.$/);
  });

  it("speaks in years, and says nothing in a race", () => {
    const all = JSON.stringify([words(real(), one), words(real(), { product: 3, growth: 0, recruiting: 0 })]);
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
    const race = newGame();
    const draft = defaultPlan(race.companies[HUMAN]);
    expect(careerHiringView(race, draft, planningView(race, draft, DESIGN), DESIGN)).toBeNull();
  });
});
```

  Add to `src/ui/careerHelp.test.ts`:

```ts
  it("says how + moves people and who gets the candidates", () => {
    const text = help.find((s) => s.title === "Product, Growth, Recruiting")!.text;
    for (const words of ["Press +", "largest other team", "most hype", "start next year"]) expect(text).toContain(words);
  });
```

  (If `newGameSetup(1, "Acme")` gives another set of rival hypes on this branch, use the real numbers that
  `planningView` gives for the same state. The test pins the wording, not the seed.)
- [ ] **Step 2: Run them.** `npx vitest run src/ui/careerHiring.test.ts src/ui/careerHelp.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `careerHiringView`.** Return `null` when `rulesForTurn(config, game.turn).career` is
  undefined. Otherwise take `rules`, `self`, `cand = view.hiring.candidates`, `wanted = view.hiring.wanted`,
  `expected = view.hiring.expected` and `best = Math.min(wanted, cand)`. `ahead` is the number of rivals with
  `out === null && hype >= self.hype`.
  - **`teamLine`:**
    - When `self.headcount - draft.layoffs >= peopleCap(career)`: `` `Your ${lastOffice.name.toLowerCase()} is full: nobody more can join.` ``
    - Else, with `draft.allocation.recruiting === 0`: with `cand > 0`,
      `` `Nobody is recruiting. Put one person on Recruiting to hire: ${plural(cand, "candidate", "candidates")} this year.` ``;
      with none, `"Nobody is recruiting, and nobody is looking for work this year."`
    - Else, with `view.hiring.capacity === 0`: `"Recruiting finds nobody this year: put more people on it."`
    - Else `null`.
  - **`hireText`** starts with `` `${money(view.hiring.fee)} fee each now, then ${money(rules.salary)} a year in salary. Hires join next year. ` ``,
    then the first case that applies:
    - `cand === 0`: `"Nobody is looking for work this year: expect no hires."`
    - `draft.hireLimit === 0`: `"Hire at most is 0: nobody joins."`
    - `expected >= best`: `` `${plural(cand, ...)} this year: expect ${expected}.` ``
    - otherwise:
      `` `${plural(cand, ...)} this year, handed out one at a time with the most hype first; ${ahead === 0 ? "you pick first" : ahead === 1 ? "1 rival picks before you" : `${ahead} rivals pick before you`}. Expect ${expected === 0 ? "none for sure" : `at least ${expected}`}, and up to ${best} if rivals hire fewer.` ``
  - Finally add `" This plan already ends the year below $0."` when `view.projection.cash < 0`.
- [ ] **Step 4: Wire it.**
  - In `GameScreen`:
    `const hiring = useMemo(() => (game === null || draft === null || planning === null ? null : careerHiringView(game, draft, planning, config)), [game, draft, planning, config]);`
    placed before the early return, and passed as `hiring={hiring}` to both `PlanningPanel`s.
  - In `PlanningPanel`, after the "N people to assign" block: `{hiring?.teamLine != null && <p className={HINT}>{hiring.teamLine}</p>}`.
  - The "Hire at most" row's `hint` is `` hiring == null ? <today's string, unchanged> : `${limitNote}${hiring.hireText}` ``.
  - In `careerHelp.ts`, the "Product, Growth, Recruiting" text becomes: "Product raises quality; once it is good enough
    you launch and start winning users, and higher quality keeps them. Growth adds pull: each year's new users are
    shared out by pull, which is quality lifted by growth work, marketing, a lower price and hype. Press + on a team to
    move one person into it; with nobody free, they come from your largest other team. Recruiting hires people, who
    start next year. Each year has only so many candidates, and they go to the companies with the most hype first.
    Bigger teams lose a little to coordination."
  - In `scripts/office-check.mjs`, `expectedHires` becomes
    `const found = (await planPanel(page).innerText()).match(/\b(?:expect|at least) (\d+)\b/i); return found === null ? 0 : Number(found[1]);`
    with its comment reworded: "expect N", "at least N", or 0 for "none for sure" or no hiring row.
- [ ] **Step 5: Run the tests, then the checks.** Expected: PASS. Then run
  `node scripts/office-check.mjs --only 3` (the year's expected hires at the door against the plan) and
  `node scripts/career-check.mjs --only 1`. Expected: each prints its "every assertion passed" line.
- [ ] **Step 6: Commit**

```bash
git add src/ui/careerHiring.ts src/ui/careerHiring.test.ts src/ui/components/PlanningPanel.tsx src/ui/screens/GameScreen.tsx src/ui/careerHelp.ts src/ui/careerHelp.test.ts scripts/office-check.mjs
git commit -m "ui: the career's plan says how to hire, why it may bring nobody, the most it can bring, and that hires join next year"
```

---

### Task 3: The page no longer zooms in on an iPhone

**Files:**
- Modify: `src/ui/screens/NewGameScreen.tsx:107` (the name box) and `:127` (the seed box)

**Interfaces:**
- Consumes: nothing new.
- Produces: no code interface. Every `input[type=text]` on the first screen has a computed `font-size` of at least
  16px below 640px, and 14px from 640px up, as today.

- [ ] **Step 1: Write the failing check.** Run this one-off check (the permanent one comes in Task 6) against a build
  served with `npx vite build && npx vite preview --port 4410 --strictPort &`:

```bash
node -e '
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
(async () => {
  const browser = await chromium.launch();
  const { defaultBrowserType, ...phone } = devices["iPhone 13"];
  const page = await (await browser.newContext(phone)).newPage();
  await page.goto("http://localhost:4410/");
  await page.getByText("Replay a game with its seed").click();
  const sizes = await page.$$eval("input[type=text]", (els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  console.log(JSON.stringify(sizes), sizes.every((s) => s >= 16) ? "OK" : "TOO SMALL");
  await browser.close();
})();'
```

  Expected now: `[14,14] TOO SMALL`.
- [ ] **Step 2: Fix.** On both inputs, replace `text-sm` with `text-base sm:text-sm`. Nothing else changes: no
  viewport meta, no root overflow rule. Add one comment above the name input: "16px on phones: iOS zooms in on a text
  box under 16px, and keeps the zoom for the whole game."
- [ ] **Step 3: Run the check again.** Expected: `[16,16] OK`. Stop the preview server.
- [ ] **Step 4: Run the checks, and** `node scripts/career-check.mjs --only 1,10`. Expected: PASS (the race's text is
  unchanged, and a career fits 390px).
- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/NewGameScreen.tsx
git commit -m "ui: the first screen's text boxes are 16px on phones, so iOS no longer zooms in on a tap and leaves the game cut off at the sides"
```

---

### Task 4: The start tour as data

**Files:**
- Create: `src/ui/careerTour.ts`, `src/ui/careerTour.test.ts`

**Interfaces:**
- Consumes:
  - `rulesForTurn(config, 1).hiring.fee`, `rulesForTurn(config, 1).game.maxTurns`, `yearOf(turn, career)`
    (`src/engine/career.ts`)
  - `money` (`src/ui/format.ts`)
  - `StorageLike` (`src/state/gameStore.ts:27`), following the pattern of `readOfficePreference` and
    `writeOfficePreference` (`src/ui/officeView.ts:9-24`)
  - `Allocation`, `PriceTier`, `RulesConfig` (`src/engine/types.ts`)
- Produces:
  ```ts
  // src/ui/careerTour.ts
  export const TOUR_KEY = "startupworld:tour:v1";
  export type TourStepId = "goal" | "team" | "money" | "cash" | "end" | "report" | "done";
  /** What a step points at: the value of the career-only data-tutorial attribute; null for the closing card. */
  export type TourTarget = "status" | "team" | "money" | "cash" | "end" | "report";
  export interface TourStep { readonly id: TourStepId; readonly target: TourTarget | null; readonly title: string; readonly text: string }
  /** The steps in order; [] in a race. `office`: the 3D office is on screen, so the team step also says how to move a person there. */
  export const tourSteps: (config: RulesConfig, options: { readonly office: boolean }) => readonly TourStep[];
  /** What the tour watches on the screen. */
  export interface TourWatch { readonly turn: number; readonly allocation: Allocation; readonly marketing: number; readonly price: PriceTier }
  export interface TourState { readonly index: number; readonly since: TourWatch }
  export const startTour: (watch: TourWatch) => TourState;
  /** Next or Done: the following step, or "finished" after the last. */
  export const nextStep: (state: TourState, watch: TourWatch, steps: readonly TourStep[]) => TourState | "finished";
  /** After the screen changed: on to the next step when the player did what this one asks; to the report step when a
   *  year was played before it; otherwise the same state object. */
  export const observeTour: (state: TourState, watch: TourWatch, steps: readonly TourStep[]) => TourState | "finished";
  export const shouldStartTour: (now: { readonly career: boolean; readonly turn: number; readonly hasReport: boolean; readonly seen: boolean }) => boolean;
  /** The phone tab a target lives on; null when it is on every tab. */
  export const tabFor: (target: TourTarget | null) => "plan" | null;
  export const TOUR_GAP = 12;    // the card's distance from the screen's edge and the bar
  export const TOUR_MARGIN = 8;  // the least space between the card and its target
  export interface DockInput { readonly top: number; readonly bottom: number; readonly viewport: number; readonly bar: number; readonly card: number; readonly fixed: boolean }
  /** Where the card docks (the side with more room beside the target) and how far to scroll the page (window.scrollBy)
   *  so the card does not cover the target; a fixed target is never scrolled. */
  export const dockFor: (input: DockInput) => { readonly dock: "top" | "bottom"; readonly scroll: number };
  /** Seen once finished or skipped; missing or blocked storage reads as seen. */
  export const readTourSeen: (storage: Pick<StorageLike, "getItem"> | null) => boolean;
  export const writeTourSeen: (storage: Pick<StorageLike, "setItem"> | null, how: "done" | "skipped") => void;
  ```

- [ ] **Step 1: Write the failing tests** (`src/ui/careerTour.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
import {
  dockFor, nextStep, observeTour, readTourSeen, shouldStartTour, startTour, tabFor, TOUR_KEY, tourSteps, writeTourSeen,
  type TourState, type TourStepId, type TourWatch,
} from "./careerTour";

const watch = (patch: Partial<TourWatch> = {}): TourWatch => ({ turn: 1, allocation: { product: 3, growth: 0, recruiting: 0 }, marketing: 0, price: "standard", ...patch });
const steps = tourSteps(CAREER, { office: false });
const ids = steps.map((step) => step.id);
const at = (id: TourStepId): TourState => ({ index: ids.indexOf(id), since: watch() });

describe("the start tour's steps", () => {
  it("has seven steps in order, each but the last pointing at a control", () => {
    expect(ids).toEqual(["goal", "team", "money", "cash", "end", "report", "done"]);
    expect(steps.map((step) => step.target)).toEqual(["status", "team", "money", "cash", "end", "report", null]);
  });

  it("says the goal, how to hire, and takes its numbers from the config", () => {
    expect(steps[0].text).toMatch(/users/);
    expect(steps[0].text).toMatch(/go public/);
    expect(steps[0].text).toContain("2038");
    expect(steps[1].text).toContain("press + on Recruiting");
    expect(steps[1].text).toContain("$20K");
    expect(steps[1].text).toContain("next year");
    expect(steps[1].text).not.toContain("click a person");
    expect(tourSteps(CAREER, { office: true })[1].text).toContain("click a person, then another team");
    expect(steps[6].text).toContain("How to play");
  });

  it("speaks in years and plain words, and does not exist in a race", () => {
    const all = [...steps, ...tourSteps(CAREER, { office: true })].map((step) => `${step.title} ${step.text}`).join(" ");
    expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
    expect(tourSteps(DESIGN, { office: false })).toEqual([]);
  });
});

describe("moving through the tour", () => {
  it("starts at the first step and moves on with Next, then finishes", () => {
    const later = watch({ marketing: 50_000 });
    expect(startTour(watch())).toEqual({ index: 0, since: watch() });
    expect(nextStep(at("goal"), later, steps)).toEqual({ index: 1, since: later });
    expect(nextStep(at("done"), later, steps)).toBe("finished");
  });

  it("moves on when the player does what the step asks", () => {
    const moved = watch({ allocation: { product: 2, growth: 0, recruiting: 1 } });
    expect(observeTour(at("team"), moved, steps)).toEqual({ index: ids.indexOf("money"), since: moved });
    const pricier = watch({ price: "premium" });
    expect(observeTour(at("money"), pricier, steps)).toEqual({ index: ids.indexOf("cash"), since: pricier });
    expect(observeTour(at("money"), watch({ marketing: 50_000 }), steps)).toMatchObject({ index: ids.indexOf("cash") });
    const played = watch({ turn: 2 });
    expect(observeTour(at("end"), played, steps)).toEqual({ index: ids.indexOf("report"), since: played });
  });

  it("waits on a step that asks only for Next", () => {
    for (const id of ["goal", "cash", "report", "done"] as const) {
      const state = at(id);
      expect(observeTour(state, watch({ marketing: 50_000, price: "budget" }), steps)).toBe(state);
    }
    const state = at("team");
    expect(observeTour(state, watch({ marketing: 50_000 }), steps)).toBe(state);
  });

  it("jumps to the report step when a year is played before the end step", () => {
    for (const id of ["goal", "team", "money", "cash"] as const) {
      expect(observeTour(at(id), watch({ turn: 2 }), steps)).toMatchObject({ index: ids.indexOf("report") });
    }
    const report = at("report");
    expect(observeTour({ ...report, since: watch({ turn: 2 }) }, watch({ turn: 3 }), steps)).toMatchObject({ index: ids.indexOf("report") });
  });

  it("starts by itself only in a first career's first year, before any report", () => {
    const first = { career: true, turn: 1, hasReport: false, seen: false };
    expect(shouldStartTour(first)).toBe(true);
    expect(shouldStartTour({ ...first, career: false })).toBe(false);
    expect(shouldStartTour({ ...first, turn: 2 })).toBe(false);
    expect(shouldStartTour({ ...first, hasReport: true })).toBe(false);
    expect(shouldStartTour({ ...first, seen: true })).toBe(false);
  });

  it("shows the plan tab for the plan's controls only", () => {
    expect(["status", "team", "money", "cash", "end", "report", null].map((t) => tabFor(t as never))).toEqual([null, "plan", "plan", null, null, null, null]);
  });
});

describe("where the card docks", () => {
  const phone = { viewport: 664, bar: 100, card: 160, fixed: false };
  it("docks on the side with more room and needs no scroll when it fits", () => {
    expect(dockFor({ ...phone, top: 100, bottom: 200 })).toEqual({ dock: "bottom", scroll: 0 });
    expect(dockFor({ ...phone, top: 400, bottom: 540 })).toEqual({ dock: "top", scroll: 0 });
  });

  it("scrolls the page so the card does not cover the target", () => {
    expect(dockFor({ ...phone, top: 150, bottom: 450 })).toEqual({ dock: "top", scroll: -30 });
    expect(dockFor({ ...phone, top: 100, bottom: 420 })).toEqual({ dock: "bottom", scroll: 36 });
  });

  it("never scrolls for a fixed target, such as the End bar", () => {
    expect(dockFor({ ...phone, top: 600, bottom: 650, fixed: true })).toEqual({ dock: "top", scroll: 0 });
  });
});

describe("remembering the tour", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return { items, getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
  };
  it("is unseen in fresh storage, and seen once finished or skipped, under its own key only", () => {
    const storage = memory();
    expect(readTourSeen(storage)).toBe(false);
    writeTourSeen(storage, "skipped");
    expect([...storage.items.entries()]).toEqual([[TOUR_KEY, "skipped"]]);
    expect(readTourSeen(storage)).toBe(true);
    writeTourSeen(storage, "done");
    expect(storage.getItem(TOUR_KEY)).toBe("done");
  });

  it("reads missing or blocked storage as seen, and never throws", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readTourSeen(null)).toBe(true);
    expect(readTourSeen(blocked)).toBe(true);
    expect(() => writeTourSeen(blocked, "done")).not.toThrow();
    expect(() => writeTourSeen(null, "done")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/ui/careerTour.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement.**
  - `tourSteps` returns `[]` when `config.career` is undefined. Otherwise the text, with
    `last = yearOf(rules.game.maxTurns, career)` and `fee = money(rulesForTurn(config, 1).hiring.fee)`:
    - goal, "Your goal": "Grow your users, go public, and last until {last}. Each year you set a plan, end the year,
      and read what happened."
    - team, "Your team": "Your people work in Product, Growth or Recruiting. Product builds what users want, Growth
      wins them, and Recruiting hires. To hire, press + on Recruiting: with nobody free, someone moves over from your
      largest team. Each hire costs {fee} now and a salary every year, and joins next year." With `office`, add " In
      the office you can also click a person, then another team."
    - money, "Price and marketing": "Marketing buys pull for new users, and each extra dollar does less. A lower price
      wins more users; a higher one earns more from each."
    - cash, "Cash and the board": "This is the cash the plan leaves at the end of the year. Below $0 the company needs
      its one rescue. Once investors outnumber founders on your board, a bad year can get you fired: the warnings say
      when."
    - end, "End the year": "When the plan looks right, press End. The year plays out and its report opens."
    - report, "The report": "The report shows the users you won, your cash and what your rivals did. Open it again any
      time with Last report, or the Report tab on a phone."
    - done, "That's the tour": "You know the basics. How to play has the rest of the rules, and can show this tour
      again."
  - `observeTour`:
    - Let `i = state.index`, `end = index of "end"` and `report = index of "report"`.
    - If `watch.turn > state.since.turn` and `i <= end`, return `{ index: report, since: watch }`.
    - If `steps[i].id` is "team" and the allocation differs (any of the three counts), return
      `nextStep(state, watch, steps)`. Likewise for "money" when `marketing` or `price` differs.
    - Otherwise return `state` itself.
  - `dockFor`:
    - `above = top`, `below = viewport - bar - bottom`, `dock = below > above ? "bottom" : "top"`.
    - A fixed target gives a scroll of 0.
    - Top: `scroll = Math.min(0, top - (TOUR_GAP + card + TOUR_MARGIN))`.
    - Bottom: `scroll = Math.max(0, bottom - (viewport - bar - TOUR_GAP - card - TOUR_MARGIN))`.
  - Storage is wrapped in try/catch like `officeView.ts:9-24`. `readTourSeen` returns `true` for a null storage or a
    throw, and otherwise `getItem(TOUR_KEY) !== null`.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ui/careerTour.ts src/ui/careerTour.test.ts
git commit -m "ui: the career's start tour as data: seven steps, when each is done, where its card docks, and a flag kept apart from the saves"
```

---

### Task 5: The tour on screen, and replaying it from How to play

**Files:**
- Create: `src/ui/components/CareerTour.tsx`
- Modify: `src/ui/screens/GameScreen.tsx`
  - tour state, auto-start, observing, the tab, the hold
  - `<CareerTour>` rendered after the `inert` div, beside the dialogs
  - `onTour` passed to `HowToPlayDialog`
  - career-only `data-tutorial` attributes:
    - `"cash"` on the bar's cash block (l.560)
    - `"end"` on the End button (l.571)
    - `"report"` on "Last report" (l.430) and on the Report tab button (l.532)
- Modify: `src/ui/components/PlanningPanel.tsx`: with `career`, `data-tutorial="team"` on the team block (l.82) and
  `data-tutorial="money"` on the Marketing block (after l.122) and the Price block (after l.160). Without it, `undefined`, which
  React omits.
- Modify: `src/ui/components/CareerStatus.tsx:19`: `data-tutorial="status"` on its section (a career-only component)
- Modify: `src/ui/components/HowToPlay.tsx`: `HowToPlayDialog` gains `onTour?: () => void`. When it is given, a
  "Show me around" button above "Back to the game" calls `onTour()` and then the dialog's `close()`.
- Modify: `scripts/career-check.mjs:211` and `scripts/office-check.mjs:244` (`freshPage`): by default, an init script
  sets `localStorage["startupworld:tour:v1"] = "done"` when it is unset. The option `{ tour: true }` leaves storage
  untouched. Fixture saves and whole careers then play as before.

**Interfaces:**
- Consumes:
  - everything Task 4 produces
  - `browserStorage()` (`src/state/useGame.ts:7`)
  - in `GameScreen`: `layout`, `barRef`, `tab`/`setTab`, `helpOpen`, `report`, `playing`, `over` and the `inert`
    wrapper (l.420)
  - `useDialog`'s `close` (`src/ui/useDialog.ts`)
- Produces:
  ```tsx
  // src/ui/components/CareerTour.tsx
  interface CareerTourProps {
    step: TourStep;
    index: number;
    count: number;
    /** The fixed End bar, measured so a bottom card sits above it. */
    barRef: RefObject<HTMLDivElement | null>;
    onNext: () => void;
    onSkip: () => void;
  }
  export const CareerTour: (props: CareerTourProps) => JSX.Element;
  ```

- [ ] **Step 1: The card component.** `CareerTour` renders two things:
  - A ring: `aria-hidden`, `pointer-events-none fixed z-[34] rounded-xl ring-2 ring-neon/80`.
  - A card: `<section aria-label="Tour" className="panel-surface fixed inset-x-3 z-[35] mx-auto max-h-[45vh] max-w-md overflow-y-auto rounded-xl p-3">`,
    holding:
    - "Step {index + 1} of {count}" in `LABEL`
    - an `h2` title
    - the text in a `p` with `aria-live="polite"`
    - "Skip the tour" (`BUTTON`), and "Next" or, on the last step, "Done" (`PRIMARY`)

  On each `step.id`, in `useLayoutEffect`:
  1. Find the visible targets:
     `[...document.querySelectorAll(`[data-tutorial="${step.target}"]`)].filter((el) => el.getClientRects().length > 0)`.
  2. With none (no target, or a step replayed before any report), dock the card at the bottom with no ring.
  3. Otherwise call `scrollIntoView({ block: "center" })` on the first target. Then take the union of the targets'
     rects. A target is fixed when it or an ancestor has computed `position: fixed`. Call `dockFor` with
     `viewport = innerHeight`, `bar = barRef.current?.offsetHeight ?? 0` and the card's measured height, then
     `window.scrollBy(0, scroll)`.
  4. Place the card with `top: TOUR_GAP` or `bottom: bar + TOUR_GAP`, plus `env(safe-area-inset-bottom)`.

  A `requestAnimationFrame`-throttled `scroll`/`resize` listener keeps the ring on the union rect while the step shows.
  There is no Escape handler and no focus change, and there are no words but the step's and the buttons'.
- [ ] **Step 2: Wire `GameScreen`.** Put every hook before the early return.
  - **State:**
    - `const [tourSeen, setTourSeen] = useState(() => readTourSeen(browserStorage()));`
    - `const [tour, setTour] = useState<TourState | null>(null);`
    - `const steps = useMemo(() => tourSteps(config, { office: layout === "3d" }), [config, layout]);`
  - **Watch:** `tourWatch`, memoised from `game?.turn` and `draft`'s `allocation`, `marketing` and `price` (null
    without a game).
  - **Auto-start:** a `useRef(false)` guards a `useEffect` that starts the tour once per mount:
    `if (!started.current && tourWatch !== null && shouldStartTour({ career, turn: tourWatch.turn, hasReport: lastLog !== null, seen: tourSeen })) { started.current = true; setTour(startTour(tourWatch)); }`.
  - **Observe:** a `useEffect` on `tourWatch` runs `observeTour`. On `"finished"` it calls `endTour("done")`.
  - **`endTour(how)`:** `writeTourSeen(browserStorage(), how); setTourSeen(true); setTour(null);`.
    Next calls `nextStep`, and `"finished"` there calls `endTour("done")`. Skip calls `endTour("skipped")`.
  - **Tab:** a `useEffect` on the current step calls `setTab("plan")` when `tabFor(step.target) === "plan"`.
  - **Hold:** `const tourHeld = report !== null || helpOpen || playing || over;`. Render
    `{tour !== null && !tourHeld && steps.length > 0 && <CareerTour step={steps[tour.index]} index={tour.index} count={steps.length} barRef={barRef} onNext={...} onSkip={...} />}`
    after the `inert` div's closing tag.
  - **Replay:** `<HowToPlayDialog config={config} onClose={closeHelp} onTour={career ? replayTour : undefined} />`,
    where `replayTour` sets `startTour(tourWatch)`. The race passes nothing, so its dialog is unchanged.
  - **Attributes:** add the `data-tutorial` attributes as `career ? "<name>" : undefined`, and pass `career` to
    `PlanningPanel`. It already has it since Task 1.
- [ ] **Step 3: Seed the flag in both check scripts.**
  - In each `freshPage`, add the option `tour = false`. Unless it is true, run
    `await context.addInitScript(([key]) => { try { if (localStorage.getItem(key) === null) localStorage.setItem(key, "done"); } catch {} }, ["startupworld:tour:v1"]);`.
  - Add `const TOUR_KEY = "startupworld:tour:v1";` beside `CAREER_KEY` in each script, and one line about it in each
    header comment.
  - `office-check.mjs`'s `freshPage` already spreads `...options` into `newContext`, so take `tour` out of `options`
    before that.
- [ ] **Step 4: Look at it.** Build and preview, then take screenshots with a scratch Playwright script in the
  scratchpad (not committed), at 1280x800 (2D, with `--disable-3d-apis`) and on `devices["iPhone 13"]`:
  - each step's card and ring
  - the card never over its ring
  - the Plan tab pressed for team and money on the phone
  - nothing on screen while the summary is open
  - the report step after it closes

  Fix anything that is off before the commit.
- [ ] **Step 5: Run the checks, then** `node scripts/career-check.mjs --only 1,2,10` and
  `node scripts/office-check.mjs --only 1,3`. Expected: each prints its "every assertion passed" line. The race is
  unchanged, the whole career runs with the flag seeded, and the 3D year still plays.
- [ ] **Step 6: Commit**

```bash
git add src/ui/components/CareerTour.tsx src/ui/screens/GameScreen.tsx src/ui/components/PlanningPanel.tsx src/ui/components/CareerStatus.tsx src/ui/components/HowToPlay.tsx scripts/career-check.mjs scripts/office-check.mjs
git commit -m "ui: a first career opens with a short tour of the real controls in 1990, skippable, never shown again, and replayable from How to play"
```

---

### Task 6: Browser checks and documents

**Files:**
- Modify: `scripts/career-check.mjs`
  - new steps 12 to 15, with `runs(12)` … `runs(15)` in `main`
  - the header comment lists them
  - `freshPage` gains `device` (a Playwright device descriptor, spread into `newContext` in place of `viewport`)
- Modify: `scripts/office-check.mjs`
  - new step 19, the tour with the 3D office; `runs(19)` before step 14, which runs last
  - the header comment
- Modify: `README.md`: the career bullet (l.13-20)
- Modify: `docs/career-rules.md`: one bullet under "What was tried and did not work" (l.577), from the measurement in
  "Notes for the owner". No number changed, so "Numbers changed" and "Starting numbers" stay as they are.

**Interfaces:**
- Consumes:
  - the scripts' helpers: `freshPage`, `endButton`, `opened`, `closeWith`, `fullReport`, `noForbiddenWords`, `dialog`,
    `stays2D` and `PHONE` in career-check; `startCareer`, `planPanel`, `teamCount`, `running`, `playYear` and
    `closeWith` in office-check
  - `require("playwright").devices["iPhone 13"]`
  - every UI string pinned in Tasks 1, 2, 4 and 5
- Produces: no code interface. `--only 12`, `13`, `14` and `15` in career-check and `--only 19` in office-check each
  run alone.

- [ ] **Step 1: A helper for the edges** in `career-check.mjs`:

```js
/** Sideways overflow, and elements past either edge that no scrolling or clipping box holds (1px boxes left out). */
const edges = (page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    const width = root.clientWidth;
    const held = (el) => {
      for (let p = el.parentElement; p !== null && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== "visible") return true;
      return false;
    };
    const out = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && (r.left < -0.5 || r.right > width + 0.5) && !held(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()} ${JSON.stringify(String(el.className).slice(0, 60))}`);
    return { scrollWidth: root.scrollWidth, clientWidth: width, scrollX: window.scrollX, out };
  });
const fitsEdges = async (page, where) => {
  const e = await edges(page);
  assert(e.scrollWidth === e.clientWidth && e.scrollX === 0, `${where}: the page is ${e.scrollWidth} px wide in ${e.clientWidth} px, scrolled ${e.scrollX}`);
  assert(e.out.length === 0, `${where}: past the edge: ${e.out.join(" | ")}`);
};
/** The tour card, and its box against the box of every visible target of the step. */
const tourCard = (page) => page.locator('section[aria-label="Tour"]');
const cardClear = async (page, target, where) => {
  const card = await tourCard(page).boundingBox();
  const boxes = await page.locator(`[data-tutorial="${target}"]`).evaluateAll((els) => els.filter((el) => el.getClientRects().length > 0).map((el) => el.getBoundingClientRect().toJSON()));
  assert(card !== null && boxes.length > 0, `${where}: no card or no ${target}`);
  for (const b of boxes) {
    const overlap = card.x < b.right && b.left < card.x + card.width && card.y < b.bottom && b.top < card.y + card.height;
    assert(!overlap, `${where}: the tour card covers ${target}`);
  }
};
```

- [ ] **Step 2: Step 12, "+" and the hiring words** (desktop, a fresh career with seed 1, flag seeded). In 1990:
  - "More: Recruiting" is enabled.
  - The plan says "Nobody is recruiting. Put one person on Recruiting to hire".
  - After the click, the counts are Product 2 and Recruiting 1. The plan reads "1 moved from Product", the
    "Hire at most" group shows, and its text contains "Hires join next year" and matches
    `/Expect none for sure|Expect at least \d+|expect \d+\./`.
  - "Less: Recruiting" takes the note away.
  - `noForbiddenWords` holds on the plan section.

  Then repeat the first click on `devices["iPhone 13"]` and `fitsEdges`. Pass line: "in a career + on Recruiting with
  everyone at work moves one person from Product, the row says so, and the plan says how hiring works".
- [ ] **Step 3: Step 13, the tour at 1280x800 in 2D** (`freshPage(DESKTOP, { tour: true })`; WebGL is off in this
  script).
  - Start a career with seed 1. The card shows "Step 1 of 7" and `cardClear(page, "status")`.
  - Next brings the team step. `cardClear(page, "team")`. Clicking "More: Recruiting" moves it to money on its own.
  - Clicking Price "Premium" moves it to cash. `cardClear(page, "cash")`. Next brings end. `cardClear(page, "end")`.
  - Click "End 1990". While the summary is open, `tourCard` has count 0. Close with "Plan 1991"; the report step
    shows. `cardClear(page, "report")`.
  - Next, then Done. `localStorage[TOUR_KEY] === "done"`. After a reload, `tourCard` has count 0.
  - How to play → "Show me around" shows step 1 again. "Skip the tour" hides it, and the key is "skipped".
  - `noForbiddenWords(tourCard)` at every step. `stays2D`. `noErrors()`.
- [ ] **Step 4: Step 14, the tour on an iPhone** (`freshPage(PHONE, { tour: true, device: devices["iPhone 13"] })`).
  - Start a career. Press the Rivals tab while step 1 shows, then Next. The team step presses the Plan tab
    (`aria-pressed="true"`).
  - At every step: the target's box lies inside the viewport, above the bar's top
    (`barTop = innerHeight - bar.offsetHeight`); `cardClear`; the card is at most 45% of the screen high; `fitsEdges`.
  - The flow is as in step 13, ending with the key "done".
- [ ] **Step 5: Step 15, nothing cut off on an iPhone over a played year** (`devices["iPhone 13"]`, flag seeded).
  - On the first screen, open "Replay a game with its seed". Every `input[type=text]` has a computed font size of
    at least 16px (the iOS zoom's cause, Task 3).
  - Then start a career with seed 1 and call `fitsEdges` after each of these:
    - 1990
    - each of the eight `section[aria-label="Your company"] [tabindex="0"]` anchors tapped (tooltip open)
    - "End 1990" and the summary
    - "Full report"
    - closing it, 1991
    - marketing to its maximum ("More: Marketing" until disabled)
    - Price "Premium"
    - "Sell 10%" when it is enabled
    - the Rivals tab, then the Plan tab
    - the page scrolled to the bottom
  - Pass line: "at iPhone width the page never scrolls sideways and nothing passes the edges over a played year,
    tooltips open; every text box is 16 px or more".
- [ ] **Step 6: Office-check step 19, the tour with the 3D office** (`freshPage(browser, { tour: true })`).
  - Start a career and wait `running(page)`. The card shows.
  - On the team step, the text contains "click a person, then another team" and `cardClear(page, "team")` holds.
  - With the card up, a click on a person in the office still starts a carry: `carryStrip(page)` appears. Press
    "Keep them".
  - Next through to end. "End 1990" plays the year with the card hidden (`tourCard` count 0 while `playBar` shows),
    and the report step shows after the summary closes.
  - Finish with Done. `noErrors()`.
- [ ] **Step 7: Documents.**
  - In `README.md`'s career bullet, after "...played in its complete 2D screens.", add: "A first career opens with a
    short tour of the controls, which How to play can show again. In a career, + on a team moves one person over from
    the largest other team, and the plan says how many hires to expect and why."
  - In `docs/career-rules.md`, under "What was tried and did not work", add one bullet with the exact numbers from
    "Notes for the owner": a third 1990s candidate a year was tried and not kept. On 1,000 careers it passed only
    just (Bootstrapper 39.0%, bot wins 16.5%); on 200 careers it failed the 40% cap (Bootstrapper 40.5%). The player
    already gets every 1990-1993 candidate with one recruiter, and the plan now says so.
- [ ] **Step 8: Run the checks, then both browser scripts whole:** `node scripts/career-check.mjs` and
  `node scripts/office-check.mjs`. Expected: each ends with its "every assertion passed" line. Then run
  `npm run sim:career -- strict=1`. Expected: exit 0, five PASS lines (nothing in the rules changed, so this matches
  `d4a1307`).
- [ ] **Step 9: Final review.** Review the branch against this plan's Review Focus with
  `git diff d4a1307 --stat` and the superpowers:requesting-code-review skill. Write each finding the review keeps as a
  task in the report to the owner, not as a silent fix.
- [ ] **Step 10: Commit**

```bash
git add scripts/career-check.mjs scripts/office-check.mjs README.md docs/career-rules.md
git commit -m "scripts: browser checks for the career's + and hiring words, the start tour on desktop, phone and 3D, and nothing cut off at iPhone width; docs say so"
```

---

## Notes for the owner

- **Why hiring looked broken.** The engine hires as it should: a player with one person on Recruiting got every
  candidate the 1990s offer in every one of 708 recruiting years measured over 200 seeds. Three things made it look
  broken:
  - "+" did nothing with everyone at work (fixed by Task 1).
  - The plan said "expect 0" while the player then hired 2. Its guess assumes every rival recruits and wins ties, and
    rivals do not recruit before 1993. Task 2 fixes the wording.
  - Early hires cost a fee now, a salary every year after, and a $125K move once a 5th person arrives. The plan's
    warnings already name the move; nothing names next year's salaries.
- **Config: not changed.** The hiring diagnosis recommended no config change, so there was nothing to apply.
  Measured for the record, `npm run sim:career -- strict=1` at `d4a1307`:

  | Target | Today, 1,000 careers | 3 candidates in the 1990s, 1,000 careers | 3 candidates, 200 careers |
  |---|---|---|---|
  | No computer type wins more than 40% | Bootstrapper 30.0% | Bootstrapper 39.0% | **FAIL**, Bootstrapper 40.5% |
  | Baseline bot wins 15% to 35% | 28.1% | 16.5% | 17.5% |
  | Bot's career ends early in 10% to 30% | 18.9% | 23.8% | 19.5% |
  | Bot goes public in 40% to 80% | 62.7% | 64.4% | 66.5% |
  | The leader of 2010 wins in under 60% | 22.8% | 28.0% | 25.5% |

  - "3 candidates in the 1990s" is `set=career.eras.0.values.hiring.candidatesPerTurn=3`. It passes strict on the
    default 1,000 careers (exit 0), but only just: 1 point under the 40% cap and 1.5 points over the bot's 15%
    floor. It fails on 200 careers.
  - It mostly feeds the rivals (the Bootstrapper hires 4.3 to 5.3 in 1990-1995 instead of about 3) and halves the
    bot's wins. The player already gets every candidate in 1990-1993 with one recruiter.
  - The owner may still choose it; this plan leaves it out.
- **Owner decisions:**
  - Should the 3D office show the most hires the year can bring ("up to")? Today it shows the plan's sure figure,
    which in 1990 is usually nobody.
  - Should the plan warn about next year's salaries before hiring ("Next year salaries rise to $X")?
  - Should "+" refuse to take the last person off Product before launch? As decided, it takes from the largest other
    team, Product first on ties.
  - The 16px text boxes also apply to the race's first screen on phones. Its text and every race test are
    unchanged, and race players on iPhones get the same fix. If the race's first screen must not change even in
    style, make the class conditional on `mode === "career"`.
  - A tour left unfinished in 1990 (the player closed the page) starts again on the next career's first year. It
    stops for good only on Done or Skip.

## After this plan

In a career, the hiring controls do what they show, and the plan explains hiring in plain words. The page fits an
iPhone without zooming in. A first career opens with a seven-step tour that can be skipped and replayed. What is left
for the owner:
- the decisions above
- whether the tour's words read well to a new player on a real phone; this machine checks layout in Chromium only,
  and iOS Safari itself was not run
