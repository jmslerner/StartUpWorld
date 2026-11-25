# Career Rules and Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the career game's rules, computer players and simulator with no screen: 49 one-year turns from 1990
to 2038 on the shared rules engine, tuned until the five career targets pass, with the race left exactly as it is.

**Architecture:** The career is a second config, `CAREER`, whose optional `career` block switches the career's rules
on inside the same pure engine; the race's config has no such block. Everything the career adds to a state or a log
lives in optional fields that the race never creates, so the race's outputs and its tests do not change. The numbers
of a year are the config with that year's era laid over it, resolved in one place (`rulesForTurn`).

**Tech Stack:** TypeScript 5.9 (strict), Vitest 4 in node, tsx for the simulator script. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-career-3d-design.md`, sections 5 to 9, 11 and 13. This plan is build
steps 1 and 2 of its section 15. Reference material: `docs/superpowers/specs/career-timeline-research.md`.

This is the first of four plans. The career's screens (step 3), the 3D office (step 4) and the market view with the
polish (step 5) each get their own plan when the step before is done, because each builds on what that step settles.

## Global Constraints

- **The race is untouched.** No existing test file is edited, and a race state, plan, report or log never gains a
  key. The two commands under "The checks" prove both after every task.
- **Career-only data is written only when `config.career` is set**, and never as a key whose value is `undefined`
  (one existing test file uses `toStrictEqual`).
- **Keys keep their order.** The golden record of Task 1 compares serialised text, so a race state or log keeps its
  keys in today's order as well as its values: build objects the way they are built today and add career keys last.
- **The engine stays pure.** Nothing under `src/engine` imports from `src/ai`, `src/sim`, `src/state` or `src/ui`,
  reads a clock or calls `Math.random`. Every roll comes from `streamSeed(seed, turn, purpose, company)`.
- **Every number lives in `src/config.ts`;** `src/config.design.ts` holds the frozen starting values. Counts that are
  part of a rule stay out of the config: one rescue, one card a year, four companies, "the year after" a rescue.
- **Rules C1 to C11 are fixed** as the spec states them. Numbers are tuned in Task 17 only. If a rule looks wrong,
  stop and ask the owner.
- **No real company, product or person is named in any text a player can read.** The real event behind a card goes in
  a code comment beside it.
- **Rule tests run on `CAREER_TEST`** (Task 2): the race's frozen design numbers with the career switched on. They
  never read `CAREER`, so tuning cannot break them.
- TypeScript: `erasableSyntaxOnly` (no enums, no parameter properties), `verbatimModuleSyntax` (`import type` for
  types), `noUnusedLocals`, `noUnusedParameters`. ESLint runs with `--max-warnings=0`. No new dependencies.
- Notes a player can read (plan fix-ups) are plain sentences in the style of `src/engine/plan.ts`.
- Commits: at least one per task, message `area: sentence` as in `git log`, ending with the session's attribution
  trailers. Push after each task.

### The checks

Run both after every task, before its commit.

```bash
npx tsc -b && npx eslint . --max-warnings=0 && npm test
```

Expected: no type errors, no lint output, every test passes.

```bash
git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'
```

Expected: prints nothing. `b0d38b0` is the last commit that changed the race, and `--diff-filter=a` leaves out files
added since, so anything printed is one of its 39 test files, edited or deleted.

## Review Focus

Conditions the spec implies but does not spell out, most likely first. Each is pinned by tests in the task named.

1. A screen sends a plan that asks for the impossible in a career: going public unqualified, twice, or together with
   a raise; hiring or poaching at the 150-person cap; marketing above the cash in hand. Each is fixed up with a note,
   never an error. (Tasks 7, 8, 10)
2. The year an era changes. The numbers switch in the same year for the turn, the projection, the plan check and the
   computer players, and a replay crosses the boundary identically. (Tasks 3, 13, 14)
3. Empty seats: every rival out at once, a year with no company in the market, and a last year that ends with nobody
   left. (Tasks 4, 11)
4. A company in trouble two years running: rescued, then bankrupt or fired the next year, including the year in which
   the board may not vote. (Task 9)
5. A dated card nobody qualifies for, a card that removes more candidates than there are, and a platform shift on a
   product that has not launched. (Tasks 5, 6)

## File structure

| File | Responsibility |
|---|---|
| `src/engine/types.ts` (modify) | The career's types, all optional on the race's shapes (see "Shared contract") |
| `src/engine/career.ts` (create) | The career's own rules as pure functions: years and eras, dated cards, offices, going public, the rescue |
| `src/engine/cast.ts` (create) | Name and pitch pools and their seeded draw, moved from `src/ai/names.ts`; draws a newcomer |
| `src/engine/careerKit.ts` (create) | Test helpers: `CAREER_TEST` and friends. Not used by the game |
| `src/engine/resolveTurn.ts`, `plan.ts`, `events.ts`, `setup.ts`, `project.ts`, `view.ts`, `rng.ts`, `index.ts` (modify) | Call the career's rules where the turn order says, only when `config.career` is set |
| `src/engine/career.*.test.ts` (create) | One file per rule, on `CAREER_TEST` |
| `src/engine/blackbox/career-*.test.ts` (create) | Independent tests written from the documents alone (Task 16) |
| `src/config.ts`, `src/config.design.ts` (modify) | `PlayConfig`, `CareerGameConfig`, `CAREER` and its frozen copy `CAREER_DESIGN` |
| `src/config.career.test.ts` (create) | What the career's config must always satisfy |
| `src/ai/types.ts`, `cpu.ts`, `baselineBot.ts`, `choosePlans.ts`, `names.ts` (modify) | Computer players in a career; `names.ts` takes its pools from `engine/cast.ts` |
| `src/sim/raceGolden.test.ts` (create) | Proof that the race's games did not change |
| `src/sim/runCareer.ts`, `pilots.ts`, `careerReport.ts` (create), `args.ts`, `scripts/sim.ts` (modify) | The simulator's career mode |
| `src/state/shape.ts` (modify) | The save check learns the optional career fields |
| `docs/career-rules.md` (create) | The order of a year, the rulings on what the spec left open, the tuning log |

## Shared contract

Task 2 adds this to `src/engine/types.ts`. Every later task uses these names exactly.

```ts
/** Some of T's numbers; whatever is left out keeps the value underneath. Lists are replaced whole. */
export type Overlay<T> = T extends readonly unknown[] ? T : T extends object ? { readonly [K in keyof T]?: Overlay<T[K]> } : T;

export interface OfficeConfig { readonly id: string; readonly name: string; readonly capacity: number }

/** An era's own values for any number of the config. `cpu` and `baseline` are read by src/ai only. */
export type EraValues = Overlay<Omit<RulesConfig, "game" | "career">> & { readonly cpu?: object; readonly baseline?: object };

export interface EraConfig {
  readonly id: string;
  readonly name: string;
  /** The calendar year the era starts in. It lasts until the next era starts. */
  readonly firstYear: number;
  /** False for history, true for the imagined future: the timeline marks where history ends. */
  readonly invented: boolean;
  /** `market` counts from the era's first year: `newUsersTurn1` arrive in that year. */
  readonly values: EraValues;
}

/** A card with a fixed year. It replaces that year's random draw. */
export interface DatedCard extends Omit<EventCard, "weight"> { readonly year: number }

export interface CareerRules {
  readonly firstYear: number;
  readonly eras: readonly EraConfig[];
  readonly dated: readonly DatedCard[];
  /** How many years ahead a platform shift is announced. */
  readonly shiftNoticeYears: number;
  readonly listing: { readonly percent: number; readonly premium: number; readonly hype: number; readonly investorSeats: number };
  readonly rescue: { readonly equityKept: number; readonly investorSeats: number; readonly hype: number; readonly salaryYears: number };
  readonly replacement: { readonly afterYears: number; readonly styles: readonly CpuKind[] };
  /** Smallest first. The last one cannot be outgrown. */
  readonly offices: readonly OfficeConfig[];
  readonly moving: { readonly salaryYears: number };
}

export interface Listing { readonly turn: number; readonly valuation: number; readonly amount: number }
export interface Rescue { readonly turn: number; readonly reason: OutReason }

/** What everyone can see of a company's career. */
export interface PublicCareer {
  /** The turn the company entered the game: 1 for the first four. */
  readonly founded: number;
  /** Index into `career.offices`. It only goes up. */
  readonly office: number;
  readonly listed: Listing | null;
  readonly rescue: Rescue | null;
}
export interface CompanyCareer extends PublicCareer {
  /** Quality when the last year closed, before the next year's card touched it. */
  readonly qualityAtLastClose: number;
  /** True once the company has closed a year at that year's bar with a profit. From then on it may go public. */
  readonly qualified: boolean;
}

/** More (or fewer) new users for some years: what a platform shift brings. Shaped like the funding climate. */
export interface Wave { readonly multiplier: number; readonly turnsLeft: number }

export interface CareerReport {
  readonly listing: { readonly valuation: number; readonly amount: number } | null;
  readonly rescue: { readonly reason: OutReason; readonly cashBefore: number; readonly equityBefore: number } | null;
  readonly office: { readonly from: number; readonly to: number; readonly bill: number } | null;
  readonly hype: { readonly listing: number; readonly rescue: number };
  readonly qualityLostToEvent: number;
}
```

And these optional members on existing shapes (absent in the race):

```ts
Plan.goPublic?: boolean
PublicCompany.career?: PublicCareer            Company.career?: CompanyCareer
CostBreakdown.moving?: number                  // counted in `total`
CompanyReport.career?: CareerReport
PublicReport.career?: { readonly listed: boolean; readonly rescued: OutReason | null; readonly movedTo: number | null }
TurnLog.entrants?: readonly CompanyId[]        // seats a new company takes for next year
RulesConfig.career?: CareerRules
GameState.wave?: Wave                          CompanyView.wave?: Wave   // in a career always there; at rest { multiplier: 1, turnsLeft: 0 }
EventEffect: | { readonly kind: "qualityCeiling"; readonly ceiling: number }                        // both also in
             | { readonly kind: "userWave"; readonly multiplier: number; readonly turns: number }   // EVENT_EFFECT_KINDS
```

`src/engine/career.ts` ends up exporting (the task that adds each is in brackets):

```ts
yearOf(turn: number, career: CareerRules): number                         // [3]
turnOf(year: number, career: CareerRules): number                         // [3]
eraIndexOf(turn: number, career: CareerRules): number                     // [3]
rulesForTurn<C extends RulesConfig>(config: C, turn: number): C           // [3] the numbers in force that turn
marketTurn(config: RulesConfig, turn: number): number                     // [3]
datedCardFor(turn: number, config: RulesConfig): DatedCard | null         // [5]
upcomingShift(turn: number, config: RulesConfig): ShiftNotice | null      // [6]
officeFor(headcount: number, career: CareerRules): number                 // [2]
peopleCap(career: CareerRules): number                                    // [10]
movingBill(headcount: number, rules: RulesConfig): number                 // [10]
listingBlocker(company: Company, turn: number, config: RulesConfig): ListingBlocker | null   // [7]
listingOf(company: Company, climateMultiplier: number, rules: RulesConfig): { valuation: number; amount: number }  // [7]
boardPaused(company: Company, turn: number): boolean                      // [9] the year after its rescue
isCpuKind(controller: Controller): controller is CpuKind                  // [11]
```

Two conventions hold everywhere:

- A parameter named `config` is the game's config (`CAREER`, `CONFIG`, a test config). A parameter or local named
  `rules` is `rulesForTurn(config, turn)`: the numbers of one year. Public functions take `config` and resolve `rules`
  themselves; `rulesForTurn` is cheap and gives the same answer when handed a `rules` object.
- "In a career" in this plan means `rules.career !== undefined`.

---

### Task 1: A golden record of the race

**Files:**
- Create: `src/sim/raceGolden.test.ts`
- Modify: `eslint.config.js` (lint leaves the tool folders `.claude` and `.superpowers` alone)

**Interfaces:**
- Consumes: `createGame`, `resolveTurn` (`src/engine`), `choosePlans` (`src/ai/choosePlans`), `newGameSetup`
  (`src/ai/names`), `CONFIG`, `DESIGN`.
- Produces: a test that fails if any race state or log changes by one character. And a lint run that reads this
  checkout only: the two tool folders can hold whole scratch copies of the repository, which `npx eslint .` would
  otherwise walk (measured: 35 seconds instead of 8, and a scratch copy's lint errors would fail this checkout's check).

- [ ] **Step 1: Write the test**

```ts
const digest = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
};
const play = (seed: number, config: GameConfig): string => {
  let state = createGame(newGameSetup(seed, "Golden", "baseline"), config);
  const logs: TurnLog[] = [];
  while (state.outcome === null) {
    const result = resolveTurn(state, choosePlans(state, seed, config), seed, config);
    logs.push(result.log);
    state = result.state;
  }
  return digest(JSON.stringify({ state, logs }));
};
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

