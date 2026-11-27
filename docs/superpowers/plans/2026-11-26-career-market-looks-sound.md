# The Market View, Eight Era Looks and Sound for Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the career's 3D screen on desktop (design section 15, step 5): a market view on the office's canvas
where the four companies stand as buildings sized by their users, with the year's new users streaming to whoever won
them and the bar for going public marked; a look of its own for each of the eight eras, the invented future on a
fourth furniture set; a sound for each year's main milestone; a how-to-play that explains all of it; documents that
say what is built; and the open points of the last review closed.

**Architecture:** Nothing in the rules, the store or the save changes. A pure scene model (`src/scene/marketScene.ts`,
types in `src/world/types/market.ts`) turns the game and the last year's log into a `MarketScene` through
`publicCompany` and `publicReport` only; a pure layout (`src/world/market/marketLayout.ts`) turns that into lots,
heights and dots, and a `MarketSystem` in the world draws it on the same renderer, camera and lights as the office.
`WorldHandle` gains `setMarket`, `setView` and `view`; the world hides the office's roots while the market shows, so
the two are never drawn together and picking only finds what is shown. The year's playback gains a last `market` beat
(`withMarket`), and a pure `viewNow` decides which view is on screen. Era looks become one `LookId` per era (palette,
resting light, signature props) laid over the four furniture sets of section 10.2 plus a `classic` fallback
(`FurnitureSet`, `furnitureOf`). Milestone sounds are
chosen by one pure function (`yearSoundFor`) from the milestones a year added, and played through the existing audio
engine, from a new `src/ui/careerSound.ts` (the frozen `SFX` facade is not touched); the world's kept
`WorldSoundListener` seam is wired for footsteps and chairs.

**Tech Stack:** three 0.187.0 (pinned), React 19, zustand 5, Tailwind 3, TypeScript 5.9 strict, Vitest 4 in node, the
Web Audio engine in `src/audio`, Playwright with this machine's Chromium (`require("playwright")`, WebGL 2 through
SwiftShader). No new dependencies, no audio, model, image or font files.

**Spec:** `docs/superpowers/specs/2026-11-25-career-3d-design.md`, sections 2, 3, 4, 6, 10 (all), 13, 15 (step 5), 17
and 18. What step 4 built and left: `docs/superpowers/plans/2026-11-25-career-3d-office.md` ("After this plan");
what it measured: `docs/superpowers/specs/3d-office-check.md`. Rulings: `docs/career-rules.md`.

