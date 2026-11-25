# The old 3D office, file by file

A file-by-file reading of the three.js office this project had before the turn-based rebuild, made for the plan
`docs/superpowers/plans/2026-11-25-career-3d-groundwork.md`. The code is in commit `63b4bed` under `src/world` (read a
file with `git show 63b4bed:src/world/<path>`). Four readers took one group of folders each, read every file whole,
checked each import against today's code, and tried the restore in a scratch project with three 0.187.0 installed.
Their verdicts:

- **as is**: compiles and passes its tests in today's repository unchanged, once `three` is installed.
- **with edits**: the edits are listed.
- **rewrite**: tied to the old weekly game closely enough that a new file is cheaper.
- **drop**: the new game has no use for it.

Where this document and the approved design (`2026-11-25-career-3d-design.md`) differ, the design wins. Where it and
the plan differ, the plan wins: the plan made the decisions these notes leave open (no founder figure, the cast and
its cap of 50, seating by team along the benches, stations kept as furniture, a look as a parameter).

Paths under `/tmp` were scratch folders on the machine that did the reading. They no longer exist and are kept only
so the notes read as written. Line numbers such as `l.212` refer to the file at `63b4bed`.

| Verdict | Files | Lines |
|---|---|---|
| as is | 44 | 8,621 |
| with edits | 51 | 21,384 |
| rewrite | 13 | 4,637 |
| drop | 17 | 5,948 |
| all | 125 | 40,590 |


## The world's root, core and types (src/world, src/world/core, src/world/types)

