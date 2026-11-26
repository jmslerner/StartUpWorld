# The 3D Office as the Career's Main Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the restored three.js office the career's main screen on a desktop browser: the office beside the plan,
furnished for its decade, people who can be moved between teams by pointing at them, a year that plays out for a few
seconds after "End year", and the complete 2D screens whenever 3D is off, missing or broken, with the race untouched.

**Architecture:** Nothing in the rules, the store or the save changes. A store-fed scene source (`src/ui/officeSource.ts`)
turns the game into an `OfficeScene` through the existing `officeSceneFor` and keeps identical scenes as the same
object. The year's beats, their lengths and the scene each beat shows come from a pure scene-model module
(`src/scene/yearPlayback.ts`) read off the turn log (design 10.4): while a year plays out the source shows the beats'
scenes one after another, and the world only draws them. The career screen loads one lazy component (`CareerOffice`,
which brings three.js with it) inside its own error boundary, lays it beside the planning panel, and falls back to
today's 2D grid through one pure decision (`officeLayoutFor`), fed by a cheap WebGL 2 probe and by an availability
that, once lost, stays lost. The world gains three looks keyed by era, signature props, the year on the wall calendar,
a channel that tells every tap, and four small handle methods; every decision behind them is a pure, node-tested
function.

**Tech Stack:** three 0.187.0 (already pinned), React 19, zustand 5, Tailwind 3, TypeScript 5.9 strict, Vitest 4 in
node, Playwright with this machine's Chromium (`require("playwright")`, WebGL 2 through SwiftShader, confirmed by the
groundwork checks). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-25-career-3d-design.md`, sections 2, 3, 4, 10 (all), 11, 13, 15 (step 4), 17
and 18. What the groundwork built and left: `docs/superpowers/plans/2026-11-25-career-3d-groundwork.md` ("After this
plan") and its ledger; what it measured: `docs/superpowers/specs/3d-groundwork-check.md`.

**Not in this plan (step 5):** the market view and the office/market switch, the flow of users in the playback, the
invented-future furniture set and the five remaining era looks, sound, how-to-play, documents, the phone layout,
cheaper instanced figures for the phone draw budget.

## Decisions this plan makes where the design is open

1. **Three looks, one per furniture set.** `nineties` (1990 to 1999: dial-up, gold-rush), `noughties` (2000 to 2021:
   bust, phones, cheap-money), `twenties` (2022 on: winter-ai, and agents and ambient until step 5 brings the future
   set). Each is a furniture set (the computer on every desk), a palette, a resting light and three signature props.
   This reads "the first three era looks" (section 15) literally; splitting them into eight era looks is step 5. The
   old `classic` look stays for any era id the world does not know (the lab's free text).
2. **The scene model gives the beats and the scene of each; the screen keeps the clock.** Beats: leave 1.5 s, move
   2.5 s, arrive 2.5 s, or a quiet year 1.2 s; at most 6 s. `beatScenes` gives one scene per beat (people leave while
   the year's hires wait at the door; the company moves; the hires walk in), and the source shows them in turn as the
   screen's timer reaches each beat. The screen holds the year summary that long, with a caption per beat and a Skip
   button, then tells the world to finish at once (`settle`). Under reduced motion, with 3D off or not running, there
   is no playback and the summary opens at once, as today.
3. **Next year's hires wait at the door only once the year has played out.** The beats' scenes have the year's own
   hires at the door (leave, move) or at their desks (arrive); next year's expected hires appear when the playback ends.
4. **Moving a person on desktop:** click a person (they are picked up and highlighted; a strip under the office offers
   the two other teams as buttons and "Keep them"), then click anyone of another team or one of those buttons. The
   person picked is the one who walks (a hint held by the world for the next scene of the same year only), and the
   planning panel's steppers stay the button path. The world tells every tap, the same person twice included, and
   the highlight always shows what is carried (nothing, or the person picked). No team-area hit boxes and no drag:
   desktop pointers are precise, and an empty team has no area to aim at.
5. **Layout, in a desktop window only** (`(min-width: 1024px) and (pointer: fine)`): as the mock in section 4, the
   office directly under the timeline (and the news card when one is in force) in the left column, sized to end above
   the bottom bar with nothing scrolled (`officeCellHeight`, at least 360 px), with the status, the resource bar, the
   projection and the rivals under it; the planning panel in the right column. Every 2D panel stays on the page, so
   "one glance or one tap away" (section 3) holds. A narrower window or a touch screen gets today's 2D screens: no
   phone or tablet layout is built here, and the groundwork measured up to 629 draw calls against the 300 of a phone.
6. **Fallback (10.5):** a synchronous WebGL 2 probe, made once per screen before the first paint, sends a device
   without it straight to the 2D layout (no flash, no chunk downloaded). No WebGL 2 after all, a failed load, or a lost
   context gives the 2D layout and stays so (`nextAvailability`: the "starting" a view says as it unmounts is never
   news). A lost context offers "Reload 3D view" in the header; a failed or unsupported one shows the switch as
   unavailable. The player's switch is remembered per browser under `startupworld:office:v1`, apart from the save.
7. **Draw budget:** the 300 draw calls of section 10.6 are a phone budget, and phones get the 2D screens in this plan.
   The browser check asserts the figure cap and a draw-call ceiling per office (`80 + 14 × figures drawn`, and 800 at
   most, from the groundwork's measured 82 to 629), so a regression fails; instanced far figures are the phone work.
8. **A browser check hook in production:** `window.__careerOffice`, installed by the career screen for the page's
   life, as the lab sets `window.__officeLab`. It reads the live world and the last world taken down (so a check can
   see that it left nothing); the only thing it changes is `loseContext()`.
9. **`scripts/career-check.mjs` plays its whole career with WebGL switched off**, so it remains the proof that the 2D
   screens are complete; a new `scripts/office-check.mjs` covers the 3D screen.
10. **"End year" is refused while a year plays out or a report is open,** and a year plays out only if the store's
   turn moved on by one with no failure; otherwise the summary (or the error) shows as today.

## Global Constraints

- **The race is unchanged.** `git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'`
  prints nothing; `scripts/race-text.snapshot.json` is not edited and `raceText` still matches it. Every change to a
  shared screen hangs on `config.career !== undefined` (`words.career`), and a race renders no new node, label or
  title. The race never requests the 3D chunk.
- **The rules, the store and the save do not change.** No edit under `src/engine`, `src/ai`, `src/sim`, nor to
  `src/state/gameStore.ts`, `src/state/careerSave.ts`, `src/state/save.ts`, `src/state/shape.ts`, `src/config.ts`.
  (`src/state/useGame.ts` only exports its existing `browserStorage`.)
- **The fence holds** (`src/world/boundary.test.ts`): three only under `src/world`; `src/world` imports nothing from
  the rules, state, scene, ui, lab or config; `src/scene` takes only types from `src/world/types`; no chain of static
  value imports from `src/main.tsx` reaches `src/world` or three. `src/ui` modules loaded statically take only
  `import type` from `src/world`; the one value import of `src/world` from `src/ui` is inside
  `src/ui/components/CareerOffice.tsx`, which is reached only through `lazy(() => import(...))`.
- **The 2D screens stay complete.** With 3D off, unavailable or failed, the career screen is today's markup.
- **No new dependencies; no jsdom or testing-library.** Logic in pure `.ts` modules tested in node; components only
  lay it out; screens checked by Playwright scripts.
- **Desktop browsers only.** Laid out for 1280×800. Below 1024 px or without a fine pointer the career is today's 2D
  screens (no canvas); at 390 px nothing overflows sideways and nothing throws; no other phone work.
- **Redrawn only when something changes.** The game never calls `setKeepAwake(true)`.
- **Career text says years**, never "turn", "turns", "quarter", "quarterly" or `Q<n>`. Plain language. No real
  company, product or person in any text, sign or prop. No art, layout or names from any other game; every prop is
  built in code (no model, image or font files).
- TypeScript strict as configured (`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUnusedLocals`,
  `noUnusedParameters`); ESLint `--max-warnings=0`; component files export components only.
- Existing world, scene and lab tests (all added after `b0d38b0`) may be edited only where a task says so.
- Commits: at least one per task, message `area: sentence` as in `git log` (areas: `world`, `scene`, `ui`, `scripts`,
  `docs`), ending with the session's attribution trailers. Branch `claude/trusting-ramanujan-gd0yok`.

### The checks

Run after every task, before its commit.

```bash
npx tsc -b && npx eslint . --max-warnings=0 && npm test && npx vite build
git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'
git diff --stat 3aba859 -- src/engine src/ai src/sim src/state/gameStore.ts src/state/careerSave.ts src/state/save.ts src/state/shape.ts src/config.ts scripts/race-text.snapshot.json
```

Expected: no type errors, no lint output, every test passes, the build succeeds, and both `git diff` lines print
nothing.

## Review Focus

Conditions the design implies and no feature test would meet by itself, most likely first. Each is pinned by a test
in the task named.