describe("the race, as recorded before the career was built", () => {
  it("plays seeds 1 to 12 exactly as before on the shipped numbers", () => {
    expect(SEEDS.map((seed) => play(seed, CONFIG))).toEqual(RECORDED_CONFIG);
  });
  it("plays seeds 1 to 12 exactly as before on the design's numbers", () => {
    expect(SEEDS.map((seed) => play(seed, DESIGN))).toEqual(RECORDED_DESIGN);
  });
});
```

`RECORDED_CONFIG` and `RECORDED_DESIGN` are two arrays of twelve 8-character strings. Leave them empty for Step 2.

- [ ] **Step 2: Record the digests**

Run: `npx vitest run src/sim/raceGolden.test.ts`
Expected: FAIL, and each failure prints the twelve digests actually produced. Paste them into the two constants.
They should be the ones measured when this plan was written. If they are not, stop and find out what changed in the
race since `b0d38b0` before going on:

```ts
const RECORDED_CONFIG = ["352881c9", "7bec6bdc", "5361e1ca", "49e5b4b7", "c918f955", "28c8c4d6", "a8654ef9", "84221d88", "fee41339", "19aaf6f6", "2e6ecfda", "07fb5228"];
const RECORDED_DESIGN = ["5e71db35", "c13dd7cc", "7980b414", "4afc7c73", "f0be30d7", "606a138d", "15b947c1", "80464405", "0785a93a", "32fe095e", "b35ec94d", "65e68daf"];
```

- [ ] **Step 3: Check the test has teeth**

In `src/engine/formulas.ts` change `round4` to round to 3 digits. Run the test. Expected: both tests FAIL. Undo the
change (`git checkout src/engine/formulas.ts`). Run again. Expected: PASS.

- [ ] **Step 4: Keep the tool folders out of lint**

In `eslint.config.js` change `globalIgnores(['dist'])` to `globalIgnores(['dist', '.claude', '.superpowers'])`.

Run: `npx eslint . --max-warnings=0 --debug 2>&1 | grep -c "\.claude/"`
Expected: `0`.

- [ ] **Step 5: Run the checks and commit**

```bash
git add src/sim/raceGolden.test.ts eslint.config.js && git commit -m "sim: a golden record of the race, so the career cannot change it"
```

---

### Task 2: Types, the switch, a career's opening state, the save check

**Files:**
- Modify: `src/engine/types.ts` (the whole "Shared contract")
- Modify: `src/config.ts:15-19` (`PlayConfig`; `GameConfig` extends it)
- Modify: `src/engine/setup.ts` (each company's `career` and the state's `wave` when the config has a career)
- Modify: `src/engine/resolveTurn.ts` (step 14: a career's next state keeps `wave`)
- Modify: `src/engine/view.ts:8-24` (`publicCompany` copies the public career facts)
- Modify: `src/state/shape.ts`
- Create: `src/engine/career.ts`, `src/engine/careerKit.ts`, `docs/career-rules.md`
- Test: `src/engine/career.setup.test.ts`, `src/state/shape.career.test.ts`

**Interfaces:**
- Consumes: `DESIGN`, `FOUR_SEATS`, `createGame`, `resolve` (`src/engine/testKit.ts`).
- Produces, in `src/config.ts`:

```ts
export interface PlayConfig extends RulesConfig { readonly cpu: CpuConfig; readonly baseline: BaselineConfig }
export interface GameConfig extends PlayConfig { readonly sim: SimConfig }
```

- Produces, in `src/engine/careerKit.ts`:

```ts
export const OFFICES: readonly OfficeConfig[];   // garage 4, shared 9, own 22, floor 40, campus 150
export const CAREER_RULES: CareerRules;          // firstYear 1990; one era { id: "flat", name: "Flat", firstYear: 1990, invented: false, values: {} }; dated [];
                                                 // shiftNoticeYears 2; listing { percent: 20, premium: 1.25, hype: 20, investorSeats: 1 };
                                                 // rescue { equityKept: 0.5, investorSeats: 2, hype: -10, salaryYears: 1 };
                                                 // replacement { afterYears: 2, styles: ["blitzscaler", "bootstrapper", "incumbent"] };
                                                 // offices OFFICES; moving { salaryYears: 0.5 }