I covered all 44 files in src/world (14), src/world/core (21) and src/world/types (9) at 63b4bed. I read each file whole and checked every import against the working tree at 5798e21. In a scratch project (three@0.187.0 and @types/three@0.187.0 installed there, with the repo's own tsc, vitest, eslint and tsconfig) I tried the restore for real. Results: math, adaptiveQuality, lightingState, types/geometry, types/fx and hash compile unchanged, and adaptiveQuality's 44 tests pass. I then replaced types/snapshot.ts with a small OfficeScene and edited office.ts, interaction.ts, system.ts, handle.ts, events.ts and the barrel. After that, SystemRunner, rendererLook, CameraRig, Lighting, colors, materials, geometry, textures, models (including the three/addons import), sharedResources and palette compile and pass lint. 86 tests ran green in node against the real three, with no fake (the one failing assertion was in my own crude Lighting test edit). Verdicts: 13 restore-as-is, 19 restore-with-edits, 5 rewrite, 7 drop. Every as-is file depends on nothing outside src/world except three. Everything tied to the old weekly game (snapshot, events, names, outcomes, phase, the old mount and their tests) is rewritten or dropped. The new input is an 11-field OfficeScene, plus a 6-kind event list derived from two scenes. Full table: /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/core/inventory.md; notes: /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/core/notes.md; scratch proof: /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/core/try.

### Files

| File | Lines | What it does | Verdict | Edits, or why | Imports from outside the world | Test |
|---|---|---|---|---|---|---|
| `WorldView.tsx` | 87 | React entry: a stage keyed by a generation counter, one canvas (role img), the context-lost overlay with a 'Reload 3D view' button | with edits | Remove the runCommand prop, the WorldOverlay render and the useUiStore dismissWorldHint handlers. Take a scene source as a prop and pass it to mountWorld. Reword CANVAS_LABEL and the context-lost text, which say 'the terminal has everything'. Keep the key={generation} reload, the canvas without tabIndex, and the status from the stage store. | react: useEffect, useRef, useState (still exists today); zustand: useStore (still exists today); ../state/useUiStore: useUiStore (gone) | none (and vitest only runs *.test.ts, so a .tsx test would not run) |
| `core/CameraRig.test.ts` | 501 | Projection, pan, zoom, tweens, shake, revision, building framing, focusPoint | with edits | Delete imports 3-6 and the 'CameraRig building framing' describe (lines 352-443). Move it into the office folder's framing test, re-keyed to the five tiers and without outdoor assets. Verified: the remaining blocks pass. | three: * as THREE (ok); vitest; ../../types/game: AssetId, CompanyPhase (gone) | real three math in node, no DOM |
| `core/CameraRig.ts` | 492 | Fixed true-isometric orthographic camera: framing with fitWidth/fill, pan bounds, zoomAt, focus/focusPoint, shake, project, screenToGround, all as plain arithmetic | as is | Text unchanged. It compiles as soon as the types barrel does (verified). | three: * as THREE (ok) | CameraRig.test.ts (real three in node) |
| `core/Lighting.test.ts` | 349 | Looks, sweep, flicker, setup and endings, shadows, state sharing | with edits | Use a literal OfficeScene fixture. Drop the 'time of day' describe (5 AP tests). Keep the sweep tests with 'year-advanced'. For endings, use ending 'win'/'loss' instead of the seven old ending ids. Drop the setup-dim and flicker tests unless those looks are kept. The 'looks', 'shadows' and 'state sharing' describes stay nearly as they are (verified they run). | three (ok); vitest; ../../engine: createInitialState (gone) | real three in node (Scene, lights, WebGLRenderTarget stand-in); no renderer |
| `core/Lighting.ts` | 409 | Hemisphere, sun and fill lights blended between named looks; week sweep; event flicker; shadows; publishes LightingState | with edits | Delete the WIN_ENDINGS import (line 2). Replace daytimeKey and goalKey (lines 174-191) with: scene.ending win gives WIN, loss gives LOSS, otherwise MORNING (later, the era's mood). In applySnapshot (lines 263-285), 'week-advanced' becomes 'year-advanced', the 'event-opened' flicker and 'setup-completed' cases go (or are remapped), and 'game-over' keeps SLOW_RATE. Types become OfficeScene. Verified it compiles. | three: * as THREE (ok) | Lighting.test.ts (real three in node) |
| `core/SystemRunner.test.ts` | 190 | Order, rebuilding a subset, containment, report-once | with edits | Line 7: use a literal OfficeScene fixture instead of buildWorldSnapshot(createInitialState()), and remove imports 2-3. Verified: 7 tests pass. | vitest (exists); ../../engine: createInitialState (gone) | pure, no three |
| `core/SystemRunner.ts` | 102 | Runs systems in a fixed order, contains their failures, reports each failure once | with edits | Type swap WorldSnapshot to OfficeScene in the import and in applySnapshot (lines 1, 58). Verified. | none | SystemRunner.test.ts (pure) |
| `core/World.ts` | 690 | createWorld: WebGL2 context first, renderer, camera rig, lighting, interaction, fx, SystemRunner(office, people, lighting, fx), rAF loop, resize/DPR, pause, context loss, dispose | with edits | WorldSnapshot becomes OfficeScene (lines 21, 182, 303, 477). Lines 322-327: layout key becomes officeLayoutKey(next.office[, next.era]) and getOfficeLayout(next.office) instead of (phase, ownedAssets). Lines 331-333: roster = castOf(next).people and hidden = castOf(next).hiddenPeople, replacing the setupComplete filter. Lines 482-489: layoutBounds(layout) and computeBuildingFrame(layout) without assets. Line 494: phaseChanged becomes prev.office !== next.office \|\| 'office-changed'. Line 179 initial layout: getOfficeLayout(0). The run-reset path (307-314, 460-474) is unchanged. Optional: on-demand rendering (design 10.6). | three: * as THREE (ok once installed) | none (only mocked in mountWorld.test; it needs a real WebGL2 context, so its check is the browser check) |
| `core/adaptiveQuality.test.ts` | 389 | Synthetic timing simulations for the governor | as is | none (verified: 44 tests pass) | vitest | pure |
| `core/adaptiveQuality.ts` | 246 | Pure frame governor: steps down pixel ratio, then shadows, under sustained overload | as is | none (verified) | none | adaptiveQuality.test.ts (pure) |
| `core/colors.ts` | 208 | App UI colours, diorama palette C, ROLE_COLORS, outfits, skin and hair, PHASE_THEMES, SCALE, colour maths | with edits | Import Department and OfficeTier from ../types. ROLE_COLORS: Record<TeamRole> becomes DEPARTMENT_COLORS: Record<Department> with three colours. PHASE_THEMES: Record<CompanyPhase> becomes a Record<OfficeTier> keyed 0..4; this is where era themes will go later. PHASES and phaseTier become tier helpers. Users to update: people/Character, office/dressing, DeskSlots, props/decor, building, stations. Verified it compiles. INK, NEON and so on still match tailwind.config.js. | ../../types/game: CompanyPhase, TeamRole (gone) | none |
| `core/geometry.ts` | 88 | Geometry cache, unit geometries, one-line mesh helpers | as is | none (verified) | three (ok) | none |
| `core/layoutBounds.test.ts` | 35 | Bounds cover the ground tile and the assets | with edits | Loop over the 5 tiers instead of the phases. Drop the outdoor-asset test. | vitest; ../../types/game: AssetId, CompanyPhase (gone) | pure |
| `core/layoutBounds.ts` | 33 | Ground bounds for pan limits and the shadow frustum, from the layout's tile, door and assets | with edits | Remove the assets parameter, the AssetId import and the loop over asset footprints: layoutBounds(layout). It waits for office/layouts groundRect. | ../../types/game: AssetId (gone) | layoutBounds.test.ts |
| `core/lightingState.ts` | 47 | Per-scene duskAmount and daylight that props read | as is | none (verified) | three: type * as THREE (ok) | covered in Lighting.test.ts |
| `core/materials.ts` | 122 | Cached Lambert, glow and glass materials | as is | none (verified; it only reads C from colors) | three (ok) | none |
| `core/math.ts` | 40 | clamp, lerp, eases, damp | as is | none | none | none |
| `core/models.ts` | 528 | ModelBuilder (bakes a prop into one vertex-coloured geometry), bakeModel cache, outline helpers | as is | none (verified with tsc and eslint) | three (ok); three/addons/geometries/RoundedBoxGeometry.js: RoundedBoxGeometry (ok with @types/three 0.187.0, verified) | none in these folders (exercised by office/props tests) |
| `core/palette.ts` | 32 | Barrel for colors, materials, geometry, models, textures, sharedResources | as is | none | none | none |
| `core/rendererLook.ts` | 25 | Renderer output settings: transparent clear, sRGB, no tone mapping, PCF shadows only on high | as is | Text unchanged. Needs the barrel for QualityLevel (verified). | three (ok) | none |
| `core/sharedResources.ts` | 22 | Cache stats and disposal of all caches | as is | none | none | none |
| `core/textures.ts` | 112 | Cached canvas textures and caller-owned DynamicTexture; returns null without a DOM | as is | none. LABEL_FONT 'IBM Plex Mono' is still the app font (src/index.css:1). | three (ok) | none |
| `events.test.ts` | 1085 | Diff tests, including a scan of the old engine's commands.ts source | drop | Everything in it is about commands, builds, AP and easter eggs. Replace it with a small sceneEvents.test.ts. | vitest (exists); ../types/game (gone); ../engine: executeCommand (gone); ../engine/commands.ts?raw (gone); ../engine/testHelpers (gone) | pure |
| `events.ts` | 370 | Diff of two snapshots plus the last terminal command into a 40-kind WorldEvent list in a fixed order | rewrite | New sceneEvents.ts, about 80 lines. run-reset when runId changes or the year goes backwards (exclusive). Then office-changed, departed and hired per department (ids by set difference as missingFrom does at lines 117-127, with count when capped), year-advanced, and game-over last. Keep findWorldEvent and filterWorldEvents. No command or action input. | ../types/game: SoundHint, TeamRole (gone) | events.test.ts (pure) |
| `hash.ts` | 35 | mix32 and hashText32: deterministic hashing for looks | as is | Unchanged (verified it compiles). Add a small hash.test.ts for determinism and spread, since its coverage leaves with the dropped tests. | none | none of its own (it was exercised by snapshot, names and events tests, which go) |
| `mountWorld.test.ts` | 198 | Node test that mount feeds the world and that teardown leaves nothing behind, including on failure | rewrite | Keep the fake pattern (vi.hoisted fake handle, FakeResizeObserver, FakeIntersectionObserver, stubbed document with a listener set, expectNothingLeft). Feed it a tiny in-memory scene source instead of the zustand game store. Drop the audio fake, the useUiStore checks and the 'unknown phase shows garage' case. Replace that case with 'an out-of-range office index shows the garage' if the builder clamps. | vitest (exists); ../engine: createInitialState (gone, today's engine exports createGame); ../state/useGameStore: useGameStore (gone); ../state/useUiStore: useUiStore (gone) | itself; needs a fake WorldHandle and stubbed DOM globals, no WebGL |
| `mountWorld.ts` | 217 | Imperative mount: createWorld, subscription to the game store, snapshot plus event diff, ResizeObserver, IntersectionObserver and visibilitychange pause, an undo stack for teardown, DEV debug global, sound | rewrite | New mountWorld(canvas, viewport, stage, source: { get(): OfficeScene; subscribe(cb): () => void }). Keep the proven parts: createWorld inside try, where WorldUnsupportedError sets status 'unsupported' and any other error is logged first. Keep the undo stack, which runs in reverse and keeps going when a step throws (rethrowing the first error); ResizeObserver to handle.resize, skipping zero sizes and repeats; IntersectionObserver plus visibilitychange to handle.setPaused(document.hidden \|\| !onScreen); a first scene with no events; deriveSceneEvents(prev, next) on each change; and the DEV window.__startupWorld. Drop audio, inspector, worldSounds, ActionSignal/seq and useUiStore. | ../audio/worldAudio: createWorldAudio, WorldAudio (gone); ../state/useGameStore: useGameStore (gone); ../state/useUiStore: useUiStore (gone); ../types/game: GameState (gone) | mountWorld.test.ts (node: vi.mock of createWorld, audio and environment; vi.stubGlobal for window, document, ResizeObserver, IntersectionObserver) |
| `names.test.ts` | 363 | Name collision tests, and blurbs pinned to old engine rules | drop | Dropped with names.ts. | vitest; ../types/game (gone); ../engine (gone exports); ../engine/actions (gone); ../engine/economy (gone); ../engine/events/pool (gone); ../engine/testHelpers (gone); ../engine/tick (gone) | pure |
| `names.ts` | 229 | Seeded employee names, plus titles, team names and blurbs for the ten old roles | drop | Design C9: the team is anonymous people in three departments, so names have no use. The role vocabulary is for the old ten roles. | ../types/game: TeamRole (gone) | names.test.ts |
| `outcomes.ts` | 22 | WIN_ENDINGS, isWinEnding, isLossEnding, isPromotion over the old endings and phases | drop | Replaced by OfficeScene.ending ('win' \| 'loss' \| null). Promotion becomes next.office > prev.office. Its users (Lighting, crew, FxSystem, OfficeStage) switch to those. | ../types/game: CompanyPhase, EndingType (gone) | none |
| `phase.ts` | 31 | worldPhaseOf: an unknown saved phase is shown as the garage | drop | Its idea moves into the scene builder: clamp the office index to 0..4, so an unknown value shows the garage. | ../types/game: CompanyPhase (gone) | none |
| `snapshot.test.ts` | 584 | Tests of the snapshot built from old engine states | rewrite | New officeScene.test.ts on createGame plus src/engine/careerKit.ts (CAREER_TEST, withCareer, OFFICES 4/9/22/40/150, all present today). Check that sum(departments) + away + leaving equals Company.headcount, the office/capacity/era/year mapping, the clamping, and that castOf ids are stable across years and capped at 64. | vitest (exists); ../types/game (gone); ../engine: createInitialState, executeCommand (gone); ../engine/economy (gone); ../engine/testHelpers: makeState, makeTycoonState (gone) | pure |
| `snapshot.ts` | 282 | GameState to WorldSnapshot: the one place the old world read engine state (people with names and looks, staff, builds, candidates, assets) | rewrite | Two new pure files. (1) officeSceneOf(...) builds an OfficeScene from today's Company, Plan, CareerRules and GameState (fields in the answer). (2) castOf(scene, cap = 64), on the world side, returns PersonView[] with stable ids `${department}-${i}` (plus one for the person away), look = hashText32(seed, id), and hiddenPeople for those past the cap. That is the reusable idea of buildPeople at lines 104-166, without names. | ../types/game: AssetId, GameState, TeamRole, TeamRoster (gone); ../engine/economy: calcNetBurn, calcRunwayWeeks, getEffectiveMaxAp (gone); ../engine/context: computeTeamSize (gone); ../engine/assets: ALL_ASSET_IDS, ASSET_CATALOG, phaseAtLeast (gone); ../engine/founders: isSetupComplete (gone); ../engine/people: listCandidates, rosterForWorld, PersonFacts (gone); ../engine/projects: listBuilds, productSummary (gone) | snapshot.test.ts (pure) |
| `targets.ts` | 26 | targetKey and sameTarget for InteractableTarget | with edits | Remove the `asset` case, and the `station` case if stations are dropped. Add a case for any new target, such as { kind: 'zone'; department }. A switch with no default breaks the build when the union changes, which is good. | none | none |
| `types.ts` | 23 | Barrel re-exporting the nine type files | with edits | Change `export * from "./types/snapshot"` to `export * from "./types/scene"`. Because of this barrel, every file that imports from "../types", even for QualityLevel, fails until all nine type files compile. | none | none |
| `types/events.ts` | 65 | WorldEvent union of 40 kinds, CruftBand, MoatBand | rewrite | A 6-kind union (verified it compiles): run-reset; year-advanced { year }; office-changed { from; to }; hired and departed { department; personIds; count? }; game-over { ending: 'win' \| 'loss' }. | ../../types/game: AssetId, CompanyPhase, EndingType, OfferKind, ReceptionTier, Stage, TeamRole (gone) | none |
| `types/fx.ts` | 41 | FxApi, BurstKind, FloatTone, BubbleIcon | as is | none (verified); some kinds (money, bugs) will go unused | three: type * as THREE (ok) | none |
| `types/geometry.ts` | 29 | Vec2, Vec3Like, Placement and the axis conventions | as is | none (verified) | none | none |
| `types/handle.ts` | 85 | WorldHandle, WorldCallbacks, ScreenPoint, ScreenRect, WorldFocusOptions, InteractableHit | with edits | setSnapshot(next: OfficeScene, events?) (renaming to setScene is optional). Change the comment on resetCamera ('phase's default framing') to the office. Verified it compiles. | none | none |
| `types/interaction.ts` | 41 | InteractableTarget union and the registry contract | with edits | Remove the { kind: 'asset'; assetId } variant and the AssetId import (verified). Decide on { kind: 'station' }, since the new game has no stations. Add { kind: 'zone'; department: Department } for design 10.2, where touch moves aim at a team's area. | three: type * as THREE (ok); ../../types/game: AssetId (gone) | none |
| `types/office.ts` | 57 | OfficeLayout (floor, seats, door, stations, wander spots, camera) and StationKind | with edits | Change `phase: CompanyPhase` to `tier: OfficeTier` and delete assetAnchors (verified it compiles). Keep StationKind until the office folder decides. The founderSeat and cofounderSeat fields need a decision, because the new team has no founders. | ../../types/game: AssetId, CompanyPhase (gone) | none |
| `types/seating.ts` | 39 | Seat, SeatChange, SeatingApi | as is | none | none | none |
| `types/snapshot.ts` | 202 | WorldSnapshot, PersonView, StaffView, BuildView, ReleaseView, ProductView, CandidateView, ActionSignal | rewrite | New types/scene.ts, about 50 lines. It holds OfficeScene (11 fields), Department (same strings as the engine's, declared here so the world imports nothing from the engine), OfficeTier = 0..4, SceneEnding, MAX_SCENE_PEOPLE = 64, and PersonView { id; kind; role: Department \| null; name; look }. That keeps seating, crew and Character down to type swaps. | ../../types/game: AssetId, BuildSize, BuildType, CofounderArchetype, CompanyPhase, EndingType, FounderArchetype, OfferKind, PricingModel, QuirkId, ReceptionTier, SoundHint, Stage, TeamRole, TeamRoster (gone) | none |
| `types/system.ts` | 123 | WorldSystem, WorldContext, WorldSignals, the sound sink and listener, WorldOptions, QualityLevel | with edits | Import OfficeScene from ./scene and use it in applySnapshot(next, prev, events). Renaming to applyScene is optional. Verified it compiles with only that change. The sound listener types can stay unused (sound is out of scope). | three: type * as THREE (exists once three is installed) | none |

### The question this reader answered

## 1. What the old WorldSnapshot holds and who reads it

`types/snapshot.ts:116-178` (built by `snapshot.ts:236-282`) has these fields:

- **Identity:** `runId`, `setupComplete`, `companyName`, `founderName`, `founderArchetype`, `cofounderArchetype`
- **Clock:** `week`, `ap`, `maxAp`, `phase`, `stage`
- **Money and market:** `cash`, `netBurn`, `runwayWeeks`, `valuation`, `users`, `mrr`, `pricingModel`
- **Mood:** `reputation`, `morale`, `cohesion`, `stress`, `volatility`
- **People:** `team`, `teamSize`, `people[]` (PersonView {id, kind, role, name, look}, capped at `MAX_WORLD_PEOPLE` = 64), `hiddenPeople`, `staff[]` (energy, offers, build)
- **Product:** `builds[]`, `product`, `candidates`
- **Assets and endings:** `ownedAssets`, `availableAssets`, `pendingEventTitle`, `gameOver`

Readers, found by grepping every non-test file outside dev/:

| Field | Read by |
|---|---|
| runId | core/World.ts:307 (hard reset); mountWorld.ts:167 (clears the selection) |
| setupComplete | World.ts:331-332 (founder-only roster); Lighting.ts:189; OfficeStage.ts:212; crew.ts:328 |
| phase | World.ts:323-325 (layout), :494 (reframe); OfficeSystem.ts:76 (rebuild the stage); fx/particles.ts; office/StageKit.ts |
| ownedAssets / availableAssets | World.ts:323, 482-489 (layout key, bounds, framing); AssetSlots.ts:31-32; OfficeStage.ts:159, 330 |
| people | World.ts:331 into SeatingPlan.reconcile; EmployeeSystem.ts:122; crew.ts:356-360 (cast reconcile); DeskSlots.ts:296 (screen kind by role) |
| hiddenPeople | World.ts:332 (overflow sign) |
| staff | EmployeeSystem.ts:204 (markers); crew.ts:327 (energy); markers.ts:48 |
| gameOver | Lighting.ts:188; EmployeeSystem.ts:209; crew.ts:329; OfficeStage.ts:212, 223, 358 |
| ap, maxAp | Lighting.ts:190 (time of day) only |
| morale, stress | crew.ts:325-326 only |
| week, reputation, builds, product.slots, users, pendingEventTitle, pricingModel, runwayWeeks, companyName | OfficeStage.ts:100-109, 160-220, 343-356 (calendar, kanban, server rack, phone, pricing board, alarm, sign); builds also markers.ts:45 |
| team | FxSystem.ts:241 (fallback count for hired/departed) |
| founderName, archetypes, cash, netBurn, valuation, mrr, cohesion, volatility, teamSize, candidates | No system reads these. Only ui/inspector.ts, the HUD and picking read them. |

**Events.** `deriveWorldEvents(prev, next, action)` (`events.ts:286-354`) emits 40 kinds (`types/events.ts:5-55`) in six fixed groups:

1. Structural: setup-completed, phase-changed, stage-changed, departed, resigned, hired, asset-acquired.
2. Action outcome: week-advanced, event-resolved, then at most one of ship / launch / pitch / raise / board-action / pricing-changed / easter-egg / command-failed.
3. Builds.
4. People.
5. cash-changed, users-changed, event-opened.
6. game-over.

`run-reset` is emitted alone when runId changes or the week goes backwards. Hired and departed are per role, with ids found by set difference (`missingFrom`, lines 117-127) and a `count` when the 64 cap hides some.

Who consumes which events:

- **World:** run-reset, phase-changed.
- **Lighting:** run-reset, week-advanced (night-to-sunrise sweep), event-opened (flicker), setup-completed and game-over (slow fade). `Lighting.ts:263-285`.
- **OfficeSystem:** run-reset, ship, launch, released, build-started, build-cancelled, surprise, pricing-changed.
- **crew.ts:** run-reset and week-advanced (`:321, :334`), setup-completed, and hired/departed through `coveredBy` (`:180, :383, :436`). Named people walk in or out; anyone else pops or vanishes. Also reactions to ship, launch, pitch, raise, offers, energy and phase.
- **EmployeeSystem:** experience, offer-landed, retained.
- **FxSystem:** nearly all of them; hired/departed give the '+N' float at the door (`:236-243`).

## 2. The smallest new input: OfficeScene

Proposed file `src/world/types/scene.ts`. It imports no three and no engine. I compiled it against the restored types and core.

```ts
export type Department = "product" | "growth" | "recruiting"; // same strings as engine Department (types.ts:16)
export type OfficeTier = 0 | 1 | 2 | 3 | 4;
export interface OfficeScene {
  readonly runId: string;   // `${seed}:${Company.id}:${Company.career.founded}`; the seed comes from the store (gameStore.ts:25), GameState has none
  readonly seed: number;    // looks (hashText32(seed, personId)); same store seed
  readonly year: number;    // CareerRules.firstYear + GameState.turn - 1
  readonly office: OfficeTier;  // PublicCareer.office (types.ts:528); fallback officeFor(Company.headcount, career) (career.ts:7); clamped 0..4
  readonly capacity: number;    // CareerRules.offices[office].capacity (OfficeConfig, types.ts:457): 4/9/22/40/150
  readonly era: string;         // id of the last EraConfig with firstYear <= year (types.ts:467); the groundwork maps every id to one look
  readonly departments: Readonly<Record<Department, number>>; // Plan.allocation, from the draft or Company.lastPlan (types.ts:26, 116)
  readonly away: number;        // Plan.raisePercent > 0 ? 1 : 0 (raising takes one person off work, types.ts:34)
  readonly leaving: number;     // Plan.layoffs
  readonly arriving: number;    // expected hires: projectTurn(...).hires (project.ts Projection), capped by Plan.hireLimit; 0 if unknown
  readonly ending: "win" | "loss" | null; // GameState.outcome.winnerId === Company.id gives win; Company.out or another winner gives loss
}
```

- **Invariant to test:** sum(departments) + away + leaving = Company.headcount.
- **Last year's flows** (for playback), if wanted later: `CompanyReport.headcount` gives joined = hired + poachedIn and left = laidOff + poachedOut + lostToEvent. A move comes from `CompanyReport.career.office {from, to}` or `PublicReport.career.movedTo`.
- **Builder location:** put the pure builder outside the three.js layer, for example `src/ui/officeScene.ts` next to viewModel.ts, or one world file allowed `import type` from the engine. A no-restricted-imports rule can then keep the rest of src/world off the engine.
- **People:** the world turns counts into people with a pure `castOf(scene)`. It gives PersonView ids `${dept}-${i}` and `away-0`, kind 'employee', role = department, look = hashText32, capped at 64, plus hiddenPeople.
- **Events** come from two scenes, in 6 kinds: run-reset, year-advanced, office-changed, departed, hired, game-over.

What reads what in the new design:

| Reader | Uses |
|---|---|
| World | runId, office (and era) for the layout, castOf for seating, office-changed for reframing |
| Office system | office, era, ending |
| People system | departments, away, leaving, arriving, ending; hired/departed; year-advanced |
| Lighting | ending, year-advanced, game-over |
| Fx | hired/departed counts, office-changed |

## 3. Create, resize, pause, dispose, and what the React shell does

**Create.** `createWorld(canvas, callbacks, options)` (`World.ts:683`):

1. `acquireContext` asks for webgl2 first. It cancels a pending context release for this canvas (the StrictMode remount) and throws `WorldUnsupportedError` if there is no context or it is lost (`:108-125`).
2. The WebGLRenderer is built on that context; if it throws, that also becomes WorldUnsupportedError (`:224-234`). Then `configureRenderer` runs.
3. It builds CameraRig, Lighting, Interaction and Fx, and registers office, people, lighting and fx in the SystemRunner (`:271-275`).
4. It adds the context lost/restored listeners, `watchPixelRatio` (a matchMedia resolution query), `applySize` from the canvas's CSS box, and starts the rAF loop.

**Resize.** `handle.resize(w, h)` calls `applySize`: setPixelRatio(min(devicePixelRatio, the governor's cap of 2 or 1.5)), setSize(w, h, false), rig.setViewport, then an immediate render so the browser does not paint a blank frame (`:550-561`).

**Pause.** `setPaused` calls `syncLoop`. The loop runs only when it is not paused, the context is not lost and the world is not disposed. On restart the first dt is 0 and the governor warms up again (`:582-595`). Each frame clamps dt to 0.1 s, runs the systems, then the rig and interaction, then renders and feeds the governor (`:597-650`).

**Context loss.** It calls preventDefault, stops the loop and fires onContextLost. On restore it resumes (`:660-673`).

**Dispose.** In order (`:401-451`):

1. Stop the loop and remove the listeners.
2. Collect the materials on stage, stop the runner, dispose Interaction, then `disposeTree` on every scene child and dispose each collected material. The second pass is deliberate; a comment says not to deduplicate it.
3. `disposeSharedResources()` frees the module-level caches.
4. `renderer.resetState()`, then `renderer.dispose()`.
5. `releaseContextWhenOrphaned`: after 300 ms, WEBGL_lose_context is called if the canvas has left the page.

A new run (runId change or run-reset) rebuilds only the office and people systems and resets fx and seating (`:460-474`).

**What the React shell must do.** The shell is WorldView.tsx plus mountWorld.ts:

1. Render one div and one `<canvas role="img">` with no tabIndex.
2. In one `useEffect([stage])`, call the mount and return its teardown.
3. The mount wraps createWorld in try/catch. WorldUnsupportedError sets status 'unsupported', which means the 2D screens take over.
4. Feed the first scene with no events, then each new scene with the derived events.
5. A ResizeObserver on the viewport calls `handle.resize`, skipping sizes of 0 and unchanged sizes.
6. IntersectionObserver plus `visibilitychange` call `setPaused(document.hidden || !onScreen)`.
7. Teardown is an undo stack run in reverse that keeps going when a step throws, and ends in `handle.dispose()`.
8. On context loss, show a 'Reload 3D view' button. It bumps a key so React replaces the canvas element, because a lost canvas cannot get a new context.
9. Never keep a world alive across unmounts: the caches are module-level, so only one world can exist at a time.
10. Load WorldView lazily so three stays in its own chunk.

## 4. How the tests run without WebGL

There is **no fake of three.js**.

- Vitest runs in node with no jsdom. Tests import the real `three` and use only the parts that need no GL: Scene, lights, cameras, Vector3.project, Raycaster, WebGLRenderTarget as a stand-in shadow map (Lighting.test), and the math in CameraRig.test.
- I confirmed this in scratch: CameraRig, SystemRunner and Lighting tests ran green against three@0.187.0 in node.
- `textures.ts` returns null without `document`, so props fall back to flat colours. Nothing in a test constructs WebGLRenderer, which throws 'document is not defined' in node.
- The only file using vi.mock is `mountWorld.test.ts`. It replaces `./core/World` with a fake WorldHandle (vi.fn for setSnapshot, resize, setPaused, setSelected, hiddenCount, dispose), fakes the audio and environment, and stubs the globals `window`, `document` (with a listener set), `ResizeObserver` and `IntersectionObserver` with classes that track what is still alive. Its `expectNothingLeft()` checks are reusable as they are.
- office/props.test.ts also stubs `document`; that file is outside my folders.
- What the fake pattern cannot cover: World.ts itself (context, renderer, loop, dispose). That needs the real-browser check.

### An order that compiles and passes at each step

1. 0. package.json: add three 0.187.0 and @types/three 0.187.0 as exact versions (no caret), matching the old lockfile.
2. 1. Leaves with no dependencies (verified unchanged): core/math.ts, core/adaptiveQuality.ts, core/adaptiveQuality.test.ts, core/lightingState.ts, hash.ts (plus a new hash.test.ts), types/geometry.ts, types/fx.ts.
3. 2. The whole types layer in one step, because the barrel needs all of it: new types/scene.ts (replaces types/snapshot.ts), new types/events.ts, edited types/office.ts and types/interaction.ts, types/seating.ts as-is, edited types/system.ts and types/handle.ts, edited types.ts barrel, edited targets.ts.
4. 3. Art kit: edited core/colors.ts, then core/materials.ts, core/geometry.ts, core/textures.ts, core/models.ts, core/sharedResources.ts, core/palette.ts (all as-is).
5. 4. core/SystemRunner.ts with its one-line edit, and core/SystemRunner.test.ts with a literal scene fixture; core/rendererLook.ts; core/CameraRig.ts as-is, and core/CameraRig.test.ts without the building-framing block.
6. 5. Edited core/Lighting.ts and core/Lighting.test.ts.
7. 6. New pure files and their tests: officeScene builder (from engine types, tested with careerKit), castOf, sceneEvents. These replace snapshot.ts and events.ts.
8. 7. After the office folder restores office/layouts.ts and office/framing.ts: edited core/layoutBounds.ts and its test; the CameraRig building-framing tests move into the office framing test.
9. 8. After office/OfficeSystem, people/seating, people/EmployeeSystem, interaction/Interaction, fx/FxSystem and ui/environment are restored: edited core/World.ts.
10. 9. After ui/stage.ts: rewritten mountWorld.ts and mountWorld.test.ts, then WorldView.tsx with its edits; then the dev page and the browser check.
11. Not restored at all: events.ts, events.test.ts, snapshot.ts, snapshot.test.ts, names.ts, names.test.ts, outcomes.ts, phase.ts, types/snapshot.ts (replaced).

### Risks

- The barrel src/world/types.ts re-exports types/snapshot.ts and types/events.ts, which import the gone src/types/game.ts. So every file that imports from "../types" fails to compile until all nine type files are fixed, even files whose own text is unchanged (CameraRig, rendererLook, SystemRunner). Restore the types layer as one step, first.
- Today's src/config.ts has no career block. The five offices at 4/9/22/40/150 exist only in the test helper src/engine/careerKit.ts (OFFICES, CAREER_RULES). The scene builder's tests must use careerKit or their own fixture until plan 1 ships the real career config.
- GameState has no seed (only the store has one, src/state/gameStore.ts:25). runId and the look seed must be passed in from outside, or derived from Company.id, career.founded and the name.
- The design (section 10.6) wants a redraw only when something changes. Old World.ts runs a continuous requestAnimationFrame loop whenever it is visible and not paused, and the crew idles and wanders. Either accept that or add idle detection; rig.isAnimating exists, the systems have no such flag. This is a plan decision, not a restore.
- Module-level caches for materials, geometry and textures mean one world at a time, and dispose frees them all. The dev page and any game screen must never both mount a world, and a second view (the market) would need per-world caches.
- Capacity against the old plans: the old plans held 3/8/20/36/48 desks plus 4/6/8/10/12 overflow spots. Re-keyed to 4/9/22/40/150 they need more seats; the campus at 150 is far past the 64-figure cap and the 48-desk plan, so it relies on hiddenPeople and the overflow sign. The design's 300-draw-call phone budget and about 8 draw calls per figure (up to 512 at 64 people) may force instanced far figures.
- The old office is built around a founder and a cofounder: PersonKind, founderSeat and cofounderSeat in OfficeLayout, FOUNDER_OUTFIT, crew logic. The new team is anonymous departments. Decide whether one founder figure stays, for example as the person away raising money, before re-keying the layouts.
- Lighting loses its whole time-of-day model, because it was driven by AP (5 tests). A year has no inner clock, so pick the resting look (morning, or the era's mood) and decide whether the sweep plays on each End year. The flicker on an opened event and the dark setup look have no counterpart yet.
- Coverage that disappears: hash.ts was tested only inside snapshot, names and events tests (2,032 test lines dropped). Add a small hash.test.ts. Also, events.test scanned the engine's command source, a pattern that no longer applies.
- vitest.config.ts includes only src/**/*.test.ts, so a .tsx test (for WorldView) would be silently ignored. The old project had the same rule; keep React-free logic in .ts.
- colors.ts keys (ROLE_COLORS, PHASE_THEMES, phaseTier) are imported by files in other folders (people/Character, office/dressing, DeskSlots, props/decor, building, stations). Renaming them must be coordinated with those folders' restores, or the old names kept as aliases.
- threejs-facts.md section 4 says, from memory, to create the canvas inside the effect. The old proven code lets React render the canvas and survives StrictMode through pendingContextRelease plus a keyed remount (World.ts:104-139, WorldView.tsx). Keep the old way unless the browser check shows a problem, and do not mix the two.
- Department strings must stay identical to the engine's Department (src/engine/types.ts:16) while the world declares its own copy to keep the boundary. Make the builder's test check that, for example with `satisfies Record<EngineDepartment, ...>`, so a rename cannot go unnoticed.
- Only the real-browser check can cover World.ts: there is no node test for context creation, renderer setup, the loop or dispose.


## The office (src/world/office)

The 28 files in src/world/office at 63b4bed hold 13,193 lines: 19 in office/ (6,763) and 9 in props/ (6,430). I read every file, and I tested them in a scratch copy only; the repository was not touched. In that copy, with the old engine and types next to them, all 265 office tests pass under today's Vitest 4.0.18 with three 0.187.0 in node. layouts.test's 156 tests pass with no three installed at all. tsc also passes with the repository's strict flags (erasableSyntaxOnly, verbatimModuleSyntax, noUnused*), so moving to today's toolchain is not the risk. The work is the old-game types.

Today there is no src/types folder, no src/engine/assets.ts and no createInitialState, and `three` is not installed. The 7 files I call as-is change no line, but they still need three back, the rebuilt src/world/types barrel and a re-keyed core/palette from other folders. Those 7 are timing, motion, PropSet, mergeStatic, pathfinding, props/shared, props/parts and props/markers. 17 need edits; the common edit is CompanyPhase becoming an office index 0 to 4 and AssetId being removed. 2 should be rewritten: OfficeStage, and OfficeSystem.test, which builds its state from the old engine. 2 should be dropped: AssetSlots and props/assets, the purchasable helicopter, jet, yacht, lounge and office upgrade.

The office tiers are a table of five hand-drawn plans, one per old CompanyPhase, with 3, 8, 20, 36 and 48 desks. Each plan also has 2 founder seats and 4, 6, 8, 10 and 12 overflow beanbags. Once the founder seats count as ordinary desks, the plans already seat 5, 10, 22, 38 and 50. That covers 4, 9 and 22 now. Adding one bench pair to the unicorn plan and moving one plant gives 40; I checked this and all 156 layout rules still pass. For 150, I recommend keeping the 50-desk plan and showing the rest as a count, the same mechanism the old office used for people past its last desk.

### Files

| File | Lines | What it does | Verdict | Edits, or why | Imports from outside the world | Test |
|---|---|---|---|---|---|---|
| `office/AssetSlots.ts` | 147 | The 5 purchasable assets: nothing while locked, a blueprint ghost with a price while for sale, the real prop once owned, plus paving under outdoor assets. | drop | The new game has no purchasable assets; spec 10.1 drops the old game's 'purchasable toys'. Nothing in the career needs a blueprint ghost or a price tag. | three: type * as THREE (gone today; comes back with the dependency); ../../engine/assets: ASSET_CATALOG (gone: no src/engine/assets.ts); ../../types/game: AssetId (gone: no src/types) | Covered by OfficeSystem.test.ts (priceLabel, 'OfficeSystem assets' block). Needs real three in node. |
| `office/DeskSlots.ts` | 364 | One desk + chair group per seat: lit or dark by occupancy, chairs that roll with signals.chairsOut, 'Empty desk — hire' targets, up to 6 floating '+' markers, and a beanbag under each overflow sitter. | with edits | (1) FOUNDER_DESK_STYLE: Record<CompanyPhase,…> (l.64-70) and the founder/cofounder slots (l.117-118, chairKey FOUNDER_CHAIR/COFOUNDER_CHAIR) go once founder seats become ordinary deskSeats; the people/approach import then goes too. (2) sync(snapshot: WorldSnapshot, …) (l.153) becomes sync(scene, …). showScreenFor (l.294-301) reads snapshot.people[].role and SCREEN_FOR_ROLE; replace it with a department lookup, e.g. seating.departmentOf(id) or a desk→department map, and SCREEN_FOR_DEPARTMENT. (3) accentFor (l.282-287) colours only coworking hot desks by slot; make it the occupant's department colour. The accent is part of createDesk's bake key, so a recolour means swapping the desk the way setUpgraded does (l.218-227). (4) setUpgraded/upgraded (the office-upgrade asset) go, or become the recolour path. (5) Decide whether to keep the 'empty-desk' target with EMPTY_DESK_LABEL and the vacant '+' markers (MAX_VACANT_MARKERS, syncMarkers l.318-341). Both were the old hire UI; hiring now lives in HTML. | three: * as THREE (gone; comes back); ../../types/game: CompanyPhase (gone) | OfficeSystem.test.ts. Needs real three in node, a recording registry and people/seating. |
| `office/OfficeStage.ts` | 429 | One built office for one phase: shell, desks, the eight command stations, dressing, assets, event beacon, low-runway alarm and the '+N more people' sign; sync() applies each snapshot incrementally. | rewrite | About half of it is old game, so a new file of roughly 150 lines is cheaper. Copy over: the constructor wiring (buildShell, addDoorClickArea l.313-326, DeskSlots, dressOffice), the Registrar methods, unregisterAll, the door that follows doorTraffic (openDoor/update l.235-254), setGlow, dispose (including shell.merged), and setOverflowCount (l.399-428), fed from seating.hiddenCount(). Leave out: STATION_LABELS (old commands, l.43-52), DOOR_LABEL 'Front door — roadmap', BEACON_LABEL and setBeacon (pending event), LOW_RUNWAY_WEEKS and setAlarm, wallBuilds (BuildView), syncStations (week, reputation, builds, users, pendingEventTitle, pricingModel, l.341-350), syncUpgrade, AssetSlots and isLossEnding. Fixtures are built as plain props at layout.stations. The new sync(scene, animate) takes the new office-scene type: office index, people per department, arrivals and leavers, company name. | three: * as THREE (gone; comes back); ../../types/game: AssetId, CompanyPhase (gone) | OfficeSystem.test.ts (real three in node). |
| `office/OfficeSystem.test.ts` | 714 | Node tests for OfficeSystem, OfficeStage, DeskSlots, AssetSlots, StageMotion and decor sizes, with a real THREE.Scene, a recording registry and a real SeatingPlan. | rewrite | makeState builds an old GameState and runs it through buildWorldSnapshot. A new fixture should build an office scene directly. Keep the RecordingRegistry and Harness pattern (l.48-170) and these tests: door + fixtures registered, fixtures where the plan says, free desks offered, chair on seat, no rebuild on a headcount change, overflow beanbags + sign count, dispose leaves nothing, and the tier-change block (swap with no stale registrations, done in ≤1.2 s, instant on first build and under reduced motion, back-and-forth mid transition, reset). Also keep decor fits its footprint, and move StageMotion (l.561-608) into motion.test.ts. Drop: assets, beacon, alarm, pricing, priceLabel, 'stations in step with snapshot', the office upgrade, and the end-of-run blocks. | three: * as THREE (gone; comes back); vitest: describe, expect, it (exists); ../../engine/assets: ASSET_CATALOG (gone); ../../engine: createInitialState (gone; src/engine/index.ts exists but no longer exports it); ../../types/game: AssetId, CompanyPhase, GameState, TeamRole (gone) | Itself. Needs real three in node (Scene, OrthographicCamera), no DOM and no WebGL. 86 tests passed in the scratch copy. |
| `office/OfficeSystem.ts` | 197 | The office WorldSystem: builds an OfficeStage per phase, sinks the old one and raises/pops the new one, pushes dusk glow, ticks props, and reacts to a few old events. | with edits | applySnapshot(next: WorldSnapshot, prev, events) (l.72) takes the new scene type, matching whatever the new WorldSystem contract is. l.75 detects a reset with events.some(type === 'run-reset'); take that from the new input, e.g. a run id or a reset flag. l.76 `this.stage.phase !== next.phase` becomes `this.stage.office !== next.office`. rebuild(snapshot) (l.124-153) passes the scene to the new OfficeStage. Delete react() (l.167-196): ship, launch, pricing-changed, released, build-started, surprise and build-cancelled are old events. The rebuild, reveal, glow and dispose code is generic and stays. | three: * as THREE (gone; comes back) | OfficeSystem.test.ts (real three in node). |
| `office/PropSet.ts` | 78 | Bookkeeping for one office's props: which tick, which glow at dusk, and freeing them all. | as is | No change. | three: type * as THREE (gone; comes back) | No own test. Exercised by OfficeSystem.test and props.test. |
| `office/StageKit.ts` | 89 | Scaffolding of one built office: root/structure/contents groups, its PropSet, and the order pieces pop in. | with edits | `readonly phase: CompanyPhase` (l.24, set from layout.phase l.36) becomes `readonly office: OfficeIndex` (layout.office), with the root name `office:${index}`. If era looks come later, add a `look` field here rather than re-keying again. | three: * as THREE (gone; comes back); ../../types/game: CompanyPhase (gone) | Indirect (OfficeSystem.test). |
| `office/dressing.ts` | 392 | Set dressing: builds each floor-plan DecorSpot as its prop, then a hand-written scene per phase (wall art, rugs, lamps, street, trees, skyline, company name sign). | with edits | The DECOR_FACTORIES phase argument (l.96) becomes office index or look; this touches only bookshelf, coffee-table, reception and meeting-pod. createDecorProp(phase, spot) (l.121) likewise. SCENES: Record<CompanyPhase, Scene> (l.376) becomes a 5-element array indexed by office. coworkingScene and unicornScene read PHASE_THEMES.coworking/.unicorn (l.279, l.327); re-key them with core/palette. publicScene's stock ticker (tickerSymbol, l.357) should depend on 'listed' or be left as decor. The company name sign stays, fed from the scene's company name. | ../../types/game: CompanyPhase (gone) | OfficeSystem.test 'floor-plan décor' (createDecorProp sizes). |
| `office/footprints.ts` | 602 | Pure floor geometry: furniture sizes, per-phase station and ground sizes, rotated-rectangle maths and each layout's obstacle list. | with edits | STATION_SIZES (l.57), SKYLINE_HEIGHTS (l.218) and GROUND_MARGINS (l.238) are keyed by CompanyPhase; key them by office index, e.g. readonly arrays of 5. groundRect (l.266) and stationFootprint (l.375) read layout.phase; read layout.office instead. Delete ASSET_SIZES, ASSET_HEIGHTS, ASSET_IDS, OUTDOOR_ASSET_IDS (l.115-139), AssetObstacle, assetFootprint (l.380) and the indoor-asset loop in buildObstacles (l.572-579). This frees the bar/lounge floor patches in the office/unicorn/public plans. DeskOwnerKind 'founder'/'cofounder' goes once founder seats are ordinary desks. | ../../types/game: AssetId, CompanyPhase (gone) | layouts.test.ts. Pure, no three, no DOM. |
| `office/framing.ts` | 206 | Pure isometric framing maths: the shot (target, width, height) that fits floor, back walls and outdoor assets; viewHeightForFrame. | with edits | Remove the AssetId import. computeLayoutFrame(layout, framedAssets, ground) loses framedAssets and its loop (l.114-117), and its Pick becomes 'floor'. computeBuildingFrame(layout, ownedAssets) loses ownedAssets and its loop (l.184-187), and its Pick becomes 'floor'\|'door'. Callers in core (World.ts, CameraRig) change in step. | ../../types/game: AssetId (gone) | layouts.test.ts and core/CameraRig.test.ts (pure). |
| `office/layouts.test.ts` | 1040 | Rule tests for every plan (capacity, sizes, nothing overlaps, clearance behind seats, reachability from the door, framing) plus footprint maths and the findPath suite. | with edits | Re-key PHASES and SPEC (l.56-64) to office indices with the new seat counts: desks including the old founder seats are 5/10/22/40/50 after the unicorn change. Add a test that seats ≥ min(capacity, visible cap). The founder/cofounder parts of allSeats (l.73-86) follow the layout change. Delete the asset tests: l.348-368 (outdoor parking), l.369-387 (espresso and lounge indoors), the asset parts of l.388-485, l.557-610 (memoised per asset set, purchases, hangouts, assets kept from a bigger past, building frame with owned assets), l.643 (unknown asset ids), the isOutdoorAsset use, and ALL_ASSETS (l.66). Change l.647 (unknown phase draws the garage) to 'an out-of-range index is clamped'. The findPath block (l.786-1040) and footprint maths stay unchanged. | vitest: describe, expect, it (exists); ../../engine/assets: ALL_ASSET_IDS (gone); ../../types/game: AssetId, CompanyPhase (gone) | Itself: pure, needs no three and no DOM (156 tests, about 2.4 s, verified). |
| `office/layouts.ts` | 825 | The five hand-drawn floor plans (pure data with drafting helpers), memoised getOfficeLayout(phase, ownedAssets), layout frames, doorExterior; also re-exports footprints, framing and pathfinding. | with edits | PLAN_BUILDERS: Record<CompanyPhase,…> (l.663) becomes a readonly array of 5. planFor (l.696) clamps an index instead of calling worldPhaseOf. getOfficeLayout(phase, ownedAssets, knownKey) (l.760) becomes getOfficeLayout(office); the key is the index, since the layout no longer depends on purchases. Delete layoutVariant/officeLayoutKey (l.715-737) or reduce them to the index. Remove assetAnchors, assetWanderSpots, bar, lounge, patioLounge, outdoorAnchors, BEYOND_PATIO (l.158-194) and isOutdoorAsset (l.824), keeping a lounge spot as a wander spot if wanted. Merge founderSeat/cofounderSeat into deskSeats. Unicorn: l.488 bench('z', 2.9, -4.2, 5) becomes 6 pairs, and the plant at l.539 (3.825,3.2) moves to (3.825,4.5); this gives 38 desks + 2 = 40 seats, verified with 156/156 rules passing. Add per-plan desk groups (the seat ranges each bench() call returned) for department zones. Optionally rename the five plans to garage/shared/own/floor/campus. | ../../engine/assets: ASSET_CATALOG, phaseAtLeast (gone); ../../types/game: AssetId, CompanyPhase (gone) | layouts.test.ts (pure). |
| `office/mergeStatic.ts` | 100 | Merges a stage's static shell meshes into one mesh per material, to cut draw calls. | as is | No change. | three: * as THREE (gone; comes back); three/addons/utils/BufferGeometryUtils.js: mergeGeometries (gone; ships with three and is typed by @types/three 0.187.0) | No own test. Exercised through shell in OfficeSystem.test. |
| `office/motion.ts` | 135 | StageMotion: pop, rise and sink tweens for the office rebuild, with no allocation per frame. | as is | No change. | three: type * as THREE (gone; comes back) | The StageMotion block in OfficeSystem.test.ts (l.561-608) needs only THREE.Object3D/Group in node. Move it to motion.test.ts. |
| `office/pathfinding.ts` | 574 | Walking routes: a 0.4-unit occupancy grid per layout, A*, line-of-sight straightening, door routing; findPath, isWalkable, pathLength. | as is | No line changes. It reads only layout.floor and layout.door and the footprints helpers. It compiles once ../types exposes OfficeLayout and Vec2 without the old types/game import. | none | The findPath suite in layouts.test.ts (l.786-1040), pure. |
| `office/props.test.ts` | 531 | Node tests for palette helpers and every prop in the catalog: mesh budgets, build/animate/dispose, cache-key collisions, outward winding, desk/station/asset footprints. | with edits | CompanyPhase/PHASES become office indices or looks (phasesFor l.63). The ROLE_COLORS test ('a shirt colour for every role', l.127) becomes department colours. Drop ASSET_SIZES, ASSET_FOOTPRINTS, createAsset, createHelicopter and makeBlueprint from the imports, and the 'assets' block (l.472-511). Change the stations block (l.409-470) to match the stations decision: plates gone, so l.434 'command plate' goes. STATION_FOOTPRINTS is re-keyed. | three: * as THREE (gone; comes back); vitest: afterEach, describe, expect, it, vi (exists); ../../types/game: CompanyPhase (gone) | Itself. Needs real three in node, plus a fake canvas through vi.stubGlobal('document', …) (l.112-123). 23 tests passed in the scratch copy. |
| `office/props.ts` | 18 | Barrel that re-exports the nine prop modules. | with edits | Delete `export * from "./props/assets"` (l.16), and stations or catalog too if those are dropped. Note that catalog exports a type named PropSet, the same name as the PropSet class in office/PropSet.ts. That is harmless today because StageKit imports the class from ./PropSet directly. | none | none |
| `office/props/assets.ts` | 746 | Purchasable asset props (office-upgrade espresso bar, executive lounge, helicopter, jet, yacht) and makeBlueprint (translucent ghost + price tag). | drop | Everything here is the old game's purchasable assets. If a lounge is wanted as decor later, createLounge (l.141) can be copied out as a decor factory. | three: * as THREE (gone; comes back); ../../../types/game: AssetId (gone) | props.test.ts 'assets' block. |
| `office/props/building.ts` | 952 | Building kit: floor slabs and ground per phase, road, driveway, walls with windows/glass, corner post, kerb, framed and garage doors, rugs, floor/pendant lamps with fake light pools, signs, neon signs, wall art. | with edits | FLOOR_STYLES (l.62), drawFloor and createFloor, drawGround and createGround (their phase === 'garage'/'coworking'/'public' branches), WALL_STYLE_FOR_PHASE (l.244) and createDoor(phase) (l.446) take an office index or look instead of CompanyPhase. Delete the '> phases' command plate in createDoor (l.461). Everything else is generic. | three: * as THREE (gone; comes back); ../../../types/game: CompanyPhase (gone) | props.test.ts (real three in node + canvas stub). |
| `office/props/catalog.ts` | 396 | Every prop factory listed once, with budget, mount and a demo driver, for the dev gallery and props.test. | with edits | create(phase: CompanyPhase) becomes create(look or office). Remove the assets entries and the assets import (l.7). Remove PRICING_CYCLE and the pricing-board entry (l.188, ~l.270-280), plus the build-board and calendar-week demos to match the stations edits. Keep it: the planned development page can reuse it, and props.test's budget, dispose and cache-collision checks run over it. | ../../../types/game: CompanyPhase, PricingModel (gone) | props.test.ts iterates over PROP_CATALOG. |
| `office/props/decor.ts` | 993 | Décor factories: plants, bookshelf, filing cabinet, boxes, couch, coffee table, water cooler, whiteboard, car, bicycle, pegboard, ping-pong, arcade, vending, trophy shelf, stock ticker, reception, meeting pod, trees, bush, street lamp, bench, background buildings. | with edits | Only createBookshelf (l.67), createCoffeeTable (l.212), createReceptionDesk (l.736) and createMeetingPod (l.773) take CompanyPhase through PHASE_THEMES/phaseTier; change them to office index or look, including their bake keys `bookshelf:${phase}` etc. Nothing else changes. | three: * as THREE (gone; comes back); ../../../types/game: CompanyPhase (gone) | props.test.ts. |
| `office/props/markers.ts` | 254 | Markers: event beacon '!', low-runway alarm light, and the '+N more people' overflow sign. | as is | No change needed to compile. The beacon and alarm become unused (old-game signals) and can be deleted later. The overflow sign is needed; if it should show a count per department, createOverflowSign/drawCount (l.193-252) needs a small edit. | three: * as THREE (gone; comes back) | props.test.ts. |
| `office/props/parts.ts` | 350 | Sub-assemblies stamped into props: 5 chair styles, monitors (flat, wide, CRT, laptop) and their screen quads, keyboard, mouse, mugs, cans, paper, books, pots, plants. | as is | No change. The CRT monitor here is a ready-made 1990s piece. | none | props.test.ts. |
| `office/props/shared.ts` | 606 | Prop plumbing: PropHandle contract, PropKit, shapeMesh, hash01, screen textures and surfaces (code/terminal/chart/design/sheet/deck/arcade), command plates, Pulse, texturedPlane. | as is | No change. addCommandPlate and plateFace become unused once the plates are removed from stations, building and shell; noUnusedLocals does not flag unused exports. | three: * as THREE (gone; comes back) | props.test.ts. |
| `office/props/stations.ts` | 1607 | The eight command stations per phase tier: product wall with build board, growth corner, investor line, board table, wall calendar, coffee machine, server rack, pricing board; each with a '> command' plate. | with edits | CompanyPhase becomes office index or look throughout (stationFootprint, STATION_FOOTPRINTS l.67, every createX(phase)). Delete STATION_COMMAND (l.76-85) and all 13 addCommandPlate(kit, …) calls. Delete WallBuild, TIER_COLORS, drawBuildBoard and setBuilds (about l.99-292 plus the board texture l.410-435 and setBuilds l.478-488), keeping the board, sticky notes and pulse. Delete createPricingBoard and PRICING_MODELS (l.1455-1580, PricingModel). Remove CoffeeMachineOptions.upgraded (office-upgrade asset). setWeek becomes setYear or the calendar goes; drawWeekPage already shrinks the font for numbers longer than 2 digits. STATION_FACTORIES/StationHandles (l.1584-1607) shrink to match. If StationKind is renamed in types/office.ts, rename it here too. | three: * as THREE (gone; comes back); ../../../types/game: CompanyPhase, PricingModel (gone) | props.test.ts 'stations' block and OfficeSystem.test. |
| `office/props/workstations.ts` | 526 | Desks in 5 styles (garage plywood + beige tower + CRT, hotdesk laptop, standard, premium sit-stand, executive), chair, floating '+' vacant marker, beanbag overflow spot. | with edits | DESK_STYLE_FOR_PHASE: Record<CompanyPhase, DeskStyle> (l.36) is keyed by look; it is the era hook, since 'garage' is already a 1990s desk. SCREEN_FOR_ROLE: Record<TeamRole \| 'founder' \| 'cofounder', ScreenKind> (l.57) becomes SCREEN_FOR_DEPARTMENT, e.g. {product: 'code', growth: 'chart', recruiting: 'sheet'}. The `upgraded` option (second monitor + neon strip = office-upgrade asset, deskMonitors l.81-119, drawUpgradeStrip l.122) is dropped or reused as a look variant. | three: * as THREE (gone; comes back); ../../../types/game: CompanyPhase, TeamRole (gone) | props.test.ts 'workstations' block. |
| `office/shell.ts` | 298 | The building per phase: ground tile, floor slab, two back walls with windows, kerbs, corner post, framed door or garage roll-up door; then merges the static parts. | with edits | SHELL_SPECS: Record<CompanyPhase, ShellSpec> (l.62) becomes a 5-element array. buildShell reads kit.phase (l.231), which becomes kit.office. Delete createRoadmapPlate (the '> phases' plate, l.223-228) and its use on the roll-up door (l.283-287), since there is no terminal any more. createDoor(phase) changes in building.ts. | three: * as THREE (gone; comes back); ../../types/game: CompanyPhase (gone) | OfficeSystem.test.ts (real three in node). |
| `office/timing.ts` | 24 | Pure constants for the rebuild: sink 0.4 s, rise after 0.22 s over 0.5 s, contents pop 0.55-1.15 s. | as is | No change. | none | Indirect (OfficeSystem.test 'within 1.2 seconds'). Also used by people/crew.ts. |

### The question this reader answered

**1. How a plan is described.** A plan is pure data. The type is `OfficeLayout` (`src/world/types/office.ts`): `phase`, `floor` rect, `founderSeat`, `cofounderSeat`, `deskSeats: Placement[]` in fill order, `overflowSpots`, `door`, `stations: Record<StationKind, Placement>`, `stationStandSpots`, `wanderSpots`, `assetAnchors: Record<AssetId, Placement>` and `camera`. A `Placement` is `{x, z, facing}`, and a seat is where the person sits, with the desk `DESK_OFFSET` (0.55) in front of them.

`layouts.ts` builds each plan with drafting helpers (l.63-156): `at`, `centredFloor`, `onBackWall` (l.82), `onSideWall` (l.86), `inFrontOf` (l.90) and `bench(along, x, z, pairs)` (l.145), which returns facing desk pairs A0, B0, A1, B1 and so on. Each plan is a `FloorPlan` (l.52), which is the layout plus `assetWanderSpots` and `decor`. The plans are garage 8×7 (l.212), coworking 12×10 (l.283), office 17×13 (l.362), unicorn 23×17 (l.461) and public 27×19 (l.572). `PLAN_BUILDERS: Record<CompanyPhase, …>` (l.663), `planFor` (l.696) and `getOfficeLayout(phase, ownedAssets, knownKey)` (l.760) deep-freeze and cache them. Décor is kept in a WeakMap beside the layout (`registerLayoutDecor`, `footprints.ts` l.539).

Other tables are keyed by the same phase:
- `STATION_SIZES`, `GROUND_MARGINS`, `SKYLINE_HEIGHTS` (`footprints.ts` l.57, l.238, l.218)
- `SHELL_SPECS` (`shell.ts` l.62)
- `SCENES` (`dressing.ts` l.376)
- `DESK_STYLE_FOR_PHASE` (`workstations.ts` l.36)
- `FOUNDER_DESK_STYLE` (`DeskSlots.ts` l.64)
- `FLOOR_STYLES` and `WALL_STYLE_FOR_PHASE` (`building.ts` l.62, l.244)
- `PHASE_THEMES` and `phaseTier` (`core/colors.ts` l.150, l.179)

`layouts.test.ts` enforces the rules for every plan: nothing overlaps, at least 0.9 clear behind each seat, and every seat reachable from the door.

**2. Desks per plan and what happens past the last one.**

| plan | desks | where | founder seats | overflow beanbags |
|---|---|---|---|---|
| garage | 3 | l.236 | 2 | 4 |
| coworking | 8 | `bench("x",…,4)`, l.306 | 2 | 6 |
| office | 20 | 2×bench 3 + 2×bench 2, l.385-392 | 2 | 8 |
| unicorn | 36 | benches of 7, 6, 5 pairs, l.484-489 | 2 | 10 |
| public | 48 | 6×bench 4, l.595-603 | 2 | 12 |

The test table is at `layouts.test.ts` l.58-64.

People past the last desk are handled in three layers:
1. `people/seating.ts` `reconcile` (l.69-84) gives each person the lowest free desk, then the lowest free overflow spot, then "hidden". Within one office it is sticky; a different office reseats everyone in roster order.
2. `DeskSlots.syncCushions` (l.344-363) puts a beanbag (`createOverflowSpot`) under each overflow sitter.
3. `OfficeStage.syncMarkers` (l.358) and `setOverflowCount` (l.399-428) stand a "+N more people" picket sign beside the door (`createOverflowSign`, `markers.ts` l.210). The count is `seating.hiddenCount()`, which also includes `snapshot.hiddenPeople`, the people past `MAX_WORLD_PEOPLE = 64` (`snapshot.ts` l.27; passed in at `core/World.ts` l.332-333).

**3. How a tier is chosen and swapped while running.** The old engine's `computeCompanyPhase` (`engine/progression.ts`) picked the phase from valuation plus users, MRR or team size, with no ratchet, so the office could shrink. `worldPhaseOf` (`phase.ts`) maps unknown values to garage.

On each snapshot, `World.setSnapshot` (`core/World.ts` l.322-327) computes `officeLayoutKey(phase, ownedAssets)` and only fetches `getOfficeLayout` when the key changes. Seating then reconciles against the new layout.

`OfficeSystem.applySnapshot` (l.72-94) rebuilds when `stage === null || stage.phase !== next.phase || run-reset` (l.76). `rebuild` (l.124-153) unregisters the old stage's targets and sinks it 2.4 units over 0.4 s, then disposes it. It builds a new `OfficeStage` from `ctx.getLayout()`. `reveal` (l.156-164) raises the structure after 0.22 s over 0.5 s and pops the contents in build order between 0.55 and 0.85 s, 0.3 s each, so everything is in place by 1.15 s (`timing.ts`). The change is instant on the first snapshot, under reduced motion, and on a reset (l.74-77). All other snapshots are applied incrementally by `OfficeStage.sync`.

**4. The eight stations.** `StationKind` is in `types/office.ts` l.11-19. Labels are `STATION_LABELS` (`OfficeStage.ts` l.43-52); terminal plates are `STATION_COMMAND` (`stations.ts` l.76-85); factories are at `stations.ts` l.1595-1604.

| station | plate | what it was | drawn at |
|---|---|---|---|
| ship | `ship` | product wall with sticky notes and the build board | l.294 |
| launch | `launch` | growth corner: chart and megaphone | l.525 |
| investors | `pitch` | investor line: phone on a stool, booth, then podium | l.703 |
| boardroom | `board` | board table | l.902 |
| calendar | `end` | wall calendar showing "WEEK n" | l.1038 |
| coffee | `coffee` | coffee machine (drip, bean or espresso) | l.1189 |
| servers | `status` | server rack, `setLoad` from users | l.1398 |
| pricing | `pricing` | pricing board, `PricingModel` | l.1464 |

Their live behaviour is in `OfficeStage.syncStations` (l.341-350) and `OfficeSystem.react` (l.167-196).

**5. What must change for offices 0 to 4 holding 4, 9, 22, 40 and 150.**
- **Type:** add `type OfficeIndex = 0|1|2|3|4` in `src/world/types/office.ts`. `OfficeLayout.phase` becomes `office`, and `assetAnchors` goes.
- **Plan table:** `PLAN_BUILDERS` becomes a 5-element array. `planFor(i)` clamps the index instead of calling `worldPhaseOf`, and `getOfficeLayout(office)` drops `ownedAssets` and `knownKey`; the layout no longer depends on purchases. Every other `Record<CompanyPhase,…>` table listed in section 1 becomes an array of 5.
- **Assets:** delete `AssetSlots`, `props/assets.ts`, the asset sizes and obstacles, and the asset parameters in `framing.ts`.
- **Founder seats:** the new game has no founders as people, so merge `founderSeat` and `cofounderSeat` into `deskSeats`. Seats then become 5, 10, 22, 38 and 50, which already covers 4, 9 and 22.
- **Unicorn to 40:** change `bench("z", 2.9, -4.2, 5)` at l.488 to 6 pairs and move the plant at l.539 from (3.825, 3.2) to (3.825, 4.5). I tried this in a scratch copy: the first run found exactly that desk-plant clash, and after the move all 156 layout rules pass.
- **Overflow:** tiers 0 to 3 keep their beanbags and sign for the people hired in a year beyond capacity, which is when the company moves up. This is honest: the room really is too small until next year. For 150, see section 7.
- **Capacities:** the world must not import the engine (spec 10.4). Mirror `[4, 9, 22, 40, 150]` (`src/engine/careerKit.ts` l.14-18; `officeFor` is at `career.ts` l.67) in a layout test, and cross-check it against the career config in the scene-mapping test.

**6. Grouping seats by the three departments.** `bench()` already returns each bench's seats as a contiguous run, so record per plan `deskGroups: readonly (readonly number[])[]`, the desk indices of each bench or pod in fill order.

Add a pure `departmentSeats(layout, {product, growth, recruiting})` that hands out desks group by group in the order product, growth, recruiting. Each department then occupies contiguous benches; when a desk runs out mid-bench, the department continues on the next desk. People are anonymous, so reseating each year costs nothing. Seating's sticky roster-order rule in `people/seating.ts` gives way to department zones.

For colour, `createDesk` and `createChair` already take an `accent`. `DeskSlots.accentFor` (l.282-287) becomes the department's colour. The accent is part of the bake key, so a recolour swaps the desk the way `setUpgraded` does (l.218-227). The screen picture comes from the department: `SCREEN_FOR_ROLE` (`workstations.ts` l.57) becomes `SCREEN_FOR_DEPARTMENT`. The garage's 3 desks are one irregular group.

**7. Which furniture is generic and which is old game.**

Generic:
- `parts.ts`: 5 chair styles; flat, wide, CRT and laptop monitors; clutter; plants.
- `shared.ts`: PropKit, screens, Pulse, signs.
- `workstations.ts`: 5 desk styles, chair, beanbag.
- `building.ts`: floors, ground, road, driveway, walls and windows, kerbs, doors, roll-up garage door, rugs, lamps with light pools, sign, neon sign, wall art.
- All of `decor.ts`.
- The overflow sign.
- Once their plates are removed: board table, coffee machine, server rack, the product wall as a plain board, growth corner, investor phone booth.

Several props are already period pieces: the garage desk (plywood on sawhorses, beige tower, CRT), the drip coffee machine and the beige server tower read as 1990s; the laptop hot desk as 2010s; the sit-stand desk with a wide monitor as 2020s.

Old game:
- All purchasable assets (office upgrade, lounge, helicopter, jet, yacht, blueprint and price tag) and `AssetSlots`.
- Every "> command" plate: `STATION_COMMAND`, the door's "phases" plate (`building.ts` l.461, `shell.ts` l.223-228 and l.283-287).
- The build board (`WallBuild`), the calendar's "WEEK n" page and the pricing board (`PricingModel`).
- The coffee machine's and desks' "upgraded" variants.
- The event beacon and low-runway alarm.
- The vacant "+" markers and the "Empty desk — hire" target.
- The stock ticker, unless it is tied to going public.

One structural catch: the old code uses phase for both room size and furniture polish (`phaseTier` is called throughout the props). Give the factories a separate look argument now, even with only one look, or their signatures change twice when eras arrive.

**8. Showing 150 people.** The largest plan has 48 desks, 50 seats once the founder seats are merged. The cheapest honest option is to keep that plan, with no new plan or furniture, and seat up to 50 people. Count the other 100 on the existing overflow sign, relabelled "+N elsewhere on campus" and ideally split by department. Drop the beanbags at the campus, since it never overflows: recruiting stops at 150.

This is exactly what the old code already does for people past the last desk and past the 64-figure cap, and spec 10.6 chose it ("a bigger company shows the rest as a count, as the old office did"). The public plan's skyline of background buildings already makes the room read as one floor of something larger.

Two caveats. First, make "visible seats" and "capacity" separate fields, so a test asserts seats ≥ capacity for offices 0 to 3 and seats = 50 for office 4. Second, 50 figures at 8 draw calls each is 400, over the spec's 300-call phone budget. The people folder must cap the visible figures lower or draw the far ones instanced; that is not an office problem.

### An order that compiles and passes at each step

1. (before office) three@0.187.0 + @types/three@0.187.0; new src/world/types (geometry, office with OfficeIndex, seating, interaction without assets) and the barrel without snapshot/events; core/palette re-keyed by office index/look and department
2. src/world/office/timing.ts
3. src/world/office/motion.ts (+ new motion.test.ts made from the StageMotion block of OfficeSystem.test l.561-608)
4. src/world/office/footprints.ts
5. src/world/office/framing.ts
6. src/world/office/pathfinding.ts
7. src/world/office/layouts.ts
8. src/world/office/layouts.test.ts
9. src/world/office/mergeStatic.ts
10. src/world/office/props/shared.ts
11. src/world/office/props/parts.ts
12. src/world/office/props/building.ts
13. src/world/office/props/workstations.ts
14. src/world/office/props/decor.ts
15. src/world/office/props/markers.ts
16. src/world/office/props/stations.ts
17. src/world/office/props.ts
18. src/world/office/props/catalog.ts
19. src/world/office/props.test.ts
20. src/world/office/PropSet.ts
21. src/world/office/StageKit.ts
22. src/world/office/shell.ts
23. src/world/office/dressing.ts
24. src/world/office/DeskSlots.ts (after people/approach and people/seating are restored)
25. src/world/office/OfficeStage.ts (rewritten)
26. src/world/office/OfficeSystem.ts
27. src/world/office/OfficeSystem.test.ts (rewritten; needs interaction/hitProxy, targets, core/lightingState and the new scene type)
28. (not restored) src/world/office/AssetSlots.ts, src/world/office/props/assets.ts

### Risks

- No office file compiles before two other folders are rebuilt. Every file imports the `../types` barrel, which re-exports old-game types (snapshot.ts, events.ts, interaction.ts import ../../types/game, AssetId, StationKind). Every prop file imports `core/palette`, whose colors.ts keys PHASE_THEMES, PHASES, phaseTier by CompanyPhase and ROLE_COLORS by TeamRole. Even pathfinding.ts, which changes no line, waits for them.
- There is a circular dependency across folders: office/DeskSlots imports FOUNDER_CHAIR/COFOUNDER_CHAIR from people/approach, and people/approach imports office/layouts. Restore layouts before people and DeskSlots after people/approach, or drop the founder chairs, which the new game no longer needs.
- The old code uses phase for both the room's size and the furniture's polish (phaseTier is called throughout props; DESK_STYLE_FOR_PHASE, FLOOR_STYLES, SHELL_SPECS). If groundwork keys everything by office index alone, every factory signature changes again when era looks arrive. Pass a separate `look` argument from the start, even with one look.
- The 'as is' results (265 tests, clean tsc) were measured with the old src/engine and src/types copied beside the files. In today's repository those are gone, so the as-is files only stay unchanged; they cannot run alone.
- Founder and cofounder seats are special throughout: the OfficeLayout fields, seatKind on obstacles, signals.chairsOut keys -1/-2, seating rule 2, FOUNDER_DESK_STYLE, and the layouts.test 'founders in different seats' test. Merging them into deskSeats touches the people folder as well.
- Removing assets changes geometry. The indoor bar and lounge patches were reserved floor (obstacles) even when unbought, and framing widened the shot for assets on sale. Routes, layouts.test framing assertions ('does not waste the shot', 'grows with the company') and core/CameraRig.test, which calls getOfficeLayout(phase, assets), all need updating together.
- The eight station rectangles shaped every plan and are obstacles. Deleting them frees floor but invalidates hand-placed décor and wander spots and changes the rule tests. Keeping the slots and only stripping their old-game content (plates, build board, pricing) is the cheapest path that keeps layouts.test green.
- Bake and texture cache keys embed phase strings (`ship:${phase}`, `desk:${shapeKey}:${accent}`, `bookshelf:${phase}`). After re-keying they must stay unique per office and per look; the props.test 'no cache-key collisions' test catches mistakes. Department colours as desk accents add bake variants: 5 styles × 3 accents × busy/vacant × 3 clutter variants.
- The capacity numbers live in src/engine/careerKit.ts, which the career track is still changing, and spec 10.4 forbids the world importing the engine. Duplicate [4, 9, 22, 40, 150] in a world test, and cross-check it against the config in the scene-mapping module's test so a rules change cannot silently desync the office.
- At the campus, 50 visible figures at 8 draw calls each is about 400 calls, over the 300-call phone budget in spec 10.6. The office side is fine, but the people folder must cap or instance figures. The '+N' sign shows one number; a count per department needs a small edit to createOverflowSign/drawCount.
- noUnusedLocals: deleting the beacon, alarm, assets and pricing code in OfficeStage and stations leaves module-level constants (ALARM_*, SERVER_FULL_LOAD_USERS, TYPE_LABELS, READY_GOLD, …) unused. tsc and lint fail until they are deleted too. Unused exports such as addCommandPlate are not flagged.
- props.test stubs the global `document` (vi.stubGlobal, unstubbed in afterEach), and OfficeSystem.test builds real THREE scenes in node. Both work under Vitest 4 without jsdom. layouts.test has an 'is fast enough to call for every walk' timing assertion that may flake on a slow CI runner.
- `three/addons/utils/BufferGeometryUtils.js` (mergeStatic) is typed only by @types/three, which must match three exactly (0.187.0). Spec section 10.6 and threejs-facts.md warn that r188 changes lighting, so pin both without a caret.
- The scratch copy for these experiments is at /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/office/try. Its node_modules is a symlink to the repository's node_modules, and three was installed into try/src/node_modules only. Do not run npm install in try/ itself: that would write into the repository's node_modules.


## Interaction and people (src/world/interaction, src/world/people)

I read all 26 files in src/world/interaction (7) and src/world/people (19) at 63b4bed in full, after reading the three earlier notes and design sections 10 and C9. I then ran a trial in a scratch folder, with three@0.187.0 and @types/three@0.187.0 installed from npm. The interaction folder and pathFollower/random worked almost unchanged once the old files sat beside a minimal new types barrel that has no old-game types. The repo's strict tsc settings pass. The repo's ESLint with --max-warnings=0 passes. Vitest passes 48 of 48 (Interaction 34, pathFollower 14). The only edit needed was 9 'station' target literals in Interaction.test.ts. On the people side, Character.ts compiles once a TeamRole type is provided, and I measured its real cost in node (numbers in the answer). The rest of the people folder is bound to the old game in four ways: TeamRole types, the old office layouts (station spots, five phases, assets), the snapshot seam and testKit (which built an old GameState), and crew.ts's scripted reactions. markers.ts and its test should not come back. Files I wrote: /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/people/inventory.md (the full table), /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/people/notes.md, and the trial project /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/people/try. The repository is untouched (git status is empty).

### Files

| File | Lines | What it does | Verdict | Edits, or why | Imports from outside the world | Test |
|---|---|---|---|---|---|---|
| `interaction/HighlightRing.ts` | 228 | Unlit shader ring on the floor (hover and selected styles) with a fixed on-screen line width and an optional pulse. | as is | None. | three: * as THREE (gone today) | Tested indirectly: the Interaction tests build the ring in node with real three. |
| `interaction/Interaction.test.ts` | 714 | 34 tests: registry, picking, nested objects, hidden and stale objects, hit proxies, thin lines, anchors, gestures, footprints, screenBounds, wheel zoom reports. | with edits | Change the 9 literals { kind: 'station', station: 'ship' \| 'servers' \| 'coffee' \| 'investors' } at lines 47, 48, 51, 52, 146, 147, 154, 189 and 245 to members of the new InteractableTarget union. Lines 146/147 need two distinct keys; line 189 needs a key distinct from 'empty-desk'. If the union drops 'empty-desk', 'person' or 'door', change those literals too. In scratch, after mapping the stations to { kind: 'zone', department }, all 34 tests pass and tsc and eslint are clean. | three: * as THREE (gone today); vitest: describe, expect, it (exists) | Itself. Real three and real CameraRig in node, stub canvas, no DOM. |
| `interaction/Interaction.ts` | 526 | Pointer, wheel and Safari-gesture handling; hover re-pick every 0.25 s; selection; both rings; tracking of the selected item's anchor; screenBounds. | as is | No code change. Optional: the comments at lines 80-84 and 339-343 justify mousedown preventDefault by 'the terminal'. Reword them to the HTML panels (the behaviour, not stealing focus, is still wanted). | three: * as THREE (gone today) | Interaction.test.ts. Uses a stub canvas object and real CameraRig and three; no DOM. |
| `interaction/footprint.ts` | 102 | Measures an object's local bounds and the rounded rectangle on the ground where the highlight ring goes. | as is | None. | three: * as THREE (gone today) | Interaction.test.ts 'highlight footprint' block. Needs real three, no DOM. |
| `interaction/gestures.ts` | 184 | Turns raw pointer samples into tap, pan and pinch: 6 px click threshold, second finger, pinch hand-off. | as is | None. | none | Interaction.test.ts 'GestureRecognizer' block. Pure logic. |
| `interaction/hitProxy.ts` | 85 | Invisible pick boxes (addHitBox, addHitProxy) that give small props and peg people a comfortable hit area. | as is | None. | three: * as THREE (gone today) | No test of its own (picking tests cover the hitProxy flag). EmployeeSystem uses addHitBox. |
| `interaction/picking.ts` | 210 | Registry of clickable objects plus the raycast that picks between them. It needs no DOM; an entry only counts while it is attached and visible. | as is | None. Verified in scratch against a new barrel that has no old-game types. It needs targets.ts and types.ts to be game-free first. | three: * as THREE (gone today; must be installed) | Interaction.test.ts. Needs real three in node, no DOM. |
| `people/Character.test.ts` | 326 | 13 tests: deterministic looks, role colours, outfits, variety, mesh budget 6-12, seat heights, head anchor, blending, walking, slouching, tint, cache-key collisions, geometry sharing. | with edits | Change ROLES (line 17) to the three departments. Replace the TeamRole import (line 3). Change ROLES[seed % 9] (line 110) to % ROLES.length. Adapt or remove the founder/cofounder/executive outfit test (lines 90-102) per the decisions. The other tests carry over. | three (gone today); vitest (exists); ../../types/game: TeamRole (gone) | Itself. Real three in node, no DOM. |
| `people/Character.ts` | 829 | Peg figure: 8 baked vertex-coloured meshes on a rig (torso, head, 2 arms, 2 thighs, 2 shins), 9 procedural poses blended over 0.2 s, look derived from a uint32 seed, lazy props (lap laptop, phone, carry box), owns no GPU resources. | with edits | Line 19: replace TeamRole with the scene's own department type (or PersonView['role']); do not import src/engine from the drawing layer. Re-key ACCESSORY_ODDS (lines 139-150) to product/growth/recruiting. Reduce the drawTorso role switch (lines 270-308) to three department tells. Remove the executive suit branch (lines 194-212). Keep or remove the founder/cofounder outfit branch (lines 171-189) per the founder decision. Update the CharacterLook.role type (line 112). ROLE_COLORS in core/colors.ts must be re-keyed by department (another folder). Recommended addition: setRole(role), which swaps the torso and arm meshes for the new team's baked geometry (bakeModel caches by key), so a team change is a recolour, not a new body. In scratch, the file compiled unchanged against a 2-line TeamRole stub. | three: * as THREE (gone today); ../../types/game: TeamRole (gone) | Character.test.ts. Real three in node, no DOM. |
| `people/EmployeeSystem.test.ts` | 424 | 15 tests: personLabel, carrying the box, seating on the first snapshot, labels and anchors, walk-in, leaver, id reuse, sparkles, rebuild without zero-scale bodies, applying while paused, chairsOut/vacated, dispose, no growth over hire/fire cycles. | with edits | Replace the GameState import and company/hired/departed (lines 3, 21) with the new kit. Change the personLabel test (124-133) to team labels. Drop setup/founder (240-250) and ship sparkles (319-336). Re-point or drop the bankruptcy/vacated tests (357-391). Rename role ids 'engineering'/'sales'/'design' to departments. Keep FakeRegistry and FakeFx. | three (gone today); vitest (exists); ../../types/game: GameState (gone) | Itself. Real three in node, fakes, no DOM. |
| `people/EmployeeSystem.ts` | 369 | The three.js side of the people: a Character per Actor, sync each frame (pose only when changed), hit box and registration, door-traffic, chairsOut and vacated signals, bubbles and dust through ctx.fx. | with edits | Remove markers: import line 32, fields 99-100, construction 110-111, calls at 127, 134 and 138, and syncMarkers/react/headOf 200-241, plus StaffView. personLabel (65-69) becomes a team label (no names), and the roleTitle import (line 12) goes. applySnapshot (121-129) takes the new scene. Drop stream() (191-198) and StationKind. Optionally drop footfall (sound is out). It still needs ctx.fx (bubble, burst), so the fx folder or a no-op FxApi must exist; WorldContext/WorldSystem/WorldSignals come from a rewritten types/system.ts. If Character gains setRole, call it in sync() when actor.role changes. | three: * as THREE (gone today) | EmployeeSystem.test.ts. Real three in node, FakeRegistry, FakeFx, no DOM. |
| `people/actor.test.ts` | 712 | 41 tests: rest poses, arriving, never walking through furniture in every office, the chair dance, errands, hurry, seat changes, leaving, robustness. | with edits | Replace the phase strings 'garage'..'public' (lines 73, 223-224, 294, 553) with the five new office keys. Drop the asset lists (line 293 'office-upgrade','lounge','helicopter','jet','yacht'; line 697 ['lounge']). Replace layout.stationStandSpots.coffee (lines 329, 351, 358, 617, 630) with whatever errand spot the new layouts keep (wanderSpots[0] works). Change person() role 'engineering' (line 23) to a department. The new layouts must keep deskSeats, overflowSpots, door, wanderSpots and obstacle kinds 'desk'/'station' (line 228), or this test changes further. | vitest (exists) | Itself. Pure (no three). |
| `people/actor.ts` | 815 | One person's pure state machine: waiting, seated, rising, walking, pausing, settling, vanishing, gone. Walks in from the door, runs errands, leaves carrying a box, rolls the chair, has watchdogs (TRIP_LIMIT 45 s, walk slack 1.7x), resolves the pose. | with edits | Delete line 16 (TeamRole import). Line 142: readonly role: TeamRole \| null becomes readonly role: PersonView['role']. A department move must not re-create the actor, so role should become mutable (or the Crew identity check changes; see crew.ts). Comments about 'a new week' (line 27) are cosmetic. Nothing else is tied to the old game. | ../../types/game: TeamRole (gone) | actor.test.ts. Pure. |
| `people/approach.ts` | 80 | Finds the clear spot beside a chair to step into or out of; chairKey maps a seat to the chairsOut signal key. | as is | None, provided office/layouts keeps those four exports and SeatKind keeps 'founder' and 'cofounder'. If the founder seats are dropped, delete the two cases at lines 60-63 and the constants FOUNDER_CHAIR and COFOUNDER_CHAIR (lines 52-53). | none | Through actor.test.ts. Pure. |
| `people/crew.test.ts` | 1206 | About 60 tests on cast management, hiring, leaving, seats and offices changing, wandering, moods, reactions, weeks, run endings, door queueing, determinism and a 400-step hostile script. | with edits | Port and keep: helpers 72-108 (minus energyFor 77-84); who is in the office 110-139; hiring 180-261; leaving 263-353; seats and offices 355-460 (minus the asset swap 423-434); wandering 469-557; door queue 994-1084; lifecycle 1104-1206 (hostile script re-keyed to the five offices and three departments). Drop: setup/founder name 141-177; morale/stress 463-467 and 559-647; all reactions 650-866; week 868-925 (rewrite as year start); win/loss 927-992 and 1086-1101 (rewrite when the career's end is drawn). | vitest (exists); ../../types/game: GameState, TeamRole (gone) | Itself. Pure via the new testKit. |
| `people/crew.ts` | 965 | Director of the office people. Keeps the cast in line with every snapshot (instant, rebuild or live), queues walk-ins (0.4 s apart) and walk-outs, holds the doorway and queues leavers, runs ambient wandering, morale moods, founder pacing and scripted reactions to old-game events. | with edits | Heavy cut; cheaper than a fresh file because the generic half (door queue, staggering, id reuse) is intricate and tested. KEEP: reconcile 347-401, hire/walkIn/dismiss/remove 403-452, clearTransients 462-477, tickWander/pickWanderSpot/spotTaken 748-805, update 897-917, holdArrival/holdExit/queueBehind 943-964, wanderCap/spreadIndices/pacePoints. CHANGE: applySnapshot (314-344) takes the new office scene (people, arrived ids, left ids, office key) instead of WorldSnapshot + WorldEvent[]. coveredBy (180-181) reads arrived/left id lists. Line 368's identity check must ignore role so a team change is a rehome walk, not leave plus hire. rebuilt = layout.phase !== this.layout.phase (line 322) becomes the office key. pickWanderSpot (line 778) needs a coffee or errand spot. REMOVE: morale/stress/energy (46-50, 110-122, the energy line in applyRoutines 490, the mood parts of 487-494, tickAmbient 844-869, tickMood 872-893); react() 532-658 and BUILDER/GROWTH_ROLES 88-89 (replace with year beats later or nothing); founder logic (say, founder(), tickPace, coffeeRun: 659-663, 711-718, 808-841) unless founders survive; old outcomes/exodus (170, 336, 430-435, 454-459, 520-528) re-pointed to the career's end or removed; startMorning 500-517 becomes 'a year starts'; CrewHost.stream (201) and StationKind. | ../../types/game: EndingType, TeamRole (gone) | crew.test.ts. Pure via testKit. |
| `people/footfall.test.ts` | 152 | 7 tests for stepsFor and the cues that Footfall emits. | with edits | Line 2: replace the GameState import, and replace company()/hired()/departed() with the new scene kit. Change role ids 'engineering'/'design' to departments. Drop the coffee easter-egg test (lines 121-133). Rewrite the phase-changed test (lines 146-151) as an office move. Only needed if footfall comes back. | vitest (exists); ../../types/game: GameState (gone; src/types does not exist) | Itself. Pure through the Crew and the new testKit. |
| `people/footfall.ts` | 99 | Reads sound cues off the actors: arrival footsteps timed to the seat, a leaver's fading steps, a coffee trip, a chair taking an arrival's weight. | as is | No change to the file, but sound is outside the groundwork, so it can wait. If it waits, remove EmployeeSystem.ts lines 31, 97, 109, 260 and 265 (import, field, construction, two observe calls). | none | footfall.test.ts. Pure, via Crew and testKit. |
| `people/markers.test.ts` | 80 | 5 tests for markers, pizza boxes and personalEnergyCap. | drop | Goes with markers.ts. | vitest (exists); three (gone today); ../../engine: executeCommand (src/engine exists but no longer exports executeCommand); ../../engine/testHelpers: makeTycoonState (gone); ../../types/game: GameState, TeamRoster (gone) | Needs the old engine. |
| `people/markers.ts` | 282 | Old tycoon markers: offer envelopes with week countdowns, gold lead stars, pizza boxes on the desks of a crunching team (one InstancedMesh). | drop | Everything it shows (named staff's outside offers, build leads, crunch weeks) is gone from the new game. Its lines 141-233 are the only people-related InstancedMesh code and are a useful pattern for instanced far figures. Read them; do not restore them. | three: * as THREE (gone today); ../../types/game: OfferKind (gone) | markers.test.ts |
| `people/pathFollower.test.ts` | 193 | 14 tests for the angle helpers and PathFollower. | as is | None (14/14 pass in scratch). | vitest: describe, expect, it (exists) | Itself. Pure. |
| `people/pathFollower.ts` | 169 | Walks a polyline at a steady pace without leaving it; smooths the heading (TURN_RATE 9.5 rad/s); shuffles slowly while badly misaligned. | as is | None (verified). | none | pathFollower.test.ts. Pure. |
| `people/random.ts` | 38 | Seeded mulberry32 Rng for ambient behaviour (never Math.random). | as is | None (copied unchanged in scratch). | none | No file of its own. Covered by the actor.test 'rhythms' case. Pure. |
| `people/seating.test.ts` | 585 | 30 tests: founders, first seating, stability, departures, promotion off the floor, capacity, moving office, determinism. | with edits | Heavy but mechanical. roster() at line 25 must build PersonView[] straight from department counts instead of going through makeState and buildWorldSnapshot. Rename roles to product/growth/recruiting. Re-derive every expected slot index from the 4/9/22/40/150 plans; the old capacities are written into lines 31-33, 104-121 and 319-341 (garage 3+4, coworking 8+6, office 20+8, public 48+12). Drop the asset-layout tests (lines 439-454 and the 'office-upgrade' history entry at line 489). The logic tests carry over. | vitest (exists); ../../types/game: TeamRoster (gone); ../../engine/testHelpers: makeState (gone) | Itself. Pure. |
| `people/seating.ts` | 265 | Who sits where. It remembers seats, so a hire moves nobody else; promotes floor sitters to freed desks; reseats everyone in roster order when the office changes; counts hidden people. | with edits | Minimal: line 40 compares a.phase === b.phase. Change it to the new OfficeLayout's office key (index or id). Nothing else is needed to restore it. To get desks grouped by team (design 10.2): claimSpot (lines 247-259) must take the person's department and pick a free desk in that team's zone or pod before any other desk; updateInPlace (lines 155-209) must release and re-claim a seat when a kept id has changed department, which Actor.rehome then turns into a walk across the room. Keep the founder branches (lines 169-177, 225-230) only if founders survive. | none | seating.test.ts. Pure. |
| `people/testKit.ts` | 178 | Test scaffolding: builds an old GameState, Studio (state to snapshot to seating to layout, as World did), RecordingHost (a CrewHost that records), run(). | rewrite | New kit: scene({ office, teams: {product, growth, recruiting}, arriving, leaving, seed }) builds the new office scene. Studio.frame runs scene to cast (the new pure cast function: stable ids, minimal team moves, the 64 cap) to SeatingPlan.reconcile to layout. hired/departed helpers return id lists. RecordingHost (lines 113-171) and run() (174-178) can be copied nearly verbatim, minus streams/StationKind. | ../../engine: createInitialState (src/engine exists, export gone); ../../types/game: CompanyPhase, EndingType, GameState, TeamRole, TeamRoster (gone) | Used by the crew, footfall and EmployeeSystem tests. |

### The question this reader answered

## How people work today (63b4bed)

**Created.** The old seam put every person into `WorldSnapshot.people` as a `PersonView { id, kind: founder|cofounder|employee, role: TeamRole|null, name, look: uint32 }` (types/snapshot.ts:23-37). `look` was `hashText32(runSeed, id)` (snapshot.ts:108-156). The list was capped at `MAX_WORLD_PEOPLE = 64` (snapshot.ts:27); the people past the cap were counted in `hiddenPeople`.
- `SeatingPlan.reconcile(people, hiddenPeople, layout)` (seating.ts:84) gives each id a frozen Seat.
- `Crew.reconcile` (crew.ts:347-401) makes one `Actor` per person who has a seat. Whether a new actor walks in, pops in or is placed depends on `prev`, on 'run-reset', on a phase change, and on `coveredBy(events, 'hired', id)` (crew.ts:180, 378-384).
- `EmployeeSystem.spawn` (EmployeeSystem.ts:151-159) builds the body with `createCharacter(actor.person)`, adds a 0.66 x 1.6 hit box and registers `{kind:'person', personId}`.

**Given a look.** `deriveLook(view)` (Character.ts:154-217) seeds mulberry32 from `look` and picks skin, hair colour and style (10 styles), cap or beanie colour, accessory (odds by role, 139-150), height 0.92-1.08 and an animation phase.
- Shirt colour is `ROLE_COLORS[role]` with a small shade shift (214-216). The torso carries a role detail (270-308). Executives wear a suit; the founders have fixed outfits.
- Each body part is baked once per look key and shared (`bakeModel('character:'+key)`, 491-512). All figures share one vertex-colour material.

**Seated.** `SeatingPlan` remembers seats.
- In the same office: leavers free their seat; floor sitters are promoted to free desks; newcomers take the lowest free desk, then the lowest overflow spot, else they are hidden (155-209). Nobody else moves; a test confirms desks go out in hiring order, not by team.
- In a new office (`layout.phase` differs, line 40), everyone is reseated in roster order (211-244).
- The Actor sits with the chair dance: step out beside the chair (approach.ts), the chair rolls out over `CHAIR_SECONDS` 0.3, then settle and sit (actor.ts:556-590, 699-714).

**Animated.** Each Character has 16 channels (Character.ts:439-455), recomputed every frame from the pose, a clock and the walk stride. Pose changes blend with smoothstep over 0.2 s (803-816).
- The Actor resolves the pose from mode, routine (work, wait, celebrate, defeat), mood and emote (actor.ts:748-814).
- `EmployeeSystem.sync` copies position, facing, scale, pose, walk speed, energy and carrying onto the Character every frame. It only calls setPose when something changed (EmployeeSystem.ts:347-368).

**Walked.** `Actor.walkTo` (actor.ts:627-654) chains a chair step-out (`chairApproach`), then `findPath(layout, from, to)`, then a chair step-in.
- findPath is in office/pathfinding.ts: a 0.4-unit occupancy grid rasterised once per layout and cached in a WeakMap (430-439), A* on 8 neighbours, and line-of-sight pulling to straighten the route. Ends inside furniture are snapped. People enter and leave only through `layout.door` (533-557). If no route exists it returns `[to]`.
- `PathFollower` walks the route at 1.6 u/s, 2.2x when hurried, turning at most 9.5 rad/s (pathFollower.ts).
- Watchdogs: a walk may take 1.7x its ideal time plus 2 s; a trip lasts at most 45 s. When either fires, the person snaps home.
- The door: newcomers wait while anyone is exiting, leavers give way to arrivals, and leavers queue 0.65 apart (crew.ts:943-964). Each wait is capped at 12 s (actor.ts:38).
- Arrivals file in 0.4 s apart, but nobody waits more than 5 s (crew.ts:40-42, 412-417). So past about 12 arrivals in one batch, the rest start together at the door.

## What the code needs per person

- **Identity and look:** a stable `id` and a stable `look` seed. Crew re-creates the actor if look, role or kind changes (crew.ts:368).
- **Team:** `role`, used for colour, the torso detail, accessory odds and the reaction groups (crew.ts:88-89, 666-676).
- **Kind:** founder and cofounder get reserved seats (seating.ts:169-177), never wander or doze, and get bubbles and pacing.
- **Name:** only the hover label (EmployeeSystem.ts:65-69).
- **Staff stats:** `StaffView` energy only capped liveliness (crew.ts:121, 490); offers, lead and crunch drove markers.ts.
- **Company-wide:** morale and stress (moods and energy), setupComplete, gameOver, and phase through `layout.phase`.

None of the stats survive in the new game. Everything left fits `{ id, team, look }`.

## Smallest change: three counts, same figure in the same seat, visible arrivals and leavers

1. **A pure cast function** beside the scene type (tested in node):
   - Signature: `nextCast(prev: Cast | null, scene) -> { people: {id, team, look}[], hidden, arrived: id[], left: id[], nextId }`.
   - Ids are team-free (`p0`, `p1`, ...) from a counter carried inside the Cast. A fresh load starts canonical (`p0..pN-1`). `look = hashText32(seed, id)`. GameState has no seed today (it lives in gameStore), so the scene must carry one.
   - Leavers are the most recent joiners from teams that shrank. Arrivals get new ids, so nobody is a look-alike of the person who just left.
   - Team changes are the fewest moves needed to reach the new counts (the mock's untested syncPeople, done properly).
   - The scene's three counts come from `refitAllocation(company.lastPlan.allocation, company.headcount)` (src/engine/plan.ts:9-10, formulas.ts:122). That is the split the next plan starts from. Arrivals and leavers come from `CompanyReport.headcount` (hired + poachedIn; laidOff + poachedOut + lostToEvent).
2. **Feed the existing machinery unchanged:** people, a hidden count and `arrived`/`left` id lists. The latter replace the `hired`/`departed` events (crew.ts:180, 383, 436). The walk in through the door, the leaver carrying a box, the staggering, the door queue and id reuse all work as they are; the EmployeeSystem tests already cover a re-hire while the old holder is still walking out.
3. **Team moves as walks:** drop `role` from the identity check at crew.ts:368. Make `Actor.role` mutable (actor.ts:142). `SeatingPlan.updateInPlace` re-claims a seat when a kept id changed team; `Actor.rehome` then walks the person over. `Character.setRole` swaps the torso and arm geometry. Without this, a team change looks like a leave plus a hire.
4. **Teams grouped at their desks (design 10.2):** `claimSpot` takes the team and prefers that team's pod or zone. Recommended: desk pods that belong to the team of their first occupant until they empty, so no fixed shares are needed.
5. **A person away raising money:** reuse `signals.vacated`. The person keeps the seat but the desk goes dark (EmployeeSystem.ts:297-313). A small `stepOut`/`comeBack` errand on Actor shows them leaving and returning.

## The cap, what happens above it, and the cost of one more person

- **The cap:** 64 drawn people. It lived in the old snapshot.ts:27, which is gone, so the cast function must apply it again.
- **Above it:** people beyond the cap count toward `hiddenPeople`; people the plan has no spot for count as unseated. `SeatingPlan.hiddenCount()` is the sum (seating.ts:115), and the office's overflow sign shows it. Crew gives bodies only to people with a seat (crew.ts:365). Someone who loses a seat without leaving shrinks away (`Actor.vanish`, crew.ts:443).
- **Only the campus goes over:** the offices for 4, 9, 22 and 40 fit. The campus (150) draws 64 and counts 86. Two choices follow:
  - Give the campus about 64 desks plus a sign. Then choose the drawn 64 in proportion to the team counts, or the colours will misrepresent the teams.
  - Instance the far figures.

**Measured in node with real three r187** (scratch cost test):

| | 1 figure | 64 figures | 150 figures |
|---|---|---|---|
| Draw calls (meshes) | 8 | 512 | 1,200 |
| Extra shadow-pass draws, 'high' quality | 2 seated / 6 standing | 128 to 384 | 300 to 900 |
| Triangles (seated) | about 2,460 | 156,556 | 369,384 |
| Baked geometries | 5 | 208 | 419 |
| Materials | 1 | 1 | 1 |

- Each figure is also 9 animated groups. Its CPU work each frame is one Actor update, a 16-channel blend and about 15 matrix updates.
- **The budget:** design 10.6 sets 300 draw calls on phones. The restored figures cross it at roughly 30 people before any furniture is counted. So the offices for 22, 40 and 150 all need cheaper figures, not just the campus.
- **The instancing route:** each figure has a different baked geometry per look, so the existing parts cannot be instanced as they are. Use 2 to 3 InstancedMeshes per figure type (body plus head, `setColorAt` for team and skin, a few head variants). The pure Actor drives their matrices; markers.ts lines 141-233 shows the instance-matrix pattern.
- **One more person, restored figure:** +8 draw calls, +2 to 6 shadow draws, about 2.5k triangles, about 2.8 new geometries.
- **One more person, instanced:** about +0 draw calls, 1 more instance matrix per part.

### An order that compiles and passes at each step

1. PREREQ (other folders): add three@0.187.0 and @types/three@0.187.0 at exact versions; a game-free src/world/types.ts barrel (geometry, interaction with the new InteractableTarget union, handle: ScreenPoint/ScreenRect/InteractableHit/WorldCallbacks); targets.ts matching the union; core/math.ts; core/CameraRig.ts
2. src/world/interaction/footprint.ts
3. src/world/interaction/gestures.ts
4. src/world/interaction/hitProxy.ts
5. src/world/interaction/picking.ts
6. src/world/interaction/HighlightRing.ts
7. src/world/interaction/Interaction.ts
8. src/world/interaction/Interaction.test.ts (9 target literals edited; verified 34/34 in scratch)
9. src/world/people/random.ts
10. src/world/people/pathFollower.ts
11. src/world/people/pathFollower.test.ts (verified 14/14)
12. PREREQ: office/footprints.ts, office/pathfinding.ts, office/layouts.ts re-keyed to the 5 offices; types/office.ts and types/seating.ts game-free
13. src/world/people/approach.ts
14. src/world/people/seating.ts (phase key edit)
15. src/world/people/seating.test.ts (roster helper + capacities)
16. PREREQ: core/palette (colors with department-keyed ROLE_COLORS, materials, geometry, models, textures, sharedResources)
17. src/world/people/Character.ts
18. src/world/people/Character.test.ts
19. src/world/people/actor.ts
20. src/world/people/actor.test.ts
21. NEW: the office-scene type and the pure cast function (stable ids, team moves, 64 cap) with their own tests
22. src/world/people/testKit.ts (rewritten on the new scene)
23. src/world/people/crew.ts (cut)
24. src/world/people/crew.test.ts (ported)
25. OPTIONAL (sound is out of scope): src/world/people/footfall.ts and src/world/people/footfall.test.ts
26. PREREQ: types/system.ts (WorldContext, WorldSystem, WorldSignals, WorldSoundSink) and the fx folder or a no-op FxApi
27. src/world/people/EmployeeSystem.ts
28. src/world/people/EmployeeSystem.test.ts
29. NOT RESTORED: src/world/people/markers.ts, src/world/people/markers.test.ts

### Risks

- The world barrel src/world/types.ts at 63b4bed re-exports types/snapshot.ts, office.ts, events.ts and interaction.ts, and all of them import src/types/game, which no longer exists. Every file in both folders imports '../types', so restoring the old types/*.ts unchanged breaks the compile everywhere. The barrel must be rewritten game-free before step 1.
- Draw-call budget: measured 8 draw calls per figure plus 2 to 6 shadow draws on 'high'. 64 figures are 512 + 128..384, so the 300-call phone budget in design 10.6 is crossed at about 30 people with no furniture counted. Instancing is needed for the 22, 40 and 150 offices, not only the campus. The baked per-look geometries (419 for 150 people) cannot be instanced as they are, so the instanced figure is a new, simpler model.
- Continuous animation versus 'redraw only when something changes' (design 10.6). Characters animate every frame even at rest (typing jitter, sway, head turns; Character.ts:619-716), and Crew starts wander trips. The old world ran its frame loop continuously while visible. An on-demand renderer would freeze them. Decide between freezing the idle poses after playback, a low idle frame rate, or a short loop only during playback.
- Year playback length: walking is 1.6 u/s; arrivals are staggered 0.4 s but capped at a 5 s wait, so past about 12 arrivals they bunch at the door and walk through each other. Newcomers wait for every leaver, up to 12 s per wait. A year with layoffs and hires in a big office plays for 20-40 s, not 'a few seconds'. Playback must hurry or snap (Crew.hurry and the reduced-motion snaps exist) and the stagger needs re-tuning for yearly batches.
- Team changes break identity if ids carry the team. crew.ts:368 removes and re-creates an actor whose role changes, and Character bakes the role colour into the torso geometry. With '${dept}-${i}' ids (the old unlisted-head scheme), moving one person between teams plays as a walk-out plus a walk-in. Use team-free ids plus a team attribute.
- SeatingPlan ignores teams: it hands out the lowest free desk in hiring order (a test asserts this). Design 10.2 wants desks grouped by team. Zones or pods are new logic with new tests, and fixed per-team zones would overflow because the team split changes every year.
- The 64 cap lived in snapshot.ts (gone). The new cast function must apply it again and pick which 64 are drawn. A naive 'first 64 ids' misrepresents the team mix in the campus.
- Founder concept: SeatingPlan, approach.chairKey, Crew (pacing, bubbles, never wanders) and Character (outfits) special-case the founder and cofounder, and OfficeLayout requires founderSeat and cofounderSeat. The new game has only anonymous people. Decide keep or drop before the office plans are re-keyed, because it changes approach, seating and every test's expected slot numbers.
- EmployeeSystem calls ctx.fx (a wave bubble on arrival, dust on sitting, plus streams and float text) and needs WorldContext and WorldSignals. If the fx folder is not in the groundwork, a no-op FxApi must be provided, or the arrival wave and dust silently go.
- Crew depends on layout details: stationStandSpots.coffee for wandering (crew.ts:778, 838) and pacePoints near founderSeat. actor.test walks every seat of every office and checks against obstacle kinds 'desk' and 'station'. The re-keyed layouts must keep a coffee or errand spot, wanderSpots, door, overflowSpots and those obstacle kinds, or these files need more edits.
- Look determinism needs a seed. The old look was hashText32(runSeed, id), but today's GameState has no seed (it is in gameStore). The scene input must carry one, or the figures change between loads.
- The tests in this area depend on test scaffolding that is entirely old-game (testKit.ts built an old GameState through createInitialState and buildWorldSnapshot, both gone). Until the new testKit exists, none of crew, footfall or EmployeeSystem tests can run. The restore cannot be done file by file in alphabetical order.
- crew.ts:935-940 assumes 'at most 120 people' for its per-actor door scans (O(n^2) in leavers). That is fine at a 64 cap, but if the cap is lifted for the campus, re-check the cost.
- Interaction.ts never focuses the canvas and cancels mousedown so the focus stays where it was. The comments say 'the terminal'; the behaviour still suits the HTML panels, but whoever restores it should know it is deliberate. The 0.66-wide person hit box is about 14 px on a phone; design 10.2 says touch should aim at a team's area, so the new InteractableTarget union needs a team or zone target.


## Effects, interface and development page (src/world/fx, src/world/ui, src/world/dev)

I read all 27 files in src/world/fx, ui and dev at 63b4bed in full, checked them against today's working tree, and tested the generic ones in a scratch project. That project had three@0.187.0 installed and used the repo's own tsc, eslint and vitest with the same tsconfig flags. These files pass tsc in strict mode, `eslint --max-warnings=0` and vitest: core/math and core/CameraRig (both needed by fx), the six fx building blocks, ui/placement and its test, stage, environment, WorldShell, and the pure part of worldSounds. In those runs, 47 tests passed, plus one extra check I wrote that builds ParticleRenderer, FloatTextLayer and BubbleLayer with real three.js in node, without a DOM. The only edits needed were small stub world types (an InteractableTarget union without AssetId, and a WorldHandle that takes an OfficeScene) and changing fx/format.ts from TeamRole to the three departments. Verdicts: the particle system, sprite layers and HTML placement code come back as is. FxSystem keeps its FxApi half and loses its old-event reactions. The inspector, HUD, actionSignal and ui/format are tied to the old weekly game and its terminal, so they are dropped. WorldOverlay, InspectorPanel and the WorldPreview dev page should be rewritten, and the WorldPreview skeleton is worth copying. Sound pieces are deferred because sound is out of scope. The finished table is at /tmp/claude-0/-home-user-StartUpWorld/09bcf54c-d5eb-5be8-9cc8-36b8ff79ebf3/scratchpad/ground3d/fxui/inventory.md and notes at .../fxui/notes.md. The scratch project is at .../fxui/try.

### Files

| File | Lines | What it does | Verdict | Edits, or why | Imports from outside the world | Test |
|---|---|---|---|---|---|---|
| `dev/PropGallery.tsx` | 610 | Dev contact sheet at /world-gallery of every prop and character pose, with its own renderer, lights copied from Lighting.ts, pan and zoom, and HTML labels | with edits | Line 19: CompanyPhase becomes whatever key palette/props use for the five offices or era styles; TeamRole becomes the department type. ROLES (line 79) becomes the 3 departments. personView (159-165) must match the new PersonView. Restore it only after core/palette, office/props and people/Character are back. Optional hardening: dispose calls renderer.dispose() but never forceContextLoss() (threejs-facts.md measured that this is needed to avoid context warnings), and it renders every frame with a 4096 shadow map. Both are fine for a dev page. | react (exists); three; ../../types/game: CompanyPhase, TeamRole (gone) | none |
| `dev/WorldPreview.tsx` | 863 | Dev sandbox at /world-preview: builds a fake old GameState from query parameters, runs the real createWorld, pushes hand-built WorldEvents from buttons, FX demos, stats, and a window.__preview scripting API | rewrite | New page with the same skeleton: copy the component (686-863): canvas, createWorld in try/catch for WorldUnsupportedError with a queued error message, the selected-anchor marker that proves project() and onSelectedAnchorMove, ResizeObserver, the 500 ms stats line, window.__preview, StrictMode-safe cleanup. Also copy stats() (352-367) and the FX demos (504-604). Replace stateFromParams and PreviewController's game actions (66-226, 279-500) with query parameters that build an OfficeScene directly, for example ?office=0..4&product=&growth=&recruiting=&arriving=&leaving=&era=&quality=&motion=&ui=0, and buttons that step the office, add or remove people per department, and replay arrivals. Show draw calls against the 300-call phone budget. | react (exists); three; ../../engine: createInitialState (gone); ../../engine/assets: ASSET_CATALOG (gone); ../../engine/economy: calcBurn, calcNetBurn, getEffectiveMaxAp, roleComp (gone); ../../types/game: AssetId, CompanyPhase, EndingType, GameState, PendingEvent, Stage, TeamRole, TeamRoster (gone) | none |
| `fx/BubbleLayer.ts` | 197 | Sprite thought bubbles that follow an anchor: one per anchor, at most 24, 26-52 CSS px wide, dropped when the anchor leaves the scene | as is | None. Verified compile and lint, and that show() returns false under node. | three: * as THREE (to be re-added at 0.187.0) | No direct test. FxSystem.test.ts 504-511 checks that it does nothing without a document (real three, no DOM). |
| `fx/FloatTextLayer.ts` | 289 | Rising canvas-text sprites with on-screen font held at 13-24 CSS px, stacked lines (at most 6), at most 28 alive, LRU cache of 40 textures, waits for the web font | as is | None. Verified. The font string names IBM Plex Mono, which is still the mono font in today's tailwind.config.js. | three: * as THREE | lowestFreeSlot tested in FxSystem.test.ts 95-112; pure |
| `fx/FxSystem.test.ts` | 628 | Tests for float formatting, text stacking, particle budgets, ParticlePool physics and streams, FxSystem | with edits | Keep 1-396, fixing format expectations at 90-91 (verified passing in scratch, minus the budgets block, which needs FxSystem). Lines 401-411: replace the fake SeatingApi, getOfficeLayout('garage', []) and buildWorldSnapshot(createInitialState()) with a made-up layout and OfficeScene. Keep the generic FxSystem tests at 437-512 (root and dispose, bursts by quality, absurd requests, stream pops, shake, no document). Rewrite or drop the event-reaction tests at 513-628 (ship, raise, launch, phase-changed, game-over, run-reset), since those events no longer exist. | three: * as THREE; vitest; ../../engine: createInitialState (gone: old engine) | It is a test. Lines 1-396 are pure; 398-628 need real three in node (Scene, Object3D), no DOM, no fake. |
| `fx/FxSystem.ts` | 503 | FxApi for the other systems (burst, stream, floatText, bubble, shake) plus a WorldSystem that reacts to the old weekly WorldEvents at named stations | with edits | Keep: FxDeps minus seating; particleBudget (50-53); magnitudeIntensity; constructor; the FxApi methods (148-178); update, reset, dispose (197-222); celebrateAcrossFloor (427-436, needs only floor bounds); schedule, fireScheduled, popArrivals (468-502). Remove: the bodies of applySnapshot (182-195) and react, reactToShip, reactToRelease, reactToLaunch, streamUsers and smokeOut (226-443). Remove the outcomes.ts import (isPromotion, isWinEnding). Re-point types: WorldSnapshot to OfficeScene, WorldEvent to the scene's arriving/leaving lists, OfficeLayout/StationKind to the new layout (door, floor), SeatingApi only if a reaction needs a seat. New reactions: a '+3 Product' float at the door for arrivals, '-1 Growth' for leavers, and a confetti celebration on an office move. Nothing on the first scene (keep the prev===null rule at line 191). | three: * as THREE | fx/FxSystem.test.ts lines 398-628: real three Scene in node (no fake, no DOM), but it needs the old engine's createInitialState, getOfficeLayout and buildWorldSnapshot |
| `fx/ParticleRenderer.ts` | 166 | Draws the pool as one InstancedMesh per shape (at most 5 draw calls), frustumCulled off, uploads only the live part of each buffer | as is | None. Verified against @types/three 0.187.0, including clearUpdateRanges and addUpdateRange. | three: * as THREE (InstancedMesh, ExtrudeGeometry, LatheGeometry, addUpdateRange) | No direct test. A scratch test built it with real three in node, synced 20 confetti (1 visible mesh) and disposed it, all passing. |
| `fx/bubbleIcons.ts` | 509 | 15 thought-bubble pictograms and the bubble frame, drawn with canvas paths only (no fonts or emoji) | as is | None. Verified compile and lint in scratch. The icon set (code, coffee, money, megaphone, phone, etc.) suits the new game; adding new icons later is a type plus an entry. | none | none |
| `fx/format.ts` | 68 | Number formatting for float text (+$1.2M, +340 users, +1 Eng) | with edits | Line 1: replace `import type { TeamRole } from "../../types/game"` with the new scene's Department type (the 3D layer should not import the rules, so declare it in the world's scene type). Lines 53-64: ROLE_SHORT_LABEL becomes { product: "Product", growth: "Growth", recruiting: "Recruiting" } (or shorter labels). In FxSystem.test.ts lines 90-91, change the formatHeadcountDelta expectations to the new departments. Verified in scratch: compiles, and the 4 format tests pass. | ../../types/game: TeamRole (gone; today src/engine/types.ts:16 has Department = product\|growth\|recruiting) | Tested in fx/FxSystem.test.ts lines 57-93; pure |
| `fx/particles.ts` | 679 | Pure particle simulation: 8 burst kinds with tuned profiles, a fixed-capacity ring pool in typed arrays, arcing streams, arrivals | as is | None. Verified: those tests pass unchanged in scratch (23 tests together with format and stacking). | none | FxSystem.test.ts lines 150-396 (ParticlePool and streams); pure, seeded random |
| `ui/HoverTooltip.tsx` | 73 | Name chip over the hovered target, re-projected each frame through a CSS transform with no React renders | with edits | Remove useGameStore (line 3, 29) and describeTarget (5, 33-38). Take the text from hover.label, or from an optional describe(target) prop fed by the scene. Keep the rAF follow loop (40-59) and placeChip unchanged. Tailwind classes bg-ink, text-mist exist today. | react: useLayoutEffect, useMemo, useRef (exists); zustand: useStore (exists, 5.0.11); ../../state/useGameStore: useGameStore (gone; today's store is src/state/useGame.ts, useGame/gameStore) | none (needs a DOM) |
| `ui/InspectorPanel.tsx` | 447 | Floating inspector card with notch (or a bottom sheet below 640 px) whose buttons run or prefill terminal commands | rewrite | Not needed in the groundwork (no screens wired). When the office card arrives, write a smaller card for a team or person: title, subtitle, lines, and at most the design's two actions (move a person, select a company), each also an HTML button elsewhere. Reuse the placement half (334-414: placeCard with avoid/prefer/minTop, the ResizeObserver, the 300 ms re-check, the docked sheet that calls handle.focus with avoidBottomPx). Drop ActionButton's command/prefill model, keepTerminalFocus and the '> cmd' echo. Needs the CSS .world-pop and .world-card-notch, which are missing from today's src/index.css (old lines 117-162). | react (exists); ../../audio/engine: playSound (exists; 'ui-denied' and 'ui-press' are in today's sounds.ts) | none |
| `ui/WorldHud.tsx` | 141 | Old HUD: phase, week and AP pips, End week button with blocker, zoom -/+/reset buttons, gesture hint | drop | The weekly HUD has no place in a yearly game with HTML controls (design 10.3). Lift the three icon buttons (lines 120-132, ZOOM_STEP 1.25) and the hint text (134-137) into the dev page or a small ViewControls component. | react: MouseEvent type; ../../audio/engine: playSound (exists); ../../engine/economy: getEffectiveMaxAp (gone); ../../types/game: GameState (gone) | none |
| `ui/WorldOverlay.tsx` | 88 | HTML layer over the canvas (pointer-events none) holding the HUD, hover chip and inspector; docks below 640 px | rewrite | New overlay with props (stage, finePointer, describe?) and no store: the pointer-events-none div with data-world-ui, HoverTooltip when finePointer, an optional card, and DOCK_BELOW_PX = 640 (line 24). It is about 30 lines; the dev page can use it before any game wiring. | react, zustand (exist); ../../audio/engine: playSound (exists); ../../state/useGameStore (gone); ../../state/useUiStore: requestPrefill, worldHintSeen (gone) | none |
| `ui/WorldShell.tsx` | 61 | Entry-chunk parts that must not import three: WorldPlaceholder, WorldUnavailableNote, and the WorldBoundary error boundary that calls onError once | with edits | Compiles and lints as is (verified). Wording at line 22, '3D view unavailable on this device — the terminal has everything.', must say the 2D screens are complete (design 10.5). The placeholder's class 'world-viewport' is gone from today's src/index.css: restore that rule (old index.css lines 100-116). panel-surface and text-mist still exist. | react: Component, ErrorInfo, ReactNode (exist) | none |
| `ui/actionSignal.test.ts` | 189 | Tests actionSignal against the real old engine and old game store | drop | Goes with actionSignal.ts. | vitest; ../../engine: executeCommand (gone); ../../engine/context: computeContext (gone); ../../engine/events/pool: eventPool (gone); ../../engine/events/types: toPendingEvent (gone); ../../engine/testHelpers: makeState (gone); ../../state/useGameStore (gone); ../../types/game: BoardState, GameState (gone) | It is a test (old engine, store) |
| `ui/actionSignal.ts` | 48 | Turns a terminal command and the engine's ActionResult into the ActionSignal the old world listened to | drop | The career has no commands: a year is plan then resolveTurn. Who arrives or leaves comes from the scene function, not from a command signal. | ../../types/game: ActionResult (gone) | ui/actionSignal.test.ts |
| `ui/environment.ts` | 36 | Device probe read once per world: detectQuality (coarse pointer, screen short side under 520 px, or 4 or fewer cores means low), prefersReducedMotion, hasFinePointer | as is | None (verified). Consider adding a node test that stubs window.matchMedia, screen and navigator.hardwareConcurrency, since it was never tested. | none | none (mountWorld.test.ts mocked it away) |
| `ui/format.ts` | 53 | formatCount, formatUsd, formatUsdDelta, formatCountDelta, titleCase for the old cards and HUD | drop | Its only users (inspector.ts, WorldHud.tsx) are dropped, and today's src/ui/format.ts has money, count, signed and percent for any HTML that needs numbers. | none | Tested only inside inspector.test.ts |
| `ui/inspector.test.ts` | 1236 | 60 tests feeding every card button to the real old engine | drop | Goes with inspector.ts. | vitest; ../../engine, ../../engine/assets, ../../engine/context, ../../engine/economy, ../../engine/events/pool, ../../engine/events/types, ../../engine/testHelpers (all gone); ../../types/game (gone); ../../ui/terminal/tokens (gone) | It is a test (old engine) |
| `ui/inspector.ts` | 1052 | (clicked target, old GameState) to inspector card, with every button gated exactly like the old engine's command checks | drop | Everything is old game content (stations, AP, cash, builds, board, events). If cards come back, keep only the card shape at lines 44-81 (InspectorAction, InspectorLine, InspectorCard) as a model and write a new describer over the office scene. | ../../engine/assets, board, economy, investors, pricing, founders, people, projects, stagePerks, tycoon/preflight (all gone); ../../types/game: AssetId, CompanyPhase, GameState, PricingModel, TeamRole (gone); ../../ui/terminal/tokens: stripTypewriterTokens (gone) | ui/inspector.test.ts |
| `ui/placement.test.ts` | 165 | 14 tests for placeCard and placeChip | as is | None. All 14 pass in scratch. | vitest | It is a test; pure |
| `ui/placement.ts` | 166 | Pure geometry: where a card goes beside its target (above, then outward side, then below, then least overlap), with a notch, plus placeChip | as is | None. Verified. The types barrel just has to export ScreenPoint and ScreenRect without pulling in the old snapshot types. | none | ui/placement.test.ts; pure |
| `ui/stage.ts` | 92 | Per-mount vanilla zustand store (status starting\|running\|unsupported\|context-lost, handle, hover, selected, size) and an AnchorChannel that carries the selected target's screen point outside React | as is | None (verified compile with WorldHandle taking an OfficeScene). A small pure test of select() and the anchor channel would be cheap to add. | zustand/vanilla: createStore, StoreApi (exists) | none |
| `ui/useSelectionKeeper.ts` | 84 | Keeps the selection honest: closes when there is nothing to describe, waits 450 ms when the target vanishes, closes on Escape with the ui-close sound | with edits | Remove or retarget successorOf (lines 19-29): it hands an 'empty-desk' card to the next free desk for the old hiring flow and needs handle.freeDeskSlots. Replace it with () => null, or a team-area equivalent. Update the Escape comment about the terminal (67-69). Keep the rest. | react: useEffect; ../../audio/engine: playSound (exists; 'ui-close' exists today) | none (React/DOM) |
| `ui/worldSounds.test.ts` | 114 | 14 tests for worldSounds | drop | Deferred with worldSounds.ts. Lines 1-84 pass unchanged once the worldAudio import is removed (verified, 10 tests); the createBubbleGate block (85-114) goes with the gate. | vitest; ../../audio/worldAudio: STINGER_CLEARANCE, STING_DELAY, STING_LENGTH (gone) | It is a test; pure |
| `ui/worldSounds.ts` | 130 | Pure sound decisions: selectionSound, hoverSounds, createZoomStepper, and a bubble gate that keeps pops off store stingers | drop | Sound is out of the groundwork. When it comes back: lines 1-90 (selection, hover, zoom) restore as is (verified compile, 10 tests pass); delete the bubble gate (92-130) or rewrite it against today's audio, which has 'bubble-pop' but no stinger table. | ../../audio/worldAudio: STING_DELAY, STINGER_CLEARANCE, STING_LENGTH, STORE_STINGERS (gone; src/audio has no worldAudio.ts) | ui/worldSounds.test.ts; pure |

### The question this reader answered

**1. What is tied to the old game, and what is generic**

Tied to the old game's events or commands:
- **FxSystem.ts.** Lines 182-195 and 226-443 react to old WorldEvents (ship, launch, pitch, raise, board-action, week-advanced, cash-changed, phase-changed, game-over, released, crunch and so on). They place effects at named stations (ship, investors, boardroom, calendar, servers, launch) through `layout.stations` and the founder seat via `deps.seating.seatOf("founder")`. They import `isPromotion` and `isWinEnding` from src/world/outcomes.ts, which reads the old CompanyPhase and EndingType.
- **ui/inspector.ts (whole file).** Every card is old game state, and every button is a terminal command gated like the old `executeCommand`/`ensurePlayable` (header lines 1-17, `describeTarget` at 1030).
- **ui/WorldHud.tsx.** AP pips at 30-51, End week with `commandBlocker` at 59-118, and `getEffectiveMaxAp` from the old engine.
- **ui/InspectorPanel.tsx.** The command/prefill buttons (65-169) and `keepTerminalFocus` at 63.
- **ui/WorldOverlay.tsx.** `useGameStore`, `useUiStore.requestPrefill`/`worldHintSeen` and `runCommand("end")` (36-61).
- **ui/actionSignal.ts.** Terminal command to ActionSignal.
- **The bubble gate in ui/worldSounds.ts (92-130).** It reads `STORE_STINGERS` from audio/worldAudio, which no longer exists.
- **useSelectionKeeper.ts `successorOf` (19-29).** The empty-desk handover from the old hiring flow.
- **HoverTooltip's text (33-38).** It comes from `describeTarget(target, gameState)`.
- **Outside my folders, the time of day.** core/Lighting.ts 180-190 (`daytimeKey`) sets daylight from AP spent this week, plus fixed looks for setup and win/loss. So "time of day" was an old-game reading too, and needs a new driver (for example a fixed look per era, or the year's playback).

Generic:
- **Effects:** fx/particles.ts (pure), ParticleRenderer.ts, FloatTextLayer.ts, BubbleLayer.ts, bubbleIcons.ts, fx/format.ts (once TeamRole becomes the three departments), and FxSystem's FxApi half (148-178, 197-222, 427-436, 468-502).
- **HTML overlay pieces:** ui/placement.ts and its test, ui/stage.ts, ui/environment.ts, and the rAF follow loop in HoverTooltip (40-59).
- **Lazy-load shell:** ui/WorldShell.tsx. Old App.tsx line 21 did `lazy(() => import("./world/WorldView"))`, wrapped at 237-241 in `<WorldBoundary fallback={null} onError={() => setWorldUnsupported(true)}><Suspense fallback={<WorldPlaceholder/>}>`, and line 244 shows `WorldUnavailableNote`.
- **Error boundary:** `WorldBoundary` (WorldShell.tsx 38-60) logs, calls onError once, and renders the fallback. The no-WebGL path is `WorldUnsupportedError` from core/World.ts:36, thrown by `acquireContext` before the renderer exists.

Verified in the scratch project: the generic files pass tsc in strict mode, eslint with the repo's config at `--max-warnings=0`, and vitest against three@0.187.0.

**2. The development pages**

- **How they were reached.** In 63b4bed:src/main.tsx lines 12-13 and 17-25, two pages were lazy-loaded only when `import.meta.env.DEV` is set, and chosen by `window.location.pathname`:
  - `/world-preview` loaded dev/WorldPreview.tsx.
  - `/world-gallery` loaded dev/PropGallery.tsx.
  - (`/audio-lab` was the third.)
  
  Production builds left them out. Today's src/main.tsx has no routing at all, so a new dev page needs this path switch added back. The new page must also not use the game's crash reset, which wipes the save.
- **What WorldPreview did.**
  - Built an old GameState from query parameters (phase, team, n, assets, ap, morale, stress, runway, event, setup, over, quality, motion, ui=0), using the old `createInitialState`, `ASSET_CATALOG` and economy functions.
  - Ran the real `createWorld` and pushed hand-built WorldEvents from buttons (`PreviewController`, 279-500).
  - Had FX demos for each burst kind, a stream, all float tones, all 15 bubbles, shake, pale test walls, zoom/reset/pause/resume, and "recreate world".
  - Showed a dot glued to the selected target to prove `project()`/`onSelectedAnchorMove`.
  - Showed a 500 ms stats line: draw calls, triangles, particles, geometries, textures, programs, zoom, duskAmount (352-367).
  - Exposed `window.__preview` (fire, snapshot, world, stats, debug) for a "screenshot harness". That harness is not in the repository at 63b4bed (no scripts reference `__preview`).
- **Can the new page reuse it?** Only the skeleton and the FX demos:
  - Reuse: 686-863 (canvas, try/catch for `WorldUnsupportedError`, ResizeObserver, marker, stats timer, `window.__preview`, StrictMode-safe cleanup that carries state across re-creation), 504-604 (FX demos) and the stats function.
  - Replace: all game fabrication (66-226) and the event-pushing controller. Query parameters should build an `OfficeScene` directly: office 0-4, per-department counts, arriving and leaving, era.
  - PropGallery can come back with small type edits after the props and people folders are restored.

**3. Performance budget and quality settings**

| Setting | Where | What it does |
|---|---|---|
| Quality tier | ui/environment.ts:26-31 | Picks low for a coarse pointer, a screen short side under 520 px, or 4 or fewer cores; otherwise high |
| Pixel-ratio ladder | core/World.ts:75 | `PIXEL_RATIO_STEPS` is high [2, 1.5, 1], low [1.5, 1] |
| Pixel ratio applied | World.ts:553 | `setPixelRatio(min(devicePixelRatio, governor cap))`; re-armed by a matchMedia resolution query at 562-575 when the window changes screen |
| Shadows | core/rendererLook.ts:21-24 | Only on high, PCFShadowMap |
| Shadow map size | core/Lighting.ts:136 | 2048 |
| Adaptive quality | core/adaptiveQuality.ts | 2 s warm-up and 2 s windows (`WARM_UP_MS`, `WINDOW_MS` at 55-57). Steps down the pixel ratio, then turns shadows off (`World.ts trackQuality` 635-651, `lighting.setShadowsEnabled(false)`). Never steps back up |
| Frame loop | World.ts 581-628 | Continuous requestAnimationFrame (not on-demand); dt clamped to `MAX_FRAME_SECONDS` 0.1 (World.ts:51); the first frame after a resume simulates no time (`skipNextDelta`) |
| Pause when hidden | mountWorld.ts:188-200 | `setPaused(document.hidden \|\| !onScreen)` from `visibilitychange` plus an IntersectionObserver |
| Particles | FxSystem.ts:50-53 | 600 capacity / density 1 on high, 250 / 0.5 on low, 90 / 0.3 under reduced motion; at most 5 instanced draw calls (ParticleRenderer) |
| Bubbles | BubbleLayer.ts:33 | At most 24 |
| Float text | FloatTextLayer.ts:49-50 | At most 28 alive, 40 textures cached |
| Drawn people | (people folder) | 64 cap |

How it was tested:
- **Governor:** core/adaptiveQuality.test.ts covers it thoroughly with an injected clock (light load never steps; CPU- and GPU-bound overload steps down; warm-up; only rungs that actually lower the effective ratio).
- **Particle budgets:** FxSystem.test.ts:118-129 and 448-465 check the budgets and the per-quality burst counts.
- **Not tested:**
  - `detectQuality`: mocked away in mountWorld.test.ts:41.
  - The real pixel-ratio and shadow wiring inside World.ts: World is `vi.mock`ed at mountWorld.test.ts:35.
  - Pausing: mountWorld.test.ts stubs IntersectionObserver and document, but `setPaused` is only a `vi.fn()` at line 17 and is never asserted.
  - Frame pacing.
  - No browser test existed; draw-call and frame-rate numbers were never recorded (consistent with old-3d-office-reuse-map.md section "Not checked").

### An order that compiles and passes at each step

1. (prerequisite, other folders) package.json: three and @types/three pinned at 0.187.0; src/world/core/math.ts; a new src/world/types barrel without old-engine types (geometry, fx, interaction without AssetId, handle taking OfficeScene, QualityLevel); src/world/core/CameraRig.ts; src/world/targets.ts with the new target union
2. src/world/ui/placement.ts + src/world/ui/placement.test.ts
3. src/world/ui/stage.ts
4. src/world/ui/environment.ts (optionally with a new test that stubs matchMedia)
5. src/world/ui/WorldShell.tsx (wording edit) + restore .world-viewport, .world-card-notch, .world-pop rules in src/index.css
6. src/world/fx/particles.ts
7. src/world/fx/format.ts (departments edit)
8. src/world/fx/bubbleIcons.ts
9. src/world/fx/FloatTextLayer.ts
10. src/world/fx/BubbleLayer.ts
11. src/world/fx/ParticleRenderer.ts
12. src/world/fx/FxSystem.test.ts pure half (lines 1-396 minus the budgets block)
13. src/world/fx/FxSystem.ts trimmed to FxApi + budgets, then the budgets block and the generic FxSystem tests with a made-up layout
14. src/world/ui/HoverTooltip.tsx and src/world/ui/useSelectionKeeper.ts (edited), once core/World and a WorldHandle exist
15. new small WorldOverlay (rewrite), optional
16. src/world/dev/PropGallery.tsx after core/palette, office/props and people/Character are restored
17. new dev page built from the WorldPreview skeleton after core/World and the scene function exist; add the DEV-only path switch to src/main.tsx

### Risks

- The old world rendered every frame with a continuous requestAnimationFrame (core/World.ts 581-628). Design 10.6 asks for drawing only when something changes, which needs new work in core/World.ts, not a restore. The particle, bubble and float-text layers, and the people's idle animation, assume they are updated every frame.
- The CSS for the 3D view is gone from today's src/index.css: .world-viewport, .world-card-notch[data-side], .world-pop and .world-pulse (old index.css lines 100-185). Nothing fails to compile without them. The placeholder loses its backdrop and the inspector notch and pop-in silently disappear, so they must be copied back deliberately.
- Being as-is depends on the types barrel. src/world/types.ts re-exports types/snapshot.ts, events.ts, office.ts and interaction.ts, all of which import ../../types/game. If the barrel is restored whole, even files whose content is generic (placement, stage, environment, BubbleLayer) fail tsc through it. Rebuild the barrel first, without those modules.
- Time of day is an old-game reading. core/Lighting.ts 180-190 sets daylight from AP spent this week, plus setup and win/loss looks. The generic lighting needs a new input (era look or year playback), otherwise the office sits at 'full AP morning' forever.
- FxSystem's tests mix generic and old-event cases in one file. Its 398-628 block imports createInitialState from the old engine, getOfficeLayout('garage', []) and buildWorldSnapshot. Restoring the file unchanged breaks `tsc -b`, because tests are type-checked as part of src.
- The pause-when-hidden and the pixel-ratio and shadow wiring were never tested: mountWorld.test.ts mocks World and environment, and setPaused is only a vi.fn(). The browser checks in the plan should cover them: hidden tab, off-screen canvas, the pixel-ratio cap at devicePixelRatio 3, and shadows off on low.
- The window.__preview screenshot harness WorldPreview mentions is not in the repository at 63b4bed, so there is no browser script to bring back. The real-browser checks have to be written new, for example from the mock's try.mjs approach in 3d-mock-lessons.md.
- Old dev routing lived in src/main.tsx (lazy imports behind import.meta.env.DEV, matched on pathname). Today's main.tsx has none, and its ErrorBoundary onReset wipes the save. A dev page routed through it must not trigger that reset.
- PropGallery creates its own WebGLRenderer, renders every frame, uses a 4096 shadow map, and disposes without forceContextLoss(). It also calls disposeSharedResources(), and the module-level caches allow only one world at a time, so opening it next to a world in the same page would break the other. Keep it on its own route.
- The sound library today still contains the old world cue names ('bubble-pop', 'ui-close', 'ui-denied', 'ui-press', footsteps and so on), but src/audio/worldAudio.ts is gone. Restoring anything that imports worldAudio (worldSounds bubble gate, mountWorld's audio wiring) fails at import, not at type level only.
- three is not installed, so these restores cannot be checked in the working tree until package.json changes. In the scratch project, `npm install three@0.187.0 @types/three@0.187.0` resolved fine through the proxy.