1. **End pressed again while a year plays out, or Skip pressed as it ends; or End when the year cannot end:** nothing
   plays a second year, nothing replays last year, and the summary opens exactly once. (Task 9: `endRefused` refuses
   End while playing or while a report is open, before `endQuarter` runs; `yearPlaysOut` starts a playback only when a
   new report came in with no failure and the player's company is not out; `startYearPlay` ignores a start while playing; Task 11: a double click.)
2. **The 3D view fails at any moment** (chunk fails to load, no WebGL, context lost mid-playback): the year finishes at
   once, the summary opens, the 2D panels are all there, and the layout does not swing back to 3D by itself. (Task 7:
   `officeLayoutFor`, `nextAvailability` and `canPlayOut` tables; Task 9: `yearPlayAfterLoss`; Tasks 10 and 11:
   `--disable-3d-apis`, a blocked chunk with the office cell mounted at most once, and a context lost during playback.)
3. **A reload, a resume or "Last report" while the report is open:** no playback replays, the summary shows, the save
   is byte-identical to one written without 3D. (Task 5: a new source is never playing; Task 11: reload mid-year and
   compare the save.)
4. **Picking an impossible move, or picking again:** from an empty team, onto the same team, someone waiting at the
   door or away, or a draft that changed under the pick; the same person tapped twice; a pick after Escape. No
   allocation goes below 0, nothing else in the plan changes, and every tap is heard. (Task 3: the tap channel tells
   repeats; Task 6: `carryStep` and `highlightFor`; Task 11 step 4.)
5. **Storage blocked or full** (private window): the 3D switch reads as on, writing it throws nothing, and the career
   save is untouched by it. (Task 7.)

## File Structure

| Path | Responsibility |
|---|---|
| `src/world/types/scene.ts`, `src/world/core/colors.ts`, `src/world/core/Lighting.ts`, `src/world/office/props/workstations.ts`, `src/world/office/props/building.ts`, `src/world/office/shell.ts` | The three looks: which era has which, and every look-keyed table (Task 1) |
| `src/world/office/props/signature.ts`, `src/world/office/props/digits.ts`, `src/world/office/dressing.ts`, `src/world/office/props/stations.ts`, `src/world/office/OfficeStage.ts`, `src/world/office/OfficeSystem.ts` | Signature props per look; the year on the wall calendar (Task 2) |
| `src/world/cast.ts`, `src/world/core/sceneFrames.ts`, `src/world/targets.ts`, `src/world/core/settle.ts`, `src/world/types/handle.ts`, `src/world/core/World.ts`, `src/world/ui/stage.ts`, `src/world/mountWorld.ts`, `src/world/WorldView.tsx` | What the game needs of the world: a person's team, the person who moves, finishing a year at once, every tap out of the view (Task 3) |
| `src/scene/yearPlayback.ts`, `src/scene/officeScene.ts` | Pure: a year's beats, lengths and the scene of each beat; the played-out scene; scene equality (Task 4) |
| `src/ui/officeSource.ts` | The store as a `SceneSource`, memoized by content, showing a year's beats while it plays (Task 5) |
| `src/ui/officeMoves.ts` | Pure: picking a person up and setting them down, and what is highlighted (Task 6) |
| `src/ui/officeView.ts` | Pure: the 3D switch, the WebGL 2 probe, availability that stays lost, which layout, the office's height, its words (Task 7) |
| `src/ui/officeProbe.ts`, `src/ui/components/OfficeSlot.tsx`, `src/ui/components/CareerOffice.tsx`, `src/ui/screens/GameScreen.tsx` | The office on the career screen, its fallback and the check hook (Task 8) |
| `src/ui/yearPlay.ts` (+ `GameScreen.tsx`, `CareerOffice.tsx`) | The year playing out and moving people, wired (Task 9) |
| `scripts/career-check.mjs` | The 2D career, played with WebGL off (Task 10) |
| `scripts/office-check.mjs`, `scripts/career-fixtures.ts`, `docs/superpowers/specs/3d-office-check.md` | The 3D career in a real browser, three era fixtures, and the report (Task 11) |

---

### Task 1: Three era looks over the five offices

**Files:**
- Modify: `src/world/types/scene.ts:14`, `src/world/core/colors.ts:125-166`, `src/world/core/Lighting.ts:118-121`,
  `src/world/office/props/workstations.ts:38-90`, `src/world/office/props/building.ts:64-72,250-252`,
  `src/world/office/shell.ts:62`, `src/world/office/DeskSlots.ts:227` (pass the look to `createDesk`)
- Test: `src/world/core/colors.test.ts` (the two tests of its `describe("looks")` are replaced, as this task changes
  what they pin), `src/world/core/Lighting.test.ts`, `src/world/office/props.test.ts` (new tests only, including a
  desk-of-every-look cache test beside the existing catalog one), `src/world/office/OfficeSystem.test.ts`,
  `src/scene/officeScene.test.ts`

**Interfaces:**
- Consumes: the look seam as it is: `lookFor`, `PHASE_THEMES`, `RESTING_LOOKS`/`restingLook`, `DESK_STYLE_FOR_PHASE`,
  `FLOOR_STYLES`, `WALL_STYLE_FOR_PHASE`, `SHELL_SPECS`, `OfficeSystem`'s rebuild on `stage.look !== look`.
- Produces:
  ```ts
  // src/world/types/scene.ts
  export type LookId = "classic" | "nineties" | "noughties" | "twenties";
  // src/world/core/colors.ts
  export const LOOKS: readonly LookId[];                       // ["classic", "nineties", "noughties", "twenties"]
  export const ERA_LOOKS: Readonly<Record<string, LookId>>;    // frozen
  export const lookFor: (era: string) => LookId;               // own keys of ERA_LOOKS only, else "classic"
  // src/world/office/props/workstations.ts
  export const monitorFor: (style: DeskStyle, look: LookId) => MonitorKind;
  export interface DeskOptions { /* as now, plus */ look?: LookId }   // default "classic"
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// colors.test.ts, replacing the two tests of describe("looks")
it("each era of the career has the look of its decade's furniture", () => {
  expect(["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai", "agents", "ambient"].map(lookFor)).toEqual(
    ["nineties", "nineties", "noughties", "noughties", "noughties", "twenties", "twenties", "twenties"]);
});
it("an era nobody has heard of, or none at all, keeps the classic look", () => {
  expect(["flat", "", "constructor", "__proto__", "classic", "nineties"].map(lookFor)).toEqual(Array(6).fill("classic"));
});
it("every look has five themes, and no two looks dress the same office alike", () => {
  for (const office of PHASES) {
    const keys = LOOKS.map((look) => { const t = themeFor(office, look); return `${t.wood}:${t.panel}:${t.accents.join(",")}`; });
    expect(new Set(keys).size).toBe(LOOKS.length);
  }
});
it("the classic themes are as they were", () => {
  expect(PHASE_THEMES.classic).toEqual([
    { wood: C.plywood, woodDark: C.pallet, frame: C.galvanised, panel: C.cardboard, accents: [C.red, C.yellow, C.blue], glow: EMBER },
    { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.cream, accents: [C.teal, C.yellow, C.coral], glow: NEON },
    { wood: C.oak, woodDark: C.walnut, frame: C.steel, panel: C.greyLight, accents: [C.blue, C.teal, C.orange], glow: NEON },
    { wood: C.birch, woodDark: C.oak, frame: C.white, panel: C.white, accents: [C.purple, C.leaf, C.pink], glow: NEON },
    { wood: C.walnut, woodDark: C.walnutDark, frame: C.brass, panel: C.marble, accents: [C.burgundy, C.navy, C.brass], glow: EMBER },
  ]);
});
// (C, EMBER and NEON are exported by colors.ts already.)

// Lighting.test.ts
it("each look rests in its own light", () => {
  expect(LOOKS.map((look) => restingLook(2, look))).toEqual(["morning", "afternoon", "morning", "sunrise"]);
  expect(new Set(PHASES.map((office) => restingLook(office, "nineties")))).toEqual(new Set(["afternoon"]));
});
// (noughties rests in "morning" like classic; it differs from classic by furniture, floor and palette)

// props.test.ts
it("each look puts its decade's computer on every desk", () => {
  expect(DESK_STYLES.map((style) => monitorFor(style, "classic"))).toEqual(["crt", "laptop", "flat", "wide", "flat"]);
  expect(DESK_STYLES.map((style) => monitorFor(style, "nineties"))).toEqual(Array(5).fill("crt"));
  expect(DESK_STYLES.map((style) => monitorFor(style, "noughties"))).toEqual(["flat", "flat", "flat", "wide", "wide"]);
  expect(DESK_STYLES.map((style) => monitorFor(style, "twenties"))).toEqual(Array(5).fill("laptop"));
});
it("gives every office of every look a desk style, a floor and walls", () => {
  for (const look of LOOKS) for (const office of PHASES) {
    expect(DESK_STYLES).toContain(deskStyleFor(office, look));
    expect(() => createFloor(4, 4, office, look).dispose()).not.toThrow();
  }
});
// The existing catalog cache test builds desks with no look (desk entries are not `styled`), so it cannot see a
// collision between looks. This one can: every style in every look, busy and vacant, with one shared cache and then
// each from empty caches (signature() is the catalog test's, lifted to the file's top level for both tests).
it("builds a desk of every style in every look the same whatever was built before it (no cache-key collisions)", () => {
  const cases = DESK_STYLES.flatMap((style, i) => LOOKS.flatMap((look) => [true, false].map((occupied) => ({ style, look, occupied, variant: i }))));
  const build = (c: (typeof cases)[number]) => createDesk({ style: c.style, look: c.look, occupied: c.occupied, variant: c.variant });
  const shared = cases.map((c) => { const desk = build(c); const s = signature(desk); desk.dispose(); return s; });
  cases.forEach((c, i) => {
    disposeSharedResources();
    const desk = build(c);
    expect(signature(desk), `${c.style} ${c.look} ${c.occupied ? "busy" : "vacant"}`).toBe(shared[i]);
    desk.dispose();
  });
  expect(new Set(LOOKS.map((look) => signature(createDesk({ style: "standard", look })))).size).toBeGreaterThan(1);
});

// OfficeSystem.test.ts (with the file's own kit)
it("a year that crosses into another decade rebuilds the office in place; a year within it does not", () => {
  /* apply scenes era "bust" 2006 → era "phones" 2007 (same office): same stage object, look "noughties" both;
     then era "cheap-money" 2021 → "winter-ai" 2022: a new stage, look "twenties", the old one sinks */
});

// src/scene/officeScene.test.ts
it("every era of the shipped career has a look of its own, by decade", () => {
  for (const era of CAREER.career!.eras) expect(lookFor(era.id)).not.toBe("classic");
  // Turn 1 is 1990 (yearOf = firstYear + turn - 1). CAREER is a CareerGameConfig, which newCareer does not take:
  // build the game as src/ui/careerTimeline.test.ts does.
  const lookIn = (year: number) =>
    lookFor(sceneOf(atTurn(createGame(newGameSetup(1, "Acme"), CAREER), year - 1990 + 1), 0, { config: CAREER }).era);
  expect([1990, 1999, 2000, 2021, 2022, 2038].map(lookIn)).toEqual(["nineties", "nineties", "noughties", "noughties", "twenties", "twenties"]);
});
```

(`atTurn(state, turn)` is in `src/engine/careerKit.ts`, `createGame` in `src/engine/setup.ts`, `newGameSetup` in
`src/ai/names.ts`; `CAREER` is `src/config.ts`'s.)

- [ ] **Step 2: Run them.** `npx vitest run src/world/core src/world/office src/scene` — Expected: FAIL (`lookFor`
  returns "classic"; `monitorFor` is not exported; `LOOKS` has one entry).
- [ ] **Step 3: Implement the looks.** `ERA_LOOKS` exactly as the first test lists; `lookFor` reads it with
  `Object.hasOwn`. Every look-keyed table gets the three new entries: `PHASE_THEMES` (nineties: beige casework
  `C.bone`/`C.cream` panels and grey metal frames; noughties: light woods with steel `C.steel` frames; twenties:
  `C.birch` and white with green and teal accents; the rest is the builder's, within the distinctness test),
  `RESTING_LOOKS` as the test pins, `DESK_STYLE_FOR_PHASE` and `WALL_STYLE_FOR_PHASE` equal to classic's,
  `SHELL_SPECS` equal to classic's (the buildings are the plans; the looks dress them), `FLOOR_STYLES` with a
  grey-blue carpet for nineties, warm laminate for noughties and pale polished concrete for twenties.
  `monitorFor` replaces the switch in `deskMonitors`, which now takes `(style, look)`; the monitor kind joins both
  cache keys of a desk, the `bakeModel` key (`desk:${style}:${monitor}:…`) and the `screenQuads` key
  (`desk:${style}:${monitor}`). `DeskSlots` passes the stage's look to `createDesk`.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; the boundary test still passes.
- [ ] **Step 5: Commit**

```bash
git add src/world src/scene
git commit -m "world: the office is furnished for its decade: three looks, the nineties, the noughties and the twenties"
```

---

### Task 2: Signature props, and the year on the wall calendar

**Files:**
- Create: `src/world/office/props/signature.ts`, `src/world/office/props/digits.ts`
- Modify: `src/world/office/dressing.ts:91-117,335-338`, `src/world/office/props/catalog.ts` (the new props join the
  catalog so the budget, cache and inside-out tests cover them), `src/world/office/props/stations.ts:780-890,1198-1222`,
  `src/world/office/OfficeStage.ts` (`stations` typed `Readonly<StationHandles>` instead of
  `Readonly<Record<StationKind, StationHandle>>`, so `stations.calendar.setYear` type-checks; `buildStations` builds
  it as `StationHandles`), `src/world/office/OfficeSystem.ts:77-89`
- Test: `src/world/office/props.test.ts`, `src/world/office/OfficeSystem.test.ts`, Create:
  `src/world/office/props/digits.test.ts`, `src/world/office/dressing.test.ts`

**Interfaces:**
- Consumes: `LookId`, `LOOKS` (Task 1); `getLayoutDecor`, `decorSize`, `DecorSpot`, `DecorKind`, `FootprintSize`
  (`src/world/office/footprints.ts`); `PropHandle`.
- Produces:
  ```ts
  // signature.ts
  export type SignatureKind = "fax-machine" | "software-shelf" | "tube-tv" | "flat-tv" | "beanbag" | "foosball" | "plant-wall" | "ring-light" | "scooter";
  export const SIGNATURE_PROPS: Readonly<Record<Exclude<LookId, "classic">, readonly SignatureKind[]>>;
  //   nineties: fax-machine, software-shelf, tube-tv · noughties: flat-tv, beanbag, foosball · twenties: plant-wall, ring-light, scooter
  /** The least footprint each prop needs (width across its facing, depth). */
  export const SIGNATURE_SIZES: Readonly<Record<SignatureKind, FootprintSize>>;
  //   fax-machine 0.40×0.40 · software-shelf 0.90×0.30 · tube-tv 0.60×0.50 · flat-tv 0.70×0.30 · beanbag 0.45×0.45
  //   foosball 0.90×0.55 · plant-wall 0.90×0.30 · ring-light 0.40×0.40 · scooter 0.70×0.30
  export const createSignatureProp: (kind: SignatureKind, size: FootprintSize, variant: number) => PropHandle;
  // dressing.ts
  /** Décor a signature prop may stand in for. Never reception, meeting pods, partitions, couches, tables or games. */
  export const REPLACEABLE_DECOR: readonly DecorKind[];   // plant, plant-large, boxes, filing-cabinet, water-cooler, vending, bookshelf
  export const signaturePlan: (decor: readonly DecorSpot[], look: LookId) => ReadonlyMap<number, SignatureKind>;
  export const signatureAt: (decor: readonly DecorSpot[], index: number, look: LookId) => SignatureKind | null;
  // digits.ts
  export const digitSegments: (digit: number) => readonly boolean[];   // 7 entries, segments a to g; [] for anything not 0..9
  // stations.ts
  export interface CalendarHandle extends StationHandle { setYear(year: number): void }
  //   StationHandles["calendar"] becomes CalendarHandle
  // OfficeStage
  setYear(year: number): void;
  ```

The rule for where signature props stand (`signaturePlan`): in a look other than classic, each of the look's three
props in turn takes the smallest free spot (by `decorSize` area; ties: the earlier in `getLayoutDecor` order) whose
kind is in `REPLACEABLE_DECOR` and whose `decorSize` is at least the prop's `SIGNATURE_SIZES` entry in width and depth.
A prop with no such spot left is not shown in that office; each prop stands at most once per office. The prop is
built to fill `decorSize(spot)`. Classic dresses as today. (Checked against `getLayoutDecor` at 3aba859: every office
of every look gets at least two, and the garage, whose spots are a filing cabinet and boxes, exactly two.)

- [ ] **Step 1: Write the failing tests**

```ts
// digits.test.ts
it("draws the ten digits on seven segments", () => {
  const lit = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => digitSegments(d).filter(Boolean).length);
  expect(lit).toEqual([6, 2, 5, 5, 4, 5, 6, 3, 7, 6]);
  expect(digitSegments(1)).toEqual([false, true, true, false, false, false, false]);
});
it("draws nothing for what is not a digit", () => {
  for (const d of [-1, 10, 1.5, Number.NaN]) expect(digitSegments(d)).toEqual([]);
});

// dressing.test.ts
const kinds = (office: OfficeIndex) => getLayoutDecor(getOfficeLayout(office));
const DECADES = ["nineties", "noughties", "twenties"] as const;
it("the garage's filing cabinet and boxes hold two signature props in each decade", () => {
  expect([...signaturePlan(kinds(0), "nineties")]).toEqual([[0, "fax-machine"], [1, "software-shelf"]]);
  expect([...signaturePlan(kinds(0), "noughties")]).toEqual([[1, "flat-tv"], [0, "beanbag"]]);
  expect([...signaturePlan(kinds(0), "twenties")]).toEqual([[1, "plant-wall"], [0, "ring-light"]]);
});
it("each prop takes the smallest spot it fits: the own office in the nineties", () => {
  // own office: four partitions, vending 4, water-cooler 5, bookshelf 6, plant-large 7, plant 8, plant-large 9, plant 10
  expect([...signaturePlan(kinds(2), "nineties")]).toEqual([[5, "fax-machine"], [6, "software-shelf"], [7, "tube-tv"]]);
});
it("never stands in for a reception desk, a meeting pod, a partition, a couch, a table or a game", () => {
  for (const office of PHASES) for (const look of DECADES) for (const i of signaturePlan(kinds(office), look).keys())
    expect(REPLACEABLE_DECOR).toContain(kinds(office)[i].kind);
});
it("every office of every decade shows at least two of its signature props, each once, and classic none", () => {
  for (const office of PHASES) for (const look of DECADES) {
    const shown = [...signaturePlan(kinds(office), look).values()];
    expect(shown.length).toBeGreaterThanOrEqual(2);
    expect(new Set(shown).size).toBe(shown.length);
    expect(shown.every((k) => SIGNATURE_PROPS[look].includes(k))).toBe(true);
    for (const [i, k] of signaturePlan(kinds(office), look)) expect(signatureAt(kinds(office), i, look)).toBe(k);
  }
  for (const office of PHASES) expect(signaturePlan(kinds(office), "classic").size).toBe(0);
});
it("a signature prop stands only where it has room, and fits the spot it stands on", () => {
  for (const office of PHASES) for (const look of DECADES) for (const [i, kind] of signaturePlan(kinds(office), look)) {
    const spot = kinds(office)[i];
    expect(decorSize(spot).width).toBeGreaterThanOrEqual(SIGNATURE_SIZES[kind].width);
    expect(decorSize(spot).depth).toBeGreaterThanOrEqual(SIGNATURE_SIZES[kind].depth);
    const prop = createSignatureProp(kind, decorSize(spot), spot.variant);
    const box = new THREE.Box3().setFromObject(prop.group);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(decorSize(spot).width + 1e-6);
    expect(box.max.z - box.min.z).toBeLessThanOrEqual(decorSize(spot).depth + 1e-6);
    prop.dispose();
  }
});

// props.test.ts
const countVisibleSegmentMeshes = (root: THREE.Object3D): number => {
  let n = 0;
  root.traverse((o) => { if (o.name === "calendar-segment" && o.visible) n += 1; });
  return n;
};
const countGeometries = (root: THREE.Object3D): number => {
  const seen = new Set<THREE.BufferGeometry>();
  root.traverse((o) => { if (o instanceof THREE.Mesh) seen.add(o.geometry); });
  return seen.size;
};
it("the wall calendar shows the year on its segments, and changes it without new geometry", () => {
  const calendar = createStation("calendar", 2, "classic");
  const lit = () => countVisibleSegmentMeshes(calendar.group);
  calendar.setYear(1990); expect(lit()).toBe(2 + 6 + 6 + 6);
  const geometries = countGeometries(calendar.group);
  calendar.setYear(2038); expect(lit()).toBe(5 + 6 + 5 + 7);
  expect(countGeometries(calendar.group)).toBe(geometries);
  calendar.setYear(123456); expect(lit()).toBe(0);
  calendar.dispose();
});

// OfficeSystem.test.ts
it("the calendar shows the scene's year, and the next one after the year has advanced", () => {
  /* apply year 1990, read stage.stations.calendar lit segments = 20; apply year 1991 (same office): 2+6+6+2 = 16 */
});
```

The existing "no station, door or wall writes a word" test must still pass: digits are bars, not text.

- [ ] **Step 2: Run them.** `npx vitest run src/world/office` — Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `digitSegments` (segment order a, b, c, d, e, f, g as on a seven-segment display);
  `createSignatureProp` (each prop a handful of boxes and cylinders with the shared kit, no text, nothing that
  imitates a real product); `signaturePlan`/`signatureAt` by the rule above, used in `dressOffice` in place of
  `createDecorProp` for those spots; `createWallCalendar` builds 28 segment bars once (four digits, each a mesh named
  "calendar-segment") and `setYear` only toggles their `visible`; `OfficeStage.setYear` passes it on; `OfficeSystem.applyFrame` calls
  `stage.setYear(next.scene.year)` after the sync.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS, including the catalog's budget and cache tests over
  the nine new props.
- [ ] **Step 5: Commit**

```bash
git add src/world
git commit -m "world: each decade brings its own props, and the wall calendar shows the year"
```

---

### Task 3: What the game needs of the world

**Files:**
- Create: `src/world/core/settle.ts`, `src/world/core/settle.test.ts`, `src/world/targets.test.ts`
- Modify: `src/world/cast.ts` (a ruling added to its header), `src/world/core/sceneFrames.ts:56`,
  `src/world/targets.ts`, `src/world/types/handle.ts`, `src/world/core/World.ts:313-332` and the matching private
  methods, `src/world/ui/stage.ts` (a tap channel), `src/world/mountWorld.ts`, `src/world/WorldView.tsx`, the fake
  handle in `src/world/mountWorld.test.ts:20`
- Test: `src/world/cast.test.ts`, `src/world/core/sceneFrames.test.ts`, `src/world/ui/stage.test.ts`,
  `src/world/mountWorld.test.ts` (new tests only, apart from the fake handle's four new members)

**Interfaces:**
- Consumes: `nextCast`, `SceneFrames.stage`, `SeatingApi`, `InteractableTarget`, `WorldStage`, `MAX_FRAME_SECONDS`
  (`src/world/core/FrameLoop.ts`, 0.1).
- Produces:
  ```ts
  // cast.ts
  export interface CastHint { readonly releaseFirst?: string }
  export const nextCast: (prev: Cast | null, scene: OfficeScene, hint?: CastHint) => Cast;
  // sceneFrames.ts, added to SceneFrames
  /** Hold a hint for the next scene staged, if it is of the same run and year as the last one; any next scene drops it. */
  releaseFirst(personId: string | null): void;
  // targets.ts
  export const teamOfTarget: (target: InteractableTarget, cast: Cast | null, seating: Pick<SeatingApi, "teamOfDesk">) => Team | null;
  // settle.ts
  export const SETTLE_LIMIT_SECONDS = 30;
  export const settle: (busy: () => boolean, update: (dt: number) => void, step: number, limit?: number) => number;  // world seconds run
  // handle.ts, added to WorldHandle
  teamOf(target: InteractableTarget): Team | null;
  personAt(desk: number): string | null;
  /** The next scene, if it is of this year and takes someone from this person's team, moves this person. Used once. */
  releaseFirst(personId: string | null): void;
  /** Finish at once whatever is moving (walks, an office rising, the lights), then draw it. */
  settle(): void;
  // stage.ts
  export interface TapChannel { tell(target: InteractableTarget | null): void; subscribe(listener: (target: InteractableTarget | null) => void): () => void }
  //   WorldStage gains `taps: TapChannel`; reset() keeps its listeners
  // mountWorld.ts: the world's onSelect also calls stage.taps.tell(hit?.target ?? null), on every tap, repeats included
  // WorldView.tsx, added to WorldViewProps
  /** Told of every tap, the same target twice included, with the stage's select (which sets the highlight and the store together). */
  onTap?: (target: InteractableTarget | null, select: (target: InteractableTarget | null) => void) => void;
  ```

Why a tap channel and not the store's `selected`: the world keeps a tapped person selected, so tapping them again
changes nothing in the store, and `handle.setSelected(null)` clears the world's highlight but not the store. The
channel tells every tap; `select` is `stage.select`, the one path that sets both.

The ruling for the cast's header: "7. A hint may name one person to release first. When that person's group must give
people up, they are released before the most recent joiner. A hint naming nobody in the cast, or someone whose group
does not shrink, changes nothing."

- [ ] **Step 1: Write the failing tests**

```ts
// cast.test.ts (its own helpers)
it("a hint moves the person picked, not the most recent joiner", () => {
  const before = play(scene([3, 0, 0]));
  expect(who(nextCast(before, scene([2, 1, 0]), { releaseFirst: "p0" }))).toEqual(["p0:working:growth", "p1:working:product", "p2:working:product"]);
});
it("a hint for someone whose team keeps its size, or for nobody here, changes nothing", () => {
  const before = play(scene([2, 1, 0]));
  for (const hint of [{ releaseFirst: "p2" }, { releaseFirst: "p9" }, {}]) {
    expect(who(nextCast(before, scene([1, 2, 0]), hint))).toEqual(who(nextCast(before, scene([1, 2, 0]))));
  }
});

// sceneFrames.test.ts (scenes built as the file builds them)
it("a hint goes to the next scene of the same year only, once", () => {
  /* stage A (1990, [3,0,0]); releaseFirst("p0"); stage B (1990, [2,1,0]): p0 is the one in growth;
     stage C (1990, [1,2,0]) with no new hint: the ordinary ruling (the most recent product joiner moves) */
});
it("a hint followed by no scene of its year is dropped: next year's changes follow the ordinary ruling", () => {
  /* stage A (1990, [3,0,0]); releaseFirst("p0"); stage B (1991, [2,1,0]): the same cast as staging B with no hint */
});

// targets.test.ts (copies cast.test.ts's `scene` helper: it is private to that file)
const scene = (teams: [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene => ({
  runId: "r", seed: 7, year: 1990, office: 0, capacity: 4, era: "dial-up",
  teams: { product: teams[0], growth: teams[1], recruiting: teams[2] }, away: 0, leaving: 0, arriving: 0, ending: null,
  ...patch,
});
it("a person working has their team; someone waiting, leaving or away has none", () => {
  const cast = nextCast(null, scene([1, 1, 0], { away: 1, leaving: 1, arriving: 1 }));
  const seating = { teamOfDesk: () => null };
  expect(["p0", "p1", "p2", "p3", "p4", "p9"].map((personId) => teamOfTarget({ kind: "person", personId }, cast, seating)))
    .toEqual(["product", "growth", null, null, null, null]);
});
it("a desk has the team whose area it is in; a team is itself; anything else has none", () => {
  const seating = { teamOfDesk: (i: number) => (i === 0 ? "product" as const : null) };
  expect(teamOfTarget({ kind: "desk", desk: 0 }, null, seating)).toBe("product");
  expect(teamOfTarget({ kind: "desk", desk: 5 }, null, seating)).toBeNull();
  expect(teamOfTarget({ kind: "team", team: "growth" }, null, seating)).toBe("growth");
  expect(teamOfTarget({ kind: "door" }, null, seating)).toBeNull();
});

// settle.test.ts
it("runs nothing when nothing moves", () => { const update = vi.fn(); expect(settle(() => false, update, 0.1)).toBe(0); expect(update).not.toHaveBeenCalled(); });
it("steps until nothing moves, a step at a time", () => {
  let left = 5; const update = vi.fn(() => { left -= 1; });
  expect(settle(() => left > 0, update, 0.1)).toBeCloseTo(0.5); expect(update).toHaveBeenCalledTimes(5);
  expect(update.mock.calls.every(([dt]) => dt === 0.1)).toBe(true);
});
it("stops at the limit whatever still moves", () => { expect(settle(() => true, () => undefined, 0.1, 2)).toBeCloseTo(2); });

// stage.test.ts
it("tells every tap, the same one twice included, until a listener stops; a reset keeps listeners", () => {
  const stage = createStage(); const seen: unknown[] = []; const stop = stage.taps.subscribe((t) => seen.push(t));
  stage.taps.tell(DESK); stage.taps.tell(DESK); stage.reset(); stage.taps.tell(null);
  stop(); stage.taps.tell(DOOR);
  expect(seen).toEqual([DESK, DESK, null]);
});

// mountWorld.test.ts
it("each tap the world reports is told on the stage, the same person twice included", () => {
  /* mount with the fake world; take the callbacks createWorld was given; subscribe to stage.taps;
     callbacks.onSelect(hit of person p1) twice, then onSelect(null): heard [p1, p1, null], and the store's
     `selected` is p1 then null as before */
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/world` — Expected: FAIL (no hint, no `teamOfTarget`, no `settle`,
  no tap channel).
- [ ] **Step 3: Implement.** The hint in `nextCast`'s release step. `SceneFrames.releaseFirst` stores the id with the
  run id and year of the last staged scene; `stage` passes `{ releaseFirst }` to `nextCast` only when the new scene
  has that run id and year, and drops the hint whatever it staged. `World`: `teamOf` =
  `teamOfTarget(target, frames.last?.cast ?? null, frames.seating)`; `personAt` = `frames.seating.deskOccupant(desk)`;
  `releaseFirst` = `frames.releaseFirst`; `settle()` runs
  `settle(() => runner.busy(), (dt) => runner.update(dt, elapsed += dt), MAX_FRAME_SECONDS)`, then `loop.wake()`.
  All four do nothing (or return null) once disposed. `createStage` makes the tap channel; mountWorld's `onSelect`
  tells it after it updates the store. `WorldView` passes `onTap` on; `WorldStageView` subscribes `stage.taps` and calls the
  `onTap` prop through a ref (as it does `onState`), handing it `stage.select`. The fake handle in `mountWorld.test.ts` gains the four
  members.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/world
git commit -m "world: the game can ask a person's team, move the person picked, finish a year at once and hear every tap"
```

---

### Task 4: The year playing out, as beats with lengths

**Files:**
- Create: `src/scene/yearPlayback.ts`, `src/scene/yearPlayback.test.ts`
- Modify: `src/scene/officeScene.ts` (add `sameOfficeScene`)
- Test: `src/scene/officeScene.test.ts`

**Interfaces:**
- Consumes: `CompanyReport` (`src/engine/types.ts:220`, with `headcount.{laidOff, poachedOut, lostToEvent, hired,
  poachedIn}` and `career?.office: { from; to; bill } | null`); `OfficeScene` (type from `src/world/types/scene`).
- Produces:
  ```ts
  export type BeatKind = "leave" | "move" | "arrive" | "year";
  export interface PlaybackBeat { readonly kind: BeatKind; readonly seconds: number; readonly count: number; readonly office: number | null }
  export interface YearPlayback { readonly beats: readonly PlaybackBeat[]; readonly seconds: number }
  export const BEAT_SECONDS: Readonly<Record<BeatKind, number>>;   // { leave: 1.5, move: 2.5, arrive: 2.5, year: 1.2 }
  export const MAX_PLAYBACK_SECONDS = 6;
  export const NO_PLAYBACK: YearPlayback;                          // { beats: [], seconds: 0 }
  export const yearPlayback: (report: CompanyReport | null, reducedMotion: boolean) => YearPlayback;
  export const playedOut: (scene: OfficeScene) => OfficeScene;     // the same scene with arriving: 0
  /** One scene per beat of `playback`, from the scene shown before the year ended to the new year's. */
  export const beatScenes: (before: OfficeScene, after: OfficeScene, playback: YearPlayback) => readonly OfficeScene[];
  // officeScene.ts
  export const sameOfficeScene: (a: OfficeScene, b: OfficeScene) => boolean;
  ```

Rules: `leave.count = laidOff + poachedOut + lostToEvent`, `arrive.count = hired + poachedIn`; a move when
`career.office` is set and `to > from` (`office` = `to`, `count` 0). Beats in the order leave, move, arrive, each only
with a count above 0 (move: when it happened). No beat: one `year` beat. `seconds` = the sum, at most
`MAX_PLAYBACK_SECONDS`. Reduced motion or no report: `NO_PLAYBACK`.

`beatScenes`, with `hires` = the `arrive` beat's count (0 without one) and `waiting` = `after` with `away: 0`,
`leaving: 0`, `arriving: hires` and its teams less `hires` (taken one at a time from the largest team; ties in the
order product, growth, recruiting; never below 0):
- `leave`: `waiting` in the old office (`office` and `capacity` of `before` when the playback has a move, else of
  `after`): the people who left walk out while the year's hires wait at the door;
- `move`: `waiting` in the new office (`after`'s `office` and `capacity`);
- `arrive` and `year`: `playedOut(after)`: the hires walk to their desks; next year's expected hires are not at the door
  yet.
`NO_PLAYBACK` gives no scene. Every beat scene keeps `after`'s run id, seed, year and era.

- [ ] **Step 1: Write the failing tests**

```ts
// yearPlayback.test.ts: its own helper, as officeScene.test.ts's `sceneOf` is private to that file
const sceneOf = (game: GameState, companyId: CompanyId, extra: Partial<OfficeSceneInput> = {}) =>
  officeSceneFor({ game, companyId, config: CAREER_TEST, seed: 7, ...extra });
const reportOf = (patch: { headcount?: Partial<CompanyReport["headcount"]>; office?: { from: number; to: number; bill: number } | null }): CompanyReport => {
  const game = newCareer();
  const base = resolveTurn(game, game.companies.map(() => null), 11, CAREER_TEST).log.companies[0]!;
  return { ...base, headcount: { ...base.headcount, laidOff: 0, poachedOut: 0, lostToEvent: 0, hired: 0, poachedIn: 0, ...patch.headcount },
    career: { ...base.career!, office: patch.office ?? null } };
};
it("a quiet year is one short beat", () => {
  expect(yearPlayback(reportOf({}), false)).toEqual({ beats: [{ kind: "year", seconds: 1.2, count: 0, office: null }], seconds: 1.2 });
});
it("people leave, then hires walk in", () => {
  expect(yearPlayback(reportOf({ headcount: { laidOff: 1, poachedOut: 1, hired: 2, poachedIn: 1 } }), false)).toEqual({
    beats: [{ kind: "leave", seconds: 1.5, count: 2, office: null }, { kind: "arrive", seconds: 2.5, count: 3, office: null }], seconds: 4 });
});
it("a move comes between, and the whole is held to six seconds", () => {
  const play = yearPlayback(reportOf({ headcount: { lostToEvent: 1, hired: 4 }, office: { from: 0, to: 1, bill: 1 } }), false);
  expect(play.beats.map((b) => [b.kind, b.count, b.office])).toEqual([["leave", 1, null], ["move", 0, 1], ["arrive", 4, null]]);
  expect(play.seconds).toBe(6);
});
it("nothing plays under reduced motion, or for a company with no report", () => {
  expect(yearPlayback(reportOf({ headcount: { hired: 3 } }), true)).toEqual(NO_PLAYBACK);
  expect(yearPlayback(null, false)).toEqual(NO_PLAYBACK);
});
it("the played-out scene keeps everything but the hires expected next", () => {
  const scene = sceneOf(newCareer(), 0, { expectedHires: 2 });
  expect(playedOut(scene)).toEqual({ ...scene, arriving: 0 });
  expect(scene.arriving).toBe(2);
});
const at = (teams: [number, number, number], patch: Partial<OfficeScene> = {}): OfficeScene =>
  ({ ...sceneOf(newCareer(), 0), teams: { product: teams[0], growth: teams[1], recruiting: teams[2] }, ...patch });
it("people leave while the year's hires wait at the door, the company moves, then the hires walk in (design 10.4)", () => {
  const before = at([3, 0, 0], { year: 1994, office: 0, capacity: 4 });
  const after = at([3, 2, 1], { year: 1995, office: 1, capacity: 9, arriving: 2, era: "gold-rush" });
  const play = yearPlayback(reportOf({ headcount: { laidOff: 1, hired: 3 }, office: { from: 0, to: 1, bill: 1 } }), false);
  const [leave, move, arrive] = beatScenes(before, after, play);
  expect([leave.office, leave.capacity, leave.teams, leave.arriving, leave.year, leave.era]).toEqual([0, 4, { product: 1, growth: 1, recruiting: 1 }, 3, 1995, "gold-rush"]);
  expect(move).toEqual({ ...leave, office: 1, capacity: 9 });
  expect(arrive).toEqual({ ...after, arriving: 0 });
  expect(beatScenes(before, after, play)).toHaveLength(play.beats.length);
});
it("a quiet year shows the new year played out; no playback shows nothing", () => {
  const before = at([2, 1, 0]); const after = at([2, 1, 0], { year: 1991, arriving: 1 });
  expect(beatScenes(before, after, yearPlayback(reportOf({}), false))).toEqual([{ ...after, arriving: 0 }]);
  expect(beatScenes(before, after, NO_PLAYBACK)).toEqual([]);
});
it("without a move, people leave in the office they are in, and hires never take a team below none", () => {
  const before = at([1, 0, 0]); const after = at([1, 0, 1], { year: 1991 });
  const [leave] = beatScenes(before, after, yearPlayback(reportOf({ headcount: { poachedOut: 1, hired: 3 } }), false));
  expect([leave.office, leave.teams, leave.arriving]).toEqual([after.office, { product: 0, growth: 0, recruiting: 0 }, 3]);
});

// officeScene.test.ts
it("two scenes are the same when every field is", () => {
  const a = sceneOf(newCareer(), 0);
  expect(sameOfficeScene(a, { ...a, teams: { ...a.teams } })).toBe(true);
  for (const patch of [{ year: a.year + 1 }, { arriving: 1 }, { teams: { ...a.teams, growth: a.teams.growth + 1 } }, { ending: "lost" as const }])
    expect(sameOfficeScene(a, { ...a, ...patch })).toBe(false);
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/scene` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above in `src/scene/yearPlayback.ts` and `sameOfficeScene` in
  `src/scene/officeScene.ts`. Engine imports are types only; world imports stay `import type` from
  `src/world/types/scene`.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; the boundary test's rule 3 passes.
- [ ] **Step 5: Commit**

```bash
git add src/scene
git commit -m "scene: a year plays out as beats, people leaving, a move and hires arriving, each with its length and its scene"
```

---

### Task 5: The office scene from the store

**Files:**
- Create: `src/ui/officeSource.ts`, `src/ui/officeSource.test.ts`

**Interfaces:**
- Consumes: `createGameStore`, `GameStore` (`src/state/gameStore.ts`); `PLAYER_ID` (`src/state/player.ts`);
  `planningView(game, draft, config).hiring.expected` (`src/ui/viewModel.ts:363`); `officeSceneFor`,
  `sameOfficeScene`, `beatScenes`, `yearPlayback`, `YearPlayback` (Task 4); `SceneSource` (type,
  `src/world/mountWorld.ts`).
- Produces:
  ```ts
  export interface OfficeSource extends SceneSource {
    /** Called just before the year ends: the scene shown now is kept as the year's start, and from now on the store's
     *  changes tell nobody and get() keeps returning the scene shown, until a beat is shown. */
    startPlay(): void;
    /** index: show beatScenes(start, the new year, playback)[index], telling listeners if it differs from the scene shown.
     *  null: stop playing and show the new year as it stands (with next year's expected hires), telling them once. */
    showBeat(playback: YearPlayback, index: number | null): void;
    readonly playing: boolean;
  }
  export const createOfficeSource: (store: StoreApi<GameStore>, companyId?: CompanyId) => OfficeSource;  // companyId defaults to PLAYER_ID
  ```

Rules: when not playing, `get()` builds the scene from the store's `game`, `draft`, `config` and `seed` with
`expectedHires: planningView(...).hiring.expected`; it rebuilds only when one of those references changed, and returns
the previous object when the new scene is `sameOfficeScene`. With no career in the store it returns the last scene it
made, or throws `Error("the office needs a career in play")` if it never made one. `subscribe` listens to the store and
tells its listener only when `get()` would return another object; it returns its undoing. A `showBeat` index out of
range, or a `showBeat` while not playing, is the same as `null`.

- [ ] **Step 1: Write the failing tests**

```ts
const career = () => { const store = createGameStore(null); store.getState().startCareer("Test", 1); return store; };
/** A draft for 1990 that hires: one person moved from Product to Recruiting. */
const hiring = (store: ReturnType<typeof career>) => {
  const { allocation } = store.getState().draft!;
  store.getState().setDraft({ allocation: { ...allocation, product: allocation.product - 1, recruiting: allocation.recruiting + 1 } });
  const { game, draft, config } = store.getState();
  expect(planningView(game!, draft!, config).hiring.expected).toBeGreaterThan(0);   // the precondition: this year hires
};
it("shows the player's office for the plan being drafted, with the hires it expects", () => {
  const store = career(); const { game, draft, config, seed } = store.getState();
  expect(createOfficeSource(store).get()).toEqual(officeSceneFor({ game: game!, companyId: PLAYER_ID, config, seed: seed!, draft: draft!,
    expectedHires: planningView(game!, draft!, config).hiring.expected }));
});
it("a change that changes nothing in the office keeps the same scene and tells nobody", () => {
  const store = career(); const source = createOfficeSource(store); const told = vi.fn(); source.subscribe(told);
  const before = source.get(); store.getState().setDraft({ price: store.getState().draft!.price });
  expect(source.get()).toBe(before); expect(told).not.toHaveBeenCalled();
});
it("moving a person tells the listener once, with a new scene", () => {
  const store = career(); const source = createOfficeSource(store); const told = vi.fn(); source.subscribe(told);
  const { allocation } = store.getState().draft!;
  store.getState().setDraft({ allocation: { ...allocation, product: allocation.product - 1, growth: allocation.growth + 1 } });
  expect(told).toHaveBeenCalledTimes(1); expect(source.get().teams.growth).toBe(allocation.growth + 1);
});
it("while a year plays out the source shows its beats in turn, and next year's hires only at the end", () => {
  const store = career(); hiring(store);
  const source = createOfficeSource(store); const told = vi.fn(); source.subscribe(told);
  const start = source.get();
  source.startPlay(); store.getState().endQuarter();
  expect(source.get()).toBe(start); expect(told).not.toHaveBeenCalled();
  const playback = yearPlayback(store.getState().lastLog!.companies[PLAYER_ID]!, false);
  const hires = playback.beats.find((b) => b.kind === "arrive")?.count ?? 0;
  expect(hires).toBeGreaterThan(0);                                         // the precondition: 1990 hired someone
  const { game, draft, config, seed } = store.getState();
  const next = officeSceneFor({ game: game!, companyId: PLAYER_ID, config, seed: seed!, draft: draft!, expectedHires: planningView(game!, draft!, config).hiring.expected });
  playback.beats.forEach((_, i) => {
    source.showBeat(playback, i);
    expect(source.get()).toEqual(beatScenes(start, next, playback)[i]);
  });
  expect(source.get().arriving).toBe(0);                                    // the arrive beat: hires at their desks
  source.showBeat(playback, null);
  expect([source.get(), source.playing]).toEqual([next, false]);
  expect(source.get().arriving).toBe(planningView(game!, draft!, config).hiring.expected);
});
it("a source made while a report is open is not playing (Review Focus 3)", () => {
  const store = career(); store.getState().endQuarter();
  expect(store.getState().reportOpen).toBe(true); expect(createOfficeSource(store).playing).toBe(false);
});
it("a race has no office; a source that showed a career keeps its last scene after the game is left", () => {
  const race = createGameStore(null); race.getState().startGame("Test", 1);
  expect(() => createOfficeSource(race).get()).toThrow("the office needs a career in play");
  const store = career(); const source = createOfficeSource(store); const last = source.get();
  store.getState().leave(); expect(source.get()).toBe(last);
});
it("stops listening to the store when told to", () => {
  const store = career(); const source = createOfficeSource(store); const told = vi.fn(); source.subscribe(told)();
  store.getState().endQuarter(); expect(told).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/ui/officeSource.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `createOfficeSource`** as specified. It imports from `src/world` with `import type` only.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; the boundary test passes (a type import is no chain).
- [ ] **Step 5: Commit**

```bash
git add src/ui/officeSource.ts src/ui/officeSource.test.ts
git commit -m "ui: the career's office scene comes from the store, the same object while nothing in it changes, beat by beat while a year plays out"
```

---

### Task 6: Picking a person up and setting them down

**Files:**
- Create: `src/ui/officeMoves.ts`, `src/ui/officeMoves.test.ts`

**Interfaces:**
- Consumes: `Plan`, `Department` (`src/engine/types.ts`); `Team`, `InteractableTarget` (types, `src/world/types`;
  `Team` is the same three strings).
- Produces:
  ```ts
  export type Carry = { readonly team: Team; readonly personId: string } | null;
  export interface Picked { readonly team: Team | null; readonly personId: string | null }
  export const moveBetweenTeams: (draft: Plan, from: Department, to: Department) => Pick<Plan, "allocation"> | null;
  export const carryStep: (carry: Carry, picked: Picked | null, draft: Plan) => { readonly carry: Carry; readonly move: Pick<Plan, "allocation"> | null };
  export const TEAM_NAMES: Readonly<Record<Team, string>>;      // Product, Growth, Recruiting
  export const carryLine: (team: Team) => string;               // `Move one ${TEAM_NAMES[team]} person to`
  export const CARRY_WORDS: { readonly keep: "Keep them"; readonly label: "Move a person between teams" };
  /** What the world highlights: the person carried, or nothing. Set after every tap, move, put-back and drop. */
  export const highlightFor: (carry: Carry) => InteractableTarget | null;
  ```

`carryStep`, case by case: nothing carried and a working person picked: carry them, no move. Nothing carried and
anything else: nothing. Carrying and empty space picked: put back. Carrying and the same person: put back. Carrying
and someone else of the same team: carry that person instead. Carrying and a person or desk of another team: the move
`moveBetweenTeams(draft, carry.team, picked.team)`, carry nothing. A move that `moveBetweenTeams` refuses: no move,
carry nothing.

- [ ] **Step 1: Write the failing tests**

```ts
const draft = (product: number, growth: number, recruiting: number): Plan =>
  ({ ...defaultPlan(newCareer().companies[0]), allocation: { product, growth, recruiting } });
it("moves one person and changes nothing else", () => {
  expect(moveBetweenTeams(draft(2, 1, 1), "product", "recruiting")).toEqual({ allocation: { product: 1, growth: 1, recruiting: 2 } });
});
it("refuses a move from an empty team or onto the same team (Review Focus 4)", () => {
  expect(moveBetweenTeams(draft(0, 2, 1), "product", "growth")).toBeNull();
  expect(moveBetweenTeams(draft(2, 1, 1), "growth", "growth")).toBeNull();
});
it("picks up a working person, and only a working person", () => {
  const plan = draft(2, 1, 1);
  expect(carryStep(null, { team: "product", personId: "p0" }, plan)).toEqual({ carry: { team: "product", personId: "p0" }, move: null });
  for (const picked of [null, { team: null, personId: "p5" }, { team: "growth" as const, personId: null }])
    expect(carryStep(null, picked, plan)).toEqual({ carry: null, move: null });
});
it("sets them down on anyone of another team, or a desk of it", () => {
  const plan = draft(2, 1, 1); const carry = { team: "product" as const, personId: "p0" };
  expect(carryStep(carry, { team: "growth", personId: "p2" }, plan)).toEqual({ carry: null, move: { allocation: { product: 1, growth: 2, recruiting: 1 } } });
  expect(carryStep(carry, { team: "recruiting", personId: null }, plan).move).toEqual({ allocation: { product: 1, growth: 1, recruiting: 2 } });
});
it("puts back on empty space or on the same person, and swaps to another of the same team", () => {
  const plan = draft(2, 1, 1); const carry = { team: "product" as const, personId: "p0" };
  expect(carryStep(carry, null, plan)).toEqual({ carry: null, move: null });
  expect(carryStep(carry, { team: "product", personId: "p0" }, plan)).toEqual({ carry: null, move: null });
  expect(carryStep(carry, { team: "product", personId: "p1" }, plan)).toEqual({ carry: { team: "product", personId: "p1" }, move: null });
});
it("a pick the draft no longer allows moves nobody (Review Focus 4)", () => {
  expect(carryStep({ team: "product", personId: "p0" }, { team: "growth", personId: "p2" }, draft(0, 3, 1))).toEqual({ carry: null, move: null });
});
it("highlights the person carried, and nothing when nothing is (Review Focus 4)", () => {
  expect(highlightFor({ team: "product", personId: "p0" })).toEqual({ kind: "person", personId: "p0" });
  expect(highlightFor(null)).toBeNull();
});
it("the same person tapped again after a put-back is picked up again (Review Focus 4)", () => {
  const plan = draft(2, 1, 1); const p0 = { team: "product" as const, personId: "p0" };
  const first = carryStep(null, p0, plan); const back = carryStep(first.carry, p0, plan); const again = carryStep(back.carry, p0, plan);
  expect([first.carry, back.carry, again.carry]).toEqual([p0, null, p0]);
});
it("says what is being moved in plain words, none of them a period word of the race", () => {
  expect(carryLine("growth")).toBe("Move one Growth person to");
  expect(Object.values(TEAM_NAMES)).toEqual(["Product", "Growth", "Recruiting"]);
  const text = [...(["product", "growth", "recruiting"] as const).map(carryLine), ...Object.values(TEAM_NAMES), ...Object.values(CARRY_WORDS)].join("\n");
  expect(text).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i);
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/ui/officeMoves.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ui/officeMoves.ts src/ui/officeMoves.test.ts
git commit -m "ui: a person picked up in the office is set down in another team as one change to the plan"
```

---

### Task 7: The 3D switch, what falls back to 2D, and the office's words

**Files:**
- Create: `src/ui/officeView.ts`, `src/ui/officeView.test.ts`

**Interfaces:**
- Consumes: `StorageLike` (type, `src/state/gameStore.ts`); `StageStatus` (type, `src/world/ui/stage.ts`);
  `PlaybackBeat`, `BeatKind` (types, Task 4).
- Produces:
  ```ts
  export const OFFICE_PREFERENCE_KEY = "startupworld:office:v1";
  export const readOfficePreference: (storage: Pick<StorageLike, "getItem"> | null) => boolean;   // false only for "off"
  export const writeOfficePreference: (storage: Pick<StorageLike, "setItem"> | null, on: boolean) => void;  // "on" | "off"; never throws
  export type OfficeAvailability = "unknown" | "running" | "context-lost" | "unsupported" | "failed";
  export const availabilityOf: (status: StageStatus) => OfficeAvailability;   // starting → unknown, the rest by name
  /** Once "unsupported", "failed" or "context-lost", nothing the view says changes it (the "starting" a view says as it
   *  unmounts least of all); only the player's press sets "unknown" again, directly. Otherwise availabilityOf(status). */
  export const nextAvailability: (prev: OfficeAvailability, status: StageStatus) => OfficeAvailability;
  /** WebGL 2 can be had here. Never throws; releases the context it made. The seam makes a canvas-like object. */
  export const canDrawOffice: (makeCanvas?: () => { getContext(id: "webgl2"): unknown } | null) => boolean;
  export const firstAvailability: (canDraw: boolean) => OfficeAvailability;  // "unknown" or "unsupported"
  export const DESKTOP_QUERY = "(min-width: 1024px) and (pointer: fine)";
  export type OfficeLayoutChoice = "3d" | "2d";
  export const officeLayoutFor: (input: { readonly career: boolean; readonly preference: boolean; readonly availability: OfficeAvailability; readonly wide: boolean }) => OfficeLayoutChoice;
  export const canPlayOut: (input: { readonly layout: OfficeLayoutChoice; readonly availability: OfficeAvailability; readonly reducedMotion: boolean }) => boolean;
  export const canSwitch: (availability: OfficeAvailability, wide: boolean) => boolean;   // false for unsupported, failed, or not wide
  export const reloadOffered: (availability: OfficeAvailability) => boolean;            // true for context-lost only
  /** The office cell's height: from its top to 12 px above the bottom bar, at least 360 px. */
  export const officeCellHeight: (input: { readonly viewport: number; readonly top: number; readonly bar: number }) => number;
  export const OFFICE_WORDS: {
    readonly toggle: "3D office";
    readonly unavailable: "The 3D office cannot be shown on this device. The game is complete without it.";
    readonly narrow: "The 3D office needs a desktop browser window at least 1024 pixels wide.";
    readonly lost: "The 3D office stopped drawing. The game carries on in these screens.";
    readonly reload: "Reload 3D view";
    readonly opening: "Opening the office…";
    readonly skip: "Skip";
  };
  export const playingLine: (year: number) => string;                         // `${year} plays out`
  export const beatLine: (beat: PlaybackBeat, officeNames: readonly string[]) => string;
  ```

`officeLayoutFor`: "3d" only for a career, with the preference on, in a wide window, and availability "unknown" or
"running"; otherwise "2d" (a lost context plays in the 2D screens, design 10.5). `canPlayOut`: "3d", "running" and not
reduced motion. `canDrawOffice` with no argument makes `document.createElement("canvas")`, asks for "webgl2", and if
it got one calls `getExtension("WEBGL_lose_context")?.loseContext()`; any throw is `false`.

- [ ] **Step 1: Write the failing tests**

```ts
const storage = (value: string | null) => ({ getItem: () => value, setItem: vi.fn() });
const AVAILABILITIES = ["unknown", "running", "context-lost", "unsupported", "failed"] as const;
it("the switch is on unless it was turned off, and blocked storage reads as on (Review Focus 5)", () => {
  expect([readOfficePreference(storage(null)), readOfficePreference(storage("on")), readOfficePreference(storage("off")), readOfficePreference(null)]).toEqual([true, true, false, true]);
  expect(readOfficePreference({ getItem: () => { throw new Error("blocked"); } })).toBe(true);
});
it("writes its own key, and a full disk throws nothing (Review Focus 5)", () => {
  const s = storage(null); writeOfficePreference(s, false); expect(s.setItem).toHaveBeenCalledWith("startupworld:office:v1", "off");
  expect(() => writeOfficePreference({ setItem: () => { throw new Error("full"); } }, true)).not.toThrow();
});
it("3D only in a career, switched on, in a desktop window, on a device drawing it (Review Focus 2)", () => {
  const at = (career: boolean, preference: boolean, availability: OfficeAvailability, wide = true) => officeLayoutFor({ career, preference, availability, wide });
  expect(at(false, true, "running")).toBe("2d");
  expect(at(true, false, "running")).toBe("2d");
  expect(at(true, true, "running", false)).toBe("2d");
  expect(AVAILABILITIES.map((a) => at(true, true, a))).toEqual(["3d", "3d", "2d", "2d", "2d"]);
});
it("once lost, the office stays lost: the 'starting' of an unmount is not news (Review Focus 2)", () => {
  const run = (statuses: StageStatus[], from: OfficeAvailability = "unknown") => statuses.reduce(nextAvailability, from);
  expect(run(["starting", "unsupported", "starting"])).toBe("unsupported");
  expect(run(["starting", "running", "context-lost", "starting", "running"])).toBe("context-lost");
  expect(run(["starting", "running"], "failed")).toBe("failed");
  expect(run(["starting", "running", "starting"])).toBe("unknown");
  expect(run(["running"], "unknown")).toBe("running");
});
it("a device without WebGL 2 starts in 2D, before anything is loaded; a probe that throws says no", () => {
  const canvas = (gl: unknown) => () => ({ getContext: () => gl });
  const lose = vi.fn();
  expect(canDrawOffice(canvas({ getExtension: () => ({ loseContext: lose }) }))).toBe(true);
  expect(lose).toHaveBeenCalledTimes(1);
  expect(canDrawOffice(canvas(null))).toBe(false);
  expect(canDrawOffice(() => null)).toBe(false);
  expect(canDrawOffice(() => { throw new Error("no canvas"); })).toBe(false);
  expect([firstAvailability(true), firstAvailability(false)]).toEqual(["unknown", "unsupported"]);
});
it("a year plays out only in a running 3D office, and never under reduced motion", () => {
  expect(canPlayOut({ layout: "3d", availability: "running", reducedMotion: false })).toBe(true);
  for (const input of [{ layout: "2d" as const, availability: "running" as const, reducedMotion: false },
    { layout: "3d" as const, availability: "context-lost" as const, reducedMotion: false }, { layout: "3d" as const, availability: "unknown" as const, reducedMotion: false },
    { layout: "3d" as const, availability: "running" as const, reducedMotion: true }]) expect(canPlayOut(input)).toBe(false);
});
it("the switch is offered unless the device or the window cannot draw the office; a lost one offers a reload", () => {
  expect(AVAILABILITIES.map((a) => canSwitch(a, true))).toEqual([true, true, true, false, false]);
  expect(AVAILABILITIES.map((a) => canSwitch(a, false))).toEqual([false, false, false, false, false]);
  expect(AVAILABILITIES.map(reloadOffered)).toEqual([false, false, true, false, false]);
  expect((["starting", "running", "context-lost", "unsupported"] as const).map(availabilityOf)).toEqual(["unknown", "running", "context-lost", "unsupported"]);
});
it("the office ends above the bottom bar, and is never smaller than 360 px", () => {
  expect(officeCellHeight({ viewport: 800, top: 150, bar: 60 })).toBe(578);
  expect(officeCellHeight({ viewport: 600, top: 300, bar: 60 })).toBe(360);
});
it("says each beat in plain words", () => {
  const names = ["Garage", "Shared office", "Own office", "Full floor", "Campus"];  const beat = (kind: BeatKind, count: number, office: number | null = null) => beatLine({ kind, seconds: 1, count, office }, names);
  expect([beat("leave", 1), beat("leave", 3), beat("arrive", 1), beat("arrive", 4), beat("move", 0, 1), beat("year", 0)]).toEqual(
    ["One person leaves", "3 people leave", "One hire walks in", "4 hires walk in", "The company moves to a bigger place: Shared office", "A quiet year"]);
  expect(beat("move", 0, 7)).toBe("The company moves to a bigger place");   // an office with no name given
  expect(playingLine(1994)).toBe("1994 plays out");
});
it("no word of the office is a period word of the race", () => {
  const names = ["Garage", "Shared office", "Own office", "Full floor", "Campus"];
  const beats = (["leave", "move", "arrive", "year"] as const).flatMap((kind) =>
    [0, 1, 2, 4].map((n) => beatLine({ kind, seconds: 1, count: kind === "move" ? 0 : n, office: kind === "move" ? n : null }, names)));
  const text = [...Object.values(OFFICE_WORDS), playingLine(1990), ...beats].join("\n");
  expect(text).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i);
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/ui/officeView.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the signatures above. Imports from `src/world` and `src/scene` are `import type`.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ui/officeView.ts src/ui/officeView.test.ts
git commit -m "ui: one rule for when the career shows its 3D office and when it plays in 2D, and the office's words"
```

---

### Task 8: The office beside the plan, the 3D switch and the fallback

**Files:**
- Create: `src/ui/officeProbe.ts`, `src/ui/officeProbe.test.ts`, `src/ui/components/OfficeSlot.tsx`,
  `src/ui/components/CareerOffice.tsx`
- Modify: `src/ui/screens/GameScreen.tsx`, `src/state/useGame.ts` (export `browserStorage`)

**Interfaces:**
- Consumes: `createOfficeSource`, `OfficeSource` (Task 5); `readOfficePreference`, `writeOfficePreference`,
  `nextAvailability`, `canDrawOffice`, `firstAvailability`, `DESKTOP_QUERY`, `officeLayoutFor`, `canSwitch`,
  `reloadOffered`, `officeCellHeight`, `OFFICE_WORDS`, `OfficeAvailability` (Task 7); `WorldView` default export with
  `source`, `onState`, `onTap` (Task 3); `WorldBoundary`, `WorldUnavailableNote` (`src/world/ui/WorldShell.tsx`);
  `WorldViewState`, `WorldHandle`, `WorldStats` (types).
- Produces:
  ```ts
  // officeProbe.ts
  export const PROBE_GLOBAL = "__careerOffice";
  export interface CareerOfficeProbe {
    status(): StageStatus | "none";                 // "none" while no career screen is attached
    availability(): OfficeAvailability | "none";
    stats(): WorldStats | null;                     // the live world's
    retiredStats(): WorldStats | null;              // the last world taken down (its counts stay readable once disposed)
    scene(): OfficeScene | null;
    personAt(desk: number): string | null; teamOf(target: InteractableTarget): Team | null;
    project(target: InteractableTarget): ScreenPoint | null; loseContext(): void;
  }
  export interface OfficeProbeLink {
    attach(view: () => WorldViewState, source: SceneSource, availability: () => OfficeAvailability): () => void;  // returns detach
    retire(handle: WorldHandle): void;
  }
  export const createOfficeProbe: () => CareerOfficeProbe & OfficeProbeLink;
  // CareerOffice.tsx (default export; only ever loaded lazily)
  export interface CareerOfficeProps {
    readonly source: OfficeSource; readonly draft: Plan;
    readonly onMove: (patch: Pick<Plan, "allocation">) => void;
    readonly onView: (state: WorldViewState) => void;
    readonly onFailed: () => void;
  }
  // OfficeSlot.tsx: export const OfficeSlot: (props: CareerOfficeProps) => JSX.Element
  //   its own error boundary (calls onFailed, renders nothing) around <Suspense fallback={OFFICE_WORDS.opening placeholder}>
  //   around lazy(() => import("./CareerOffice")). It imports nothing from src/world by value.
  ```

The screen in a career reads, once per mount and before its first paint, `canDrawOffice()` (in the `useState`
initializer of the availability, through `firstAvailability`), the preference, and `matchMedia(DESKTOP_QUERY)` (kept in
state, updated by its `change` event). When `officeLayoutFor` gives "3d", the page is, from the top: the header, the
timeline, the news card when one is in force (`EventBanner`), then a grid `grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]`:
the left column holds the office cell (`data-office`, rounded like the panels, its height `officeCellHeight` of the
window's inner height, the cell's top in the page and the bottom bar's height, measured in a layout effect and on
`resize` and on a `ResizeObserver` of the bar) above `CareerStatus`, `ResourceBar`, `ProjectionCard` and `RivalsPanel`;
the right column holds `PlanningPanel`. The tab buttons are not shown (the layout is desktop only). With "2d" the JSX
is today's. The header gains, in a career only and before `SoundMenu`, a button with the text `OFFICE_WORDS.toggle`,
`aria-pressed` for the layout, disabled when `canSwitch(availability, wide)` is false with `title` set to
`OFFICE_WORDS.unavailable` (device) or `OFFICE_WORDS.narrow` (window); pressing it writes the preference and, when
turning on, sets availability to "unknown" if it is "context-lost". When `reloadOffered`, a second header button
`OFFICE_WORDS.reload` (with `title={OFFICE_WORDS.lost}`) sets availability to "unknown", which brings a new office cell.
The source is made once per GameScreen (`useState(() => createOfficeSource(gameStore))`) and never read in a race.
`onView` keeps the latest `WorldViewState` in a ref, calls `probe.retire(old)` when the reported handle changes away
from a world, and sets availability through `nextAvailability`; `onFailed` sets "failed". `CareerOffice` renders
`WorldBoundary` (fallback `WorldUnavailableNote`, `onError` = `onFailed`) around `WorldView`. One probe is made per
page (module-level in GameScreen's module, created on first use) and installed on `window.__careerOffice` by the
first career GameScreen; each career GameScreen attaches it while mounted and detaches on unmount; it is never removed,
so a check can read `retiredStats()` after the player has left.

- [ ] **Step 1: Write the failing test**

```ts
// officeProbe.test.ts
const fakeHandle = (): WorldHandle => ({ /* vi.fn() for each member; stats returns { drawCalls: 9, …, figures: 4, hidden: 0, framesDrawn: 3 };
  personAt: (d) => (d === 0 ? "p0" : null); teamOf: () => "product"; project: () => ({ x: 10, y: 20 }) */ });
it("reads the view as it stands, nothing before there is a world, and none once detached", () => {
  const probe = createOfficeProbe();
  expect([probe.status(), probe.availability(), probe.stats(), probe.scene()]).toEqual(["none", "none", null, null]);
  let state: WorldViewState = { status: "starting", handle: null };
  const source = { get: () => scene, subscribe: () => () => undefined };
  const detach = probe.attach(() => state, source, () => "unknown");
  expect([probe.status(), probe.stats(), probe.personAt(0), probe.project({ kind: "door" }), probe.scene()]).toEqual(["starting", null, null, null, scene]);
  const handle = fakeHandle(); state = { status: "running", handle };
  expect([probe.status(), probe.stats()?.figures, probe.personAt(0), probe.teamOf({ kind: "person", personId: "p0" }), probe.project({ kind: "door" })])
    .toEqual(["running", 4, "p0", "product", { x: 10, y: 20 }]);
  probe.loseContext(); expect(handle.loseContext).toHaveBeenCalledTimes(1);
  detach(); expect([probe.status(), probe.stats()]).toEqual(["none", null]);
});
it("keeps the last world taken down readable", () => {
  const probe = createOfficeProbe(); const handle = fakeHandle();
  expect(probe.retiredStats()).toBeNull();
  probe.retire(handle); expect(probe.retiredStats()?.framesDrawn).toBe(3);
});
```

- [ ] **Step 2: Run it.** `npx vitest run src/ui/officeProbe.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `createOfficeProbe`,** then the two components and the GameScreen changes as described
  above.
- [ ] **Step 4: Run the test, then the checks.** Expected: PASS. Then confirm the 3D code is still out of the first
  load and the race:

```bash
for f in $(grep -o 'assets/[^"]*\.js' dist/index.html); do grep -l "WebGLRenderer" "dist/$f"; done
ls dist/assets | grep -c '^CareerOffice-'
```

Expected: the first prints nothing (three is in no file of the first load); the second prints `1` (the office is a
lazy chunk of its own; three may sit in a chunk it shares with the lab).
- [ ] **Step 5: Smoke it in the browser.** `npx vite preview --port 4391 &`, then with Playwright (as in
  `scripts/world-check.mjs`) at 1280×800 open `/`, start a career, wait for
  `window.__careerOffice?.status() === "running"`, and read `stats().figures` and `scene()`. Expected: "running" within
  30 s, `scene().office` 0, and `stats().figures` = `min(teams + away + leaving, 50) + min(arriving, 6)` of the scene
  (`MAX_STAFF_DRAWN`, `MAX_WAITING_DRAWN` in `src/world/cast.ts`); the `[data-office]` box ends above the bottom bar's
  top. Then with `--disable-3d-apis`: no `[data-office]`, no `[data-world]`, and no request for a `CareerOffice-`
  chunk. Stop the server.
- [ ] **Step 6: Commit**

```bash
git add src/ui src/state/useGame.ts
git commit -m "ui: the career's office stands beside the plan in 3D, with a switch for it and the 2D screens when it cannot run"
```

---

### Task 9: The year plays out, and people move by pointing

**Files:**
- Create: `src/ui/yearPlay.ts`, `src/ui/yearPlay.test.ts`
- Modify: `src/ui/screens/GameScreen.tsx`, `src/ui/components/CareerOffice.tsx`

**Interfaces:**
- Consumes: `yearPlayback`, `NO_PLAYBACK`, `PlaybackBeat`, `YearPlayback` (Task 4); `OfficeSource.startPlay`,
  `showBeat` (Task 5); `carryStep`, `carryLine`, `highlightFor`, `TEAM_NAMES`, `CARRY_WORDS`, `Carry` (Task 6);
  `canPlayOut`, `playingLine`, `beatLine`, `OFFICE_WORDS`, `OfficeAvailability` (Task 7); `WorldHandle.settle`,
  `teamOf`, `releaseFirst` and `WorldView`'s `onTap` (Task 3); `yearOf` (`src/engine/career.ts`).
- Produces:
  ```ts
  export type YearPlay =
    | { readonly phase: "idle" }
    | { readonly phase: "playing"; readonly year: number; readonly playback: YearPlayback; readonly startedMs: number; readonly endsMs: number };
  export const IDLE: YearPlay;
  export const startYearPlay: (play: YearPlay, playback: YearPlayback, year: number, nowMs: number) => YearPlay;
  export const beatIndexNow: (play: YearPlay, nowMs: number) => number | null;   // null when idle or done
  export const beatNow: (play: YearPlay, nowMs: number) => PlaybackBeat | null;
  export const yearPlayDone: (play: YearPlay, nowMs: number) => boolean;
  export const yearPlayAfterLoss: (play: YearPlay, availability: OfficeAvailability) => YearPlay;   // IDLE unless still "running"
  /** End is refused while a year plays out or a report is open: checked before endQuarter runs. */
  export const endRefused: (play: YearPlay, reportOpen: boolean) => boolean;
  /** The year End just closed plays out: a new report came in, the store reports no failure, and the player's company
   *  is not out (a year it goes out opens its summary at once). The career's last year plays out too. */
  export const yearPlaysOut: (
    before: { readonly log: object | null },
    after: { readonly log: object | null; readonly failure: Error | null; readonly playerOut: boolean },
  ) => boolean;
  export type YearPlayStep = { readonly kind: "none" } | { readonly kind: "beat"; readonly index: number } | { readonly kind: "finish" };
  /** What the office does for the moment the caption shows, given the beat it shows: nothing, the caption's beat, or finish. */
  export const yearPlayStep: (play: YearPlay, shown: number | null, nowMs: number) => YearPlayStep;
  ```

The flow, in `GameScreen`'s End handler, with the play state kept in a ref (`playRef`, mirrored into state for
rendering): first, `if (endRefused(playRef.current, gameStore.getState().reportOpen)) return;`. Then today's guard.
In a career when `canPlayOut` (reduced motion read from `matchMedia("(prefers-reduced-motion: reduce)")` at the click):
note `year = yearOf(game.turn, config.career!)` (a career's config always has `career`),
call `source.startPlay()`, then `endQuarter()`. Read `after = gameStore.getState()`; if
`yearPlaysOut({ log: before.lastLog }, { log: after.lastLog, failure: after.failure, playerOut })` (`playerOut`: no game
after, or the player's company `out`), set
`playRef.current = startYearPlay(playRef.current, yearPlayback(after.lastLog?.companies[PLAYER_ID] ?? null, false), year, performance.now())`;
otherwise leave it `IDLE`. If it is `IDLE`, `source.showBeat(NO_PLAYBACK, null)` at once (the summary or the error
shows as today); else `source.showBeat(playback, 0)`. While playing: the page's main `div` is `inert`, the report
dialogs are not rendered, a timer runs every 250 ms and only moves the caption's moment on (`setPlayNow`); a layout
effect on that moment takes `yearPlayStep(play, shown, playNow)` and, for a `beat`, calls
`source.showBeat(playback, index)`, so the world draws each beat's scene in turn, and the scene changes in the same
commit as the caption, before anything is drawn. (Calling `showBeat` from the timer, ahead of React's render, let a
frame or two draw the next beat, the hires walking in or the new office, under the last beat's caption.) When the step
is `finish` the timer ends the year inside `flushSync`, so the new year and the caption's removal also land together. A fixed bar at
the bottom (outside the inert `div`, `z-40`) shows `playingLine(year)`, the caption, and a `Skip` button that has
focus. The caption is `beatLine(beat, officeNames)` when `beatNow` gives a beat and nothing when it gives `null`
(the last moment before the end); `officeNames` are `rulesForTurn(config, game.turn).career?.offices.map((o) => o.name) ?? []`
(and `beatLine` says "The company moves to a bigger place" with no name when the index has none). Finishing, by the
timer reaching `endsMs` (`yearPlayStep` gives `finish`), by Skip, by `yearPlayAfterLoss` giving `IDLE`, or by the layout leaving "3d" (the switch
turned off, the window made narrow): `handle?.settle()`,
`source.showBeat(playback, null)`, `IDLE`; the summary then opens as today. Every other path (race, 2D, reduced
motion) is today's.

In `CareerOffice`: `onTap(target, select)` keeps `select` in a ref, maps the target to `Picked`
(`team = handle.teamOf(target)`, `personId` for a person target, `null` for no target), runs `carryStep` with the
current `draft`, keeps the carry in state, and calls `select(highlightFor(carry))`, so the highlight always shows what
is carried and the stage's store agrees with it. A move: `const shown = source.get(); handle.releaseFirst(carry.personId); onMove(move); if (source.get() === shown) handle.releaseFirst(null);`
then the carry is `null` and `select(null)`. While carrying, a strip at the bottom-left of the office cell
(`role="group"`, `aria-label={CARRY_WORDS.label}`) shows `carryLine(team)`, a button per other team (`TEAM_NAMES`) that
makes the same move, and `CARRY_WORDS.keep`; Escape and "Keep them" put back (`carry = null`, `select(null)`). The carry
is dropped, with `select(null)`, when the scene's year changes, when the source starts playing, or when the view's
handle changes.

- [ ] **Step 1: Write the failing tests**

```ts
const playback = (seconds: number, beats: PlaybackBeat[]): YearPlayback => ({ beats, seconds });
const leave = { kind: "leave", seconds: 1.5, count: 2, office: null } as const;
const arrive = { kind: "arrive", seconds: 2.5, count: 3, office: null } as const;
it("plays a year from now for its length", () => {
  const p = playback(4, [leave, arrive]);
  expect(startYearPlay(IDLE, p, 1994, 1000)).toEqual({ phase: "playing", year: 1994, playback: p, startedMs: 1000, endsMs: 5000 });
});
it("names the beat on screen at each moment, and its index", () => {
  const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
  expect([beatNow(play, 1000), beatNow(play, 2499), beatNow(play, 2500), beatNow(play, 4999), beatNow(play, 5000)]).toEqual([leave, leave, arrive, arrive, null]);
  expect([beatIndexNow(play, 1000), beatIndexNow(play, 2500), beatIndexNow(play, 5000), beatIndexNow(IDLE, 0)]).toEqual([0, 1, null, null]);
  expect([yearPlayDone(play, 4999), yearPlayDone(play, 5000), yearPlayDone(IDLE, 0)]).toEqual([false, true, true]);
});
it("a year with nothing to play does not start", () => { expect(startYearPlay(IDLE, NO_PLAYBACK, 1994, 0)).toBe(IDLE); });
it("a second start while a year plays changes nothing (Review Focus 1)", () => {
  const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
  expect(startYearPlay(play, playback(1.2, [{ kind: "year", seconds: 1.2, count: 0, office: null }]), 1995, 2000)).toBe(play);
});
it("End is refused while a year plays out or a report is open, before the year is ended (Review Focus 1)", () => {
  const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
  expect([endRefused(IDLE, false), endRefused(play, false), endRefused(IDLE, true), endRefused(play, true)]).toEqual([false, true, true, true]);
});
it("plays a year only when it really ended: a new report and no failure (Review Focus 1)", () => {
  const log = { turn: 5 }; const next = { turn: 6 };
  expect(yearPlaysOut({ log }, { log: next, failure: null, playerOut: false })).toBe(true);
  expect(yearPlaysOut({ log }, { log, failure: null, playerOut: false })).toBe(false); // nothing happened: last year must not replay
  expect(yearPlaysOut({ log }, { log, failure: new Error("x"), playerOut: false })).toBe(false);
  expect(yearPlaysOut({ log: null }, { log: null, failure: null, playerOut: false })).toBe(false);
});
it("a year in which the player's company went out does not play out: the summary opens at once", () => {
  expect(yearPlaysOut({ log: { turn: 12 } }, { log: { turn: 13 }, failure: null, playerOut: true })).toBe(false);
});
it("a beat list held to six seconds ends at six seconds, whatever its beats add up to", () => {
  const play = startYearPlay(IDLE, playback(6, [leave, { kind: "move", seconds: 2.5, count: 0, office: 1 }, arrive]), 2001, 0);
  expect([beatNow(play, 5999)?.kind, beatIndexNow(play, 5999), yearPlayDone(play, 6000)]).toEqual(["arrive", 2, true]);
});
it("an office that stops drawing ends the year at once (Review Focus 2)", () => {
  const play = startYearPlay(IDLE, playback(4, [leave, arrive]), 1994, 1000);
  expect((["running", "context-lost", "failed", "unsupported", "unknown"] as const).map((a) => yearPlayAfterLoss(play, a) === IDLE)).toEqual([false, true, true, true, true]);
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/ui/yearPlay.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/ui/yearPlay.ts`, then the GameScreen flow and the carry in `CareerOffice` as
  described above.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS. Then run `node scripts/career-check.mjs
  --no-build`: it may now fail only where a year plays out before its report (Task 10 settles that); the race step
  must pass.
- [ ] **Step 5: Smoke it.** As in Task 8 step 5: start a career, end 1990, and assert that the bar with "1990 plays
  out" appears, the summary dialog is absent until it goes, and pressing Skip opens the summary within a second.
- [ ] **Step 6: Commit**

```bash
git add src/ui
git commit -m "ui: after End year the office plays the year out for a few seconds, skippable, and a person can be moved by pointing"
```

---

### Task 10: The 2D career check, played with WebGL off

**Files:**
- Modify: `scripts/career-check.mjs` (header comment, `chromium.launch` at line 633, and the steps below)

**Interfaces:**
- Consumes: the career screen as Tasks 8 and 9 leave it; `raceText`, `stubAnalytics` (`scripts/race-text.mjs`).
- Produces: a check that proves the 2D screens complete and the race unchanged with the office in the build.

- [ ] **Step 1: Add the failing assertions.**
  1. Launch with `chromium.launch({ args: ["--disable-3d-apis"] })`, and say why in the header: this script is the
     proof that a career is complete without 3D; `scripts/office-check.mjs` covers the 3D screen.
  2. In `wholeCareer`, after the first year opens: at once (the WebGL 2 probe says no before the first paint) the
     "3D office" button is disabled and its `title` is
     `"The 3D office cannot be shown on this device. The game is complete without it."`; no `canvas` is on the page;
     `PlanningPanel`, the projection and the rivals are all visible at 1280×800. A `MutationObserver` installed with
     `addInitScript` counts every `[data-office]` and `[data-world]` element added to the page; read after 5 s and
     again at the end of the whole career, both counts are 0 (no swing between 2D and 3D), and no request matched
     `/assets\/CareerOffice-/`.
  3. After every `loadSave` in the script: `[data-office]` is absent (the count above stays 0).
  4. In `raceUnchanged`: record every request; assert none matches `/assets\/(CareerOffice|WorldView)-/` while a race
     is opened and its first quarter played; that no requested `assets/*.js` file contains `WebGLRenderer` (read each
     from `dist/` after the build, as Task 8 step 4 does, since three may sit in a chunk shared with the lab under
     another name); and that the race's header has no "3D office" button.
- [ ] **Step 2: Run it** against the build from Task 9: `node scripts/career-check.mjs`. Expected: the new
  assertions pass with the 2D path, and every earlier step passes as before (a year with WebGL off opens its summary
  at once, as `canPlayOut` is false). If any fails, the failure names a real defect: fix it in the module it points
  at, with a failing unit test first where one can reach it.
- [ ] **Step 3: Run the checks.**
- [ ] **Step 4: Commit**

```bash
git add scripts/career-check.mjs
git commit -m "scripts: the career check plays its whole career with WebGL off, and the race never loads the office"
```

---

### Task 11: The 3D career in a real browser

**Files:**
- Create: `scripts/office-check.mjs`, `docs/superpowers/specs/3d-office-check.md`
- Modify: `scripts/career-fixtures.ts` (three era fixtures, below); whatever the checks show to be wrong, each fix with
  a failing unit test first where one can reach it

**Interfaces:**
- Consumes: `window.__careerOffice` (Task 8); the career save fixtures from `npx tsx scripts/career-fixtures.ts`
  (`office`, `campus`, …, each `{ save, year }`, and the three added here); `raceText`, `stubAnalytics`; the helpers of
  `career-check.mjs` (copy what is needed; the two scripts stay independent).
- Produces: `node scripts/office-check.mjs [--no-build] [--shots <dir>]`, port 4181, Chromium launched with no
  options (WebGL 2 through SwiftShader) except where a step says, exit 1 on the first failed assertion, naming it.
  `scripts/career-fixtures.ts` prints three more fixtures: `nineties` (1994, turn 5), `noughties` (2004, turn 15) and
  `twenties` (2023, turn 34), each `datedTo(newCareer(1), turn)` with the player in office 1, 2 and 3 respectively, a
  head count that fills half of it, and cash for ten years of its salaries (as `officeStart` is built). The script
  already fails if a save does not pass the career save's check.

Console rule: any console error or page error fails the page, except the warning text `GPU stall due to ReadPixels`
(the software renderer's, allowed exactly as `scripts/world-check.mjs` allows it). Time is in world seconds where the
world's own motion is timed (frames are clamped at 0.1 s; this machine draws 4 to 15 a second). "Rests" means
`stats().framesDrawn` does not change over one second of page time. `figures(scene)` below is
`min(teams + away + leaving, 50) + min(arriving, 6)` (`MAX_STAFF_DRAWN`, `MAX_WAITING_DRAWN`). The draw-call ceiling is
`min(800, 80 + 14 × stats().figures)` (the groundwork measured 82 to 629).

- [ ] **Step 1: Write the script, its assertions in this order.**
  1. **Race unchanged:** `raceText` equals `scripts/race-text.snapshot.json`; no request for
     `/assets\/(CareerOffice|WorldView)-/` during the race, and no requested `assets/*.js` file contains
     `WebGLRenderer`; no `canvas` on the race's page.
  2. **3D career opens, and the office is the main view:** at 1280×800 start a career (seed 1);
     `__careerOffice.status()` is "running" within 30 s; the office cell's box is left of the planning panel's, at
     least 600 px wide, and lies wholly inside the viewport and above the fixed bottom bar's top with the page not
     scrolled. Assert the same on the `nineties`, `noughties` and `twenties` fixtures, and assert that among these four
     pages at least one shows the news card and one does not, so both cases are covered. `stats().figures` equals
     `figures(scene())`; `scene().year` is 1990 and the header and timeline match the 2D check's expectations; the loop
     rests; `stats().drawCalls` is within the ceiling. Screenshot `1990-office.png`.
  3. **A year plays out, beat by beat:** raise Recruiting by one with its stepper (so 1990 hires), press "End 1990":
     the bar shows "1990 plays out", no `[role="dialog"]` while it shows; sample `scene()` every 200 ms while the bar
     shows: while the caption is a "leave" or "move" line `scene().arriving` equals the year's hires (> 0), and while
     it is an "… walk in" line `scene().arriving` is 0; the summary opens within 8 s of page time and exactly one
     dialog is open; `scene().year` is 1991, and once the summary is closed `scene().arriving` equals the planning
     panel's expected hires. A double click on "End 1991" plays one year only and opens one summary (Review Focus 1);
     pressing Enter on "End" while that summary is open changes neither the year nor the save. Skip during the next
     year opens the summary within 1 s and the loop then rests within 2 s.
  4. **Moving a person by pointer (Review Focus 4):** with a draft of at least one Product person, click at
     `project({ kind: "person", personId: personAt(0) })`; the strip "Move one Product person to" shows; click
     "Growth"; the planning panel's Growth count is one higher and Product one lower; `scene().teams` agrees;
     `teamOf({ kind: "person", personId: <that id> })` is "growth" once the loop rests. Click the person who moved:
     the strip shows "Move one Growth person to"; press Escape: the strip goes and nothing changes. Click the same
     person again: the strip shows again; click them once more: it goes (put back). Pick a Product person and click a
     person of another team: the same move as the button.
  5. **Office move and looks:** load the `office` fixture, end its year, skip, wait for rest: `scene().office` went up
     by one; screenshot. Load the `nineties`, `noughties` and `twenties` fixtures: `lookFor(scene().era)` (the rule
     copied into the script as a table) is "nineties", "noughties" and "twenties"; screenshot each
     (`1994-nineties.png`, `2004-noughties.png`, `2023-twenties.png`). Load `campus`: `stats().figures` equals
     `figures(scene())` and is at most 56, `stats().hidden` > 0. Record `drawCalls` for each office, each within the
     ceiling.
  6. **Taken down cleanly:** after each of "Save and leave"; "New game" then "Abandon"; the "3D office" switch turned
     off; and "Reload 3D view" after a lost context: `retiredStats()` shows `geometries` 0 and `textures` 0, and its
     `framesDrawn` does not change over one second; where a new office runs, `status()` is "running" with a new
     `stats()`; after leaving, `status()` is "none".
  7. **Hidden tab and resize:** with a playback running, make the tab hidden (`Object.defineProperty` on
     `document.hidden` and `visibilityState`, then dispatch `visibilitychange`): `stats().framesDrawn` does not advance
     over one second; make it visible again: the year finishes and the summary opens. Resize to 1100×800 and back to
     1280×800: each time, once the loop rests, the canvas's CSS size equals the `[data-office]` cell's. Resize to
     1000×800: the 2D layout shows (no canvas) and `retiredStats()` shows the world freed; back to 1280×800: a new
     office runs.
  8. **Reduced motion:** a context with `reducedMotion: "reduce"`: "End <year>" opens the summary at once (no bar),
     and the loop rests within 1 s of world time.
  9. **Switch off and on:** pressing "3D office" removes the canvas and shows today's 2D grid (the same panels the 2D
     check asserts); a reload keeps it off (`localStorage["startupworld:office:v1"] === "off"`); pressing it again
     brings the office back running. The career save key's value is unchanged by either press.
  10. **Fallbacks (Review Focus 2):** a browser launched with `--disable-3d-apis` shows the 2D grid from the first
     paint and the switch disabled, with no `[data-office]` or `[data-world]` ever added (a `MutationObserver` from
     `addInitScript`, read after 5 s) and no error. With the `CareerOffice-` chunk's request aborted (`page.route`),
     the career shows the 2D grid with the switch disabled, and `[data-office]` was added at most once over 5 s.
     `loseContext()` during a playback ends the year at once (summary open) and the page shows the 2D grid with
     "Reload 3D view" in the header, and stays so over 5 s; pressing it brings status "running" back.
  11. **Reload mid-year (Review Focus 3):** end a year, reload while the bar shows: the summary is open, no bar, and
     the save is byte-identical to the one read just before the reload.
  12. **A whole career through the 3D screen:** seed 1, 1990 to 2038, pressing Skip each year as soon as the bar
     shows; each year the header names the year, and no forbidden word (`/\b(quarters?|quarterly|turns?)\b|\bQ\d{1,2}\b/i`)
     is in the page's text, read both while the playback bar shows and once the summary is open; the end screen
     appears after 2038. (Skip keeps it to minutes on a software renderer.)
  13. **Narrow:** at 390×844 (and with `hasTouch`) a career page has no `canvas`, no `[data-office]`, no sideways
     scroll and no errors; the "3D office" switch is disabled with the narrow-window title.
  14. **No console errors** on any page, under the rule above.
- [ ] **Step 2: Run it.** `node scripts/office-check.mjs --shots <scratch dir>` — Expected: every step prints
  `ok`, exit 0. Fix what fails as this task's Files line says.
- [ ] **Step 3: Measure the download.** `gzip -c dist/assets/CareerOffice-*.js | wc -c` and the same for each file
  `dist/index.html` references. Record both, beside the design's figures (section 10.5: about 131 KB for 3D on top of
  111 KB), and say plainly if the 3D part is larger.
- [ ] **Step 4: Write the report** `docs/superpowers/specs/3d-office-check.md`: what each step checked; draw calls
  per office at 1280×800 against the design's phone budget of 300 (desktop only in this plan; phones are the owner's
  check); the download sizes; how long a year's playback holds; what failed and was fixed. Say that this machine
  renders in software, so its frame rates say nothing about real devices. Send the owner the screenshots.
- [ ] **Step 5: Run the checks, and both browser scripts once more.** `node scripts/career-check.mjs` and
  `node scripts/office-check.mjs`. Expected: both exit 0.
- [ ] **Step 6: Commit**

```bash
git add scripts/office-check.mjs scripts/career-fixtures.ts docs/superpowers/specs/3d-office-check.md
git commit -m "scripts: the 3D career checked in a real browser: a year playing out, people moved, looks, fallbacks and the race unchanged"
```

---

## After this plan

The career is played in its 3D office on desktop, with the 2D screens as its complete fallback. What step 5 inherits:

- **The market view** shares the office's canvas behind a switch. The scene model needs each company's users and
  where last year's new users went (the turn log's `market` and `publicReport`), and `yearPlayback` gains a beat that
  cuts from the office to the market after `arrive`. "Select a company" (section 10.3) arrives with it, with a button
  twin in the rivals panel.
- **Five more era looks and the future set.** `ERA_LOOKS` maps eight eras onto three looks; step 5 gives each era its
  own entry, and `agents` and `ambient` a fourth furniture set. Every look-keyed table and `SIGNATURE_PROPS` take the
  new ids; the distinctness tests extend by themselves.
- **The server rack showing users** needs a users field in `OfficeScene`; the calendar shows the year already.
- **Sound for milestones** hangs on the world's kept `WorldSoundListener` seam and on the beats.
- **Phones:** this plan gives windows narrower than 1024 px, and touch screens, the 2D screens (`DESKTOP_QUERY` in
  `officeLayoutFor`). Step 5's phone work lifts that gate: the upright layout (section 10.2), touch aimed at a team's
  area (register team-area targets low, as the groundwork ledger says), and the 300 draw-call budget with instanced
  far figures, using the draw calls this plan's report records.
- **How-to-play** explains picking people up and the 3D switch; the owner's play-test decides whether six seconds is
  the right longest playback.