**Not in this plan (owner's decision: desktop web browsers only):** the upright phone layout of section 10.2, touch
aimed at team areas, the 300 draw-call phone budget and instanced far figures (10.6, 17), and lifting the
`DESKTOP_QUERY` gate in `officeLayoutFor`. Phones, touch screens and windows under 1024 px keep the 2D screens and must
merely not break (at 390 px nothing overflows sideways and nothing throws). Also not here: the server rack showing
users (it needs a users field on `OfficeScene`, through every builder and the lab; nothing in the design asks for it).

## Decisions this plan makes where the design is open

1. **Eight looks, one per era, over four furniture sets as in section 10.2, plus the `classic` fallback for an era id
   the world does not know.** `LookId` becomes the era ids themselves (`"dial-up"`,
   `"gold-rush"`, `"bust"`, `"phones"`, `"cheap-money"`, `"winter-ai"`, `"agents"`, `"ambient"`) plus `"classic"` for
   any id the world does not know. A look owns a palette (`PHASE_THEMES`), a resting light (`RESTING_LOOKS`, with six
   new moods so no two eras rest in the same light, and none in the classic morning) and three signature props. A `FurnitureSet` (`"classic"`,
   `"nineties"`, `"noughties"`, `"twenties"`, `"future"`) owns the desks, the computer on them, floors, walls and shells;
   `furnitureOf(look)` maps dial-up and gold-rush to the nineties, bust, phones and cheap-money to the noughties,
   winter-ai to the twenties, agents and ambient to the future (section 10.2: four sets, eight looks; `classic` is not
   a fifth set the design lacks, only what an unknown era falls back to, as today). Every era change
   now rebuilds the office with its sink and rise, as a decade change did; the market beat comes last in a playback,
   after any rebuild has begun.
2. **Three signature props per era**, first the one that names it (pinned in Task 2 and Task 3):
   dial-up fax-machine, dot-printer, tube-tv; gold-rush software-shelf, pinball, tube-tv; bust box-stack,
   fax-machine, flat-tv; phones charging-kiosk, flat-tv, beanbag; cheap-money foosball, drinks-fridge, scooter;
   winter-ai compute-cabinet, plant-wall, ring-light; agents robot-dock, holo-table, plant-wall; ambient home-robot,
   glasses-stand, light-column. Each prop stands where it faces the camera. Sizes are chosen so that every era's first
   prop and at least two of its three show in every office on today's décor spots (measured with `signaturePlan` over
   the real layouts; the garage has only two replaceable spots, the shared office's largest is 0.8 × 0.8): the
   software shelf and the foosball table shrink to 0.8 wide, and the pinball cabinet and the drinks fridge are narrow
   uprights (Task 2's size table). No décor spot is added.
3. **The market is a fixed diorama like the office:** four lots in a row on a plaza, the player's lot first, a source
   of new users in front of them. Building height follows the square root of users on one scale shared with the bar for
   going public (`top = max(1.25 × bar, most users)`, `height = sqrt(users / top)`, at least 0.04 for a company with any
   users), so a small company stays visible and a building that reaches the bar plane has reached the bar. A public
   company carries a flag on its roof; a newcomer of this year a crane; a company that is out leaves a fenced empty lot,
   which cannot be selected. No words are drawn in 3D: names show on hover labels and in HTML.
4. **The year cuts to the market for its last two seconds.** `withMarket` appends a 2 s `market` beat and scales the
   office beats into the remaining 4 s, so the whole year still plays in at most 6 s (the cap step 4 set and the
   owner's play-test may change). Nothing plays under reduced motion, as before. While a year plays the view is the
   beat's (office beats in the office, the market beat in the market) and the switch is disabled; afterwards the view
   is the player's choice again. The new users stream in the market whenever it is shown with a new year, and once
   when the player switches to it; under reduced motion they stand at their buildings at once.
5. **Selecting a company** (section 10.3) works on any building that is in the market, the player's own included: it
   is highlighted and an HTML card over the canvas shows its public numbers (`marketCard`). Its button twin is a
   "Show in market" button on each rival's card in the rivals panel, given only in the career's 3D layout.
6. **One sound a year, chosen by importance,** when the year's summary opens (at once in 2D or under reduced motion,
   after the playback in 3D): going public, then the rescue, an office move, the launch, a new era, a platform shift
   announced, a rival out, a rival in; nothing for a year that ends the career (the ending's sting already plays when
   its report closes), nothing on reload, resume or "Last report". The market beat streams with the existing
   `users-trickle`. Footsteps and chairs come from the world's `WorldSoundListener`. All sounds are existing synthesised
   library sounds on the outcome and world buses, honoured by the Sound menu's mute and volume. Milestone sounds play in
   the 2D screens too: sound is not a 3D feature.
7. **More than 50 people:** a move that changes the plan but not the drawn shares says so on screen ("Moved in the
   plan. The office draws 50 of your 120 people, so nobody walks."), rather than moving a figure the shares would take
   back at the next scene.
8. **Draw calls:** static floor-plan décor and scene dressing that neither animates nor glows is merged into one mesh
   per material per office (the shell is already), which takes the full floor well under its ceiling before the future
   set arrives. The office ceiling stays `min(800, 80 + 14 × figures)`; the market has its own, 60.
9. **The timeline's code is not changed; its reading is pinned.** The owner's binding ruling, "the timeline shows eras
   and announced shifts only; crashes stay a surprise", is applied as: no dated card of a future year is ever shown
   except the announced platform shift (`careerTimeline.ts:112-125` already filters `card.year <= year` and gives the
   shift through `upcomingShift`); past dated cards and the career's milestones stay on it as history, as section 10.2
   asks. Task 11 pins this with a test over every year of the shipped career, and Task 13 writes it beside section 10.2
   as a dated note.

## Global Constraints

- **The race is unchanged.** `git diff --stat --diff-filter=a b0d38b0 -- ':(glob)src/**/*.test.ts' ':(glob)api/**/*.test.ts'`
  prints nothing (so `src/audio/*.test.ts`, `src/audio/testing/fakeAudio.ts`, `src/ui/viewModel.test.ts`,
  `src/ui/draft.test.ts`, `src/ui/format.test.ts` are not edited); `scripts/race-text.snapshot.json` is not edited and
  `raceText` still matches it. Every change to a shared screen hangs on `config.career !== undefined` or on a prop the
  race never passes; a race renders no new node, plays no new sound and never requests the 3D chunk.
- **The rules, the store and the save do not change.** No edit under `src/engine`, `src/ai`, `src/sim`, nor to
  `src/state/gameStore.ts`, `src/state/careerSave.ts`, `src/state/save.ts`, `src/state/shape.ts`, `src/config.ts`.
- **The fence holds** (`src/world/boundary.test.ts`): three only under `src/world`; `src/world` imports nothing from
  the rules, state, scene, ui, lab or config; `src/scene` takes only types from `src/world/types`; the one value import
  of `src/world` from `src/ui` stays inside `src/ui/components/CareerOffice.tsx` (lazy).
- **Only what is public about a rival is shown:** market and card data go through `publicCompany` / `publicReport`.
- **The 2D screens stay complete** and are the fallback for no WebGL, a failed load, a lost context or 3D off.
- **No new dependencies; no jsdom or testing-library; no `SFX` member added** (`src/audio/sfx.test.ts` pins its keys).
- **Desktop browsers only** (laid out for 1280×800); below 1024 px or without a fine pointer, today's 2D screens.
- **Redrawn only when something changes.** The market rests when its users have arrived.
- **Career text says years**, never "turn", "turns", "quarter", "quarterly" or `Q<n>`. Plain language. No real
  company, product or person in any text, sign or prop; no AI model names in code, docs or commits. An original
  game: no art, layout, sound or names from any other game; every prop and sound is built in code.
- TypeScript strict as configured; ESLint `--max-warnings=0`; component files export components only.
- Existing world, scene, ui and lab tests added after `b0d38b0` may be edited only where a task says so.
- Commits: at least one per task, message `area: sentence` as in `git log` (areas: `world`, `scene`, `ui`, `scripts`,
  `docs`), with the session's attribution lines added as a last `-m`. Branch `claude/trusting-ramanujan-gd0yok`.

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

1. **Skip, End, a narrowed window or a lost context during the market beat:** the summary opens exactly once, the
   view goes back to the player's choice (never stuck on the market with the switch disabled), and the milestone sound
   plays once. (Task 6: `withMarket` and `beatScenes` tables; Task 8: `viewNow` table; Task 10: `yearSoundFor` and the
   once-per-year guard `soundOnce`, keyed by run and year; Task 12 step 15: Skip pressed, the window narrowed below
   1024 px, and the context lost, each during the market beat.)
2. **A rival's private numbers never reach the market:** changing a rival's cash, plan or quality-in-progress leaves
   the market scene equal, and the card shows only public figures. (Task 5: "reads only what is public"; Task 8:
   `marketCard` table.)
3. **The race gets nothing new:** no sound, no "Show in market" button, no market, no new help section. (Task 10: a
   race year makes no sound; Task 11: `careerHelp(DESIGN)` is `[]`; Task 8: `RivalsPanel` without `onShow` renders as
   before, checked by Task 12 step 1's race-text snapshot.)
4. **Every era's office stays within its draw-call ceiling**, the future set on the full floor included, and the market
   within its own. (Task 4: merged dressing mesh counts; Task 12 steps 16 and 17: measured per era fixture and in the
   market.)
5. **Era looks that read alike, or a prop that faces the wall:** no two eras share a palette in any office, a resting
   light or a first signature prop, and every signature prop faces the camera. (Task 1: palette and light tests; Task 2:
   `facesCamera` over every office and era; Task 3: the future's two eras told apart.)

## File Structure

| Path | Responsibility |
|---|---|
| `src/world/types/scene.ts`, `src/world/core/colors.ts`, `src/world/core/Lighting.ts`, `src/world/office/props/workstations.ts`, `src/world/office/props/building.ts`, `src/world/office/shell.ts`, `src/world/office/DeskSlots.ts`, `src/world/office/props/signature.ts` | Eight era looks over furniture sets, signature rows re-keyed by era (Task 1) |
| `src/world/office/props/signature.ts`, `src/world/office/dressing.ts`, `src/world/office/layouts.ts` | Signature props of every era, facing the camera (Task 2) |
| `src/world/office/props/parts.ts`, `src/world/office/props/workstations.ts`, `src/world/office/props/signature.ts` | The invented future's furniture set and props; hardware that matches its set (Task 3) |
| `src/world/office/StageKit.ts`, `src/world/office/dressing.ts`, `src/world/office/props/stations.ts` | Static dressing merged; a calendar year you can read (Task 4) |
| `src/world/types/market.ts`, `src/scene/marketScene.ts` | Pure: the market scene from the game and last year's log (Task 5) |
| `src/scene/yearPlayback.ts`, `src/ui/officeView.ts` | The market beat and its caption (Task 6) |
| `src/world/types/interaction.ts`, `src/world/targets.ts`, `src/world/types/handle.ts`, `src/world/market/*`, `src/world/core/World.ts` | The market drawn by the world, a company target, the view switch (Task 7) |
| `src/ui/marketView.ts`, `src/ui/components/CareerOffice.tsx`, `src/ui/components/RivalsPanel.tsx`, `src/ui/officeProbe.ts`, `src/ui/screens/GameScreen.tsx` | The market on the career screen: switch, playback cut, selection, card, button twin (Task 8) |
| `src/world/cast.ts`, `src/ui/officeMoves.ts`, `src/ui/components/CareerOffice.tsx` | A move nobody walks for, said on screen (Task 9) |
| `src/ui/careerSound.ts`, `src/world/mountWorld.ts`, `src/world/WorldView.tsx`, `src/ui/screens/GameScreen.tsx` | Sound for milestones and the world's footsteps (Task 10) |
| `src/ui/careerHelp.ts`, `src/ui/careerTimeline.test.ts` | How to play the office, the market and the sound; the timeline's promise pinned (Task 11) |
| `scripts/career-check.mjs`, `scripts/office-check.mjs`, `scripts/career-fixtures.ts` | Browser checks, step by step (Task 12) |
| `README.md`, `docs/superpowers/specs/2026-11-25-career-3d-design.md`, `docs/career-rules.md`, `docs/superpowers/specs/3d-office-check.md`, `docs/superpowers/plans/2026-11-25-career-3d-office.md` | The documents, and the final review (Task 13) |

---

### Task 1: Eight era looks over furniture sets

**Files:**
- Modify: `src/world/types/scene.ts:17` (`LookId`, new `FurnitureSet`), `src/world/core/colors.ts:126-200` (`LOOKS`,
  `ERA_LOOKS`, `lookFor`, new `FURNITURE_SETS`, `furnitureOf`, `PHASE_THEMES` for nine looks),
  `src/world/core/Lighting.ts:18,99-130` (six new `LightingLook` moods and their `LightKey`s, `RESTING_LOOKS` for
  nine looks; `LightKey` exported as a type and a new `lightingKeyFor`),
  `src/world/office/props/signature.ts:28` (`SIGNATURE_PROPS` re-keyed by era with stand-in rows: dial-up and
  gold-rush take the old nineties row, bust, phones and cheap-money the noughties row, winter-ai, agents and ambient
  the twenties row; Tasks 2 and 3 replace them), `src/world/office/props/workstations.ts:38-105` (`DESK_STYLE_FOR_PHASE` and `monitorFor` keyed by set),
  `src/world/office/props/building.ts:64,274` (`FLOOR_STYLES`, `WALL_STYLE_FOR_PHASE` keyed by set),
  `src/world/office/shell.ts:135` (`SHELL_SPECS` keyed by set), every caller that passes a look to a set-keyed table
  (`DeskSlots.ts`, `shell.ts`, `building.ts` callers: pass `furnitureOf(kit.look)`), `scripts/office-check.mjs:55-63,794-808`
  (its copy of `ERA_LOOKS` becomes the identity on the eight era ids; step 5's table names the looks `dial-up`, `bust`,
  `winter-ai`)
- Test: `src/world/core/colors.test.ts` (its era table, l.7-9, is replaced), `src/world/core/Lighting.test.ts` (the
  resting-look test, l.364, is replaced), `src/world/office/props.test.ts` (the `monitorFor` test, l.343, is replaced),
  `src/scene/officeScene.test.ts` (the test at l.198 is replaced), `src/world/office/dressing.test.ts` (its `DECADES`
  constant becomes `ERA_LOOKS_ALL`, the eight era looks, over which its loops run; the three pinned plans of l.17-25
  name `"dial-up"`, `"bust"` and `"winter-ai"` for `"nineties"`, `"noughties"` and `"twenties"` and expect what they
  expected, since the stand-in rows are the old ones), `src/world/office/OfficeSystem.test.ts` (the test at l.631,
  "a year that crosses into another decade rebuilds the office in place; a year within it does not", is replaced as
  Step 1 shows)

**Interfaces:**
- Consumes: `lookFor`, `PHASE_THEMES`, `themeFor`, `restingLook`, `monitorFor`, `deskStyleFor`, `FLOOR_STYLES`,
  `WALL_STYLE_FOR_PHASE`, `SHELL_SPECS`, `StageKit.look`, `OfficeSystem`'s rebuild on `stage.look !== look`.
- Produces:
  ```ts
  // src/world/types/scene.ts
  export type LookId = "classic" | "dial-up" | "gold-rush" | "bust" | "phones" | "cheap-money" | "winter-ai" | "agents" | "ambient";
  export type FurnitureSet = "classic" | "nineties" | "noughties" | "twenties";   // "future" joins in Task 3
  // src/world/core/colors.ts
  export const LOOKS: readonly LookId[];              // classic, then the eight eras in time order
  export const ERA_LOOKS: Readonly<Record<string, LookId>>;   // frozen: each era id to the look of the same name
  export const lookFor: (era: string) => LookId;      // own keys only, else "classic"
  export const FURNITURE_SETS: readonly FurnitureSet[];
  export const furnitureOf: (look: LookId) => FurnitureSet;
  // src/world/core/Lighting.ts
  export type LightingLook = "morning" | "afternoon" | "dusk" | "night" | "sunrise" | "win" | "loss"
    | "noon" | "overcast" | "golden" | "studio" | "twilight" | "clear";
  export type { LightKey };                                         // the interface at l.18, now exported
  export const lightingKeyFor: (mood: LightingLook) => LightKey;   // LOOKS[mood]
  // src/world/office/props/signature.ts
  export const SIGNATURE_PROPS: Readonly<Record<Exclude<LookId, "classic">, readonly SignatureKind[]>>;  // keyed by era
  // src/world/office/props/workstations.ts
  export const DESK_STYLE_FOR_PHASE: Record<FurnitureSet, readonly DeskStyle[]>;
  export const deskStyleFor: (office: OfficeIndex, look?: LookId) => DeskStyle;   // reads furnitureOf(look)
  export const monitorFor: (style: DeskStyle, set: FurnitureSet) => MonitorKind;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// colors.test.ts, replacing the era table test
const ERAS = ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai", "agents", "ambient"] as const;
it("each era of the career has a look of its own", () => {
  expect(ERAS.map(lookFor)).toEqual([...ERAS]);
  expect(LOOKS).toEqual(["classic", ...ERAS]);
});
it("an era nobody has heard of keeps the classic look", () => {
  expect(["flat", "", "constructor", "__proto__", "classic", "nineties"].map(lookFor)).toEqual(Array(6).fill("classic"));
});
it("eight looks sit on four furniture sets, the decade's", () => {
  expect(ERAS.map(furnitureOf)).toEqual(["nineties", "nineties", "noughties", "noughties", "noughties", "twenties", "twenties", "twenties"]);
  expect(furnitureOf("classic")).toBe("classic");
  expect(FURNITURE_SETS).toEqual(["classic", "nineties", "noughties", "twenties"]);
});
// "every look has five themes, and no two looks dress the same office alike" and the classic-themes test stay as they
// are: they iterate LOOKS, so they now hold nine looks.

// Lighting.test.ts, replacing the resting-look test
it("each era rests in a light of its own, the same in all five offices", () => {
  expect(LOOKS.map((look) => restingLook(2, look))).toEqual(
    ["morning", "afternoon", "noon", "overcast", "clear", "golden", "sunrise", "studio", "twilight"]);
  // No two eras rest in one light, and none in the classic look's morning.
  const eras = LOOKS.filter((look) => look !== "classic").map((look) => restingLook(2, look));
  expect(new Set(eras).size).toBe(eras.length);
  expect(eras).not.toContain("morning");
  for (const look of LOOKS) expect(new Set(PHASES.map((office) => restingLook(office, look))).size).toBe(1);
});
it("lists every mood, and every mood is a light of its own", () => {
  expect(LIGHTING_LOOKS).toEqual(["morning", "afternoon", "dusk", "night", "sunrise", "win", "loss", "noon", "overcast", "golden", "studio", "twilight", "clear"]);
  // A light's key: sun colour, sun intensity and sky colour; no two moods share one.
  const text = (mood: LightingLook): string => {
    const k = lightingKeyFor(mood);
    return `${k.sunColor.getHexString()}:${k.sunIntensity}:${k.skyColor.getHexString()}`;
  };
  expect(new Set(LIGHTING_LOOKS.map(text)).size).toBe(LIGHTING_LOOKS.length);
  // The resting moods of the new eras are daylight: no prop glows in them but faintly at twilight.
  expect(["noon", "overcast", "golden", "studio", "clear"].map((m) => lightingKeyFor(m as LightingLook).dusk)).toEqual([0, 0, 0, 0, 0]);
  expect(lightingKeyFor("twilight").dusk).toBeLessThanOrEqual(0.3);
});

// OfficeSystem.test.ts, replacing "a year that crosses into another decade rebuilds the office in place; …"
it("every change of era rebuilds the office in place; a year within an era does not", () => {
  const world = new Harness();
  world.apply({ office: 2, capacity: 22, era: "bust", year: 2006 }, (seating) => seating.seat("product", 3));
  world.settle();
  const bust = world.system.currentStage!;
  expect(bust.look).toBe("bust");
  world.apply({ era: "phones", year: 2007 });        // bust → phones, the same decade: a new stage all the same
  const phones = world.system.currentStage!;
  expect(phones).not.toBe(bust);
  expect(phones.look).toBe("phones");
  world.settle();
  world.apply({ year: 2008 });                       // the same era: the same stage
  expect(world.system.currentStage).toBe(phones);
  world.settle();
  world.apply({ era: "cheap-money", year: 2014 });   // a new era: a new stage in the same office
  const cheap = world.system.currentStage!;
  expect(cheap).not.toBe(phones);
  expect(cheap.look).toBe("cheap-money");
  expect(cheap.office).toBe(2);
  // The old office sinks away while the new one rises in the same place.
  const root = world.scene.children[0];
  expect(root.children).toEqual([phones.root, cheap.root]);
  world.run(0.2);
  expect(phones.root.position.y).toBeLessThan(0);
  world.settle();
  expect(root.children).toEqual([cheap.root]);
  expect(world.freeDesks()).toEqual(world.seating!.freeDeskSlots());
});

// props.test.ts, replacing the monitorFor test
it("each furniture set puts its decade's computer on every desk", () => {
  expect(DESK_STYLES.map((style) => monitorFor(style, "classic"))).toEqual(["crt", "laptop", "flat", "wide", "flat"]);
  expect(DESK_STYLES.map((style) => monitorFor(style, "nineties"))).toEqual(Array(5).fill("crt"));
  expect(DESK_STYLES.map((style) => monitorFor(style, "noughties"))).toEqual(["flat", "flat", "flat", "wide", "wide"]);
  expect(DESK_STYLES.map((style) => monitorFor(style, "twenties"))).toEqual(Array(5).fill("laptop"));
});

// src/scene/officeScene.test.ts, replacing "every era of the shipped career has a look of its own, by decade"
it("every era of the shipped career has the look of its own name", () => {
  for (const era of CAREER.career!.eras) expect(lookFor(era.id)).toBe(era.id);
  const lookIn = (year: number) =>
    lookFor(sceneOf(atTurn(createGame(newGameSetup(1, "Acme"), CAREER), year - 1990 + 1), 0, { config: CAREER }).era);
  expect([1994, 1995, 2006, 2007, 2014, 2022, 2027, 2033].map(lookIn)).toEqual(
    ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai", "agents", "ambient"]);
});
```

(`sceneOf` and the imports are the ones the replaced test already uses.)

- [ ] **Step 2: Run them.** `npx vitest run src/world/core src/world/office src/scene` — Expected: FAIL (`lookFor("bust")`
  is "noughties"; `furnitureOf` is not exported; `LIGHTING_LOOKS` has seven moods).
- [ ] **Step 3: Implement the looks.** `LOOKS`, `ERA_LOOKS` and `lookFor` as pinned. `FURNITURE_OF` (private) and
  `furnitureOf` as pinned. `PHASE_THEMES` gets one entry per era (the builder's colours; the existing nineties palette
  goes to dial-up, noughties to bust, twenties to winter-ai, and each other era gets its own, within the distinctness
  test: gold-rush brighter primaries on the same beige, phones white gloss and silver, cheap-money warm wood and coral,
  agents cool white and mint, ambient soft sand and violet). The six new moods get `LightKey`s of their own, with
  `key(sunColor, sunIntensity, sunDirection, skyColor, groundColor, hemiIntensity, fillIntensity, dusk)` as at
  `Lighting.ts:30` (`dusk` drives `duskAmount` and so every prop's `setGlow`, hence 0 by day):
  ```ts
  const NOON = key(0xffffff, 1.85, [-0.15, 1, 0.3], 0xe6f0ff, 0xb8b2aa, 1.35, 1.1, 0);      // high white sun
  const OVERCAST = key(0xdfe6f0, 1.2, [-0.2, 1, 0.5], 0xd0d8e4, 0xa8aab0, 1.55, 1.2, 0);    // grey-blue, low contrast
  const GOLDEN = key(0xffd08a, 1.75, [0.2, 0.62, 0.95], 0xf6e6d2, 0x9c8468, 1.1, 0.9, 0);   // warm late sun
  const STUDIO = key(0xf2f6ff, 1.6, [-0.25, 1, 0.55], 0xeef3ff, 0xc2c6cc, 1.45, 1.2, 0);    // even cool white
  const TWILIGHT = key(0xffc49a, 1.4, [0.25, 0.5, 1], 0xc8b8f0, 0x5c5070, 1.0, 0.7, 0.3);   // violet sky, low warm sun
  const CLEAR = key(0xffffff, 1.95, [-0.35, 1, 0.4], 0xb9d6ff, 0xc4c8cc, 1.2, 1.15, 0);     // a clear blue day (phones)
  ```
  If an existing brightness test over the resting looks fails for one of them, change that key's intensities, not the
  test. `SIGNATURE_PROPS` takes the stand-in rows the Files line names (types only change; no new kind yet).
  Every table keyed by set (`DESK_STYLE_FOR_PHASE`, `FLOOR_STYLES`,
  `WALL_STYLE_FOR_PHASE`, `SHELL_SPECS`) moves from `Record<LookId, …>` to `Record<FurnitureSet, …>` with the values
  the old look of the same decade had; callers pass `furnitureOf(look)`. Model cache keys that include the look keep it
  (a look is now an era, so the keys stay distinct). `scripts/office-check.mjs` takes the new `ERA_LOOKS` as said above.
- [ ] **Step 4: Run the tests, then the checks, then** `node scripts/office-check.mjs --only 5` — Expected: PASS; the
  step prints the looks `dial-up`, `bust` and `winter-ai`.
- [ ] **Step 5: Commit**

```bash
git add src/world src/scene scripts/office-check.mjs
git commit -m "world: each of the eight eras has a look of its own, laid over its decade's furniture"
```

---

### Task 2: Signature props of every era, facing the camera

**Files:**
- Modify: `src/world/office/props/signature.ts` (six new kinds; the rows of the first six eras replaced; `agents`
  and `ambient` keep Task 1's stand-in twenties row of existing kinds until Task 3; `software-shelf` and `foosball`
  resized), `src/world/office/props/catalog.ts` (the new kinds join the catalog, so the mesh-budget, cache and dispose tests cover
  them), `src/world/office/dressing.ts` (export `facesCamera`), `src/world/office/layouts.ts:218` and any other décor
  spot that a signature prop takes while facing away (moved to a wall the camera sees)
- Test: `src/world/office/dressing.test.ts` (Task 1's three pinned plans are replaced by the table below; the loops
  keep running over Task 1's `ERA_LOOKS_ALL`, all eight eras), `src/world/office/props.test.ts` (new test only)

**Interfaces:**
- Consumes: `signaturePlan(decor, look)`, `REPLACEABLE_DECOR`, `decorSize`, `getLayoutDecor`, `CAMERA_AZIMUTH`
  (`src/world/core/CameraRig.ts:6`), `createSignatureProp(kind, size, variant)`.
- Produces:
  ```ts
  // src/world/office/props/signature.ts
  export type SignatureKind = /* the nine of today */ | "dot-printer" | "pinball" | "box-stack" | "charging-kiosk" | "drinks-fridge" | "compute-cabinet";
  export const SIGNATURE_PROPS: Readonly<Record<Exclude<LookId, "classic">, readonly SignatureKind[]>>;
  export const SIGNATURE_SIZES: Readonly<Record<SignatureKind, FootprintSize>>;
  // src/world/office/dressing.ts
  /** A spot facing `facing` (front +Z turned by it) shows its front to the camera. */
  export const facesCamera: (facing: number) => boolean;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// dressing.test.ts (ERA_LOOKS_ALL is Task 1's eight; OWN_ROWS the eras whose rows are final: Task 3 adds agents, ambient)
const OWN_ROWS = ["dial-up", "gold-rush", "bust", "phones", "cheap-money", "winter-ai"] as const;
it("each era has three props, the first its own", () => {
  expect(SIGNATURE_PROPS["dial-up"]).toEqual(["fax-machine", "dot-printer", "tube-tv"]);
  expect(SIGNATURE_PROPS["gold-rush"]).toEqual(["software-shelf", "pinball", "tube-tv"]);
  expect(SIGNATURE_PROPS.bust).toEqual(["box-stack", "fax-machine", "flat-tv"]);
  expect(SIGNATURE_PROPS.phones).toEqual(["charging-kiosk", "flat-tv", "beanbag"]);
  expect(SIGNATURE_PROPS["cheap-money"]).toEqual(["foosball", "drinks-fridge", "scooter"]);
  expect(SIGNATURE_PROPS["winter-ai"]).toEqual(["compute-cabinet", "plant-wall", "ring-light"]);
  const firsts = OWN_ROWS.map((look) => SIGNATURE_PROPS[look][0]);
  expect(new Set(firsts).size).toBe(firsts.length);
});
it("the two tightest offices stand the props this table says (index into the office's décor, then kind)", () => {
  // garage: 0 filing cabinet 0.46 × 0.6, 1 boxes 1.0 × 0.6. shared office: 0 large plant 0.8 × 0.8,
  // 1 water cooler 0.45 × 0.4, 3 plant 0.55 × 0.55. Measured with signaturePlan over the real layouts and these sizes.
  const plans: Record<(typeof OWN_ROWS)[number], [unknown, unknown]> = {
    "dial-up": [[[0, "fax-machine"], [1, "dot-printer"]], [[1, "fax-machine"], [3, "dot-printer"], [0, "tube-tv"]]],
    "gold-rush": [[[1, "software-shelf"], [0, "pinball"]], [[0, "software-shelf"], [3, "pinball"]]],
    bust: [[[1, "box-stack"], [0, "fax-machine"]], [[3, "box-stack"], [1, "fax-machine"], [0, "flat-tv"]]],
    phones: [[[0, "charging-kiosk"], [1, "flat-tv"]], [[1, "charging-kiosk"], [0, "flat-tv"], [3, "beanbag"]]],
    "cheap-money": [[[1, "foosball"], [0, "drinks-fridge"]], [[0, "foosball"], [3, "drinks-fridge"]]],
    "winter-ai": [[[1, "compute-cabinet"], [0, "ring-light"]], [[0, "compute-cabinet"], [1, "ring-light"]]],
  };
  for (const look of OWN_ROWS) {
    expect([...signaturePlan(kinds(0), look)], `garage ${look}`).toEqual(plans[look][0]);
    expect([...signaturePlan(kinds(1), look)], `shared ${look}`).toEqual(plans[look][1]);
  }
});
it("every era's first prop shows in every office", () => {
  for (const office of PHASES) for (const look of OWN_ROWS)
    expect([...signaturePlan(kinds(office), look).values()], `office ${office} ${look}`).toContain(SIGNATURE_PROPS[look][0]);
});
it("faces the camera: the front of a spot turned toward +X+Z is seen, one toward the back walls is not", () => {
  expect([0, Math.PI / 2, Math.PI / 4].map(facesCamera)).toEqual([true, true, true]);
  expect([Math.PI, -Math.PI / 2, (-3 * Math.PI) / 4].map(facesCamera)).toEqual([false, false, false]);
});
it("every signature prop in every office of every era faces the camera", () => {
  for (const office of PHASES) for (const look of ERA_LOOKS_ALL) for (const index of signaturePlan(kinds(office), look).keys())
    expect(facesCamera(kinds(office)[index].facing ?? 0), `office ${office} ${look} spot ${index}`).toBe(true);
});
// The existing tests ("never stands in for…", "every office of every decade shows at least two…, each once, and classic
// none", "a signature prop stands only where it has room…") keep looping over ERA_LOOKS_ALL, as Task 1 left them.

// props.test.ts
it("builds every signature prop in the spot it needs, within one mesh", () => {
  for (const kind of Object.keys(SIGNATURE_SIZES) as SignatureKind[]) {
    const prop = createSignatureProp(kind, SIGNATURE_SIZES[kind], 0);
    const meshes: THREE.Mesh[] = [];
    prop.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length, kind).toBe(1);
    prop.dispose();
  }
});
```

(`kinds(office)` is the file's helper; a `DecorSpot`'s yaw field is the one `layouts.ts`'s `decor(...)` fills, named
`facing` above; use its real name.)

- [ ] **Step 2: Run them.** `npx vitest run src/world/office` — Expected: FAIL (the era rows are still Task 1's stand-ins;
  `facesCamera` is not exported; the garage's boxes spot faces −X).
- [ ] **Step 3: Implement.** `facesCamera(f)` is `Math.sin(f) * Math.sin(CAMERA_AZIMUTH) + Math.cos(f) * Math.cos(CAMERA_AZIMUTH) > 0`.
  The six new props are drawn like the existing ones (one baked mesh, front +Z, inside the size given, no words, no
  real product's shape): a dot-matrix printer on a trolley with a paper fold; an upright pinball cabinet with lit
  bumpers as plain coloured boxes; a stack of moving boxes taped shut; a kiosk of charging cables and slots; a glass
  drinks fridge; a cabinet of compute boards with a row of status lights (painted, not lit: one mesh, no `setGlow`).
  `SIGNATURE_SIZES` for them: dot-printer 0.5 × 0.4, pinball 0.45 × 0.45 (a narrow upright), box-stack 0.5 × 0.4,
  charging-kiosk 0.4 × 0.4, drinks-fridge 0.45 × 0.45, compute-cabinet 0.6 × 0.5; and two existing kinds shrink so
  the shared office's 0.8 × 0.8 spot takes them: software-shelf 0.8 × 0.3, foosball 0.8 × 0.5 (their drawings already
  fill the size given). Move the garage's boxes (`layouts.ts:218`, facing −X) to a spot of the same size on a wall the
  camera sees, keeping `layouts.test.ts` green; no other spot needs moving (every other replaceable spot faces +Z or
  +X). If a pinned plan differs from the table, the sizes or the spot are wrong: fix them, not the table.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/world/office
git commit -m "world: every era stands three props of its own in the office, each facing the camera"
```

---

### Task 3: The invented future's furniture, and hardware that matches its set

**Files:**
- Modify: `src/world/types/scene.ts` (`FurnitureSet` gains `"future"`), `src/world/core/colors.ts` (`furnitureOf`:
  agents and ambient to `"future"`), `src/world/office/props/parts.ts:115` (`MonitorKind` gains `"glass"`, with its
  size and drawing), `src/world/office/props/workstations.ts:133-230,346` (`deskHardware`; `drawBody` and
  `drawHardware` take the set), `src/world/office/props/building.ts` and `src/world/office/shell.ts` (future floor,
  walls, shell), `src/world/office/props/signature.ts` (five future kinds; `agents` and `ambient` rows)
- Test: `src/world/core/colors.test.ts` (the set test of Task 1 is updated), `src/world/office/props.test.ts`,
  `src/world/office/dressing.test.ts` (`OWN_ROWS` becomes `ERA_LOOKS_ALL`, so Task 2's first-prop, uniqueness and
  table tests cover all eight; the table gains the two rows below)

**Interfaces:**
- Consumes: Task 1's `FurnitureSet`, `furnitureOf`, `monitorFor`; Task 2's `SIGNATURE_PROPS`, `facesCamera`.
- Produces:
  ```ts
  export type FurnitureSet = "classic" | "nineties" | "noughties" | "twenties" | "future";
  export type MonitorKind = "flat" | "wide" | "crt" | "laptop" | "glass";
  // src/world/office/props/workstations.ts
  export interface DeskHardware {
    readonly tower: boolean;                                   // a computer case under the desk
    readonly keyboard: "beige" | "dark" | "pad" | "none";
    readonly laptopStand: boolean;
  }
  export const deskHardware: (style: DeskStyle, set: FurnitureSet) => DeskHardware;
  // signature.ts: SignatureKind gains "robot-dock" | "holo-table" | "home-robot" | "glasses-stand" | "light-column"
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// colors.test.ts (Task 1's set test, updated)
expect(ERAS.map(furnitureOf)).toEqual(["nineties", "nineties", "noughties", "noughties", "noughties", "twenties", "future", "future"]);
expect(FURNITURE_SETS).toEqual(["classic", "nineties", "noughties", "twenties", "future"]);

// props.test.ts
it("the future puts a glass screen on every desk", () => {
  expect(DESK_STYLES.map((style) => monitorFor(style, "future"))).toEqual(Array(5).fill("glass"));
});
it("the hardware on a desk belongs to the computer on it", () => {
  for (const set of FURNITURE_SETS) for (const style of DESK_STYLES) {
    const monitor = monitorFor(style, set);
    const kit = deskHardware(style, set);
    expect(kit.tower, `${style} ${set}`).toBe(monitor === "crt");
    expect(kit.laptopStand, `${style} ${set}`).toBe(monitor === "laptop" && style === "hotdesk");
    expect(kit.keyboard, `${style} ${set}`).toBe(
      monitor === "crt" ? "beige" : monitor === "glass" ? "pad" : monitor === "laptop" ? "none" : "dark");
  }
});
it("gives every office of every furniture set a desk style, a floor and walls", () => {
  for (const look of LOOKS) for (const office of PHASES) {
    expect(DESK_STYLES).toContain(deskStyleFor(office, look));
    expect(() => createFloor(4, 4, office, look).dispose()).not.toThrow();
  }
});
// The existing "no cache-key collisions" desk test iterates LOOKS and so now covers the future set too.

// dressing.test.ts
it("the two invented eras stand props of their own", () => {
  expect(SIGNATURE_PROPS.agents).toEqual(["robot-dock", "holo-table", "plant-wall"]);
  expect(SIGNATURE_PROPS.ambient).toEqual(["home-robot", "glasses-stand", "light-column"]);
  expect(SIGNATURE_PROPS.ambient.filter((kind) => SIGNATURE_PROPS.agents.includes(kind))).toEqual([]);
});
// Task 2's table gains (garage, then shared office):
//   agents:  [[0, "robot-dock"], [1, "holo-table"]],  [[3, "robot-dock"], [0, "holo-table"]]
//   ambient: [[0, "home-robot"], [1, "glasses-stand"]], [[3, "home-robot"], [1, "glasses-stand"], [0, "light-column"]]
// With OWN_ROWS gone, Task 2's room, facing, at-least-two, first-prop and one-mesh tests cover them.
```

(If `createFloor`'s last parameter is a set rather than a look after Task 1, pass `furnitureOf(look)`.)

- [ ] **Step 2: Run them.** `npx vitest run src/world` — Expected: FAIL (no `"future"` set; `deskHardware` missing;
  the garage desk's beige tower stands under a laptop in the twenties).
- [ ] **Step 3: Implement.** The future set: `monitorFor(_, "future")` is `"glass"` (a thin pane floating over a slim
  stand, faintly lit); `DESK_STYLE_FOR_PHASE.future` equal to the twenties'; a future floor (pale resin with inlaid
  light lines) and walls; `SHELL_SPECS.future` equal to the twenties'. `deskHardware` as the second test pins;
  `drawBody` draws the tower only when `tower`, `drawHardware` the keyboard kind and the laptop stand only as given.
  The five future props, one baked mesh each, invented (nothing shaped after a real product): a charging dock with two
  small wheeled robots; a round table with a lit top and floating panels; a short rounded home robot; a stand of
  glasses on hooks; a column of soft light rings (painted bright, not lit: one mesh, no `setGlow`, like every
  signature prop). Sizes: robot-dock 0.45 × 0.45, holo-table 0.8 × 0.5, home-robot 0.45 × 0.45, glasses-stand
  0.4 × 0.4, light-column 0.4 × 0.4.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/world
git commit -m "world: the invented future gets a furniture set of its own, and every desk's hardware matches its computer"
```

---

### Task 4: Fewer draw calls, and a calendar year you can read

**Files:**
- Modify: `src/world/office/StageKit.ts` (a `statics` group under `contents`, one entrance; `placeStatic`,
  `mergeStatics`), `src/world/office/dressing.ts:377-385` and `Dresser.put` (props with neither `update` nor
  `setGlow` go through `placeStatic`; `dressOffice` ends with `kit.mergeStatics()`), `src/world/office/OfficeStage.ts`
  (the merged geometry is disposed with the stage), `src/world/office/props/stations.ts:796-920` (`calendarPage`,
  `yearDisplayWidth`; `createWallCalendar` and `addYearDisplay` use them)
- Test: `src/world/office/statics.test.ts` (create), `src/world/office/props.test.ts` (new tests only)

**Interfaces:**
- Consumes: `mergeStaticChildren(parent, keep)` (`src/world/office/mergeStatic.ts:40`), `PropHandle.update?`,
  `PropHandle.setGlow?`, `getOfficeLayout`, `FOOTPRINTS` calendar widths 0.8, 0.9, 1.0, 1.2, 1.2.
- Produces:
  ```ts
  // src/world/office/StageKit.ts
  readonly statics: THREE.Group;
  placeStatic<T extends PropHandle>(handle: T, spot: Spot): T;   // a prop that never moves, glows or is pointed at
  mergeStatics(): void;                                           // once, after dressing; idempotent
  // src/world/office/props/stations.ts
  export const yearDisplayWidth: (digitHeight: number) => number;   // 4 digits at addYearDisplay's pitch: 2.95 × h
  export const calendarPage: (width: number) => { readonly pageW: number; readonly pageH: number; readonly digitH: number };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// statics.test.ts
import * as THREE from "three";
import { afterEach, expect, it } from "vitest";
import { disposeSharedResources, LOOKS, PHASES } from "../core/palette";
import { dressOffice } from "./dressing";
import { getOfficeLayout } from "./layouts";
import { StageKit } from "./StageKit";

const meshesUnder = (root: THREE.Object3D): number => {
  let count = 0;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) count += 1; });
  return count;
};
afterEach(() => disposeSharedResources());

it("dresses each office with its still things merged: the full floor in at most 20 meshes in every look", () => {
  for (const look of LOOKS) for (const office of PHASES) {
    const kit = new StageKit(getOfficeLayout(office), look);
    dressOffice(kit);
    const drawn = meshesUnder(kit.contents);
    if (office === 3) expect(drawn, `${look}`).toBeLessThanOrEqual(20);
    expect(meshesUnder(kit.statics), `${look} ${office}`).toBeLessThanOrEqual(12);
    kit.dispose();
  }
});
const under = (object: THREE.Object3D, ancestor: THREE.Object3D): boolean => {
  for (let o = object.parent; o !== null; o = o.parent) if (o === ancestor) return true;
  return false;
};
it("leaves every prop that animates or glows where it was, and pops the still ones in as one", () => {
  const kit = new StageKit(getOfficeLayout(3), "winter-ai");
  // Record every handle the dressing places, by the way it was placed.
  const moving: PropHandle[] = [];
  const still: PropHandle[] = [];
  const place = kit.place.bind(kit);
  const placeStatic = kit.placeStatic.bind(kit);
  kit.place = (handle, spot) => { moving.push(handle); return place(handle, spot); };
  kit.placeStatic = (handle, spot) => { still.push(handle); return placeStatic(handle, spot); };
  dressOffice(kit);
  expect(still.length).toBeGreaterThan(0);
  for (const handle of [...moving, ...still]) {
    const lives = handle.update !== undefined || handle.setGlow !== undefined;
    if (lives) {
      expect(under(handle.group, kit.contents), handle.group.name).toBe(true);
      expect(under(handle.group, kit.statics), handle.group.name).toBe(false);
    } else {
      // A still prop went through placeStatic and its meshes now live in the merged group, not in the scene.
      expect(still).toContain(handle);
      expect(under(handle.group, kit.root), handle.group.name).toBe(false);
    }
  }
  expect(still.map((handle) => handle.group.name)).toContain("ping-pong");   // office 3's ping-pong table is still
  expect(kit.statics.children.every((child) => (child as THREE.Mesh).isMesh || child.name === "merged")).toBe(true);
  expect(kit.entrances.filter((entrance) => entrance === kit.statics)).toHaveLength(1);
  const merged = meshesUnder(kit.statics);
  kit.mergeStatics();   // a second call changes nothing
  expect(meshesUnder(kit.statics)).toBe(merged);
  expect(kit.entrances.filter((entrance) => entrance === kit.statics)).toHaveLength(1);
  kit.dispose();
});
// (`createPingPongTable` (decor.ts:462) names its group "ping-pong" and has neither update nor setGlow. If
// `mergeStaticChildren` names its output otherwise than "merged", use its name. Import `PropHandle` from
// "./props/shared".)

// props.test.ts
it("draws the calendar's year at least 0.18 tall, and fits it across the page, in every office", () => {
  for (const width of [0.8, 0.9, 1.0, 1.2, 1.2]) {
    const { pageW, digitH } = calendarPage(width);
    expect(digitH).toBeGreaterThanOrEqual(0.18);
    expect(yearDisplayWidth(digitH)).toBeLessThanOrEqual(pageW - 0.04 + 1e-9);
    // A calendar of 1.0 or more keeps room for its day-dots beside the page (right edge pageW/2 + 0.17).
    expect(pageW).toBeLessThanOrEqual((width >= 1.0 ? width - 0.36 : width - 0.12) + 1e-9);
  }
  expect(yearDisplayWidth(0.2)).toBeCloseTo(0.59);
});
```

(Measured before this task, the full floor's dressing is 41 meshes in every look, each also drawn in the shadow pass.)

- [ ] **Step 2: Run them.** `npx vitest run src/world/office` — Expected: FAIL (`statics` and `calendarPage` missing).
- [ ] **Step 3: Implement.** `placeStatic` positions the prop and adds it under `statics` (the prop stays owned by
  `kit.props`, so disposal is unchanged); the first `placeStatic` makes `statics` an entrance. `mergeStatics` calls
  `mergeStaticChildren(this.statics, new Set())` once and keeps the result to dispose with the kit. `Dresser.put` and
  the décor loop use `placeStatic` when the handle has no `update` and no `setGlow`, `place` otherwise (every
  signature prop is one mesh without `setGlow`, so all of them merge). The calendar page fills its footprint
  (`pageW = width − 0.12` below 1.0 wide; `pageW = min(1.0, width − 0.36)` from 1.0, so the day-dots at
  `pageW/2 + 0.14` (`stations.ts:889-893`) stay inside the station test's slack; `pageH = pageW × 1.2` as now), and the
  year's digits take `digitH = (pageW − 0.04) / 2.95`, capped at `pageH × 0.3` (0.217, 0.251, 0.203 and 0.271 for
  widths 0.8, 0.9, 1.0 and 1.2); the header, rings and tear-off sit around it as now; "fits every station of every
  office…" (`props.test.ts:451`) stays green unedited. If the
  20-mesh bound cannot be met without merging something that moves, stop and report the counts.
- [ ] **Step 4: Run the tests, then the checks, then** `node scripts/office-check.mjs --only 2,5` — Expected: PASS;
  the twenties full floor's draw calls printed are well under its ceiling (it was 360 of 360).
- [ ] **Step 5: Commit**

```bash
git add src/world/office
git commit -m "world: the office's still furniture is drawn in a few merged meshes, and the calendar's year is large enough to read"
```

---

### Task 5: The market scene

**Files:**
- Create: `src/world/types/market.ts` (re-exported by `src/world/types.ts`), `src/scene/marketScene.ts`,
  `src/scene/marketScene.test.ts`

**Interfaces:**
- Consumes: `publicCompany(company)`, `publicReport(report)` (`src/engine/view.ts:12,55`), `rulesForTurn(config,
  turn).ipo.users`, `eraIndexOf(turn, career)`, `yearOf(turn, career)`, `TurnLog.market.pool`, `TurnLog.companies`;
  test kits `newCareer`, `CAREER_TEST`, `withCareerOf` (`src/engine/careerKit.ts`), `resolve`, `withCompany`
  (`src/engine/testKit.ts`).
- Produces:
  ```ts
  // src/world/types/market.ts (imports nothing)
  export type WorldViewKind = "office" | "market";
  export type MarketSeatState = "player" | "rival" | "out";
  export interface MarketCompany {
    readonly seat: number;          // 0 is the player
    readonly name: string;
    readonly state: MarketSeatState;
    readonly users: number;
    /** Building height on the market's scale, 0 to 1; 0 for a company that is out. */
    readonly height: number;
    /** Share of last year's new users this company won, 0 to 1. */
    readonly won: number;
    readonly listed: boolean;
    /** Founded this year in a seat another company left. */
    readonly newcomer: boolean;
  }
  export interface MarketScene {
    readonly runId: string;
    readonly year: number;
    readonly era: string;
    readonly barUsers: number;
    /** The bar for going public on the same scale as `height`. */
    readonly bar: number;
    /** Last year's new users shared out (the log's pool); 0 before any year was played. */
    readonly pool: number;
    readonly companies: readonly MarketCompany[];   // seat order
  }
  // src/scene/marketScene.ts
  export interface MarketSceneInput { readonly game: GameState; readonly log: TurnLog | null; readonly config: RulesConfig; readonly seed: number }
  export const MIN_HEIGHT = 0.04;
  export const marketTop: (barUsers: number, users: readonly number[]) => number;    // max(1.25 × bar, most users, 1)
  export const marketHeight: (users: number, top: number) => number;                 // 0 for ≤ 0, else max(MIN_HEIGHT, sqrt(users / top))
  export const marketSceneFor: (input: MarketSceneInput) => MarketScene;            // throws without a career, like officeSceneFor
  export const sameMarketScene: (a: MarketScene, b: MarketScene) => boolean;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { CAREER_TEST, newCareer, withCareerOf } from "../engine/careerKit";
import { resolve, withCompany } from "../engine/testKit";
import { rulesForTurn } from "../engine/index";
import { DESIGN } from "../config.design";
import { marketHeight, marketSceneFor, marketTop, MIN_HEIGHT, sameMarketScene } from "./marketScene";

const seed = 7;
const played = () => resolve(newCareer(), {}, 1, CAREER_TEST);

describe("the market", () => {
  it("sizes buildings by the square root of users, on one scale with the bar", () => {
    expect(marketTop(100, [10, 20, 200, 0])).toBe(200);
    expect(marketTop(100, [10, 20, 30, 0])).toBe(125);
    expect(marketTop(0, [0, 0, 0, 0])).toBe(1);
    expect(marketHeight(0, 125)).toBe(0);
    expect(marketHeight(1, 1_000_000)).toBe(MIN_HEIGHT);
    expect(marketHeight(125, 125)).toBe(1);
    expect(marketHeight(50, 200)).toBeCloseTo(0.5);
  });

  it("shows the four seats in order, the player first, with the year, the era and the bar", () => {
    const { state, log } = played();
    const scene = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    expect(scene.companies.map((c) => c.seat)).toEqual([0, 1, 2, 3]);
    expect(scene.companies.map((c) => c.state)).toEqual(["player", "rival", "rival", "rival"]);
    expect(scene.companies.map((c) => c.name)).toEqual(state.companies.map((c) => c.name));
    expect(scene.barUsers).toBe(rulesForTurn(CAREER_TEST, state.turn).ipo.users);
    const top = marketTop(scene.barUsers, state.companies.map((c) => c.users));
    expect(scene.bar).toBeCloseTo(Math.sqrt(scene.barUsers / top));
    expect(scene.pool).toBe(log.market.pool);
    expect(scene.runId).toBe(`${seed}:0:${state.companies[0].career!.founded}`);
  });

  it("gives each company its share of last year's new users, and none before a year was played", () => {
    const { state, log } = played();
    const scene = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    log.companies.forEach((report, seat) => {
      const won = report === null || log.market.pool === 0 ? 0 : report.users.won / log.market.pool;
      expect(scene.companies[seat].won).toBeCloseTo(won);
    });
    expect(marketSceneFor({ game: state, log: null, config: CAREER_TEST, seed }).companies.map((c) => c.won)).toEqual([0, 0, 0, 0]);
  });

  it("marks a public company, a newcomer, and leaves an out company an empty lot", () => {
    const { state, log } = played();
    let game = withCareerOf(state, 1, { listed: { turn: 1, valuation: 1, amount: 1 } });
    game = withCompany(game, 2, { out: { turn: 1, reason: "bankrupt", users: 0, headcount: 0 } });
    game = withCareerOf(game, 3, { founded: game.turn });
    const scene = marketSceneFor({ game, log, config: CAREER_TEST, seed });
    expect(scene.companies[1].listed).toBe(true);
    expect([scene.companies[2].state, scene.companies[2].height]).toEqual(["out", 0]);
    expect(scene.companies[3].newcomer).toBe(true);
    expect(scene.companies[0].newcomer).toBe(false);
  });

  it("reads only what is public about a rival", () => {
    const { state, log } = played();
    const before = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    const richer = withCompany(state, 2, { cash: state.companies[2].cash * 10 + 1 });
    expect(sameMarketScene(before, marketSceneFor({ game: richer, log, config: CAREER_TEST, seed }))).toBe(true);
  });

  it("is the same scene for the same inputs, and another for another year", () => {
    const { state, log } = played();
    const a = marketSceneFor({ game: state, log, config: CAREER_TEST, seed });
    expect(sameMarketScene(a, marketSceneFor({ game: state, log, config: CAREER_TEST, seed }))).toBe(true);
    expect(sameMarketScene(a, marketSceneFor({ game: { ...state, turn: state.turn + 1 }, log, config: CAREER_TEST, seed }))).toBe(false);
  });

  it("needs a career", () => {
    const { state, log } = resolve(newCareer(), {}, 1, CAREER_TEST);
    expect(() => marketSceneFor({ game: state, log, config: DESIGN, seed })).toThrow();
  });
});
```

(If `Exit`'s or `Listing`'s fields differ from those written, use the real ones from `src/engine/types.ts`.)

- [ ] **Step 2: Run them.** `npx vitest run src/scene/marketScene.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `marketSceneFor`** through `publicCompany` for every seat and `publicReport` for every report
  of the log; `listed` from `career.listed !== null`; `newcomer` when `career.founded` is this year's turn and greater
  than 1; `state` "out" when `out !== null`, else "player" for seat 0 and "rival" otherwise. `sameMarketScene` compares
  every field, the companies field by field. Nothing from `src/world` but `import type`.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; the boundary test still passes.
- [ ] **Step 5: Commit**

```bash
git add src/world/types src/world/types.ts src/scene/marketScene.ts src/scene/marketScene.test.ts
git commit -m "scene: the market as data: four buildings sized by users, last year's new users and the bar for going public"
```

---

### Task 6: The year cuts to the market

**Files:**
- Modify: `src/scene/yearPlayback.ts` (`BeatKind` gains `"market"`; `BEAT_SECONDS` gains `market: 2`;
  `MARKET_BEAT_SECONDS`, `withMarket`; the market case in `beatScenes`), `src/ui/officeView.ts:118` (`beatLine` for the market beat)
- Test: `src/scene/yearPlayback.test.ts`, `src/ui/officeView.test.ts` (new tests only)

**Interfaces:**
- Consumes: `yearPlayback`, `beatScenes`, `playedOut`, `MAX_PLAYBACK_SECONDS`, `NO_PLAYBACK`.
- Produces:
  ```ts
  export type BeatKind = "leave" | "move" | "arrive" | "year" | "market";
  export const BEAT_SECONDS: Readonly<Record<BeatKind, number>>;   // gains market: 2 (yearPlayback.ts:28)
  export const MARKET_BEAT_SECONDS = BEAT_SECONDS.market;
  /** The office's beats scaled into what MARKET_BEAT_SECONDS leaves of MAX_PLAYBACK_SECONDS, then the market's.
   *  No playback stays none. */
  export const withMarket: (playback: YearPlayback) => YearPlayback;
  // beatLine({ kind: "market", ... }) === "Where the year's new users went"
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// yearPlayback.test.ts
const report = /* the file's report helper */;
it("a quiet year then cuts to the market for two seconds", () => {
  const out = withMarket(yearPlayback(quietReport, false));
  expect(out.beats.map((b) => [b.kind, b.seconds])).toEqual([["year", 1.2], ["market", 2]]);
  expect(out.seconds).toBeCloseTo(3.2);
});
it("a full year is fitted into six seconds with the market last", () => {
  const out = withMarket(yearPlayback(leaveMoveArriveReport, false));
  expect(out.beats.map((b) => b.kind)).toEqual(["leave", "move", "arrive", "market"]);
  const k = 4 / 6.5;
  expect(out.beats.map((b) => b.seconds)).toEqual([1.5 * k, 2.5 * k, 2.5 * k, 2].map((s) => expect.closeTo(s, 6)));
  expect(out.seconds).toBeCloseTo(MAX_PLAYBACK_SECONDS);
});
it("no playback gets no market beat", () => {
  expect(withMarket(NO_PLAYBACK)).toBe(NO_PLAYBACK);
  expect(withMarket(yearPlayback(leaveMoveArriveReport, true))).toBe(NO_PLAYBACK);
});
it("the market beat shows the office played out behind it", () => {
  const playback = withMarket(yearPlayback(leaveMoveArriveReport, false));
  const scenes = beatScenes(before, after, playback);
  expect(scenes).toHaveLength(4);
  expect(scenes[3]).toEqual(playedOut(after));
});

// officeView.test.ts
it("says the market beat in plain words", () => {
  expect(beatLine({ kind: "market", seconds: 2, count: 0, office: null }, [])).toBe("Where the year's new users went");
});
```

(`quietReport`, `leaveMoveArriveReport`, `before` and `after` are what the file's existing tests build for "a quiet
year is one short beat", "a move comes between…" and the beat-scenes test; reuse them.) The officeView test "no word
of the office is a period word of the race" covers the new line.

- [ ] **Step 2: Run them.** `npx vitest run src/scene src/ui/officeView.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement `withMarket`** as its comment says (scale `k = min(1, (MAX − MARKET) / office sum)`, beats
  keep count and office), the `"market"` case of `beatScenes` returning `playedOut(after)`, and the line.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS (every exhaustive switch over `BeatKind` compiles).
- [ ] **Step 5: Commit**

```bash
git add src/scene/yearPlayback.ts src/scene/yearPlayback.test.ts src/ui/officeView.ts src/ui/officeView.test.ts
git commit -m "scene: a year that plays out ends on the market, still within six seconds"
```

---

### Task 7: The market in the world

**Files:**
- Create: `src/world/market/marketLayout.ts`, `src/world/market/marketLayout.test.ts`,
  `src/world/market/MarketSystem.ts`, `src/world/market/MarketSystem.test.ts`
- Modify: `src/world/types/interaction.ts:7` (company target), `src/world/targets.ts` (`targetKey` case),
  `src/world/types/handle.ts` (`setMarket`, `setView`, `view`), `src/world/core/World.ts` (a `MarketSystem` made in the
  constructor before `coreRoots`, its root among them; registered as `"market"` after `"fx"`; `setView` hides every
  root of the scene that is neither a core root nor the market's while the market shows, and the market's while the
  office shows, re-applied after every `setScene`; the camera's bounds and framing and the lighting's bounds follow the
  view: `frameLayout` (l.567) keeps the office's bounds and framing and applies them to the rig and the lighting only
  while the view is `"office"`, and `setView("office")` applies the kept ones; after `rebuildForNewRun` (whose
  `clearRegistry` at l.553 drops the company targets) the market is turned off and on again when it is the view, so
  its targets come back; `loop.wake()` on every change), `src/world/mountWorld.ts` (nothing but types if needed)
- Test: `src/world/targets.test.ts` (new test only), `src/ui/officeProbe.test.ts` (its `fakeHandle()` at l.23 gains
  `setMarket: vi.fn()`, `setView: vi.fn()`, `view: vi.fn(() => "office" as const)`, so it still types as a
  `WorldHandle`; no test of it changes)

**Interfaces:**
- Consumes: Task 5's `MarketScene`, `WorldViewKind`; `WorldContext` (`interactables`, `reducedMotion`, `scene`);
  `WorldSystem {applyFrame, update, busy, dispose}`; `ModelBuilder`/`bakeModel` as the props use them; `CameraRig`
  `setBounds`/`setFraming`; `Lighting.setBounds`.
- Produces:
  ```ts
  // interaction.ts
  | { kind: "company"; seat: number }
  // targets.ts: targetKey({ kind: "company", seat }) === `company:${seat}`; teamOfTarget gives null
  // handle.ts
  setMarket(scene: MarketScene): void;      // the same object again changes nothing
  setView(view: WorldViewKind): void;       // "office" until told otherwise
  view(): WorldViewKind;
  // marketLayout.ts (pure, no three)
  export const MARKET_BUILDING_HEIGHT = 6;  // world units of a building at height 1
  export const FLOW_DOTS = 48;
  export interface MarketLot { readonly seat: number; readonly x: number; readonly z: number; readonly width: number; readonly height: number }
  export interface MarketLayout {
    readonly lots: readonly MarketLot[];
    readonly barY: number;
    readonly source: { readonly x: number; readonly z: number };
    readonly bounds: { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number };
  }
  export const marketLayout: (scene: MarketScene) => MarketLayout;
  export const flowDots: (won: readonly number[], total: number) => number[];   // largest remainder, sums to round(total × Σwon)
  export const MARKET_DRAW_CEILING = 60;
  // MarketSystem.ts
  export class MarketSystem implements WorldSystem {
    constructor(ctx: Pick<WorldContext, "interactables" | "reducedMotion">);
    readonly root: THREE.Group;
    show(scene: MarketScene): void;          // rebuilds when given another object (identity; src/world may not import
                                             // src/scene's sameMarketScene, and the screen memoises the scene); streams if active
    setActive(on: boolean): void;            // registers the company targets while on, unregisters while off; streams on becoming active
    layout(): MarketLayout | null;
    /** Meshes the market draws (its own count for the check). */
    meshCount(): number;
  }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// marketLayout.test.ts
const company = (seat: number, height: number, won: number, state: MarketSeatState = seat === 0 ? "player" : "rival"): MarketCompany =>
  ({ seat, name: `C${seat}`, state, users: Math.round(height * 100), height, won, listed: false, newcomer: false });
const scene = (companies: MarketCompany[], bar = 0.5): MarketScene =>
  ({ runId: "r", year: 2000, era: "bust", barUsers: 100, bar, pool: 100, companies });

it("stands four lots in a row, the player's first, none overlapping, all inside the bounds", () => {
  const layout = marketLayout(scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0, 0, "out")]));
  expect(layout.lots.map((lot) => lot.seat)).toEqual([0, 1, 2, 3]);
  for (let i = 1; i < 4; i++) expect(layout.lots[i].x - layout.lots[i - 1].x).toBeGreaterThan((layout.lots[i].width + layout.lots[i - 1].width) / 2);
  for (const lot of layout.lots) {
    expect(lot.x - lot.width / 2).toBeGreaterThanOrEqual(layout.bounds.minX);
    expect(lot.x + lot.width / 2).toBeLessThanOrEqual(layout.bounds.maxX);
  }
  expect(layout.lots.map((lot) => lot.height)).toEqual([0.2, 1, 0.5, 0].map((h) => h * MARKET_BUILDING_HEIGHT));
  expect(layout.barY).toBeCloseTo(0.5 * MARKET_BUILDING_HEIGHT);
  expect(layout.source.z).toBeGreaterThan(Math.max(...layout.lots.map((lot) => lot.z)));
});
it("shares the dots by what each company won", () => {
  expect(flowDots([0.5, 0.25, 0.25, 0], 48)).toEqual([24, 12, 12, 0]);
  expect(flowDots([1 / 3, 1 / 3, 1 / 3, 0], 48)).toEqual([16, 16, 16, 0]);
  expect(flowDots([0.3, 0.3, 0.2, 0.1], 10)).toEqual([3, 3, 2, 1]);
  expect(flowDots([0, 0, 0, 0], 48)).toEqual([0, 0, 0, 0]);
});

// MarketSystem.test.ts. RecordingRegistry is private to OfficeSystem.test.ts (l.47): copy it into this file, with
// `keys()` (the registered targets' `targetKey`s, in order) and `labels()` added; do not export it from the old test.
it("registers each company still in the market while active, with its name, and none while not", () => {
  const registry = new RecordingRegistry();
  const market = new MarketSystem({ interactables: registry, reducedMotion: false });
  market.show(scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0, 0, "out")]));
  expect(registry.keys()).toEqual([]);
  market.setActive(true);
  expect(registry.keys()).toEqual(["company:0", "company:1", "company:2"]);
  expect(registry.labels().sort()).toEqual(["C0", "C1", "C2"]);
  market.setActive(false);
  expect(registry.keys()).toEqual([]);
  // What World does after a new run cleared the registry while the market showed: off and on brings the targets back.
  market.setActive(true);
  registry.clear();
  market.setActive(false);
  market.setActive(true);
  expect(registry.keys()).toEqual(["company:0", "company:1", "company:2"]);
  market.dispose();
});
it("streams the users when it becomes active and then rests; under reduced motion it rests at once", () => {
  const moving = new MarketSystem({ interactables: new RecordingRegistry(), reducedMotion: false });
  moving.show(scene([company(0, 0.2, 0.5), company(1, 1, 0.5), company(2, 0.5, 0), company(3, 0.1, 0)]));
  moving.setActive(true);
  expect(moving.busy()).toBe(true);
  for (let i = 0; i < 300; i++) moving.update(1 / 60, i / 60);
  expect(moving.busy()).toBe(false);
  const still = new MarketSystem({ interactables: new RecordingRegistry(), reducedMotion: true });
  still.show(scene([company(0, 0.2, 0.5), company(1, 1, 0.5), company(2, 0.5, 0), company(3, 0.1, 0)]));
  still.setActive(true);
  expect(still.busy()).toBe(false);
  moving.dispose();
  still.dispose();
});
it("draws within its ceiling, the same scene again builds nothing, and disposing leaves nothing", () => {
  const market = new MarketSystem({ interactables: new RecordingRegistry(), reducedMotion: true });
  const shown = scene([company(0, 0.2, 0.1), company(1, 1, 0.5), company(2, 0.5, 0.2), company(3, 0.1, 0.2)]);
  market.show(shown);
  const first = market.root.children.slice();
  market.show(shown);
  expect(market.root.children).toEqual(first);
  expect(market.meshCount()).toBeLessThanOrEqual(MARKET_DRAW_CEILING / 2);   // halved: each may also be drawn in the shadow pass
  market.dispose();
  expect(market.root.children).toEqual([]);
});

// targets.test.ts
it("names a company by its seat, and a company has no team", () => {
  expect(targetKey({ kind: "company", seat: 2 })).toBe("company:2");
  expect(teamOfTarget({ kind: "company", seat: 2 }, null, { teamOfDesk: () => "product" })).toBeNull();
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/world` — Expected: FAIL (modules missing; no company target).
- [ ] **Step 3: Implement.** `marketLayout`: lots 3.2 wide, 4.4 apart along X, centred on 0, at z 0; the source at
  z 4.5; bounds with a 2-unit margin. `MarketSystem` builds, per lot, one baked mesh (plaza tile, the building's stack
  of floors in the seat's colour, the player's in the look's first accent; a flag for `listed`, a crane for `newcomer`,
  a low fence and no building for "out"), one translucent bar plane at `barY` across all lots, and one
  `InstancedMesh` of `FLOW_DOTS` dots that, while streaming (1.6 s), travel from the source to each lot's foot by
  `flowDots`, then stand there. `applyFrame` does nothing (the market is not an office frame). In `World`: `setMarket`
  passes to `show`; `setView` toggles visibility as said, calls `market.setActive`, frames the camera on
  `marketLayout` bounds (instant under reduced motion) or back on the office's kept framing, and sets the lighting's
  bounds; a `setScene` while the market shows (the market beat's `showBeat`, the year's end) updates the kept office
  framing without moving the camera; `teamOf` and `personAt` answer null in the market; `stats().figures` stays the
  office's. (`RecordingRegistry.clear()` stands in for `clearRegistry`; give the copy one.)
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; the boundary test still passes.
- [ ] **Step 5: Commit**

```bash
git add src/world
git commit -m "world: the market drawn on the office's canvas: buildings by users, the bar, the year's users streaming in"
```

---

### Task 8: The market on the career screen

**Files:**
- Create: `src/ui/marketView.ts`, `src/ui/marketView.test.ts`
- Modify: `src/ui/components/CareerOffice.tsx` (props `market`, `view`, `selectedSeat`, `onSelectCompany`,
  `onChooseView`, `playing`; an "Office | Market" switch top left, disabled while a year plays; a company tap selects it
  and a tap on nothing clears it; the carry strip only in the office view; the market card over the canvas, bottom
  right; effects that call `handle.setMarket(market)`, `handle.setView(view)` and
  `handle.setSelected({ kind: "company", seat })` (`handle.ts:79`); any change of the shown view to the market clears
  the carry exactly as "Keep them" or Escape does, so nobody stays held unseen),
  `src/ui/components/RivalsPanel.tsx` (optional `onShow?: (seat: number) => void`: when given, each rival still in the
  market gets a "Show in market" button), `src/ui/officeProbe.ts` (`view()`, `market()`; `attach` takes an optional
  fourth argument `market?: () => MarketScene | null`, read as null when absent, so the existing three-argument calls
  in `officeProbe.test.ts` and `GameScreen.tsx:175` still compile; `GameScreen` passes it), `src/ui/officeView.ts` (`OFFICE_WORDS` gains `office: "Office"`,
  `market: "Market"`, `views: "Show the office or the market"`), `src/ui/screens/GameScreen.tsx` (the market scene
  memoised from `game`, `lastLog`, `config`, `seed`: `MarketScene | null`, null when `seed` is null (the store's seed
  is `number | null`, `officeSource.ts:35`), when there is no career or when `lastLog` is null; `chosenView` and `selectedSeat` state; the playback built with
  `withMarket(yearPlayback(...))`; the shown view `viewNow(chosenView, beat)`; `onShow` passed to `RivalsPanel` in the
  3D layout only, which chooses the market, selects the seat and scrolls the office cell into view)
- Test: `src/ui/marketView.test.ts`, `src/ui/officeProbe.test.ts` (new test only)

**Interfaces:**
- Consumes: Task 5's `marketSceneFor`, `MarketScene`, `MarketCompany`; Task 6's `withMarket`, `PlaybackBeat`; Task 7's
  `setMarket`, `setView`, `view`, company target; `RivalRow` (`src/ui/viewModel.ts:381`), `count`, `money`, `percent`
  (`src/ui/format.ts`), `yearOf`.
- Produces:
  ```ts
  // src/ui/marketView.ts
  /** The view on screen: a beat's while a year plays (the market beat's market, any other the office), else the choice. */
  export const viewNow: (chosen: WorldViewKind, beat: PlaybackBeat | null) => WorldViewKind;
  export interface MarketCardView { readonly title: string; readonly lines: readonly string[] }
  /** A company's public numbers for the card over the market. `row` is the rival's row; null for the player. */
  export const marketCard: (company: MarketCompany, row: RivalRow | null, barUsers: number) => MarketCardView;
  export const MARKET_WORDS: { readonly show: "Show in market"; readonly card: "Company in the market" };
  // RivalsPanelProps gains: onShow?: (seat: number) => void
  // CareerOfficeProps gains:
  //   market: MarketScene | null; view: WorldViewKind; selectedSeat: number | null; playing: boolean;
  //   onSelectCompany(seat: number | null): void; onChooseView(view: WorldViewKind): void;
  // CareerOfficeProbe gains: view(): WorldViewKind | null; market(): MarketScene | null;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// marketView.test.ts
const beat = (kind: BeatKind): PlaybackBeat => ({ kind, seconds: 1, count: 0, office: null });
it("shows the beat's view while a year plays, and the player's choice otherwise", () => {
  expect(viewNow("office", beat("market"))).toBe("market");
  expect(viewNow("market", beat("arrive"))).toBe("office");
  expect(viewNow("market", beat("year"))).toBe("office");
  expect(viewNow("market", null)).toBe("market");
  expect(viewNow("office", null)).toBe("office");
});
const base: MarketCompany = { seat: 1, name: "Tidewell", state: "rival", users: 1_200_000, height: 0.6, won: 0.25, listed: false, newcomer: false };
it("a rival's card says its public numbers", () => {
  const row = { /* a RivalRow with quality 62, hype 3, price "standard", valuation 40_000_000, launched true */ } as RivalRow;
  const card = marketCard(base, row, 2_000_000);
  expect(card.title).toBe("Tidewell");
  expect(card.lines).toEqual([
    `${count(1_200_000)} users, ${count(800_000)} short of the bar`,
    "Won 25% of last year's new users",
    "Quality 62, hype 3, standard price",
    `Worth ${money(40_000_000)}`,
    "Private",
  ]);
});
it("a public company, a newcomer, the player and one at the bar say so", () => {
  expect(marketCard({ ...base, listed: true, users: 2_500_000 }, null, 2_000_000).lines).toEqual(
    [`${count(2_500_000)} users, past the bar`, "Won 25% of last year's new users", "Public"]);
  expect(marketCard({ ...base, newcomer: true }, null, 2_000_000).lines.at(-1)).toBe("New this year");
  expect(marketCard({ ...base, seat: 0, state: "player", name: "Acme" }, null, 2_000_000).title).toBe("Acme (you)");
});
it("never says a period word of the race", () => {
  const all = [MARKET_WORDS.show, MARKET_WORDS.card, ...marketCard(base, null, 1).lines].join(" ");
  expect(all).not.toMatch(/\b(quarters?|quarterly|turns?)\b|\bQ\d/i);
});

// officeProbe.test.ts
it("reads the view and the market the screen shows, and nothing once detached", () => {
  /* attach a view whose handle.view() is "market" and a market function returning a scene: probe.view() is "market",
     probe.market() is that scene; after detach both are null */
});
```

(Fill the `RivalRow` with every field its interface has; only the numbers named matter. "Private" is the last line for a
rival that is not listed and not new; a player's card has no quality/worth line, which its 2D panels show.)

- [ ] **Step 2: Run them.** `npx vitest run src/ui` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `marketView.ts` as pinned, then the wiring the Files line lists. In the market view a tap on
  a company calls `onSelectCompany(seat)` and selects it; a tap on nothing clears both; taps never reach `carryStep`
  there. The card shows for `selectedSeat` while the market is the view, with a close button; Escape clears it.
  `GameScreen` clears `selectedSeat` when the run changes.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; `RivalsPanel` in a race renders as before (no
  `onShow`).
- [ ] **Step 5: Commit**

```bash
git add src/ui
git commit -m "ui: the market view on the career screen: a switch, the year ending on the market, and a company's card when selected"
```

---

### Task 9: A move nobody walks for, said on screen

**Files:**
- Modify: `src/world/cast.ts` (export `drawnTeams`), `src/ui/officeMoves.ts` (`unseenLine`),
  `src/ui/components/CareerOffice.tsx` (`moveCarried`, computed synchronously since the store updates later: when
  `drawnTeams(shown)` equals `drawnTeams({ ...shown, teams: move.allocation })`, where `shown = source.get()` is read
  before `onMove` (l.63) and `move` is what `moveBetweenTeams` returned (if the allocation is not people per team,
  turn it into the scene's `teams` the way `officeSceneFor` does)
  and `handle.hiddenCount() > 0`, show `unseenLine` in the strip's place for 4 s, as `role="status"`)
- Test: `src/world/cast.test.ts`, `src/ui/officeMoves.test.ts` (new tests only)

**Interfaces:**
- Consumes: `sharesOf` (private, `src/world/cast.ts:87`), `MAX_STAFF_DRAWN`, `WorldHandle.hiddenCount()`.
- Produces:
  ```ts
  // src/world/cast.ts
  /** The people drawn at work per team for a scene (the first three of its shares of MAX_STAFF_DRAWN). */
  export const drawnTeams: (scene: OfficeScene) => Readonly<Record<Team, number>>;
  // src/ui/officeMoves.ts
  export const unseenLine: (drawn: number, total: number) => string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// cast.test.ts (the file's helper `scene([product, growth, recruiting], patch)`, l.8)
it("draws every person of a small company, and a large one by its shares", () => {
  expect(drawnTeams(scene([3, 2, 1]))).toEqual({ product: 3, growth: 2, recruiting: 1 });
  expect(drawnTeams(scene([120, 40, 40]))).toEqual({ product: 30, growth: 10, recruiting: 10 });
});
it("one move in a company of 200 can leave the drawn shares as they were", () => {
  expect(drawnTeams(scene([119, 41, 40]))).toEqual(drawnTeams(scene([120, 40, 40])));
});
// (If the helper's default capacity or office caps the drawn count below MAX_STAFF_DRAWN, patch it so 50 are drawn.)

// officeMoves.test.ts
it("says when a move changes the plan but nobody walks", () => {
  expect(unseenLine(50, 120)).toBe("Moved in the plan. The office draws 50 of your 120 people, so nobody walks.");
});
```

- [ ] **Step 2: Run them.** `npx vitest run src/world/cast.test.ts src/ui/officeMoves.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `drawnTeams` from `sharesOf` exactly as `nextCast` counts, `unseenLine`, and the note.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/world/cast.ts src/world/cast.test.ts src/ui/officeMoves.ts src/ui/officeMoves.test.ts src/ui/components/CareerOffice.tsx
git commit -m "ui: a move the office cannot show, past fifty people, is said on screen"
```

---

### Task 10: Sound for milestones

**Files:**
- Create: `src/ui/careerSound.ts`, `src/ui/careerSound.test.ts`
- Modify: `src/world/mountWorld.ts:57` (an optional fifth argument `options: { sound?: WorldSoundListener }` handed to
  `createWorld`), `src/world/WorldView.tsx` (prop `sound?: WorldSoundListener`, passed through), 
  `src/ui/components/CareerOffice.tsx` (passes `careerWorldSound`), `src/ui/screens/GameScreen.tsx` (in
  `onEndQuarter`, the year's cue is worked out from the store before and after `endQuarter`; it plays at once when no
  year plays out, or in `finishPlay` when one does; the market beat plays `beatSoundFor` in the beat effect),
  `src/ui/officeProbe.ts` (`sounds(): readonly SoundName[]` reads `soundsHeard()`)
- Test: `src/ui/careerSound.test.ts`, `src/world/mountWorld.test.ts` (new test only), `src/ui/officeProbe.test.ts`
  (new test only)

**Interfaces:**
- Consumes: `playSound(name, options)` (`src/audio/engine.ts:911`), `SoundName`, `makeHarness`, `reaches`,
  `setSharedAudioEngine` (`src/audio/testing/fakeAudio.ts`, `src/audio/engine.ts`), `Milestone`, `CareerRecord`
  (`src/state/careerRecord.ts`), `eraIndexOf`, `upcomingShift(turn, config)`, `WorldSoundListener`,
  `WorldFootstepsCue`, Task 6's `PlaybackBeat`.
- Produces:
  ```ts
  // src/ui/careerSound.ts
  export interface YearSoundInput {
    readonly config: RulesConfig;
    readonly before: { readonly turn: number; readonly record: CareerRecord };
    readonly after: { readonly turn: number; readonly record: CareerRecord; readonly over: boolean };
  }
  export const YEAR_SOUNDS: Readonly<Record<"listed" | "rescued" | "office" | "launch" | "era" | "shift" | "rivalOut" | "rivalIn", SoundName>>;
  /** The one sound a year earns, by importance; null in a race, for a year that ends the career, or a year of nothing. */
  export const yearSoundFor: (input: YearSoundInput) => SoundName | null;
  export const beatSoundFor: (beat: PlaybackBeat) => SoundName | null;   // market: "users-trickle"; others null
  /** Plays `name` once for `key` (`${runId}:${turn}`, the office scene's runId): a second call with the same key
   *  plays nothing. Every call stores its key, a null one included. */
  export const soundOnce: (key: string, name: SoundName | null) => void;
  export const playCareerSound: (name: SoundName, options?: PlayOptions) => void;
  export const soundsHeard: () => readonly SoundName[];   // the last 20 asked for, oldest first
  export const careerWorldSound: WorldSoundListener;      // footsteps and chair-sit on the world bus, panned
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// careerSound.test.ts
import { CAREER } from "../config";
import { DESIGN } from "../config.design";
const at = (turn: number, record: CareerRecord = [], over = false) => ({ turn, record, over });
const m = (milestone: Milestone): CareerRecord => [milestone];

it("each milestone has its sound", () => {
  expect(YEAR_SOUNDS).toEqual({ listed: "crowd-cheer", rescued: "negative-big", office: "asset-office-upgrade", launch: "launch-ok",
    era: "phase-change", shift: "event-beacon", rivalOut: "power-down", rivalIn: "neutral" });
});
it("plays the most important of the year's milestones, only that one", () => {
  const year = [{ kind: "launch", turn: 3 }, { kind: "office", turn: 3, from: 0, to: 1 }, { kind: "listed", turn: 3, amount: 1 }] as const;
  expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, [...year]) })).toBe("crowd-cheer");
  expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, year.slice(0, 2)) })).toBe("asset-office-upgrade");
  expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, m({ kind: "rivalIn", turn: 4, seat: 2, name: "N", pitch: "p" })) })).toBe("neutral");
});
it("hears only what this year added", () => {
  const old = m({ kind: "launch", turn: 2 });
  expect(yearSoundFor({ config: CAREER, before: at(3, old), after: at(4, old) })).toBeNull();
});
it("a new era, or a platform shift newly announced, when nothing else happened", () => {
  // 1994 → 1995 crosses from dial-up to gold-rush (turn 6 is 1995).
  expect(yearSoundFor({ config: CAREER, before: at(5), after: at(6) })).toBe("phase-change");
  const shiftTurn = /* the first turn t for which upcomingShift(t, CAREER) !== null and upcomingShift(t - 1, CAREER) === null, found by a loop */;
  expect(yearSoundFor({ config: CAREER, before: at(shiftTurn - 1), after: at(shiftTurn) })).toBe(
    eraIndexOf(shiftTurn - 1, CAREER.career!) !== eraIndexOf(shiftTurn, CAREER.career!) ? "phase-change" : "event-beacon");
});
it("a second shift announced while the first is still to come counts as new", () => {
  // Every year t of the shipped career whose next announced shift is another card than the year before's, and not
  // none, is a newly announced shift; a year whose notice is the same card, or none, is not.
  for (let t = 2; t <= CAREER.game.maxTurns; t++) {
    const was = upcomingShift(t - 1, CAREER)?.cardId;
    const now = upcomingShift(t, CAREER)?.cardId;
    const sameEra = eraIndexOf(t - 1, CAREER.career!) === eraIndexOf(t, CAREER.career!);
    if (!sameEra) continue;
    expect(yearSoundFor({ config: CAREER, before: at(t - 1), after: at(t) }), `turn ${t}`).toBe(
      now !== undefined && now !== was ? "event-beacon" : null);
  }
});
it("is silent for a year that ends the career, and in a race", () => {
  expect(yearSoundFor({ config: CAREER, before: at(3), after: at(4, m({ kind: "listed", turn: 3, amount: 1 }), true) })).toBeNull();
  expect(yearSoundFor({ config: DESIGN, before: at(3), after: at(4, m({ kind: "listed", turn: 3, amount: 1 })) })).toBeNull();
});
it("the market beat streams users; no other beat makes a sound of its own", () => {
  expect((["leave", "move", "arrive", "year", "market"] as const).map((kind) => beatSoundFor({ kind, seconds: 1, count: 1, office: null })))
    .toEqual([null, null, null, null, "users-trickle"]);
});
describe("through the audio engine", () => {
  let h: Harness;
  beforeEach(async () => { vi.useFakeTimers(); h = makeHarness(); setSharedAudioEngine(h.engine); await h.unlock(); });
  afterEach(() => { h.engine.dispose(); setSharedAudioEngine(null); vi.useRealTimers(); });
  it("plays a year's sound once, however often it is asked, and remembers what it asked for", () => {
    const before = h.ctx.started.length;
    const heard = () => soundsHeard().filter((name) => name === "crowd-cheer").length;
    const was = heard();
    soundOnce("a:12", "crowd-cheer");
    soundOnce("a:12", "crowd-cheer");
    expect(h.engine.voiceCount("world")).toBe(1);
    expect(h.ctx.started.length).toBeGreaterThan(before);
    expect(soundsHeard().at(-1)).toBe("crowd-cheer");
    soundOnce("a:13", null);
    expect(heard() - was).toBe(1);
    // Another career reaching the same year is another key: it is heard.
    soundOnce("b:12", "crowd-cheer");
    expect(heard() - was).toBe(2);
    // A null call stores its key too: the same key with a sound afterwards plays nothing.
    soundOnce("c:5", null);
    soundOnce("c:5", "crowd-cheer");
    expect(heard() - was).toBe(2);
  });
  it("turns the world's footsteps and chairs into sounds on the world bus", () => {
    careerWorldSound.onFootsteps?.({ pan: -0.3, steps: 4, approach: 1, panTo: 0.2 });
    careerWorldSound.onChairSit?.({ pan: 0.1 });
    expect(soundsHeard().slice(-2)).toEqual(["footsteps", "chair-sit"]);
    expect(h.engine.error).toBeNull();
  });
});

// mountWorld.test.ts
it("hands the world the sound listener it was given, and none when given none", () => {
  /* mount with { sound: listener }: the options of createWorld's latest call have sound === listener;
     mount with no fifth argument: options.sound is undefined */
});

// officeProbe.test.ts
it("reads the sounds the career asked for", () => {
  /* after playCareerSound("neutral"), probe.sounds().at(-1) is "neutral" */
});
```

(`Harness`, `makeHarness` and the bus check come from `src/audio/testing/fakeAudio.ts`, read-only; `crowd-cheer` is a
world-bus sound, `negative-big` and `neutral` outcome-bus ones. If a name's bus differs from that, assert the bus the
library gives it.)

- [ ] **Step 2: Run them.** `npx vitest run src/ui/careerSound.test.ts src/world/mountWorld.test.ts src/ui/officeProbe.test.ts`
  — Expected: FAIL.
- [ ] **Step 3: Implement.** `yearSoundFor`: null without `config.career` or when `after.over`; the milestones added
  are `after.record.slice(before.record.length)`; importance listed, rescued, office, launch, then a new era
  (`eraIndexOf` differs), a shift newly announced (`upcomingShift(after.turn)?.cardId` is not undefined and differs
  from `upcomingShift(before.turn)?.cardId`, so a second shift announced while the first is pending counts), rivalOut,
  rivalIn; "out" makes no sound (the career is over). `soundOnce` keeps the last key it was called with, stored on
  every call, null included, and plays only when the key differs. `playCareerSound` records then calls
  `playSound` (which never throws). `careerWorldSound` maps `onFootsteps(cue)` to `playCareerSound("footsteps", { pan,
  panTo, steps, approach })` and `onChairSit` to `"chair-sit"`; `onBubble` and `onDusk` are left out. Thread the
  listener as the Files line says; `WorldView`'s `sound` must be the same object across renders, and mountWorld reads it
  once per world. In `GameScreen`, `onEndQuarter` keeps the cue in a ref with its key `${runId}:${turn}` (the runId of
  the office scene, `${seed}:${companyId}:${founded}`, so a new career or a new game never shares a key with the last
  one); `finishPlay` and the no-playback path call `soundOnce(key, cue)`; the race path computes nothing.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS; `src/audio/sfx.test.ts` and
  `src/audio/sounds.test.ts` unchanged and passing.
- [ ] **Step 5: Commit**

```bash
git add src/ui src/world/mountWorld.ts src/world/mountWorld.test.ts src/world/WorldView.tsx
git commit -m "ui: a career's milestones have their sounds, one a year, and the office's footsteps are heard"
```

---

### Task 11: How to play the office, the market and the sound; the timeline's promise pinned

**Files:**
- Modify: `src/ui/careerHelp.ts` (three new sections after "Rivals come and go")
- Test: `src/ui/careerHelp.test.ts` (the titles test is updated; new tests), `src/ui/careerTimeline.test.ts` (new
  test only: decision 9's reading of the owner's ruling; `careerTimeline.ts` is not changed)

**Interfaces:**
- Consumes: `OFFICE_WORDS` (`toggle`, `skip`, `reload`, `office`, `market`), `CARRY_WORDS.keep`, `MARKET_WORDS.show`,
  `DESKTOP_QUERY`'s 1024 px.
- Produces: `careerHelp(config)` returns twelve sections; the new titles are "The 3D office", "The market", "Sound".

- [ ] **Step 1: Write the failing tests**

```ts
it("has its sections in order", () => {
  expect(help.map((section) => section.title)).toEqual(["The goal", "One year at a time", "Eras and history", "Product, Growth, Recruiting",
    "Cash and raising money", "Going public", "Offices", "One rescue", "Rivals come and go", "The 3D office", "The market", "Sound"]);
});
it("explains the office: where it shows, moving people, the year playing out, and what happens without it", () => {
  const text = help.find((s) => s.title === "The 3D office")!.text;
  for (const words of ["1024", "3D office", "Keep them", "Escape", "Skip", "Reload 3D view", "reduced motion", "2D"]) expect(text).toContain(words);
});
it("explains the market: buildings by users, the bar, the year's new users, selecting a company", () => {
  const text = help.find((s) => s.title === "The market")!.text;
  for (const words of ["Market", "users", "bar", "public", "Show in market"]) expect(text).toContain(words);
});
it("says what makes a sound and where to turn it off", () => {
  expect(help.find((s) => s.title === "Sound")!.text).toContain("Sound menu");
});
// "speaks in years, never turns or quarters" and "is empty for a race" stay and now cover the new sections.

// careerTimeline.test.ts (the file's `real(turn)` helper, l.12, and its imports)
it("never shows the future but the announced shift: crashes stay a surprise", () => {
  for (let turn = 1; turn <= CAREER.game.maxTurns; turn++) {
    const view = timelineView(real(turn), [], CAREER)!;
    expect(view.cards.filter((card) => card.year > view.year), `turn ${turn}`).toEqual([]);
    const notice = upcomingShift(turn, CAREER);
    expect(view.shift?.year ?? null, `turn ${turn}`).toBe(notice?.year ?? null);
  }
});
```

(The test passes at once: it pins what `timelineView` already does, so a later change cannot show a future crash.
Past cards and milestone marks staying on the timeline is what "shows dated cards up to this year…" and "marks the
career's milestones by year" already pin.)

- [ ] **Step 2: Run them.** `npx vitest run src/ui/careerHelp.test.ts src/ui/careerTimeline.test.ts` — Expected: the
  help tests FAIL; the timeline test passes (it pins existing behaviour).
- [ ] **Step 3: Write the three sections** in plain words, taking the button names from the word constants, not
  retyping them. "The 3D office": on a desktop browser window at least 1024 pixels wide the career's main screen is the
  office, switched by "3D office"; click a person, then a person of another team or a team button, to move them ("Keep
  them" or Escape puts them back); after End the year plays out for a few seconds with captions, and Skip ends it; with
  reduced motion it does not play; if the office cannot be drawn, or stops ("Reload 3D view"), the 2D screens carry
  the whole game. "The market": the four companies as buildings, taller with more users, the bar for going public
  marked across them, a flag on a public company; each year ends showing where its new users went; click a building,
  or a rival's "Show in market", to see its public numbers. "Sound": a short sound marks the year's main milestone and
  people come and go with footsteps; the Sound menu mutes or sets the volume.
- [ ] **Step 4: Run the tests, then the checks.** Expected: PASS.
- [ ] **Step 5: Commit**

```bash
git add src/ui/careerHelp.ts src/ui/careerHelp.test.ts src/ui/careerTimeline.test.ts
git commit -m "ui: how to play explains the 3D office, the market and the sound; the timeline never shows a future crash"
```

---

### Task 12: The market, every era look and the sounds in a real browser

**Files:**
- Modify: `scripts/career-check.mjs` (`--only n,n` as office-check has it, each of its ten steps under `if (runs(n))`;
  a new step 11, "A milestone's sound in 2D": the office fixture's year ends and `window.__careerOffice.sounds()`
  holds `asset-office-upgrade` once), `scripts/career-fixtures.ts` (five era fixtures through `decade(what, turn,
  office)` (l.224): `goldRush = decade("gold-rush", 8, 1)`, `phones = decade("phones", 21, 2)`,
  `cheapMoney = decade("cheap-money", 28, 3)`, `agents = decade("agents", 40, 3)`, `ambient = decade("ambient", 46, 4)`;
  each joins the year-check loop (l.241) wanting 1997, 2010, 2017, 2029 and 2035, and the `console.log(JSON.stringify({
  … }))` line (l.245) gains `goldRush, phones, cheapMoney, agents, ambient`), `scripts/office-check.mjs` (steps 15 to 18 below, each
  `if (runs(n))`, the old step 14 "No console errors" stays last and runs always; `measured` rows for each)
- Test: the scripts themselves.

**Interfaces:**
- Consumes: the probe's `view()`, `market()`, `sounds()`, `stats()`, `scene()`, `screenBounds({ kind: "company", seat })`;
  `ceiling(stats)`; `MARKET_DRAW_CEILING` (copied into the script, 60); the fixtures `office`, `listing`, `nineties`
  (dial-up 1994), `noughties` (bust 2004), `twenties` (winter-ai 2023) and the five new ones.

- [ ] **Step 1: Write the steps (the failing check).**
  - **15. The market view:** from the office fixture at 1280×800: press "Market"; `view()` is "market", `market()` has
    four companies whose `height`s order as their users, `stats().drawCalls ≤ 60`; click the tallest rival's building
    (centre of `screenBounds`): a card titled with its name shows "users" and "last year's new users"; press Escape:
    the card goes; press "Office": `view()` is "office". End the year: during the last beat the caption reads "Where the
    year's new users went" and `view()` is "market"; then the summary opens once and `view()` is back to the choice.
    During that market beat a company's `screenBounds({ kind: "company", seat: 1 })` is non-null (the year's new scene
    did not pull the camera back to the office). Again with Skip pressed during the market beat: the summary opens
    once and the switch is enabled. Again, narrowing the window to 900×800 during the market beat: the summary opens
    once, the 2D screens show, and `sounds()` holds the year's milestone sound once. Again, calling `loseContext()`
    during the market beat (as the existing "a context lost during a year" check does, l.1043): the summary opens
    once, and once "Reload 3D view" is pressed and the office runs again `view()` reads the player's choice. Pick a person up, press "Market", press "Office": nobody is carried (no carry strip) and the plan
    is unchanged. With `reducedMotion: "reduce"` (the office fixture's context option), press "Market": `view()` is
    "market" and the world rests (`stats().framesDrawn` stops growing within 1 s; no dots stream). A rival's
    "Show in market" button in the rivals panel shows the market with that seat selected. No "Show in market" button
    and no "Market" switch exist in a race page or in the 2D layout.
  - **16. Every era's look:** for each of the eight era fixtures (`nineties` is dial-up, `noughties` bust, `twenties`
    winter-ai, then the five new ones): `scene().era` is the era, `lookFor` (the script's copy)
    gives the same id, `stats().drawCalls ≤ ceiling(stats)`; a shot `<year>-<era>.png`; the agents full floor's row is
    printed with its margin.
  - **17. The market's draw calls in every era:** in each era fixture, switch to the market: `stats().drawCalls ≤ 60`.
  - **18. Sounds fire:** from the office fixture with 3D: after End, `sounds()` gains `users-trickle` during the market
    beat and `asset-office-upgrade` once when the summary opens, and footsteps while hires walk in; reloading with the
    report open adds nothing to `sounds()`; with reduced motion, `asset-office-upgrade` is there as the summary opens
    and `users-trickle` is not. From the listing fixture: `crowd-cheer` once.
- [ ] **Step 2: Run them.** `node scripts/office-check.mjs --only 15,16,17,18 --shots <scratch dir>` and
  `node scripts/career-check.mjs --only 11` — Expected: each step prints `ok`, exit 0. Fix what fails in the task that
  owns it (as a fix commit in that area), not by loosening a step.
- [ ] **Step 3: Run both scripts whole** (`node scripts/career-check.mjs` and `node scripts/office-check.mjs`, about 25
  minutes). Expected: exit 0; the race-text snapshot step passes; the draw-call table prints every era and the market.
- [ ] **Step 4: Commit**

```bash
git add scripts/career-check.mjs scripts/office-check.mjs scripts/career-fixtures.ts
git commit -m "scripts: the market, every era's look and the career's sounds checked in a real browser, step by step"
```

---

### Task 13: The documents, and the final review

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-11-25-career-3d-design.md`, `docs/career-rules.md`,
  `docs/superpowers/specs/3d-office-check.md`, `docs/superpowers/plans/2026-11-25-career-3d-office.md` ("After this
  plan" only)

**Interfaces:**
- Consumes: Task 12's measured draw calls and shots; `gzip -c dist/assets/CareerOffice-*.js | wc -c` and the same for
  each file `dist/index.html` references.

- [ ] **Step 1: Check what is stale.** `grep -n "has no screens yet\|Nothing in this document is built yet\|fills in as the build goes on\|the screens plan\|later on a phone\|step 5" README.md docs/career-rules.md docs/superpowers/specs/2026-11-25-career-3d-design.md docs/superpowers/specs/3d-office-check.md`
  — Expected now: matches in each file. After Step 2 the same grep prints only lines that are history on purpose
  (dated plan names).
- [ ] **Step 2: Write them.**
  - `README.md`: the two modes (the race; the career, 1990 to 2038, a year a turn); the career on desktop has the 3D
    office and market as its main screen (a desktop browser window of 1024 px or more with WebGL 2), and the complete 2D
    screens everywhere else; the Structure section gains `src/world` (the 3D office and market, three.js), `src/scene`
    (the scene model), `src/lab` (the office lab page) and `scripts`; Commands gains `node scripts/career-check.mjs
    [--no-build] [--shots <dir>] [--only n,n]`, `node scripts/office-check.mjs [--no-build] [--shots <dir>] [--only n,n]`,
    `node scripts/world-check.mjs`, `npx tsx scripts/career-fixtures.ts`; `audio/` described as synthesised sound for
    the interface, milestones and the office. No race wording for the career ("a refresh resumes the year you were
    planning" in career text).
  - Design doc: the status line says steps 1 to 5 are built (with this plan's name); a dated note under sections 10.1,
    10.2 (phone paragraph), 10.6 (phone budget), 13 and 17 records the owner's decision (desktop browsers only; phones
    keep the 2D screens) without deleting the text; 10.5 gives the measured download sizes beside its estimate; section 4's
    timeline sketch is checked against "crashes stay a surprise" and, if it shows a future crash, a note says the screen
    shows only past cards and the announced shift; beside section 10.2 a dated note (2026-11-26) records decision 9's
    reading of the owner's ruling: no dated card of a future year is shown but the announced shift, while past cards and
    the career's milestones stay as history (pinned by Task 11's timeline test).
  - `docs/career-rules.md`: line 6 says the rules, the 2D screens and the 3D office and market are built; line 120's
    "(the screens plan)" names the plan that built it. No ruling changes.
  - `3d-office-check.md`: the draw-call table per era look and the market's, against the ceilings (the full floor's old
    360 of 360 beside its new figure); the download sizes; the sounds step; phones removed from "later" (desktop only,
    by the owner's decision); what failed and was fixed in Task 12. Say that this machine renders in software.
  - The step 4 plan's "After this plan": a line under its Phones bullet: out, by the owner's decision of 2026-11-26.
- [ ] **Step 3: Final review.** Run the checks, then both browser scripts whole. Then review the whole branch against
  the design's sections 2, 3, 4, 6, 10, 13 and 15 step 5 and against this plan's Review Focus, with
  `git diff f1313ee --stat` and the superpowers:requesting-code-review skill; confirm the five open points of the last
  review are closed (Task 9, Task 4, Task 3, Task 2, Task 4). Write each finding the review keeps as a task in the
  report to the owner, not as a silent fix.
- [ ] **Step 4: Commit**

```bash
git add README.md docs/career-rules.md docs/superpowers/specs/2026-11-25-career-3d-design.md docs/superpowers/specs/3d-office-check.md docs/superpowers/plans/2026-11-25-career-3d-office.md
git commit -m "docs: the README, the design, the rulings and the browser report say what the career's 3D screen now is"
```

---

## After this plan

The design's build order is done: the career is played on desktop in its 3D office and market, every era looks its
own, milestones are heard, and the 2D screens remain the complete game everywhere else. What is left for the owner:

- **Play-testing decides** whether 49 years is right (design section 17), whether six seconds is the right longest
  playback now that two of them go to the market, and whether each era's look and sound read as intended on a real
  screen (this machine renders in software).
- **The server rack showing users** (a users field on `OfficeScene`, through `officeSceneFor`, `sameOfficeScene`, the
  lab's scene query and the probe) was left out: nothing in the design asks for it.
- **Phones** stay on the 2D screens by the owner's decision. Should that change, the step 4 plan's Phones bullet and
  this plan's draw-call table are where to start.
- **Timeline:** by the owner's ruling it shows eras and the announced shift and never a future crash; past dated cards
  (crashes once they happened) and milestones stay on it as history (decision 9, pinned by Task 11's test, noted in
  the design beside section 10.2).