export const CAREER_TEST: GameConfig;            // { ...DESIGN, game: { maxTurns: 49 }, events: { ...DESIGN.events, chance: 0 }, career: CAREER_RULES }
export const withCareer: (patch: Partial<CareerRules>, base?: GameConfig) => GameConfig;
export const withEras: (...eras: EraConfig[]) => GameConfig;        // CAREER_TEST with these eras
export const newCareer: (config?: GameConfig) => GameState;         // createGame(FOUR_SEATS, config)
export const atTurn: (state: GameState, turn: number) => GameState; // the same state, dated to another turn
export const careerOf: (state: GameState, id: CompanyId) => CompanyCareer;                       // throws if absent
export const withCareerOf: (state: GameState, id: CompanyId, patch: Partial<CompanyCareer>) => GameState;
```

- Produces, in `src/engine/career.ts`: `officeFor` (smallest office whose capacity holds the head count; the last
  office when none does).

- [ ] **Step 1: Write the failing tests**

`src/engine/career.setup.test.ts`:

```ts
it("a race game has no career facts at all", () => {
  for (const company of newGame().companies) expect("career" in company).toBe(false);
});
it("a career opens with every company's career facts", () => {
  expect(newCareer().companies.map((company) => company.career)).toEqual([
    { founded: 1, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false },
    { founded: 1, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false },
    { founded: 1, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false },
    { founded: 1, office: 1, listed: null, rescue: null, qualityAtLastClose: 30, qualified: false },   // 8 people: the shared office
  ]);
});
it("a career keeps track of a wave of new users, at rest to begin with; a race has none", () => {
  expect(newCareer().wave).toEqual({ multiplier: 1, turnsLeft: 0 });
  expect("wave" in newGame()).toBe(false);
});
it("the smallest office that holds the team, and the last one beyond that", () => {
  expect([1, 4, 5, 9, 10, 22, 23, 40, 41, 150, 151].map((n) => officeFor(n, CAREER_RULES))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
});
it("what rivals see of a career leaves out the bookkeeping", () => {
  expect(publicCompany(newCareer().companies[3]).career).toEqual({ founded: 1, office: 1, listed: null, rescue: null });
  expect("career" in publicCompany(newGame().companies[3])).toBe(false);
});
it("a year keeps every company's career facts, and the wave", () => {
  const next = resolve(newCareer(), {}, 1, CAREER_TEST).state;
  expect(next.companies.map((company) => company.career?.founded)).toEqual([1, 1, 1, 1]);
  expect(next.wave).toEqual({ multiplier: 1, turnsLeft: 0 });
  expect("wave" in resolve(newGame(), {}, 1, DESIGN).state).toBe(false);
});
```

`src/state/shape.career.test.ts` (every state goes through `JSON.parse(JSON.stringify(...))` first):

```ts
it("accepts a career game and the log of its first year", () => {
  const { state, log } = resolve(newCareer(), {}, 1, CAREER_TEST);
  expect(isGame(saved(newCareer()), CAREER_TEST)).toBe(true);
  expect(isGame(saved(state), CAREER_TEST)).toBe(true);
  expect(isTurnLog(saved(log), 4)).toBe(true);
});
it.each([
  ["a company without its career facts", (g: Draft) => { delete g.companies[1].career; }],
  ["an office the config does not have", (g: Draft) => { g.companies[1].career.office = 5; }],
  ["a founding turn that is not a whole number", (g: Draft) => { g.companies[1].career.founded = 1.5; }],
  ["a rescue for an unknown reason", (g: Draft) => { g.companies[1].career.rescue = { turn: 3, reason: "merged" }; }],
  ["a listing without its amount", (g: Draft) => { g.companies[1].career.listed = { turn: 3, valuation: 1 }; }],
])("rejects %s", (_name, damage) => { /* damage a saved career game; isGame(..., CAREER_TEST) is false */ });
it("still accepts a race game against the race's config", () => {
  expect(isGame(saved(newGame()), DESIGN)).toBe(true);
});
it("a plan may say whether to go public, as a boolean only", () => {
  expect(isPlan({ ...somePlan, goPublic: true })).toBe(true);
  expect(isPlan(somePlan)).toBe(true);
  expect(isPlan({ ...somePlan, goPublic: "yes" })).toBe(false);
});
```

(`FOUR_SEATS` seats a human first, which `isGame` requires.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.setup.test.ts src/state/shape.career.test.ts`
Expected: FAIL (`./careerKit` does not exist).

- [ ] **Step 3: Implement**

1. `types.ts`: the contract. `config.ts`: `PlayConfig`.
2. `career.ts`: `officeFor`. `careerKit.ts`: as listed.
3. `createGame(setup, config)`: when `config.career` is set, each company gets
   `career: { founded: 1, office: officeFor(start.headcount, config.career), listed: null, rescue: null, qualityAtLastClose: start.quality, qualified: false }`
   and the state gets `wave: { multiplier: 1, turnsLeft: 0 }`. When it is not set, the state is built exactly as
   today. `resolveTurn` builds the next state field by field, so in a career it copies `wave` across unchanged
   (Task 6 makes it tick); a race's next state gets no such key.
4. `publicCompany`: adds `career` (without `qualityAtLastClose` and `qualified`) only when the company has one.
5. `shape.ts`: add `const optional = (check: Check): Check => (value) => value === undefined || check(value)` and a
   check for every new optional member: `Plan.goPublic`, `Company.career`, `CostBreakdown.moving`,
   `CompanyReport.career`, `TurnLog.entrants`, `GameState.wave`. The file does not compile until each is listed. In
   `isGame`, when `config.career` is set the state must have `wave` and every company `career`, with `office` below
   `config.career.offices.length`. `SAVE_VERSION` does not change: a race save has the shape it had.
6. `docs/career-rules.md`: the title, one paragraph saying this file records the order of a year, what the spec left
   open and what tuning changed, and the empty headings "Order of a year", "Rulings on open points", "Starting
   numbers", "Tuning log". Add ruling 1: "Career-only facts are absent from a race game, not present and empty, so
   the race's states and logs are unchanged."

- [ ] **Step 4: Run the tests, then the checks**

Run: `npx vitest run src/engine/career.setup.test.ts src/state/shape.career.test.ts`
Expected: PASS. Then the checks.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: the career's types and opening state, absent from a race game"
```

---

### Task 3: Years and eras (C1, C2)

**Files:**
- Modify: `src/engine/career.ts`, `src/engine/resolveTurn.ts`, `src/engine/project.ts`, `src/engine/plan.ts`,
  `src/engine/events.ts`, `src/engine/index.ts`, `docs/career-rules.md`
- Test: `src/engine/career.eras.test.ts`

**Interfaces:**
- Consumes: the kit (Task 2).
- Produces: `yearOf`, `turnOf`, `eraIndexOf`, `rulesForTurn`, `marketTurn` (signatures in "Shared contract").
  `rulesForTurn` returns the config itself when it has no `career`; otherwise the config with the era's `values`
  merged over it (plain objects merged key by key, lists and other leaves replaced), keeping `career`. It returns the
  same object for every turn of an era, and accepts an object it returned earlier in place of the config.
  `marketTurn` is the turn itself without a career, and the year's place within its era (1 for the era's first year)
  with one. `findCard(cardId, config)` also searches every era's `values.events.deck`.

- [ ] **Step 1: Write the failing tests**

```ts
const TWO_ERAS = withEras(
  { id: "a", name: "A", firstYear: 1990, invented: false, values: {} },
  { id: "b", name: "B", firstYear: 1993, invented: false, values: {
      salary: 2 * DESIGN.salary, quality: { gainPerWork: 9 }, raise: { options: [10] },
      market: { newUsersTurn1: 50_000, growthPerTurn: 0.5 }, pull: { maxMarketing: 50_000 } } },
);
const play = (turn: number, patches = {}) => resolve(atTurn(newCareer(TWO_ERAS), turn), patches, 1, TWO_ERAS);

describe("years", () => {
  it("turn 1 is 1990 and turn 49 is 2038", () => {
    expect([yearOf(1, CAREER_RULES), yearOf(49, CAREER_RULES), turnOf(2007, CAREER_RULES)]).toEqual([1990, 2038, 18]);
  });
  it("an era lasts until the next one starts", () => {
    expect([1, 3, 4, 49].map((turn) => eraIndexOf(turn, TWO_ERAS.career!))).toEqual([0, 0, 1, 1]);
  });
});

describe("the numbers of a year", () => {
  it("the race's config comes back as it is", () => { expect(rulesForTurn(DESIGN, 7)).toBe(DESIGN); });
  it("lays the era's values over the config", () => {
    const b = rulesForTurn(TWO_ERAS, 4);
    expect(b.salary).toBe(2 * DESIGN.salary);
    expect(b.quality).toEqual({ ...DESIGN.quality, gainPerWork: 9 });   // neighbours kept
    expect(b.raise.options).toEqual([10]);                              // lists replaced whole
    expect(b.hype).toEqual(DESIGN.hype);
    expect(rulesForTurn(TWO_ERAS, 3).salary).toBe(DESIGN.salary);
  });
  it("gives the same object for the same era, however it is asked", () => {
    const b = rulesForTurn(TWO_ERAS, 4);
    expect(rulesForTurn(TWO_ERAS, 30)).toBe(b);
    expect(rulesForTurn(b, 4)).toBe(b);
    expect(rulesForTurn(b, 2)).toBe(rulesForTurn(TWO_ERAS, 2));
  });
  it("does not change the config it was given", () => {
    const before = JSON.stringify(TWO_ERAS);
    rulesForTurn(TWO_ERAS, 4);
    expect(JSON.stringify(TWO_ERAS)).toBe(before);
  });
  it("counts the market from the era's first year", () => {
    expect([1, 3, 4, 6].map((turn) => marketTurn(TWO_ERAS, turn))).toEqual([1, 3, 1, 3]);
    expect(marketTurn(DESIGN, 6)).toBe(6);
  });
});

describe("a year is played on its era's numbers (Review Focus 2)", () => {
  it("pays the era's salary", () => {
    expect(reportFor(play(3), 0).costs.salaries).toBe(3 * DESIGN.salary);
    expect(reportFor(play(4), 0).costs.salaries).toBe(3 * 2 * DESIGN.salary);
  });
  it("brings the era's new users", () => {
    expect(play(3).log.market.newUsers).toBe(newUsersForTurn(3, 1, DESIGN));
    expect([play(4), play(6)].map((result) => result.log.market.newUsers)).toEqual([50_000, 112_500]);   // 1993; 1995 after two years of 50% growth
  });
  it("checks a plan against the era's limits", () => {
    expect(reportFor(play(4, { 0: { marketing: 100_000 } }), 0).plan.marketing).toBe(50_000);
    expect(reportFor(play(3, { 0: { marketing: 100_000 } }), 0).plan.marketing).toBe(100_000);
  });
  it("the projection uses the numbers the turn uses", () => {
    const state = atTurn(newCareer(TWO_ERAS), 4);
    expect(projectTurn(viewFor(state, 0), null, TWO_ERAS).costs.salaries).toBe(reportFor(play(4), 0).costs.salaries);
  });
  it("draws next year's card on next year's numbers", () => {
    // era "b" here also has events: { firstTurn: 2, chance: 1, deck: [one untargeted card with id "only"] }
    expect(playWithDeck(3).log.nextEvent).toEqual({ cardId: "only", targetId: null });   // 1993's card, drawn after 1992
    expect(playWithDeck(1).log.nextEvent).toBeNull();                                   // 1991 is still era "a": chance 0
    expect(findCard("only", configWithDeck)?.id).toBe("only");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.eras.test.ts`
Expected: FAIL (`yearOf` is not exported).

- [ ] **Step 3: Implement**

1. The five functions in `career.ts`. `rulesForTurn` keeps its results in a `WeakMap` keyed by the config object, and
   a second `WeakMap` from each result back to its config, so both identity tests hold.
2. `resolveTurn`: `const rules = rulesForTurn(config, turn)` at the top; every number read in this file comes from
   `rules`. New users: `newUsersForTurn(marketTurn(config, turn), state.modifiers.newUsers, rules)`. The next year's
   card is drawn and applied with the game's `config` (`drawEvent(closed, turn + 1, seed, config)`).
3. `projectTurn`, `estimateRivals`, `normalizePlanFor`, `raiseBlocker`: resolve `rules` from their `config` and the
   turn they are given, and use `marketTurn` the same way. `drawEvent` reads `events` from
   `rulesForTurn(config, turn)`. `companyRunway(company, config)` has no turn to resolve from: its callers hand it
   the year's `rules`, and its comment says so.
4. Export the five functions and `findCard`'s wider search from `src/engine/index.ts`.
5. `docs/career-rules.md`, rulings: "A year is `firstYear + turn - 1`." "The numbers of a year are the config with
   its era's values laid over it; lists are replaced whole." "Each era's market curve starts again: its
   `newUsersTurn1` arrive in the era's first year." "Limits, prices and the bar for going public are those of the
   year in which they are checked."

- [ ] **Step 4: Run the tests, then the checks**

Run: `npx vitest run src/engine/career.eras.test.ts src/sim/raceGolden.test.ts`
Expected: PASS. Then the checks.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: a career's years and eras, with each year played on its era's numbers"
```

---

### Task 4: A career runs to its last year (C1, C10)

**Files:**
- Modify: `src/engine/resolveTurn.ts` (the endings block, steps 11 to 13), `docs/career-rules.md`
- Test: `src/engine/career.endings.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: in a career `resolveTurn` sets `outcome` only when `turn >= rules.game.maxTurns`: `turnLimit` with the
  largest founder's stake among the companies not out (ties: higher valuation, then lower seat), or `wipeout` with
  `winnerId: null` when none is left. Reaching the bar ends nothing; one company left ends nothing. Until Task 9 a
  company that fails still goes out as in the race.

- [ ] **Step 1: Write the failing tests**

```ts
it("reaching the bar with a profit ends nothing", () => {
  // seat 0: launched, 300,000 users (the bar is 250,000), revenue above its costs
  const result = resolve(rich, {}, 1, CAREER_TEST);
  expect(result.log.outcome).toBeNull();
  expect(result.state.turn).toBe(rich.turn + 1);
  expect(resolve(rich, {}, 1, DESIGN).log.outcome?.kind).toBe("ipo");   // the same state in the race
});
it("a career goes on with one company left, and with none (Review Focus 3)", () => {
  expect(resolve(onlyActive(newCareer(), [HUMAN]), {}, 1, CAREER_TEST).log.outcome).toBeNull();
  const empty = resolve(onlyActive(newCareer(), []), {}, 1, CAREER_TEST);
  expect(empty.log.outcome).toBeNull();
  expect(empty.log.companies).toEqual([null, null, null, null]);
  expect(empty.state.carryOverUsers).toBe(empty.log.market.pool);     // the year's users wait
});
it("after the last year the largest founder's stake wins", () => {
  // turn 49; seat 0: 100,000 users, equity 1; seat 1: 300,000 users, equity 0.2; same hype
  const result = resolve(final, {}, 1, CAREER_TEST);
  expect(result.log.outcome).toEqual({ kind: "turnLimit", turn: 49, winnerId: 0 });
  expect(result.state.turn).toBe(49);
});
it("level stakes go to the higher valuation, then to the lower seat", () => { /* two cases */ });
it("a company that is out cannot win", () => { /* the largest stake belongs to a seat that is out */ });
it("with nobody left after the last year there is no winner (Review Focus 3)", () => {
  expect(resolve(atTurn(onlyActive(newCareer(), []), 49), {}, 1, CAREER_TEST).log.outcome).toEqual({ kind: "wipeout", turn: 49, winnerId: null });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.endings.test.ts`
Expected: FAIL (the first test gets an `ipo` outcome).

- [ ] **Step 3: Implement**

The endings block becomes `if (rules.career === undefined) { the block as it is today } else { the career's }`. The
career's block runs the bankruptcy check and the board vote exactly as the race does, then sets the outcome as
described under Interfaces. Rulings: "The engine gives a career an outcome only after its last year. `turnLimit`
goes to the largest founder's stake among the companies still in the game; ties go to the higher valuation, then the
lower seat; with nobody left the outcome is `wipeout`." "As in the race, the engine plays on when the player's
company is out. Ending the player's session after a second failure is the app's job (the screens plan); the
simulator plays every career to 2038." Add the "Order of a year" section: the race's fourteen steps, with a line
under each step that a later task changes.

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: a career ends after its last year, on the largest founder's stake"
```

---

### Task 5: Dated cards (C3)

**Files:**
- Modify: `src/engine/career.ts`, `src/engine/events.ts`, `src/engine/setup.ts`, `src/engine/resolveTurn.ts` (step 8,
  candidates), `docs/career-rules.md`
- Test: `src/engine/career.events.test.ts`

**Interfaces:**
- Consumes: Task 3.
- Produces: `datedCardFor(turn, config)`. `drawEvent` returns a year's dated card whenever there is one, without
  rolling; its target is picked as for a random card. `createGame` deals the first year's dated card. `findCard` also
  finds dated cards. The number of candidates on the market is never below 0.

- [ ] **Step 1: Write the failing tests**

```ts
const SLUMP: DatedCard = { year: 1992, id: "slump", name: "Slump", text: "…", effects: [
  { kind: "fundingClimate", multiplier: 0.5, turns: 3 }, { kind: "newUsers", multiplier: 0.7 }, { kind: "candidates", extra: 4 }] };
const OUTAGE: DatedCard = { year: 1992, id: "outage", name: "Outage", text: "…",
  target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 },
  effects: [{ kind: "targetUsers", fraction: 0.1 }, { kind: "targetHype", delta: -10 }] };

it("a dated card is in force in its year, whatever the dice say", () => {
  const config = withCareer({ dated: [SLUMP] }, { ...CAREER_TEST, events: { ...DESIGN.events, firstTurn: 2, chance: 1 } });
  for (let seed = 1; seed <= 50; seed++) {
    expect(resolve(atTurn(newCareer(config), 2), {}, seed, config).log.nextEvent).toEqual({ cardId: "slump", targetId: null });
  }
});
it("years without one draw from the deck as before", () => {
  // same config: the card for 1991 (drawn after 1990) is one of the deck's ids, for every seed 1 to 50
});
it("a card may carry several effects; only the climate outlasts the year", () => {
  const config = withCareer({ dated: [SLUMP] });
  const y1992 = resolve(atTurn(newCareer(config), 2), {}, 1, config).state;
  expect(y1992.climate).toEqual({ multiplier: 0.5, turnsLeft: 3 });
  expect(y1992.modifiers).toEqual({ newUsers: 0.7, marketing: 1, extraCandidates: 4 });
  const y1993 = resolve(y1992, {}, 1, config).state;
  expect(y1993.climate).toEqual({ multiplier: 0.5, turnsLeft: 2 });
  expect(y1993.modifiers).toEqual(NEUTRAL_MODIFIERS);
});
it("the first year's card is dealt with the game", () => {
  const config = withCareer({ dated: [{ ...SLUMP, year: 1990 }] });
  const game = newCareer(config);
  expect(game.event).toEqual({ cardId: "slump", targetId: null });
  expect(game.climate).toEqual({ multiplier: 0.5, turnsLeft: 3 });
  expect(game.modifiers.newUsers).toBe(0.7);
});
it("fewer candidates never means a negative market (Review Focus 5)", () => {
  // a dated card with { kind: "candidates", extra: -9 }; DESIGN has 6 candidates a turn
  expect(result.log.hiring.candidates).toBe(0);
  expect(result.log.hiring.picks).toEqual([]);
});
it("a card that hits one company picks among those that qualify", () => {
  // only seat 2 is launched with quality under 50 and users: for seeds 1 to 20 the target is seat 2
});
it("when nobody qualifies the card still shows, and hits nobody (Review Focus 5)", () => {
  const config = withCareer({ dated: [OUTAGE] });
  // turn 2; the Incumbent's quality is 90, and the three startups put everyone on Growth, so none of them launches
  const result = resolve(before, allOnGrowth, 1, config);
  expect(result.log.nextEvent).toEqual({ cardId: "outage", targetId: null });
  expect(result.state.companies.map((c) => [c.users, c.hype])).toEqual(
    result.log.companies.map((report) => [report!.users.end, report!.hype.end]));
});
it("a dated card can be looked up like any other", () => {
  expect(findCard("slump", withCareer({ dated: [SLUMP] }))?.name).toBe("Slump");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.events.test.ts`
Expected: FAIL (`nextEvent` is null in the first test).

- [ ] **Step 3: Implement**

`datedCardFor`; the branch at the top of `drawEvent`; `createGame` applies `datedCardFor(1, config)` through
`applyEvent`; `Math.max(0, …)` on the candidates in step 8 when in a career; `findCard`. Rulings: "A dated card
replaces the random draw of its year. `events.firstTurn` and `events.chance` govern random draws only." "The first
year's card is dealt with the game, so it cannot be a card that hits one company." "A dated card whose target rule
no company meets is still in force; the effects that need a target hit nobody." "Candidates on the market are never
fewer than none."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: dated cards, dealt in their year whatever the dice say"
```

---

### Task 6: Platform shifts (C4)

**Files:**
- Modify: `src/engine/events.ts` (`applyEvent`, `EventContext`), `src/engine/career.ts`, `src/engine/resolveTurn.ts`
  (step 6, the market; step 14; closing the books; the report), `src/engine/project.ts`, `src/engine/view.ts`
  (`viewFor`), `docs/career-rules.md`
- Test: `src/engine/career.shift.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces:

```ts
export interface ShiftNotice { readonly cardId: string; readonly year: number; readonly yearsAway: number; readonly ceiling: number }
```

  A platform shift is two effects on one dated card. `applyEvent` handles `qualityCeiling`: every company still in
  the game has its quality cut to the ceiling if it is above it. It also handles `userWave`: the state's `wave`
  becomes `{ multiplier, turnsLeft: turns }`, replacing a wave still running (`EventContext` gains an optional
  `wave`). While a wave runs, a year's new users are
  `newUsersForTurn(marketTurn(config, turn), modifiers.newUsers × wave.multiplier, rules)`, in the turn and in the
  projection alike (`viewFor` passes `wave` on). It ticks down at the end of each year exactly as the funding climate
  does. Closing the books sets `career.qualityAtLastClose` to the year's closing quality. Each career report carries
  `career.qualityLostToEvent` (`max(0, qualityAtLastClose − quality at the start of the year)`). `upcomingShift` is
  the first dated card with a `qualityCeiling` effect in the next `shiftNoticeYears` years, not counting the current
  year. From this task on every career report has a `career` member; the parts later tasks fill are `listing: null`,
  `rescue: null`, `office: null`, `hype: { listing: 0, rescue: 0 }` until then.

- [ ] **Step 1: Write the failing tests**

```ts
const SHIFT: DatedCard = { year: 1995, id: "shift", name: "Shift", text: "…", effects: [
  { kind: "qualityCeiling", ceiling: 30 }, { kind: "userWave", multiplier: 1.5, turns: 3 }] };
const config = withCareer({ dated: [SHIFT] });

it("cuts every product down to the ceiling and leaves lower ones alone", () => {
  // context: qualities 90, 35, 20 (launched) and 8 (not launched); seat 1 is out with quality 35
  const after = applyEvent(context, { cardId: "shift", targetId: null }, config);
  expect(after.companies.map((c) => c.quality)).toEqual([30, 35, 20, 8]);
  expect(after.companies.map((c) => c.launched)).toEqual([true, true, true, false]);   // launch is permanent
});
it("a leader and a newcomer restart level, and win the same share that year", () => {
  // 1994 closes with seats 0 and 1 identical in everything but quality: 90 and 35. Both then play the same plan.
  expect(y1995.companies.slice(0, 2).map((c) => c.quality)).toEqual([30, 30]);
  expect(Math.abs(reportFor(played1995, 0).users.won - reportFor(played1995, 1).users.won)).toBeLessThanOrEqual(1);
});
it("brings more new users for the years the card says, and then no more", () => {
  // 1994 is played, then 1995 to 1998 one after another
  expect(y1995.wave).toEqual({ multiplier: 1.5, turnsLeft: 3 });
  expect([played1995, played1996, played1997, played1998].map((result) => result.log.market.newUsers)).toEqual(
    [1.5, 1.5, 1.5, 1].map((times, i) => newUsersForTurn(6 + i, times, CAREER_TEST)));
  expect(played1997.state.wave).toEqual({ multiplier: 1, turnsLeft: 0 });
});
it("a card's one-year change in new users multiplies with a running wave", () => {
  // the same, with modifiers.newUsers 0.8 in 1996
  expect(played1996.log.market.newUsers).toBe(newUsersForTurn(7, 0.8 * 1.5, CAREER_TEST));
});
it("the projection counts the wave", () => {
  const atRest = { ...y1995, wave: { multiplier: 1, turnsLeft: 0 } };
  expect(projectTurn(viewFor(y1995, 0), null, config).pool - projectTurn(viewFor(atRest, 0), null, config).pool).toBe(
    newUsersForTurn(6, 1.5, CAREER_TEST) - newUsersForTurn(6, 1, CAREER_TEST));
});
it("the annual report says what the shift took", () => {
  expect(reportFor(played1995, 0).career?.qualityLostToEvent).toBe(careerOf(y1995, 0).qualityAtLastClose - 30);
  expect(reportFor(played1995, 2).career?.qualityLostToEvent).toBe(0);
});
it("is announced two years ahead, and not in its own year", () => {
  expect([3, 4, 5, 6].map((turn) => upcomingShift(turn, config))).toEqual([
    null,
    { cardId: "shift", year: 1995, yearsAway: 2, ceiling: 30 },
    { cardId: "shift", year: 1995, yearsAway: 1, ceiling: 30 },
    null,
  ]);
  expect(upcomingShift(4, DESIGN)).toBeNull();
});
it("a product that has not launched is not launched by a shift, nor set back (Review Focus 5)", () => { /* quality 8 stays 8 */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.shift.test.ts`
Expected: FAIL (qualities come back unchanged).

- [ ] **Step 3: Implement**

As under Interfaces. Rulings: "A platform shift is two effects on one dated card: a ceiling on quality in its year,
and a wave of new users for the years the card says." "The ceiling caps every company still in the game, launched or
not; launch is permanent." "A new wave replaces one still running; it multiplies with a card's one-year change in new
users, and it ticks down with the funding climate." "A shift is announced in the `shiftNoticeYears` years before it,
not in its own year."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: a platform shift caps every product's quality, announced two years ahead"
```

---

### Task 7: Going public (C5, C6)

**Files:**
- Modify: `src/engine/career.ts`, `src/engine/plan.ts`, `src/engine/resolveTurn.ts` (steps 1 to 3, 9 and 10, the
  valuation, closing the books), `src/engine/project.ts`, `src/engine/view.ts` (`publicReport`),
  `src/engine/careerKit.ts` (`qualify`), `docs/career-rules.md`
- Test: `src/engine/career.listing.test.ts`

**Interfaces:**
- Consumes: Task 6 (every career report has `career`).
- Produces:

```ts
export type ListingBlocker = "unavailable" | "listed" | "users" | "profit";
// "unavailable": not a career. "listed": already public. null: `career.qualified` is true. Otherwise it says what
// was missing last year: "users" when it closed under that year's bar, or no year has been played; else "profit".
export type RaiseBlocker = "users" | "cooldown" | "public";      // src/engine/plan.ts
Projection.career?: { readonly listing: { readonly valuation: number; readonly amount: number } | null; readonly office: { readonly from: number; readonly to: number; readonly bill: number } | null }
```

  Closing the books sets `career.qualified` to true when the year ends with at least that year's `ipo.users` and
  with revenue that covered its costs; it never goes back to false. `listingOf` values the company at the year's
  opening (`valuationOf(users, hype, climate, rules)`, no premium) and returns that with
  `amount = round(valuation × listing.percent / 100)`. Kit helper `qualify(state, id)`: the company launched, with
  the bar's users, a last year whose revenue covered its costs, and `career.qualified: true`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a company qualifies by closing a year at that year's bar with a profit", () => {
  // 1991: seat 0 ends with 250,000 users and revenue above its costs; seat 1 with 249,999; seat 2 at the bar, at a loss
  expect(after.companies.slice(0, 3).map((company) => company.career?.qualified)).toEqual([true, false, false]);
  expect(after.companies.slice(0, 3).map((company) => listingBlocker(company, after.turn, CAREER_TEST))).toEqual([null, "users", "profit"]);
});
it("and stays qualified: a bad year or a higher bar later does not take it back", () => {
  // two eras, the second with ipo: { users: 400_000 }; qualified in the first with 300,000 users, then a year at a loss in the second
  expect(later.companies[0].career?.qualified).toBe(true);
  expect(listingBlocker(later.companies[0], later.turn, config)).toBeNull();
});
it("who else may not", () => {
  expect(listingBlocker(qualify(newCareer(), 0).companies[0], 2, CAREER_TEST)).toBeNull();
  expect(listingBlocker(newCareer().companies[3], 1, CAREER_TEST)).toBe("users");      // nothing played yet
  expect(listingBlocker(/* already listed */, 5, CAREER_TEST)).toBe("listed");
  expect(listingBlocker(newGame().companies[0], 2, DESIGN)).toBe("unavailable");
});
it("sells 20% at the year's opening valuation", () => {
  const opening = valuationOf(company.users, company.hype, 1, CAREER_TEST);
  expect(report.career?.listing).toEqual({ valuation: opening, amount: Math.round(opening * 0.2) });
  expect(report.cash.end).toBe(report.cash.start + Math.round(opening * 0.2) + report.revenue - report.costs.total);
  expect(report.equity).toBe(round6(company.founderEquity * 0.8));
  expect(after.investorSeats).toBe(company.investorSeats + 1);
  expect(report.plan.allocation.product + report.plan.allocation.growth + report.plan.allocation.recruiting).toBe(company.headcount);
  expect(after.lastRaise).toEqual(company.lastRaise);                     // no cooldown started
  expect(report.raise).toBeNull();
  expect(after.career?.listed).toEqual({ turn: state.turn, valuation: opening, amount: Math.round(opening * 0.2) });
});
it("gains 20 hype in the year it lists, capped at 100", () => {
  expect(report.career?.hype.listing).toBe(20);
  expect(report.hype.end).toBe(round4(Math.min(100, company.hype * (1 - DESIGN.hype.decay) + report.hype.growth + 20)));
});
it("is worth 25% more from the end of that year on", () => {
  expect(report.valuation).toBe(Math.round(valuationOf(report.users.end, report.hype.end, 1, CAREER_TEST) * 1.25));
  expect(nextReport.valuation).toBe(Math.round(valuationOf(nextReport.users.end, nextReport.hype.end, 1, CAREER_TEST) * 1.25));
});
it("so the founder's stake does not shrink", () => {
  expect(CAREER_RULES.listing.premium * (1 - CAREER_RULES.listing.percent / 100)).toBeGreaterThanOrEqual(1);
});
it("the game goes on", () => { expect(result.log.outcome).toBeNull(); });
it("a public company cannot raise privately", () => {
  expect(raiseBlocker(after, state.turn + 1, CAREER_TEST)).toBe("public");
  expect(reportFor(next, 0).notes).toContain("Raise dropped: a public company cannot raise privately.");
  expect(reportFor(next, 0).raise).toBeNull();
});
describe("plans that ask for the impossible (Review Focus 1)", () => {
  it.each([
    ["before a year has closed at the bar", "Going public dropped: no year has yet closed with 250,000 users."],
    ["when the year at the bar closed at a loss", "Going public dropped: last year closed at the bar, but not with a profit."],
    ["a second time", "Going public dropped: the company is already public."],
  ])("asking to go public %s is dropped with the reason", (_case, note) => { /* report.notes contains note; report.career.listing is null */ });
  it("going public and raising in one year keeps the listing and drops the raise", () => {
    expect(report.notes).toContain("Raise dropped: a company cannot raise privately in the year it goes public.");
    expect(report.raise).toBeNull();
    expect(report.career?.listing).not.toBeNull();
  });
  it("a race plan that says goPublic is played as if it did not", () => {
    expect(resolve(newGame(), { 0: { goPublic: true } }, 1, DESIGN).log).toEqual(resolve(newGame(), {}, 1, DESIGN).log);
  });
});
it("the projection shows the exact amount before the year is ended", () => {
  expect(projection.career?.listing).toEqual(report.career?.listing);
  expect([projection.equity, projection.investorSeats]).toEqual([report.equity, after.investorSeats]);
  expect(projection.plan).toEqual(report.plan);
});
it("everyone can see that a rival went public", () => {
  expect(publicReport(report).career?.listed).toBe(true);
  expect(publicCompany(after).career?.listed?.turn).toBe(state.turn);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.listing.test.ts`
Expected: FAIL (`listingBlocker` is not exported).

- [ ] **Step 3: Implement**

1. `career.ts`: `listingBlocker`, `listingOf`. `plan.ts`: `raiseBlocker` returns `"public"` for a listed company; in
   a career `normalizePlanFor` resolves `goPublic` (dropped with the notes above when blocked), drops a raise that
   comes with a listing, and always writes `goPublic: true | false` into the resolved plan. Outside a career it
   never writes the key.
2. `resolveTurn`: the listing closes with the raise step (cash in before the year's work, founder's equity times
   `1 − percent/100`, `listing.investorSeats` more investor seats); `listing.hype` joins the year's hype; the
   end-of-year valuation of a company that is public, or listed this year, is `Math.round(valuationOf(…) × premium)`;
   closing the books records `career.listed` and sets `career.qualified`. The number in the "users" note is this
   year's bar.
3. `projectTurn`: the same listing, equity, seats, hype and premium; `Projection.career`.
4. `publicReport`: `career: { listed, rescued: null, movedTo: null }` for a career report (Tasks 9 and 10 fill the
   other two).
5. `src/ui/viewModel.ts` needs no change: its raise text ignores a blocker it does not know.
6. Rulings: "A company qualifies when a year closes with that year's bar in users and with revenue that covered its
   costs. Once qualified it stays qualified, whatever happens later, and may list in any later year, once." "A
   listing closes with the raise step, at the opening valuation without the premium; the premium
   applies from the end of that year, rounded to whole dollars after it." "A plan that both raises and goes public
   loses the raise."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: going public is a choice in the plan, with a lasting premium and no more raises"
```

---

### Task 8: Marketing from cash in hand (C11)

**Files:**
- Modify: `src/engine/plan.ts`, `src/engine/resolveTurn.ts` and `src/engine/project.ts` (pass the climate),
  `docs/career-rules.md`
- Test: `src/engine/career.marketing.test.ts`

**Interfaces:**
- Consumes: Task 7 (`listingOf`).
- Produces: `normalizePlanFor(company, turn, others, plan, config, climateMultiplier = 1)`. In a career the resolved
  marketing is at most `floor((max(0, company.cash) + proceeds) ÷ step) × step`, where `proceeds` is this year's
  raise or listing at the opening valuation; the era's `pull.maxMarketing` still applies. `normalizePlan` and
  `projectTurn` pass the state's and the view's climate.

- [ ] **Step 1: Write the failing tests**

```ts
const step = DESIGN.pull.marketingStep;
it("marketing cannot exceed the cash the year starts with (Review Focus 1)", () => {
  // seat 0 starts the year with $310,000 and asks for $500,000
  expect(report.plan.marketing).toBe(Math.floor(310_000 / step) * step);
  expect(report.notes).toContain(`Marketing set to $${(Math.floor(310_000 / step) * step).toLocaleString("en-US")}: it cannot exceed the cash in hand.`);
});
it("a raise this year counts", () => {
  const raised = raiseAmount(valuationOf(company.users, company.hype, 1, CAREER_TEST), 20);
  expect(report.plan.marketing).toBe(Math.floor((100_000 + raised) / step) * step);
});
it("a listing this year counts", () => { /* the same with listingOf(...).amount */ });
it("the opening valuation follows the funding climate, in the turn and in the projection alike", () => {
  // climate { multiplier: 0.5, turnsLeft: 2 }: the raise is half as large, and so is the room for marketing
  expect(report.plan.marketing).toBe(Math.floor((100_000 + Math.round(raised / 2)) / step) * step);
  expect(projectTurn(viewFor(state, 0), plan, CAREER_TEST).plan.marketing).toBe(report.plan.marketing);
});
it("a company with no cash can spend nothing", () => { expect(report.plan.marketing).toBe(0); });
it("a budget within the cash in hand is left alone, with no note", () => { /* notes has no line starting "Marketing set" */ });
it("the race has no such limit", () => {
  // DESIGN: $100,000 in hand, $500,000 of marketing
  expect(reportFor(resolve(poor, { 0: { marketing: 500_000 } }, 1, DESIGN), 0).plan.marketing).toBe(500_000);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.marketing.test.ts`
Expected: FAIL (marketing stays at $500,000).

- [ ] **Step 3: Implement**

As under Interfaces. One note per plan: when both a step fix-up and the cash limit apply, only the cash note is
written. Ruling: "The room for marketing is the opening cash, never counted below $0, plus this year's raise or
listing at the opening valuation, rounded down to the marketing step."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: in a career, marketing is paid from the cash in hand"
```

---

### Task 9: One rescue (C7)

**Files:**
- Modify: `src/engine/career.ts`, `src/engine/resolveTurn.ts` (the career's endings block; closing the books; the
  report), `src/engine/project.ts` (`boardRisk`), `src/engine/view.ts` (`publicReport`), `docs/career-rules.md`
- Test: `src/engine/career.rescue.test.ts`

**Interfaces:**
- Consumes: Task 4 (the career's endings block), Task 7 (the premium in the valuation).
- Produces: `boardPaused(company: Company, turn: number): boolean` in `career.ts`: true in the turn after the
  company's rescue. In the career's endings block a company that would go out (cash below $0, checked first; or the
  board fires its founder) is rescued if `career.rescue` is null, and goes out as in the race otherwise. A rescue:
  equity times `rescue.equityKept`; investor seats become `max(seats + rescue.investorSeats, founderSeats + 1)`;
  `rescue.hype` is added to the year's hype after it is worked out, not below 0; cash below $0 becomes
  `end-of-year headcount × rules.salary × rescue.salaryYears`; the valuation is worked out after all that.

- [ ] **Step 1: Write the failing tests**

```ts
const yearHype = (report: CompanyReport): number =>
  round4(clamp(report.hype.start * (1 - DESIGN.hype.decay) + report.hype.launch + report.hype.raise + report.hype.growth + report.hype.layoffs, 0, 100));

it("a first bankruptcy is a rescue, not the end", () => {
  // seat 0 opens the year with 5 people, $0, 2 founder seats, no investor seat, equity 0.8, hype 40
  const cashBefore = report.cash.start + report.revenue - report.costs.total;
  expect(cashBefore).toBeLessThan(0);
  expect(report.out).toBeNull();
  expect(report.career?.rescue).toEqual({ reason: "bankrupt", cashBefore, equityBefore: 0.8 });
  expect(report.equity).toBe(0.4);
  expect(after.investorSeats).toBe(3);
  expect(report.career?.hype.rescue).toBe(-10);
  expect(report.hype.end).toBe(round4(Math.max(0, yearHype(report) - 10)));
  expect(report.cash.end).toBe(report.headcount.end * DESIGN.salary);
  expect(report.valuation).toBe(valuationOf(report.users.end, report.hype.end, 1, CAREER_TEST));
  expect(after.career?.rescue).toEqual({ turn: state.turn, reason: "bankrupt" });
  expect(after.out).toBeNull();
  expect(report.board).toBeNull();          // rescued from bankruptcy: not also voted on that year
});
it.each([[0, 3], [1, 3], [2, 4], [5, 7]])("from %i investor seats to %i: always more than the founders' two", (before, expected) => {
  /* the same rescue with `before` investor seats */
});
it("a first firing by the board is a rescue too", () => {
  // investors control seat 0, its users fell, and the seed is one for which the board fires
  expect(report.board).toEqual({ usersFell: true, lowRunway: false, fired: true });
  expect(report.out).toBeNull();
  expect(report.career?.rescue?.reason).toBe("fired");
  expect(report.equity).toBe(round6(company.founderEquity * 0.5));
  expect(report.cash.end).toBe(report.cash.start + report.revenue - report.costs.total);   // cash is only reset from below $0
});
it("the board does not vote in the year after a rescue (Review Focus 4)", () => {
  // rescued in turn 5; in turn 6 its users fall again
  for (let seed = 1; seed <= 200; seed++) {
    expect(reportFor(resolve(year6, {}, seed, CAREER_TEST), 0).board).toEqual({ usersFell: true, lowRunway: false, fired: false });
  }
  expect(boardPaused(year6.companies[0], 6)).toBe(true);
  expect(projectTurn(viewFor(year6, 0), null, CAREER_TEST).boardRisk).toBe(0);
});
it("and votes again the year after that: a second firing is final", () => {
  expect(boardPaused(year7.companies[0], 7)).toBe(false);
  expect(reportFor(resolve(year7, {}, firingSeed, CAREER_TEST), 0).out).toBe("fired");
});
it("a second bankruptcy is final, the year after a rescue included (Review Focus 4)", () => {
  expect(report6.out).toBe("bankrupt");
  expect(report6.career?.rescue).toBeNull();
  expect(result6.state.companies[0].out).toEqual({ turn: 6, reason: "bankrupt", users: report6.users.end, headcount: report6.headcount.end });
  expect(result6.state.freedPeople).toBe(report6.headcount.end);
});
it("everyone can see a rescue", () => { expect(publicReport(report).career?.rescued).toBe("bankrupt"); });
it("the Incumbent is rescued like anyone else", () => { /* seat 3 */ });
it("the race still has no rescue", () => {
  expect(reportFor(resolve(brokeRaceGame, {}, 1, DESIGN), 0).out).toBe("bankrupt");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.rescue.test.ts`
Expected: FAIL (`report.out` is `"bankrupt"` in the first test).

- [ ] **Step 3: Implement**

As under Interfaces. In the pause year the board's report still says what it saw, with `fired: false`. Rulings:
"Bankruptcy is checked first; a company rescued from it is not voted on that year." "'The year after a rescue' is the
next turn only." "The rescue's hype is taken off after the year's hype is worked out, not below 0, and the valuation
follows." "Investors end a rescue with two more seats, or one more than the founders if that is more." "Cash is reset
only from below $0, to a year of salaries for the team as the year ends."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: the first failure is a rescue at a heavy price; the second is final"
```

---

### Task 10: Offices (C9)

**Files:**
- Modify: `src/engine/career.ts`, `src/engine/plan.ts` (poach at the cap), `src/engine/resolveTurn.ts` (steps 7 to 9;
  closing the books), `src/engine/project.ts`, `docs/career-rules.md`
- Test: `src/engine/career.offices.test.ts`

**Interfaces:**
- Consumes: Task 2 (`officeFor`), Task 7 (`Projection.career`).
- Produces: `peopleCap(career)` (the last office's capacity) and `movingBill(headcount, rules)`
  (`moving.salaryYears × headcount × rules.salary`). In a career every report's `costs.moving` is a number (0 without
  a move) and is part of `costs.total`.

- [ ] **Step 1: Write the failing tests**

```ts
it("ending a year with more people than the office holds means a move and a bill", () => {
  // seat 0: 4 people in the garage, one of them recruiting, and a candidate to hire
  expect(report.headcount.end).toBe(5);
  expect(report.career?.office).toEqual({ from: 0, to: 1, bill: 0.5 * 5 * DESIGN.salary });
  expect(report.costs.moving).toBe(0.5 * 5 * DESIGN.salary);
  const { salaries, marketing, hiring, poaching, severance, moving, total } = report.costs;
  expect(total).toBe(salaries + marketing + hiring + poaching + severance + (moving ?? 0));
  expect(report.cash.end).toBe(report.cash.start + report.revenue - total);
  expect(after.career?.office).toBe(1);
  expect(publicReport(report).career?.movedTo).toBe(1);
});
it("a year that ends exactly full is not a move", () => {
  expect(report.career?.office).toBeNull();
  expect(report.costs.moving).toBe(0);
});
it("a big jump skips sizes for one bill", () => {
  // 23 people still recorded in the garage
  expect(report.career?.office).toEqual({ from: 0, to: 3, bill: 0.5 * 23 * DESIGN.salary });
});
it("offices are never given up", () => { /* 3 people in office 2: no move, no bill, office stays 2 */ });
it("the bill is one of the year's costs: it counts against profit and can bankrupt", () => {
  expect(report.profitable).toBe(report.revenue >= report.costs.total);
  /* a company that could pay everything but the bill ends below $0 and is rescued */
});
it("the bill uses the year's salary", () => { /* two eras, the second with twice the salary: twice the bill */ });
it("recruiting stops at the last office's size (Review Focus 1)", () => {
  expect(reportFor(with149, 0).hiring).toMatchObject({ wanted: 1, hired: 1 });     // capacity for 5, room for 1
  expect(reportFor(with150, 0).hiring.wanted).toBe(0);
});
it("a poach cannot overfill it (Review Focus 1)", () => {
  expect(reportFor(with150Poaching, 0).notes).toContain("Poach dropped: the campus is full.");
  expect(reportFor(with150Poaching, 0).poach).toBeNull();
  expect(reportFor(with150Poaching, 0).costs.poaching).toBe(0);
});
it("the projection shows the bill before the year is ended", () => {
  expect(projection.career?.office).toEqual({ from: 0, to: 1, bill: 0.5 * 5 * DESIGN.salary });
  expect(projection.costs.moving).toBe(0.5 * 5 * DESIGN.salary);
});
it("the projection counts every hire it wants and the poach it plans, so its cash errs low", () => {
  // 4 people in the garage want one hire but no candidate is left: the projection shows a bill, the report none
  expect(projection.costs.moving).toBeGreaterThan(0);
  expect(report.costs.moving).toBe(0);
  expect(projection.cash).toBeLessThan(report.cash.end);
});
it("a race report has no moving line", () => {
  expect("moving" in reportFor(resolve(newGame(), {}, 1, DESIGN), 0).costs).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.offices.test.ts`
Expected: FAIL (`peopleCap` is not exported).

- [ ] **Step 3: Implement**

1. Step 8: `wanted` is also capped by `peopleCap − (payroll + poachedIn − poachedOut)`, never below 0.
2. Steps 1 and 7: a poach by a company whose payroll already fills the last office is dropped with
   `Poach dropped: the <last office's name, in lower case> is full.`
3. Step 9: when the end-of-year head count is over the office's capacity, the office becomes
   `officeFor(headcountEnd, career)` and `movingBill(headcountEnd, rules)` joins the costs.
4. `projectTurn`: the same, on `payroll + hiresWanted + (a poach is planned ? 1 : 0)`.
5. Rulings: "The office is checked once a year, on the head count as the year ends." "One bill, however many sizes
   are skipped: `moving.salaryYears` of that year's salary for everyone who moves." "The bill is one of the year's
   costs." "Hires are capped so that a team never exceeds the last office, and a poach that would overfill it is
   dropped." "The projection assumes every wanted hire and the planned poach arrive."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: offices hold a team, cost a move to outgrow, and end at 150 people"
```

---

### Task 11: Rivals come and go (C8)

**Files:**
- Create: `src/engine/cast.ts`
- Modify: `src/ai/names.ts` (takes its pools and draws from `engine/cast.ts`; same exports, same draws),
  `src/engine/rng.ts` (`STREAM.entrant: 11`), `src/engine/setup.ts`, `src/engine/career.ts`,
  `src/engine/resolveTurn.ts` (step 14; the log), `docs/career-rules.md`
- Test: `src/engine/career.entrants.test.ts`

**Interfaces:**
- Consumes: Task 3 (`rulesForTurn`), Task 2 (`officeFor`).
- Produces:

```ts
// src/engine/cast.ts
export const NAME_STARTS: readonly string[];
export const NAME_ENDS: readonly string[];
export const PITCHES: Readonly<Record<CpuKind, readonly string[]>>;            // the race's lines, unchanged
export const ENTRANT_PITCHES: Readonly<Record<CpuKind, readonly string[]>>;    // a newcomer's lines: none claims age, size or users
export const picker: (streamSeed: number) => (max: number) => number;          // successive whole numbers 0..max from one stream
export const drawName: (pick: (max: number) => number, taken: ReadonlySet<string>) => string;   // `taken` holds lower-cased names
export const drawEntrant: (seed: number, turn: number, seat: CompanyId, taken: ReadonlySet<string>, career: CareerRules) => SeatSetup;
// src/engine/setup.ts
export const seatCompany: (id: CompanyId, seat: SeatSetup, config: RulesConfig, turn: number) => Company;
// src/engine/career.ts
export const isCpuKind: (controller: Controller) => controller is CpuKind;
```

  `drawEntrant` draws, in this order, from `picker(streamSeed(seed, turn, STREAM.entrant, seat))`: the style (one of
  `career.replacement.styles`), the name, the pitch (from `ENTRANT_PITCHES[style]`); it returns
  `{ controller: style, archetype: "startup", name, pitch }`. `seatCompany` builds the company `createGame` builds
  today, on `rulesForTurn(config, turn)`, with `career.founded = turn` in a career; `createGame` uses it with turn 1.
  In a career every log has `entrants` (an empty list when nobody enters).

- [ ] **Step 1: Write the failing tests**

```ts
// year6State: turn 6, with seat 1 (a Blitzscaler) out since turn 5
it("two years after a rival goes out a new startup takes its seat", () => {
  const year6 = resolve(year6State, {}, 1, config);
  expect(year6.log.entrants).toEqual([1]);
  const newcomer = year6.state.companies[1];
  expect(newcomer).toMatchObject({ id: 1, out: null, archetype: "startup", headcount: 3, users: 0, quality: 0, launched: false,
    founderEquity: 1, founderSeats: 2, investorSeats: 0, lastRaise: null, lastQuarter: null, lastRevenue: null });
  expect(newcomer.cash).toBe(rulesForTurn(config, 7).archetypes.startup.cash);          // the entry year's starting cash
  expect(newcomer.career).toEqual({ founded: 7, office: 0, listed: null, rescue: null, qualityAtLastClose: 0, qualified: false });
  const names = year6.state.companies.map((company) => company.name.toLowerCase());
  expect(new Set(names).size).toBe(4);
  expect(newcomer.name).not.toBe(year6State.companies[1].name);
});
it("and no sooner", () => {
  expect(resolve(year5StateWithSeat1Failing, {}, 1, config).log.entrants).toEqual([]);
  expect(resolve(year5StateWithSeat1Failing, {}, 1, config).state.companies[1].out?.turn).toBe(5);
});
it("its style comes from the seed and is one of the three", () => {
  const styles = Array.from({ length: 60 }, (_, i) => resolve(year6State, {}, i + 1, config).state.companies[1].controller);
  expect(new Set(styles)).toEqual(new Set(["blitzscaler", "bootstrapper", "incumbent"]));
  expect(resolve(year6State, {}, 7, config).state.companies[1]).toEqual(resolve(year6State, {}, 7, config).state.companies[1]);
});
it("a newcomer that plays the Incumbent's style is still an ordinary startup", () => {
  // for a seed that draws "incumbent": archetype "startup", the startup's numbers, a pitch from ENTRANT_PITCHES.incumbent
});
it.each(["human", "baseline"] as const)("a seat played by %s is never refilled", (controller) => {
  /* seat 0 out since turn 5: still out, and never among the entrants, in every turn up to 15 */
});
it("there are always four seats, and the swap neither makes nor loses users", () => {
  expect(year6.state.companies.map((company) => company.id)).toEqual([0, 1, 2, 3]);
  expect(usersInSystem(year6.state)).toBe(usersInSystem(year6State) + year6.log.market.newUsers);
});
it("with every seat empty the market waits, and newcomers start it again (Review Focus 3)", () => {
  // all four companies out in turn 5; turn 6 has no company at all; turn 7 opens with three newcomers
  expect(turn7.companies.map((company) => company.out === null)).toEqual([false, true, true, true]);
  expect(turn7.carryOverUsers).toBeGreaterThan(0);
});
it("a card for the entry year can hit the newcomer", () => {
  /* a dated card for 1996 with target { pick: "random" } and nobody else in the game: its target is seat 1 */
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/career.entrants.test.ts`
Expected: FAIL (`log.entrants` is undefined).

- [ ] **Step 3: Implement**

1. `cast.ts`: move the pools and the draw out of `src/ai/names.ts`, which now imports them. `newGameSetup` makes the
   same draws in the same order as today (`picker(streamSeed(seed, 0, STREAM.names))`). Write four to six
   `ENTRANT_PITCHES` per style; the Blitzscaler's and Bootstrapper's may reuse `PITCHES`.
2. Step 14, in a career, when the game goes on: after the books are closed and before the climate ticks and the next
   card is drawn, every seat whose company is out, was run by a computer style (`isCpuKind`) and went out at least
   `replacement.afterYears` turns before the coming turn gets `seatCompany(seat, drawEntrant(…), config, turn + 1)`.
   Names in `taken` are those of every company in the state at that moment.
3. `src/engine/types.ts`, the comment on `Controller`: the engine reads it in one place, to tell a rival's seat from
   the player's.
4. Rulings: "A seat is refilled only if its company was run by a computer style; the player's seat never is."
   "Out in year Y means the newcomer plans from year Y + 2." "A newcomer gets the startup numbers of the year it
   enters, whatever style it plays." "Newcomers enter before the coming year's card is drawn, so a card can hit them."

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS, with `src/ai/names.test.ts` and the golden record
  untouched and green.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: a rival that goes out is replaced two years later by a new startup"
```

---

### Task 12: The career's config

**Files:**
- Modify: `src/ai/types.ts`, `src/config.ts`, `src/config.design.ts`, `docs/career-rules.md` ("Starting numbers")
- Test: `src/config.career.test.ts`

**Interfaces:**
- Consumes: the contract; `changedNumbers` (`src/sim/changes.ts`); `yearOf`, `rulesForTurn`.
- Produces:

```ts
// src/ai/types.ts
export interface CareerTargets {
  readonly maxCpuWinShare: number;                          // 0.4
  readonly baselineWinShare: readonly [number, number];     // [0.15, 0.35]
  readonly baselineOutShare: readonly [number, number];     // [0.10, 0.30]: its career ends early, by failing twice
  readonly baselineListedShare: readonly [number, number];  // [0.40, 0.80]
  readonly leaderHoldsBelow: number;                        // 0.60: the leader of `leaderYear` wins in less than this share
}
export interface CareerSimConfig {
  readonly careers: number;                     // 1_000
  readonly firstSeed: number;                   // 1
  readonly leaderYear: number;                  // 2010
  readonly checkpointYears: readonly number[];  // [1995, 2000, 2010, 2020, 2030, 2038]
  readonly overspendYear: number;               // 1993
  readonly loopholeMargin: number;              // 0.03
  readonly targets: CareerTargets;
}
// src/config.ts
export interface CareerGameConfig extends PlayConfig { readonly career: CareerRules; readonly sim: CareerSimConfig }
export const CAREER: CareerGameConfig;
// src/config.design.ts
export const CAREER_DESIGN: CareerGameConfig;   // the same numbers, written out a second time and never tuned
```

**Starting numbers.** These are this plan's proposal for where tuning starts (the spec leaves them to the builder).
Everything is per year. Base values, which every era inherits unless it sets its own:

```
game.maxTurns 49
archetypes.startup    cash 400K · 3 people · 0 users · quality 0 · hype 10 · equity 1 · seats 2 founder / 0 investor
                      workExponent 0.9 · catchUpMultiplier 1 · allocation 3 / 0 / 0
archetypes.incumbent  cash 1.5M · 8 people · 10K users · quality 30 · hype 20 · equity 0.6 · seats 2 / 1
                      workExponent 0.625 · catchUpMultiplier 1.5 · allocation 5 / 2 / 1
hiring     capacityPerWork 3 · fee 20K                       poach   cost 150K, the rest as CONFIG
layoff     severance 40K · hype -10                          quality gainPerWork 9 · decay 6 · launchAt 10
pull       growthCoefficient 0.3 · marketingCoefficient 0.3 · marketingStep 50K
priceTiers budget 8 / 1.05 / -0.05 · standard 12 / 1 / 0 · premium 20 / 0.75 / 0.03      (price / pullFactor / churnDelta)
churn      base 0.30 · perQualityPoint 0.002 · min 0.05      raise   minUsers 1K · cooldownTurns 1 · options 10, 20, 30
board      fireChance 0.3 · runwayTurns 1                    hype    decay 0.4 · launch 15 · raise 10 · growth 5 · growthThreshold 0.25
projection as CONFIG                                         events  firstTurn 2 · chance 0.5 · deck: none here,
                                                                     each era has its own (below)
cpu        as CONFIG.cpu, except layoffRunway 0.5 · shortRunwayTurns 0.5 and, per personality:
           blitzscaler  hireRunway 1 · horizon 3        bootstrapper  raise.runway 1 · hireRunway 2 · horizon 4
           incumbent    raise.runway 1.5 · poachRunway 1.5 · hireRunway 1.5 · horizon 3
baseline   split 0.4 / 0.4 / 0.2 · standard · raisePercent 20 · raiseRunway 3 · hireRunway 3 · marketing 0
sim        careers 1000 · firstSeed 1 · leaderYear 2010 · checkpointYears 1995, 2000, 2010, 2020, 2030, 2038
           overspendYear 1993 · loopholeMargin 0.03 · the five targets above
career     firstYear 1990 · shiftNoticeYears 2 · listing, rescue, replacement, offices, moving as in CAREER_RULES (Task 2),
           offices named Garage, Shared office, Own office, Full floor, Campus
```

Each era's `values` (the base `salary`, `market`, `ipo`, `valuation`, `hiring.candidatesPerTurn`,
`pull.maxMarketing` and team caps are the first era's):

| id | name | firstYear | market.newUsersTurn1 | growthPerTurn | salary | valuation.perUser | hiring.candidatesPerTurn | ipo.users | archetypes.startup.cash | pull.maxMarketing | teamCap blitz / boot / incumbent | also sets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `dial-up` | Dial-up dawn | 1990 | 20K | 0.35 | 50K | 40 | 4 | 60K | 400K | 1M | 8 / 6 / 12 | `pull.marketingCoefficient` 0.2 |
| `gold-rush` | Browser gold rush | 1995 | 100K | 0.40 | 70K | 200 | 5 | 300K | 600K | 5M | 15 / 9 / 20 | `poach.baseChance` 0.6 |
| `bust` | Bust and broadband | 2000 | 380K | 0.05 | 85K | 50 | 9 | 800K | 500K | 5M | 15 / 9 / 20 | `hiring.fee` 10K |
| `phones` | Phones and cloud | 2007 | 700K | 0.10 | 100K | 80 | 6 | 1.5M | 600K | 10M | 25 / 14 / 35 | `quality.gainPerWork` 11 · `pull.growthCoefficient` 0.4 |
| `cheap-money` | Cheap money years | 2014 | 1.3M | 0.03 | 130K | 130 | 6 | 3M | 1M | 30M | 50 / 25 / 70 | `churn.base` 0.35 |
| `winter-ai` | Winter and AI | 2022 | 1.6M | 0.04 | 150K | 100 | 8 | 4M | 1M | 30M | 50 / 25 / 70 | `quality.gainPerWork` 12 · `quality.decay` 8 |
| `agents` | Agent economy | 2027 | 2.0M | 0.06 | 220K | 60 | 4 | 5M | 1.5M | 40M | 30 / 15 / 40 | `quality.gainPerWork` 18 · `churn.perQualityPoint` 0.003 · `pull.marketingCoefficient` 0.15 |
| `ambient` | Ambient age | 2033 | 3.5M | 0.10 | 280K | 80 | 5 | 8M | 2M | 60M | 60 / 30 / 90 | `pull.marketingCoefficient` 0.1 · `hype.launch` 25 |

The last column is what makes an era play differently, as the spec's C2 asks: adverts that buy little in 1990;
hiring as a fight in the gold rush; the cheapest hiring of the career after the bust; builders who ship more once
servers are rented, and Growth work that counts for more in an app shop; users who move between rivals in the
cheap-money years; faster building and faster ageing with AI; small teams that build fast, and users who follow
quality, in the agent economy; trust worth more than reach in the ambient age.

Each era also has its own deck (`values.events.deck`): five to seven cards built from the race's seven cards that do
not touch funding (viral moment, burnout, press feature, security breach, talent glut, market boom, ad prices
spike), named and worded for the era, with the race's effects as their starting numbers. No deck card sets a funding
climate, a quality ceiling or a wave. In a career the dated cards own those, so a crash lasts as long as its card
says and no random card can cut it short.

The 28 dated cards are those of the spec's section 6, each in its year with exactly the effects listed there:

| The spec says | Effect |
|---|---|
| valuations ×M, N years | `{ kind: "fundingClimate", multiplier: M, turns: N }` |
| new users ×M | `{ kind: "newUsers", multiplier: M }` |
| marketing works ×M | `{ kind: "marketingEffect", multiplier: M }` |
| N extra candidates / N fewer candidates | `{ kind: "candidates", extra: N }` / `extra: -N` |
| platform shift | `{ kind: "qualityCeiling", ceiling: 30 }` then `{ kind: "userWave", multiplier: 1.3, turns: 3 }`, listed first |
| one weak product loses F of its users and H hype | `target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 }` (60 for 2035) with `targetUsers` F and `targetHype` −H |

The wave's 1.3 for 3 years is this plan's starting proposal for the spec's "more new users arrive for a few years".

Card texts: one line each, true of the card's year, in the words of the research file with its fact-check
corrections applied. The 2023 card must describe 2023 (the chatbot it refers to was released in November 2022).
Beside each real card, a comment names the real event. No text a player reads names a real company, product or
person.

- [ ] **Step 1: Write the failing tests**

```ts
const REAL_NAMES = ["netscape", "google", "youtube", "facebook", "instagram", "whatsapp", "twitter", "amazon", "microsoft",
  "alphabet", "apple", "iphone", "openai", "chatgpt", "nvidia", "wework", "lehman", "nasdaq", "aol", "cern", "mosaic",
  "hotwired", "at&t", "pets.com", "theglobe", "greenspan", "altman", "meta ", "berners", "nielsen", "nsfnet", "super bowl", "usenet"];

describe.each([["CAREER", CAREER], ["CAREER_DESIGN", CAREER_DESIGN]] as const)("%s", (_name, config) => {
  it("is plain data that survives a JSON round trip", () => { expect(JSON.parse(JSON.stringify(config))).toEqual(config); });
  it("runs from 1990 to 2038 in 49 turns", () => {
    expect([config.career.firstYear, config.game.maxTurns, yearOf(config.game.maxTurns, config.career)]).toEqual([1990, 49, 2038]);
  });
  it("has the design's eight eras, in order", () => {
    expect(config.career.eras.map((era) => [era.id, era.firstYear])).toEqual([["dial-up", 1990], ["gold-rush", 1995],
      ["bust", 2000], ["phones", 2007], ["cheap-money", 2014], ["winter-ai", 2022], ["agents", 2027], ["ambient", 2033]]);
    expect(config.career.eras.filter((era) => era.invented).map((era) => era.id)).toEqual(["agents", "ambient"]);
  });
  it("gives every era its own market, salary, bar and starting cash", () => { /* each is a positive number in era.values */ });
  it("has no cliff between eras: a first year brings 0.8 to 2 times the year before", () => { /* newUsersForTurn on each side of each boundary */ });
  it("deals the design's dated cards in their years, with their kinds of effect", () => {
    expect(Object.fromEntries(config.career.dated.map((card) => [card.year, card.effects.map((effect) => effect.kind)]))).toEqual({
      1990: ["fundingClimate", "newUsers"], 1991: ["newUsers"], 1993: ["newUsers"], 1994: ["marketingEffect"],
      1995: ["qualityCeiling", "userWave", "fundingClimate"], 1998: ["fundingClimate", "newUsers", "candidates"],
      2000: ["fundingClimate", "newUsers", "candidates"], 2004: ["newUsers"], 2006: ["fundingClimate", "newUsers"],
      2007: ["qualityCeiling", "userWave"], 2008: ["fundingClimate", "newUsers", "candidates"],
      2011: ["targetUsers", "targetHype"],
      2012: ["fundingClimate", "candidates"], 2014: ["fundingClimate", "candidates"], 2018: ["marketingEffect"],
      2019: ["fundingClimate", "marketingEffect"], 2020: ["newUsers", "candidates"],
      2022: ["fundingClimate", "newUsers", "candidates"], 2023: ["qualityCeiling", "userWave", "candidates"],
      2025: ["fundingClimate", "candidates"], 2028: ["newUsers"], 2029: ["marketingEffect"],
      2030: ["fundingClimate", "newUsers"], 2031: ["candidates"], 2033: ["qualityCeiling", "userWave"],
      2035: ["targetUsers", "targetHype"], 2036: ["newUsers"], 2037: ["fundingClimate", "newUsers"],
    });
  });
  it("has no dated card in the last year, and none in the first that hits one company", () => { /* 2038 absent; 1990's has no target */ });
  it("caps quality at a platform shift no lower than that year's launch bar", () => { /* every qualityCeiling */ });
  it("gives every era its own deck of at least four cards, none of which touches funding, ceilings or waves", () => {
    /* era.values.events.deck for each era; no effect of kind fundingClimate, qualityCeiling or userWave in any deck */
  });
  it("gives every card, dated or in any era's deck, its own id, a name and a line of text", () => { /* ids unique across all */ });
  it("uses only effects the engine knows, with a target rule exactly where an effect needs one", () => { /* as config.test.ts does */ });
  it("keeps every probability and share between 0 and 1, in every era", () => { /* on rulesForTurn for each era's first turn */ });
  it("has offices of growing size, and starts every company in one that holds it", () => { /* capacities ascending; both archetypes fit */ });
  it("keeps a listing from shrinking the founder's stake", () => {
    expect(config.career.listing.premium * (1 - config.career.listing.percent / 100)).toBeGreaterThanOrEqual(1);
  });
  it("uses a marketing step that divides every era's largest budget", () => { /* on each era's rules */ });
  it("names no real company, product or person in anything a player reads", () => {
    /* every card's name and text, every era's and office's name, every line of PITCHES and ENTRANT_PITCHES, lower-cased:
       none contains any of REAL_NAMES */
  });
});

describe("the career's starting numbers", () => {
  it("are the ones the spec names", () => {
    expect(CAREER_DESIGN.career.listing).toEqual({ percent: 20, premium: 1.25, hype: 20, investorSeats: 1 });
    expect(CAREER_DESIGN.career.rescue).toEqual({ equityKept: 0.5, investorSeats: 2, hype: -10, salaryYears: 1 });
    expect(CAREER_DESIGN.career.replacement).toEqual({ afterYears: 2, styles: ["blitzscaler", "bootstrapper", "incumbent"] });
    expect(CAREER_DESIGN.career.offices.map((office) => office.capacity)).toEqual([4, 9, 22, 40, 150]);
    expect(CAREER_DESIGN.career.moving).toEqual({ salaryYears: 0.5 });
    expect(CAREER_DESIGN.career.shiftNoticeYears).toBe(2);
  });
  it("deal the dated cards with exactly the effects the design lists", () => {
    const climate = (multiplier: number, turns: number) => ({ kind: "fundingClimate", multiplier, turns });
    const users = (multiplier: number) => ({ kind: "newUsers", multiplier });
    const adverts = (multiplier: number) => ({ kind: "marketingEffect", multiplier });
    const candidates = (extra: number) => ({ kind: "candidates", extra });
    const shift = [{ kind: "qualityCeiling", ceiling: 30 }, { kind: "userWave", multiplier: 1.3, turns: 3 }];
    const weak = (fraction: number, hype: number) => [{ kind: "targetUsers", fraction }, { kind: "targetHype", delta: -hype }];
    expect(Object.fromEntries(CAREER_DESIGN.career.dated.map((card) => [card.year, card.effects]))).toEqual({
      1990: [climate(0.7, 2), users(0.8)], 1991: [users(1.25)], 1993: [users(1.5)], 1994: [adverts(1.5)],
      1995: [...shift, climate(1.5, 3)], 1998: [climate(1.6, 2), users(1.25), candidates(-2)],
      2000: [climate(0.5, 3), users(0.7), candidates(4)], 2004: [users(1.5)], 2006: [climate(1.4, 2), users(1.25)],
      2007: shift, 2008: [climate(0.5, 2), users(0.8), candidates(4)], 2011: weak(0.1, 10),
      2012: [climate(1.4, 2), candidates(-2)], 2014: [climate(1.5, 3), candidates(-2)], 2018: [adverts(0.7)],
      2019: [climate(0.7, 1), adverts(1.25)], 2020: [users(1.5), candidates(4)],
      2022: [climate(0.6, 2), users(0.8), candidates(4)], 2023: [...shift, candidates(4)],
      2025: [climate(1.4, 2), candidates(-2)], 2028: [users(0.7)], 2029: [adverts(0.5)],
      2030: [climate(1.6, 2), users(1.25)], 2031: [candidates(5)], 2033: shift, 2035: weak(0.2, 15),
      2036: [users(0.7)], 2037: [climate(1.5, 2), users(1.25)],
    });
    expect(CAREER_DESIGN.career.dated.filter((card) => card.target !== undefined).map((card) => [card.year, card.target])).toEqual([
      [2011, { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 }],
      [2035, { pick: "random", launched: true, qualityBelow: 60, minUsers: 1 }],
    ]);
  });
  it("cover exactly the same numbers as the career's config: none missing on either side", () => {
    /* as "the design's starting numbers" does for the race in src/config.test.ts, whole cards exempt */
  });
});

describe("what tuning may not change in a career", () => {
  it("the five targets the owner approved, and the year the lead is taken", () => {
    expect(CAREER.sim.targets).toEqual({ maxCpuWinShare: 0.4, baselineWinShare: [0.15, 0.35], baselineOutShare: [0.1, 0.3],
      baselineListedShare: [0.4, 0.8], leaderHoldsBelow: 0.6 });
    expect(CAREER.sim.leaderYear).toBe(2010);
  });
  it("the habits that make each rival readable, in every era", () => {
    /* on each era's rules: Blitzscaler: budget, raise.when "eligible", percents [30], and the largest marketing share of
       the three. Bootstrapper: premium, raise.when "runway", and the smallest team cap of the three. Incumbent: poachRunway
       is a number. Baseline bot: 0.4 / 0.4 / 0.2, standard, raisePercent 20, raiseRunway 3, hireRunway 3. */
  });
  it("the rules' own numbers stay within what the rules mean", () => {
    /* a rescue keeps some but not all of the founder's share (0 < equityKept < 1) and gives investors at least one seat;
       a listing sells some but not all of the company and gives investors at least one seat (the owner's decision 5);
       replacement.afterYears is at least 1; shiftNoticeYears is at least 1 */
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/config.career.test.ts`
Expected: FAIL (`CAREER` is not exported).

- [ ] **Step 3: Write the config**

`CAREER_DESIGN` in `src/config.design.ts`, then the same literal as `CAREER` in `src/config.ts`. Each era's `values`
ends with `satisfies Overlay<Omit<PlayConfig, "game" | "career">>`, so a mistyped CPU number does not compile.
`docs/career-rules.md`, "Starting numbers": the three tables above, with one sentence on where each group came from
(the race's tuned numbers read per year; the spec; this plan's proposal for the era table).

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "config: the career's starting numbers, eight eras and 28 dated cards"
```

---

### Task 13: Computer players in a career

**Files:**
- Modify: `src/ai/cpu.ts`, `src/ai/baselineBot.ts`, `src/ai/choosePlans.ts`
- Test: `src/ai/career.test.ts`

**Interfaces:**
- Consumes: `rulesForTurn`, `listingBlocker`, `PlayConfig`.
- Produces: `chooseCpuPlan(view, kind, seed, config: PlayConfig = CONFIG)`, `candidatePlans(view, kind, config:
  PlayConfig = CONFIG)`, `baselinePlan(view, config: PlayConfig = CONFIG)`, `choosePlans(state, seed, config:
  PlayConfig = CONFIG, human?)`. Each resolves `rules = rulesForTurn(config, view.turn)` first and reads every
  number, the personalities included, from `rules`. In a career:
  - every plan they return has `goPublic` set to `listingBlocker(self, turn, config) === null`;
  - "cutting costs to list" (`ipoPush`) holds exactly while `listingBlocker` says `"profit"`;
  - the prize `cpu.ipo.win` goes to a plan projected to end the year at the bar with a profit, for a company that
    has not qualified yet;
  - nothing else changes. In the race nothing changes at all, and no plan has a `goPublic` key.

- [ ] **Step 1: Write the failing tests**

```ts
const KINDS = ["blitzscaler", "bootstrapper", "incumbent"] as const;

it.each(KINDS)("a %s goes public in the first year it qualifies, and not before", (kind) => {
  expect(chooseCpuPlan(viewFor(qualified, 1), kind, 1, CAREER_TEST).goPublic).toBe(true);
  expect(chooseCpuPlan(viewFor(notYetQualified, 1), kind, 1, CAREER_TEST).goPublic).toBe(false);
});
it("the baseline bot does the same", () => {
  expect(baselinePlan(viewFor(qualified, 0), CAREER_TEST).goPublic).toBe(true);
  expect(baselinePlan(viewFor(notYetQualified, 0), CAREER_TEST).goPublic).toBe(false);
});
it("in the race no plan mentions going public", () => {
  expect("goPublic" in chooseCpuPlan(viewFor(newGame(), 1), "blitzscaler", 1, DESIGN)).toBe(false);
  expect("goPublic" in baselinePlan(viewFor(newGame(), 0), DESIGN)).toBe(false);
});
it("a Blitzscaler raises 30% whenever it may, until it is public", () => {
  expect(chooseCpuPlan(viewFor(privateBlitz, 1), "blitzscaler", 1, CAREER_TEST).raisePercent).toBe(30);
  expect(chooseCpuPlan(viewFor(publicBlitz, 1), "blitzscaler", 1, CAREER_TEST).raisePercent).toBe(0);
});
it("cuts costs to list only until it has had a profitable year at the bar", () => {
  // at the bar, last year at a loss: no candidate spends on marketing or hires
  expect(candidatePlans(viewFor(atBarLosing, 1), "blitzscaler", CAREER_TEST).every((plan) => plan.marketing === 0 && plan.hireLimit === 0)).toBe(true);
  // once public, with cash: marketing is back among the candidates
  expect(candidatePlans(viewFor(publicBlitz, 1), "blitzscaler", CAREER_TEST).some((plan) => plan.marketing > 0)).toBe(true);
});
it("plays on its era's numbers (Review Focus 2)", () => {
  // two eras; the second sets cpu: { personalities: { blitzscaler: { teamCap: 30 } } }; a Blitzscaler with 12 people
  expect(candidatePlans(viewFor(inFirstEra, 1), "blitzscaler", config).every((plan) => plan.hireLimit === 0)).toBe(true);
  expect(candidatePlans(viewFor(inSecondEra, 1), "blitzscaler", config).some((plan) => (plan.hireLimit ?? 0) > 0)).toBe(true);
});
it("never plans more marketing than the cash in hand allows", () => {
  /* every candidate of every kind, for a company with cash and one raising: normalizePlanFor gives no "Marketing set" note */
});
it("plans for a newcomer in its first year", () => { /* a seat founded this turn gets a plan from choosePlans */ });
it("chooses a plan for every seat through a whole career", () => { /* 49 turns on CAREER_TEST for seeds 1 to 3, no throw */ });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ai/career.test.ts`
Expected: FAIL (`goPublic` is undefined).

- [ ] **Step 3: Implement.** As under Interfaces.

- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS, the golden record included.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "ai: computer players list when they qualify and play each year on its era's numbers"
```

---

### Task 14: Whole careers hold together

**Files:**
- Test: `src/sim/career.flow.test.ts`
- Modify: whatever these tests show to be wrong

**Interfaces:**
- Consumes: everything above; `replayGame`, `isGame`, `isTurnLog`, `usersInSystem`.
- Produces: nothing new. This task plays whole careers and checks what must hold in every year of every one.

- [ ] **Step 1: Write the tests**

`play(seed, config, controller)` returns every state and every log of one career: `createGame(newGameSetup(seed,
"Flow", controller), config)`, then `choosePlans` and `resolveTurn` to the outcome. With `controller` `"human"` the
player's plan each year is `baselinePlan` of its view, passed through `choosePlans`' last argument.

```ts
const SEEDS = [1, 2, 3, 4, 5, 6];
describe.each(SEEDS)("career %i on the starting numbers", (seed) => {
  const { states, logs, plans, setup } = play(seed, CAREER_DESIGN, "baseline");
  const final = states[states.length - 1];

  it("runs 49 years to an outcome", () => {
    expect(logs).toHaveLength(49);
    expect(final.outcome?.turn).toBe(49);
    expect(["turnLimit", "wipeout"]).toContain(final.outcome?.kind);
  });
  it("neither makes nor loses users in any year", () => {
    logs.forEach((log, i) => expect(usersInSystem(states[i + 1])).toBe(usersInSystem(states[i]) + log.market.newUsers));
  });
  it("is plain JSON all the way through", () => {
    expect(JSON.parse(JSON.stringify(states))).toStrictEqual(states);
    expect(JSON.parse(JSON.stringify(logs))).toStrictEqual(logs);
  });
  it("keeps four seats, and what a career records only moves one way", () => {
    /* in every state: ids are 0 to 3; hype and quality within 0 to 100; equity within 0 to 1; head count at most 150.
       For a company that keeps its seat from one year to the next (same `founded`): office never falls; equity never
       rises; `qualified`, `listed` and `rescue`, once set, stay as they are. No report has `raise` for a company already public. */
  });
  it("deals every dated card in its year", () => {
    for (const card of CAREER_DESIGN.career.dated) expect(logs[turnOf(card.year, CAREER_DESIGN.career) - 1].event?.cardId).toBe(card.id);
  });
  it("replays to the same end across every era (Review Focus 2)", () => {
    expect(replayGame({ setup, seed, plans }, CAREER_DESIGN).state).toEqual(final);
  });
});
it("another seed gives another career", () => { /* seeds 1 and 2 differ in their final state */ });
it("every state and log of a career passes the save check", () => {
  const { states, logs } = play(1, CAREER_DESIGN, "human");
  expect(states.every((state) => isGame(JSON.parse(JSON.stringify(state)), CAREER_DESIGN))).toBe(true);
  expect(logs.every((log) => isTurnLog(JSON.parse(JSON.stringify(log)), 4))).toBe(true);
});
it("the shipped numbers play whole careers too", () => { /* seeds 1 to 3 on CAREER: 49 logs, users conserved */ });
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/sim/career.flow.test.ts`
Expected: every test passes, or a failure names a real fault. For each fault: write the smallest test that shows it
in the rule's own test file, see it fail, fix the engine, see both pass.

- [ ] **Step 3: Check the tests have teeth**

Three hand-made breaks, one at a time, each undone afterwards: in `resolveTurn` drop the users of a company that
goes out instead of carrying them over; let `officeFor` return one size smaller; write `rescue: undefined` into a
career report. Expected: "neither makes nor loses users", "only moves one way" and "is plain JSON" fail in turn.

- [ ] **Step 4: Run the checks and commit**

```bash
git add src scripts docs package.json README.md && git commit -m "sim: whole careers checked year by year for what must always hold"
```

---

### Task 15: The simulator's career mode

**Files:**
- Create: `src/sim/runCareer.ts`, `src/sim/pilots.ts`, `src/sim/careerReport.ts`
- Modify: `src/sim/args.ts`, `scripts/sim.ts`, `package.json` (`"sim:career": "tsx scripts/sim.ts mode=career"`)
- Test: `src/sim/career.test.ts`, `src/sim/args.career.test.ts`

**Interfaces:**
- Consumes: `CAREER`, `CAREER_DESIGN`, `choosePlans`, `baselinePlan`, `newGameSetup`, `founderStake`, `yearOf`.
- Produces:

```ts
// src/sim/runCareer.ts
export type Pilot = (view: CompanyView, config: PlayConfig) => Plan;
/** One company that held a seat, as the logs tell it. */
export interface CareerCompany {
  readonly seat: CompanyId; readonly founded: number; readonly controller: Controller;
  readonly listedYear: number | null; readonly rescuedYear: number | null;
  readonly outYear: number | null; readonly outReason: OutReason | null;
}
export interface CareerSnapshot {
  readonly controller: Controller; readonly inGame: boolean; readonly listed: boolean;
  readonly users: number; readonly cash: number; readonly headcount: number; readonly quality: number; readonly stake: number;
}
export interface SimCareer {
  readonly seed: number;
  readonly winner: Controller | null;
  /** The four that started, by seat, then newcomers in the order they arrived. */
  readonly companies: readonly CareerCompany[];
  /** The company in seat 0. */
  readonly player: CareerCompany;
  /** Whether the company with the largest founder's stake at the end of `sim.leaderYear` won. null if no company was in the game then. */
  readonly leaderHeld: boolean | null;
  /** By year, then by seat. */
  readonly checkpoints: Readonly<Record<number, readonly CareerSnapshot[]>>;
}
export const runCareer: (seed: number, config?: CareerGameConfig, pilot?: Pilot) => SimCareer;      // pilot plans seat 0; default baselinePlan
export const runCareerBatch: (careers: number, firstSeed: number, config?: CareerGameConfig, pilot?: Pilot) => SimCareer[];

// src/sim/pilots.ts
export const neverListPilot: Pilot;                      // the baseline bot, except that it never goes public
export const overspendPilot: (year: number) => Pilot;    // the baseline bot, except that in `year` it budgets all the marketing the rules allow

// src/sim/careerReport.ts
export interface CareerPosition { readonly companies: number; readonly listed: number; readonly users: number; readonly cash: number; readonly headcount: number; readonly quality: number }
export interface CareerSummary {
  readonly careers: number;
  readonly winShare: Readonly<Record<Seat | "nobody", number>>;    // by the style the winner plays
  readonly newcomerWinShare: number;                               // careers won by a company founded after 1990
  readonly baselineOutShare: number; readonly baselineRescuedShare: number; readonly baselineListedShare: number;
  readonly medianOutYear: number | null; readonly medianListingYear: number | null;
  readonly leaderHeldShare: number;                                // among careers where `leaderHeld` is not null
  readonly rivalsOutPerCareer: number;
  readonly positions: Readonly<Record<number, Readonly<Record<Seat, CareerPosition>>>>;   // medians among companies in the game, by year and style
}
export type CareerCheckId = "cpu-cap" | "baseline" | "early-end" | "listed" | "lead";
export interface CareerCheck { readonly id: CareerCheckId; readonly label: string; readonly pass: boolean; readonly detail: string }
export interface LoopholeResult { readonly name: string; readonly winShare: number; readonly baselineWinShare: number; readonly flagged: boolean }
export const summarizeCareers: (careers: readonly SimCareer[]) => CareerSummary;
export const checkCareerTargets: (summary: CareerSummary, targets: CareerTargets, leaderYear: number) => CareerCheck[];
export const checkLoophole: (name: string, pilot: CareerSummary, baseline: CareerSummary, margin: number) => LoopholeResult;
export const formatCareerReport: (summary: CareerSummary, checks: readonly CareerCheck[], loopholes: readonly LoopholeResult[], config: CareerGameConfig) => string;

// src/sim/args.ts: SimArgs gains `readonly mode?: "career"`, present only for mode=career
```

  The leader at the end of `leaderYear`: the company not out with the largest `founderStake(equity, that year's
  reported valuation)`; ties go to the higher valuation, then the lower seat. "Won" means the outcome's winner is the
  same company: same seat, same `founded`. A range target passes on its bounds; the lead target passes only under its
  figure. A pilot is flagged when its win share is above the baseline bot's by more than `loopholeMargin`. Flags are
  reported, not counted as failed targets.

- [ ] **Step 1: Write the failing tests**

`src/sim/career.test.ts`:

```ts
it("plays a whole career with the baseline bot in the player's seat", () => {
  const career = runCareer(1, CAREER_DESIGN);
  expect(career.player).toMatchObject({ seat: 0, founded: 1, controller: "baseline" });
  expect(career.companies.slice(0, 4).map((company) => [company.seat, company.founded])).toEqual([[0, 1], [1, 1], [2, 1], [3, 1]]);
  expect(Object.keys(career.checkpoints).map(Number)).toEqual([...CAREER_DESIGN.sim.checkpointYears]);
  expect(runCareer(1, CAREER_DESIGN)).toEqual(career);
});
it("tells each company's story as the logs tell it", () => {
  /* replay seeds 1 to 5 by hand (as in career.flow.test.ts) and compare: listedYear is the year of the report with
     career.listing; rescuedYear the year of the report with career.rescue; outYear and outReason the year and reason of the
     report with `out`; a newcomer's `founded` is the turn after the log that lists its seat in `entrants` */
});
it("says whether the leader of 2010 won", () => { /* recomputed from the same replays */ });

describe("the summary", () => {
  // ten hand-built careers
  it("counts wins by the style the winner plays, newcomers included", () => { /* winShare and newcomerWinShare */ });
  it("counts how often the baseline bot's career ended early, was rescued, went public", () => { /* three shares, two medians */ });
  it("leaves careers with nobody in the game in 2010 out of the lead figure", () => { /* leaderHeld null is skipped */ });
});

describe("the five targets", () => {
  const check = (id: CareerCheckId, patch: Partial<CareerSummary>) =>
    checkCareerTargets({ ...passing, ...patch }, CAREER_DESIGN.sim.targets, 2010).find((each) => each.id === id)!;
  it("passes a summary inside every target", () => {
    expect(checkCareerTargets(passing, CAREER_DESIGN.sim.targets, 2010).map((each) => [each.id, each.pass])).toEqual(
      [["cpu-cap", true], ["baseline", true], ["early-end", true], ["listed", true], ["lead", true]]);
  });
  it("a range passes on its bounds and fails just outside", () => {
    expect(check("early-end", { baselineOutShare: 0.1 }).pass).toBe(true);
    expect(check("early-end", { baselineOutShare: 0.0999 }).pass).toBe(false);
    expect(check("listed", { baselineListedShare: 0.8 }).pass).toBe(true);
    expect(check("listed", { baselineListedShare: 0.8001 }).pass).toBe(false);
  });
  it("the lead target needs to be under its figure", () => {
    expect(check("lead", { leaderHeldShare: 0.6 }).pass).toBe(false);
    expect(check("lead", { leaderHeldShare: 0.5999 }).pass).toBe(true);
  });
  it("says them in the owner's words", () => {
    expect(checkCareerTargets(passing, CAREER_DESIGN.sim.targets, 2010).map((each) => each.label)).toEqual([
      "No CPU type wins more than 40.0%",
      "Baseline bot wins 15.0% to 35.0%",
      "Baseline bot's career ends early in 10.0% to 30.0%",
      "Baseline bot goes public in 40.0% to 80.0%",
      "The leader of 2010 wins in less than 60.0%",
    ]);
  });
});

describe("the two pilots that look for loopholes", () => {
  it("one is the baseline bot that never goes public", () => {
    expect(baselinePlan(qualifiedView, CAREER_TEST).goPublic).toBe(true);
    expect(neverListPilot(qualifiedView, CAREER_TEST)).toEqual({ ...baselinePlan(qualifiedView, CAREER_TEST), goPublic: false });
  });
  it("the other spends all it may on marketing in its year, and is the baseline bot in every other", () => {
    const plan = overspendPilot(1993)(viewIn1993, CAREER_TEST);
    expect(plan.marketing).toBe(Math.floor(viewIn1993.self.cash / step) * step);
    expect(normalizePlanFor(viewIn1993.self, 4, viewIn1993.rivals, plan, CAREER_TEST).notes).toEqual([]);
    expect(overspendPilot(1993)(viewIn1994, CAREER_TEST)).toEqual(baselinePlan(viewIn1994, CAREER_TEST));
  });
  it("is flagged only when it beats the baseline bot by more than the margin", () => {
    expect(checkLoophole("x", { ...passing, winShare: { ...passing.winShare, baseline: 0.26 } }, { ...passing, winShare: { ...passing.winShare, baseline: 0.23 } }, 0.03).flagged).toBe(false);
    expect(checkLoophole("x", { ...passing, winShare: { ...passing.winShare, baseline: 0.27 } }, { ...passing, winShare: { ...passing.winShare, baseline: 0.23 } }, 0.03).flagged).toBe(true);
  });
});

it("the report speaks in years and shows every target and both pilots", () => {
  expect(text.split("\n")[0]).toBe("Career simulation: 20 careers, 1990 to 2038");
  for (const check of checks) expect(text).toContain(check.label);
  expect(text).toContain("Never goes public");
  expect(text).toContain("Overspends in 1993");
  expect(text).not.toMatch(/\bturn \d/i);
});
```

`src/sim/args.career.test.ts`:

```ts
it("mode=career asks for the career", () => {
  expect(parseSimArgs(["mode=career", "games=50"])).toEqual({ games: 50, seed: null, strict: false, overrides: {}, mode: "career" });
});
it("the race is the default, and says nothing about a mode", () => {
  expect("mode" in parseSimArgs([])).toBe(false);
  expect("mode" in parseSimArgs(["mode=race"])).toBe(false);
});
it("any other mode is an error", () => {
  expect(() => parseSimArgs(["mode=campaign"])).toThrow("mode=campaign is not a mode: use mode=race or mode=career");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/sim/career.test.ts src/sim/args.career.test.ts`
Expected: FAIL (`./runCareer` does not exist).

- [ ] **Step 3: Implement**

The three modules and the `mode` argument. `scripts/sim.ts` with `mode=career`: applies the overrides to `CAREER`,
runs three batches on the same seeds (the baseline bot, `neverListPilot`, `overspendPilot(sim.overspendYear)`),
prints `formatCareerReport`, the seeds and the time taken, the overrides, then
`formatChanges(changedNumbers(CAREER_DESIGN, CAREER))`. `games=` sets the number of careers. `strict=1` exits with 1
when a target fails. Without `mode=career` the script does exactly what it does today. Update `USAGE`. The report's
sections, in order: who wins (by style, and how many winners were newcomers); the baseline bot's career; leads;
rivals; typical position at each checkpoint year; loophole checks; targets.

`docs/career-rules.md` gains a section "How the simulator measures the targets", with these as rulings: "A win is
counted under the style the winning company plays, a newcomer's included." "The baseline bot's career 'ends early'
when its company is out at the end, which takes two failures." "It 'goes public' if it lists in any year." "The
leader of 2010 is the company not out with the largest founder's stake as 2010 closes; it 'wins' if the winner of
2038 is that same company, same seat and same founding year; careers with no company in the game in 2010 are left
out of the figure." "A loophole pilot is flagged when its win share beats the baseline bot's on the same seeds by more
than `loopholeMargin`; a flag is reported, not counted as a failed target."

- [ ] **Step 4: Run the tests, the checks, and the script both ways**

Run: `npm run sim -- games=50` before and after this task, saving the output each time.
Expected: identical apart from the line that gives the time taken.

Run: `npm run sim:career -- games=20`
Expected: exit code 0; the first line is `Career simulation: 20 careers, 1990 to 2038`; five lines start with `PASS`
or `FAIL`.

- [ ] **Step 5: Commit**

```bash
git add src scripts docs package.json README.md && git commit -m "sim: a career mode with the five targets and two loophole pilots"
```

---

### Task 16: Independent tests from the documents alone

**Files:**
- Create: `src/engine/blackbox/career-years-and-cards.test.ts` (C1 to C4),
  `src/engine/blackbox/career-money-and-control.test.ts` (C5 to C7, C11),
  `src/engine/blackbox/career-rivals-offices-endings.test.ts` (C8 to C10)
- Modify: the engine or `docs/career-rules.md`, wherever a disagreement is settled

**Interfaces:**
- Consumes: only what a player of the rules could know. Each file's author reads the spec's sections 5 and 6,
  `docs/career-rules.md`, `src/engine/types.ts`, the export list of `src/engine/index.ts`, `src/config.design.ts`,
  and one of the race's black-box files as a model of style. The author does not open any other file under
  `src/engine`, `src/ai` or `src/sim`, and builds states with `createGame`, `resolveTurn` and helpers of their own.
- Produces: at least 40 tests per file, each named for the behaviour it pins.

- [ ] **Step 1: Three authors, one file each, working apart.** None sees another's file or the unit tests of Tasks 3
  to 11.

- [ ] **Step 2: Run them**

Run: `npx vitest run src/engine/blackbox/career-`
Expected: most pass. Every failure is a disagreement between an author and the engine.

- [ ] **Step 3: Settle each disagreement, in writing**

For each failing test decide which it is, and record it in `docs/career-rules.md` under "What the independent tests
found": the engine is wrong (keep the test as the failing test, fix the engine); the author misread the documents
(fix the test, say what was misread); the documents do not say (add a ruling, then fix whichever side it goes
against). A rule C1 to C11 that turns out to be unclear in a way a ruling cannot settle goes to the owner.

- [ ] **Step 4: Break each rule on purpose**

One at a time, each undone afterwards, and each must make at least one test fail: the premium is not applied the year
after a listing; a listing starts a raise cooldown; a public company may raise; the bar is read from last year's era;
a second failure is rescued again; the board votes in the year after a rescue; a rescue resets cash that was not
below $0; the ceiling multiplies quality instead of capping it; a dated card is subject to the chance roll; the
marketing limit ignores the year's raise; candidates may go below none; a newcomer enters after one year; the
player's seat is refilled; the moving bill is worked out on the head count at the start of the year; hires may pass
150; a career ends when one company is left. For each break no test catches, add the test that does.

- [ ] **Step 5: Run the checks and commit**

```bash
git add src scripts docs package.json README.md && git commit -m "engine: independent tests of the career's rules, and what they found"
```

---

### Task 17: Tune to the five targets

**Files:**
- Modify: `src/config.ts` (`CAREER` only), `docs/career-rules.md` ("Tuning log"), `README.md` ("Tuning the game"),
  and `src/ai/cpu.ts` only under the condition below

**Interfaces:**
- Consumes: `npm run sim:career`.
- Produces: a `CAREER` on which all five targets pass, and the record of how it got there.

- [ ] **Step 1: Measure where the starting numbers stand**

Run: `npm run sim:career`
Record the whole report in the Tuning log under "Where the starting numbers stood".

- [ ] **Step 2: Search**

Change numbers in `CAREER` only. Try a change first with `set=` on 300 careers
(`npm run sim:career -- games=300 set=career.eras.2.values.salary=90000`), and keep it only if it moves a failing
target without breaking a passing one. Work in this order, because each stage decides what the next can see:

1. Careers work at all: a startup can launch and live through the first era, companies reach the later eras, and
   the baseline bot's career ends early in 10% to 30%.
2. Leads, which is the test of C4: with careers working, vary only the shifts' numbers (ceiling, wave), the eras'
   markets and the quality numbers, until the leader of 2010 wins in under 60%. Nothing else is tuned until this
   holds or has gone to the owner (Step 3).
3. Listing: bars and markets such that the baseline bot goes public in 40% to 80%.
4. Who wins: the computer players' weights, caps and thresholds, until no style is over 40% and the baseline bot
   wins 15% to 35%. Then re-check stages 1 to 3.

What may change: any number of `CAREER`, except those the tests of "what tuning may not change in a career" pin. A
computer player's logic may change only when numbers cannot do it, with a failing test first and a ruling. A rule C1
to C11 may not change.

- [ ] **Step 3: Stop and ask the owner if**

- the leader of 2010 still wins in 60% or more of careers at the end of stage 2: bring C4 back to the owner with the
  measurements before tuning anything else, as the spec says; or
- any target cannot be reached without changing a rule; or
- a loophole pilot stays flagged whatever the numbers.

- [ ] **Step 4: Confirm on five batches**

Run `npm run sim:career` with `seed=1`, `seed=100001`, `seed=110001`, `seed=120001` and `seed=130001`.
Expected: all five targets PASS in all five batches and neither pilot is flagged in any. Run `npm run sim`.
Expected: the race's report as it was before this plan.

- [ ] **Step 5: Write it down**

`docs/career-rules.md`, "Tuning log": every number that differs from its starting value (old, new, why), in the
order `npm run sim:career` lists them; the table of the five batches; "what the balance rests on" (which behaviours
of the computer players each target leans on); what was tried and did not work. `README.md`, "Tuning the game": the
career's commands (`npm run sim:career`, `games=`, `seed=`, `set=` with an era path, `strict=1`) and where its
numbers live.

- [ ] **Step 6: Run the checks, commit and push**

```bash
git add src scripts docs package.json README.md && git commit -m "config: the career tuned to its five targets, with the log of every number moved"
```

Then update the pull request's description with the career's report, and report to the owner: the report of
`npm run sim:career`, the numbers that moved and why, and what is still open.

---

## After this plan

The career can be played by the simulator but not by a person. The next plan puts it into the 2D screens (the
spec's step 3): choosing Career or Quick race, years in place of quarters, the timeline strip, the plan's "Go public",
the rescue, the annual report and the end screen.

Left to that plan on purpose, from the spec's sections in scope here:

- Ending the player's session after a second failure (spec sections 4 and 5.2, C7 and C8). The engine plays on, as
  it does in the race; the store ends the session.
- The career's save: its own key and version, and the career's record of milestones by year (section 12). The
  record is collected by the store from each year's log, which carries what it needs: `quality.launchedNow`,
  `career.office`, `career.listing`, `career.rescue`, `out` and the log's `entrants`.
- Every text a player reads about a year, a card or a note in the screens, and the timeline's mark where history
  ends (`EraConfig.invented`).
- Reading the year's numbers in the view model and the screens, which read the config directly today.
