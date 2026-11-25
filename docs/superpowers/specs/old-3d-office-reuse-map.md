# The old 3D office: what can be reused

Research notes from a read of the three.js office that this project had until the turn-based rebuild removed it. The
code is still on `main` under `src/world` (read a file with `git show origin/main:src/world/<path>`). These notes are
reference material for the 3D plans; where they differ from the approved design (`2026-11-25-career-3d-design.md`),
the design wins.

Paths that start with `scratch:` were temporary files on the machine that did the research; they no longer exist and
are kept here only so the notes read as written. Sizes and timings marked as measured were measured on that machine in
November 2026.

## In short

The old 3D office (origin/main, src/world: 125 files, 40,590 lines, three ^0.187.0, no react-three-fiber) is well
suited to reuse: about two thirds of its source is generic or needs only type changes. The parts tied to the old game
are narrow: the snapshot and event diff, the inspector cards, the reaction scripts for the staff, and the eight work
stations named after old commands. Its office already grew through five hand-drawn tiers (garage 3 desks, coworking 8,
office 20, unicorn 36, public 48), chosen each turn from valuation plus users, revenue or team size, and it could
shrink again; this fits "campaign of eras" and "pick an era" directly, while "one long career" would strain the
64-person cap and the 48-desk largest plan. All art is built in code (no model or image files), so reusing it keeps
the look this project's own. The biggest change for the next version is role: the old 3D was a companion to a terminal
and the game was fully playable without it, so a 3D main screen needs its non-WebGL fallback (today's React screens)
designed first. Furniture was the main cost (the office folder is 10,908 source lines, 42% of source), so eras should
be a theme and prop swap over a tier table, not new hand-drawn plans per era.

## 1. Architecture in ten lines (all paths are on origin/main; read with: git show origin/main:<path>)

1. React entry: src/world/WorldView.tsx (87 lines), default export so the shell loads it and three.js lazily;
   src/world/ui/WorldShell.tsx (61) holds the placeholder, the 'unavailable' note and an error boundary
   (WorldBoundary) and must not import three.
2. Mount: WorldView renders one <canvas> inside a viewport div and one useEffect calls mountWorld(canvas, viewport,
   stage) from src/world/mountWorld.ts (217), which returns the teardown. The stage component is keyed by a counter so
   'Reload 3D view' replaces the canvas element.
3. Core: createWorld(canvas, callbacks, options) in src/world/core/World.ts (690) returns a WorldHandle
   (types/handle.ts, 85): setSnapshot, resize, setSelected, project, screenBounds, focus, zoomBy, resetCamera,
   setPaused, dispose.
4. Systems: World registers four systems in SystemRunner (core/SystemRunner.ts, 102) in fixed order: office, people,
   lighting, fx. Each implements WorldSystem (types/system.ts): applySnapshot(next, prev, events), update(dt,
   elapsed), dispose(). A failing system is reported, not fatal.
5. Render loop: World.frame uses requestAnimationFrame, clamps dt to 0.1 s, runs systems, then camera and interaction,
   then renderer.render, then feeds the adaptive quality governor. syncLoop stops the loop when paused, context-lost
   or disposed.
6. Game state in: mountWorld subscribes to the zustand game store; on change it calls buildWorldSnapshot(state)
   (src/world/snapshot.ts, 282) and deriveWorldEvents(prev, next, action) (src/world/events.ts, 370) and pushes both
   with handle.setSnapshot. React never sees per-frame data.
7. State out: the world reports hover, select, anchor movement, zoom and context loss through WorldCallbacks into a
   small vanilla store (src/world/ui/stage.ts, 92); the HTML overlay (ui/WorldOverlay.tsx, HoverTooltip.tsx,
   InspectorPanel.tsx) reads slices of it.
8. Actions: a click on a card button called runCommand(text), the same path as the terminal; the world never talked to
   the engine.
9. Visibility: ResizeObserver drives handle.resize; IntersectionObserver plus visibilitychange drive handle.setPaused.
10. Tests: Vitest in node with no jsdom. Logic was kept free of three.js or DOM so it ran as is; only
   src/world/mountWorld.test.ts used vi.mock (it fakes createWorld and the audio). 12,881 of the 40,590 lines are
   tests.
## 2. Reuse map: renderer and resize/DPR

Files: core/World.ts (690), core/rendererLook.ts (25), core/SystemRunner.ts (102, test 190), mountWorld.ts (217, test
198), WorldView.tsx (87). rendererLook.configureRenderer is generic: transparent clear, sRGB output, no tone mapping
on purpose, shadows only on 'high', PCFShadowMap (a comment records that PCFSoftShadowMap was removed in three r186).
World.ts is generic in its skeleton (acquireContext asks for WebGL 2 before building a renderer and throws
WorldUnsupportedError; applySize sets pixel ratio and redraws at once to avoid a blank frame per resize;
watchPixelRatio re-arms a matchMedia resolution query when the window changes screen) but it is wired to the old
OfficeSystem, EmployeeSystem, SeatingPlan, getOfficeLayout and WorldSnapshot. Judgement: rendererLook and SystemRunner
reuse as is; World.ts, mountWorld.ts and WorldView.tsx reuse with changes (swap the snapshot type, the store
subscription and the list of systems). Reason: the hard-won parts are the edge cases, not the game wiring.

## 3. Reuse map: camera and controls

Files: core/CameraRig.ts (492, test 501), interaction/gestures.ts (184), interaction/Interaction.ts (526, shared test
714), office/framing.ts (206), core/layoutBounds.ts (33, test 35). CameraRig is a fixed true-isometric
OrthographicCamera (azimuth 45 degrees, elevation atan(1/sqrt 2)), zoom 0.6 to 2.6, with setFraming (including
fitWidth so a phone in portrait still sees the whole floor, and fill 0.85), focus, focusPoint, panByPixels, zoomAt,
shake, project, screenToGround and pan bounds. Its maths is plain arithmetic, so it runs in node tests.
GestureRecognizer turns pointer samples into tap, pan and pinch with a 6 px click threshold and knows nothing about
the DOM. Interaction.ts adds wheel and trackpad zoom and Safari's own gesture events. All generic. Judgement:
CameraRig and gestures reuse as is; Interaction and framing reuse with changes (they take the old layout and target
types). Limit to know: the camera never rotates or orbits; if the new main screen wants a turnable office, that is new
work.

## 4. Reuse map: lighting and materials

Files: core/Lighting.ts (409, test 349), core/lightingState.ts (47), core/materials.ts (122), core/colors.ts (208),
core/geometry.ts (88), core/textures.ts (112), core/models.ts (528), core/sharedResources.ts (22), core/palette.ts
(32, a re-export barrel), core/math.ts (40). One lighting model everywhere: Lambert with a sun, a sky (hemisphere)
light and a fill, blended between named looks (MORNING first), calibrated so a lit surface is drawn in the colour it
was authored in. Lighting publishes duskAmount and daylight per scene so monitors and lamps can follow the time of
day. models.ts has ModelBuilder (box, strut, tube, cyl, ball, blob, torus, lathe, prism, plate, bake) which bakes a
whole prop into one vertex-coloured geometry, so one prop is one draw call; bakeModel caches by key. Materials,
geometry and textures are module-level caches freed by disposeSharedResources. Judgement: materials, geometry,
textures, models and math reuse as is; Lighting reuse with changes (its time of day followed the old game's action
points and win endings); colors.ts reuse with changes (ROLE_COLORS is keyed by the old team roles, PHASE_THEMES by the
old five phases, and this is where an era theme would go).

## 5. Reuse map: office layout and furniture

Files: office/layouts.ts (825, test 1040), office/footprints.ts (602), office/OfficeSystem.ts (197, test 714),
office/OfficeStage.ts (429), office/DeskSlots.ts (364), office/AssetSlots.ts (147), office/dressing.ts (392),
office/shell.ts (298), office/StageKit.ts (89), office/PropSet.ts (78), office/mergeStatic.ts (100), office/motion.ts
(135), office/timing.ts (24), and nine prop files under office/props/ totalling 6,430 lines (stations.ts 1,607,
decor.ts 993, building.ts 952, assets.ts 746, shared.ts 606, workstations.ts 526, catalog.ts 396, parts.ts 350,
markers.ts 254; test props.test.ts 531). The whole office folder is 10,908 source lines. Layouts are not generated:
there is one hand-drawn floor plan per phase, built with small drafting helpers (onBackWall, onSideWall, inFrontOf,
bench rows) and checked by rule tests (nothing overlaps, at least 0.9 clear behind every seat, every seat reachable
from the door). Furniture is generated in code by ModelBuilder; a search for GLTFLoader, TextureLoader, .glb, .png,
.mp3 in src/world found nothing, so there are no asset files. Tied to the old game through the five-value
CompanyPhase, the old purchasable assets (helicopter, jet, yacht, lounge, espresso bar) and eight stations named after
old commands (ship, launch, investors, boardroom, calendar, coffee, servers, pricing). Judgement: mergeStatic,
footprints rules, the drafting helpers and the generic props (desks, chairs, decor, building shell) reuse with small
changes; the plan table must be re-keyed to the new office tiers; stations.ts needs remapping to the new game's
actions or dropping. Whether any prop has era variants (for example an old CRT monitor) was not checked.

## 6. Reuse map: people: models, animation, movement, instancing

Files: people/Character.ts (829, test 326), people/actor.ts (815, test 712), people/crew.ts (965, test 1206),
people/EmployeeSystem.ts (369, test 424), people/seating.ts (265, test 585), people/pathFollower.ts (169, test 193),
people/approach.ts (80), people/footfall.ts (99, test 152), people/markers.ts (282, test 80), people/random.ts (38),
office/pathfinding.ts (574). Model: peg characters of eight baked meshes each on a tiny rig, shared geometry and one
shared material, with nine procedural poses (stand, walk, sit, type, cheer, slump, sleep, phone, floor-sit); look
varies by a seeded number (skin, hair, outfit, height). Movement: pathfinding.ts rasterises a 0.4-unit grid per
layout, runs A* and straightens the route by line of sight; pathFollower walks the polyline with smoothed turning;
approach.ts and actor.ts handle pulling a chair out and sitting without walking through it; seating.ts remembers who
sits where so one hire does not shuffle everyone. actor, crew, seating, pathFollower, approach, footfall and
pathfinding contain no three.js. Instancing: people are NOT instanced. InstancedMesh appears only in
fx/ParticleRenderer.ts and for pizza boxes in people/markers.ts. With the cap of 64 people (MAX_WORLD_PEOPLE in
snapshot.ts) that is up to 512 draw calls for people. Judgement: pathfinding and pathFollower reuse as is; Character,
actor, seating, approach and EmployeeSystem reuse with changes (type swaps, role colours); crew.ts reuse its cast
management but rewrite its reactions, which are scripted to old events and old numbers (morale, stress, shipping, the
coffee errand); an office with more than about 64 visible people needs instancing or a simpler far-away figure, which
would be a rewrite of the drawing side only.

## 7. Reuse map: picking and hover

Files: interaction/picking.ts (210), interaction/hitProxy.ts (85), interaction/HighlightRing.ts (228),
interaction/footprint.ts (102), interaction/Interaction.ts (526), types/interaction.ts (41); one test file,
Interaction.test.ts (714). picking.ts is a registry of clickable things plus a raycast, built without the DOM so it
runs in node; an entry only counts while its object is attached and visible, so a system that forgets to unregister
cannot leave a ghost. hitProxy.ts adds invisible boxes so small things are easy to hit (a comment notes peg people are
about a dozen pixels wide in the big offices). HighlightRing draws hover and selected rings on the ground with a fixed
on-screen line width. Hover is re-picked on pointer move and at an interval while the pointer rests, not every frame.
Generic apart from the InteractableTarget union (person, station, asset and so on). Judgement: reuse as is, changing
only the target union.

## 8. Reuse map: labels over 3D objects

Two techniques were used. In the scene: fx/FloatTextLayer.ts (289) draws rising text (for example money amounts) as
canvas-texture sprites whose on-screen font size is clamped between 13 and 24 CSS px at any zoom; fx/BubbleLayer.ts
(197) draws thought bubbles as sprites, at most 24 at once, with icons from fx/bubbleIcons.ts (509). In HTML over the
canvas: ui/HoverTooltip.tsx (73) re-projects its target each frame and moves itself with a CSS transform without React
renders; ui/placement.ts (166, test 165) is pure geometry for placing a card beside its target with a notch;
ui/stage.ts (92) carries the selected target's screen position on a channel outside the store because it changes every
frame; ui/useSelectionKeeper.ts (84); below 640 px wide the card docks as a bottom sheet (DOCK_BELOW_PX in
ui/WorldOverlay.tsx, 88). Tied to the old game: ui/inspector.ts (1,052, test 1,236) and ui/InspectorPanel.tsx (447),
which describe old people, builds and commands, and ui/WorldHud.tsx (141). Judgement: FloatTextLayer, BubbleLayer,
placement and stage reuse as is; HoverTooltip and WorldOverlay reuse with changes; inspector.ts, InspectorPanel and
WorldHud rewrite against the new view model (src/ui/viewModel.ts on the current branch).

## 9. Reuse map: quality tiers and mobile fallbacks

Files: ui/environment.ts (36), core/adaptiveQuality.ts (246, test 389), the PIXEL_RATIO_STEPS table in core/World.ts,
ui/WorldShell.tsx (61). Two tiers only, 'low' and 'high'. detectQuality picks 'low' for a coarse pointer, a screen
whose short side is under 520 px, or 4 or fewer cores; 'low' has no shadows and a pixel-ratio cap of 1.5, 'high' has
shadows and a cap of 2. On top of that AdaptiveQualityGovernor watches real frames (work over 14 ms on 75% of a 2 s
window, or 25% missed vsyncs) and steps down the ladder 2, 1.5, 1 and then turns shadows off; steps never go back up
in a session. prefers-reduced-motion is read once and passed to camera, lighting, fx and interaction. If WebGL 2 is
missing, the chunk fails to load or a render throws, the stage goes to 'unsupported' and the game continued in the
terminal. All generic. Judgement: reuse as is. Change needed around it: the old fallback was 'the terminal has
everything'; with 3D as the main screen the fallback target has to be today's React screens.

## 10. Reuse map: disposal and context loss

Files: core/World.ts (dispose, disposeTree, acquireContext, releaseContextWhenOrphaned, onContextLost,
onContextRestored), core/sharedResources.ts (22), mountWorld.ts (the undo stack), WorldView.tsx (keyed reload). What
it handles: React StrictMode creating a world twice on the same canvas (the pending context release is cancelled and
renderer.resetState is called so a leftover GL setting does not break the next renderer); a canvas that has left the
page gets its GPU context released after 300 ms through WEBGL_lose_context; on context loss the handler calls
preventDefault, stops the loop and shows a 'Reload 3D view' button that replaces the canvas; a new run (runId change)
tears down and rebuilds the office and people systems so nothing leaks from one company to the next; teardown runs
every undo step even if one throws. sharedResourceStats exists for leak checks. Generic. Judgement: reuse as is.
Constraint recorded in a comment: the material, geometry and texture caches are module-level, so only one world can
exist at a time and a world must never be kept alive across unmounts. A second 3D view (for example a market view
beside the office) would need those caches made per-world.

## 11. Reuse map: sound hooks

Files: WorldSoundListener and WorldSoundSink in types/system.ts (123), soundPan, tellSound and reportDusk in
core/World.ts, people/footfall.ts (99, test 152), ui/worldSounds.ts (130, test 114). The world reports only the
moments it alone can time: footsteps through the door with a count of 1 to 6 and a direction, a chair being sat in, a
thought bubble popping, and the dusk amount; each cue carries a left-right pan computed from where the camera draws
the spot, kept moderate (spread 0.6). A listener that throws is ignored so sound can never cost a frame.
worldSounds.ts decides click, hover and zoom ticks as pure functions. The player lived outside the world in
src/audio/worldAudio.ts on main; src/audio still exists on the current branch (engine.ts, settings.ts, index.ts) but
worldAudio's presence there was not checked. Judgement: the hook interface and footfall reuse as is; the wiring in
mountWorld reuse with changes.

## 12. The seam to replace (tied to the old game, rewrite)

src/world/snapshot.ts (282, test 584) and src/world/types/snapshot.ts (202) project the old weekly game (week, action
points, cash, morale, stress, named staff with energy and quirks, product builds, candidates, owned assets);
src/world/events.ts (370, test 1,085) diffs two snapshots plus the last terminal command into events;
src/world/names.ts (229, test 363) names staff from the run seed; src/world/phase.ts (31) guards the five phases.
Measured coupling: 41 of the non-test, non-dev source files import from the old engine, state, game types or audio,
and there are 48 imports of the old game types file. Most of those are type imports (roles, phases, asset ids), so the
practical job is to define a new small snapshot type first and re-point the imports to it.

## 13. What it cost

Size: 125 files, 40,590 lines; 26,236 source, 12,881 tests (including a 178-line test kit), 1,473 for a developer
sandbox (dev/PropGallery.tsx 610, dev/WorldPreview.tsx 863). By folder, source then tests: office 10,908 / 2,285;
people 3,911 / 3,678 plus the test kit; core 3,196 / 1,464; ui 2,471 / 1,704; fx 2,411 / 628; interaction 1,335 / 714;
root files 1,322 / 2,230; types 682 / 0. Build size: no record exists. main has no docs folder, its vite.config.ts has
no chunk settings, and a search for kB, gzip and 'bundle size' in docs, README and src/world found nothing; I did not
run a build. The only related fact is that three.js and the scene code were in a lazily loaded chunk. Dependencies:
three ^0.187.0 and @types/three ^0.187.0, two three addons (RoundedBoxGeometry, BufferGeometryUtils); the current
branch has no three in package.json and none installed.

## 14. Known problems recorded in the code

There are no TODO, FIXME, HACK or XXX markers in src/world (the only matches are the word 'hacker'). What comments do
record: (a) core/adaptiveQuality.ts 'Known limitation': a GPU-bound view stuck at a steady 20 to 30 frames a second
looks like a slow display and is treated as fine, and a view under 1 frame a second is never judged; (b) quality steps
never go back up in a session; (c) module-level caches mean one world at a time (see point 10); (d) a deliberate
double dispose of materials in World.dispose marked 'do not deduplicate'; (e) three r186 removed PCFSoftShadowMap; (f)
Safari reports trackpad pinches through its own events and on iOS the same pinch also arrives as two touches; (g)
three's default pick threshold for lines is one world unit and had to be lowered to 0.06; (h) resize needs an
immediate redraw or the browser paints a blank frame. Review tags M1 (merge static geometry), M2 (adaptive quality),
M3 (snapshot and layout caching) and M5 (splitting a 1,074-line palette file) show that draw calls, frame rate on weak
devices and file size were each fixed after the first build. The word 'mobile' never appears; small screens were
handled by the 'low' tier, fitWidth framing and the bottom-sheet card.

## 15. How the old game decided what the office looked like

The engine kept a company phase with five values in order: garage, coworking, office, unicorn, public.
computeCompanyPhase in src/engine/progression.ts (25 lines) recomputed it every turn with no ratchet, so the office
could shrink: coworking needs valuation of at least 5 million and (250 users or a team of 4); office needs 30 million
and (10,000 monthly revenue or 2,500 users or a team of 10); unicorn needs 1 billion and (80,000 monthly revenue or
20,000 users) and a funding stage past garage; public needs 10 billion, 250,000 monthly revenue, the growth stage and
a team of 25. Each phase had one hand-drawn plan (table at office/layouts.test.ts lines 58 to 63): garage 8 by 7 units
with 3 desks and 4 overflow spots; coworking 12 by 10 with 8 and 6; office 17 by 13 with 20 and 8; unicorn 23 by 17
with 36 and 10; public 27 by 19 with 48 and 12. The two founders have their own seats. At most 64 people are drawn;
the rest are counted on an overflow sign (hiddenCount). getOfficeLayout(phase, ownedAssets) is pure and cached; buying
an asset never moves furniture, it only widens the camera shot and adds hang-out spots, and assets for sale stand
outside as blueprints. Furniture colours came from a per-phase theme (PHASE_THEMES in core/colors.ts). On a phase
change the old office sinks in 0.4 s, the new one rises, and contents pop in one by one, all in place by 1.15 s
(office/timing.ts); the camera glides to the new framing. Until setup finished, only the founder was shown.

## 16. Fit with the three timeline shapes (my judgement, not a measurement)

(A) Campaign of eras fits the old code best: a new run already hard-resets the office by runId, the phase can start
anywhere in the table, and it can go down, which covers both 'enter the next era as the incumbent in a big office' and
'start again in a garage'. (C) Pick an era fits equally: one race, one theme chosen at start. (B) One long career is
where the old design strains: the largest plan seats 48 plus 12 overflow, the people cap is 64 with no instancing, and
five tiers over 40 or more yearly turns would mean long stretches where the office does not change. In every shape an
era needs what the old code does not have: a theme and prop set per era on top of the tier table. Whether the new
engine on the current branch has any notion of office tier or headcount to drive this was not checked.

## 17. Lesson one: keep the one-way seam and define the new snapshot first

The old world read game state in exactly one pure function and received changes as a diffed event list; everything
else was imperative and outside React. That is why it could be removed cleanly and why most of it can come back. For
the next version, add the office facts (tier, headcount, era, what happened this quarter) to the tested view model on
the current branch and have the 3D read only that.

## 18. Lesson two: decide the fallback before the main screen

The old canvas was labelled a visual companion, took no keyboard focus, and every action in it was also a terminal
command; when WebGL 2 was missing, the context was lost or the chunk failed, the game carried on. A 3D main screen
removes that safety net unless today's React screens stay as a complete way to play. Keep the old pieces for this:
WorldUnsupportedError, WorldBoundary, the 'unsupported' and 'context-lost' stage states, the reload button.

## 19. Lesson three: keep behaviour free of three.js so the node-only test setup keeps working

Camera maths, gestures, picking, seating, pathfinding, the actor state machine, the staff director, the quality
governor and the floor plans all ran in Vitest without a browser, and only one test file needed a mock. That is how
12,881 lines of tests existed with no jsdom. Follow the same split: pure logic in tested modules, a thin three.js
layer that copies their state onto meshes each frame.

## 20. Lesson four: content is the cost, and eras multiply it

The engine-like parts (renderer, camera, lighting, interaction, quality) total about 4,500 source lines; the office
folder alone is 10,908, of which props are 6,430, for five plans and one visual period. A 1990s-to-future timeline
with a distinct look per era would multiply that unless eras are expressed as data: a tier table for floor size and
desk count, plus a theme per era (palette, monitor and phone props, decor set, lighting look). Start with two or three
tiers and one or two era themes, and only then decide how many more are worth drawing.

## 21. Lesson five: the rendering budget that worked, and its ceiling

What held up: a fixed isometric orthographic camera, Lambert shading with one sun and no tone mapping, every prop
baked to one draw call, the static building merged per material, shadows only on capable devices, a pixel-ratio ladder
of 2, 1.5, 1, pausing when hidden or off screen, and a hard cap of 64 drawn people with an overflow sign. The ceiling:
people cost eight draw calls each and are not instanced, a tier change rebuilds the whole stage, and only one world
can exist at a time. If the new design wants a visibly large company, a second 3D view, or a smooth 'the office grows
desk by desk' feel instead of five jumps, plan instancing for people, per-world caches and incremental layout changes
from the start.

## Measured

- git ls-tree -r --name-only origin/main src/world, then wc -l on each file via git show: 125 files, 40,590 lines
- Split by kind: 26,236 source, 12,881 tests (.test.ts plus people/testKit.ts 178), 1,473 dev sandbox
  (dev/PropGallery.tsx 610, dev/WorldPreview.tsx 863)
- By folder, source/test lines: office 10,908/2,285; people 4,089 incl. test kit/3,678; core 3,196/1,464; ui
  2,471/1,704; fx 2,411/628; interaction 1,335/714; root 1,322/2,230; types 682/0
- office/props/*: nine files, 6,430 lines (stations 1,607; decor 993; building 952; assets 746; shared 606;
  workstations 526; catalog 396; parts 350; markers 254)
- git rev-parse --short: origin/main = 63b4bed, HEAD (claude/trusting-ramanujan-gd0yok) = b0d38b0
- origin/main package.json: three ^0.187.0, @types/three ^0.187.0, no react-three-fiber or drei; current branch
  package.json has no three and node_modules/three is absent
- Fully read: WorldView.tsx, mountWorld.ts, core/World.ts, types/system.ts, types/handle.ts, types/snapshot.ts,
  phase.ts, engine/progression.ts, core/rendererLook.ts, core/sharedResources.ts, core/palette.ts,
  core/lightingState.ts, ui/environment.ts, office/timing.ts, ui/WorldShell.tsx
- Phase thresholds read from origin/main:src/engine/progression.ts; desk counts read from
  origin/main:src/world/office/layouts.test.ts lines 58-63 (3/8/20/36/48 desks, 4/6/8/10/12 overflow)
- git grep TODO|FIXME|HACK|XXX in src/world: no real hits (19 matches, all the word 'hacker')
- git grep InstancedMesh in src/world: only fx/ParticleRenderer.ts, fx/particles.ts (comment) and people/markers.ts;
  mergeGeometries only in office/mergeStatic.ts
- git grep GLTFLoader|TextureLoader|.glb|.gltf|.png|.jpg|.mp3|.ogg in src/world non-test files: 0 hits; three addons
  used: RoundedBoxGeometry and BufferGeometryUtils, one import each
- Coupling: 41 non-test, non-dev files in src/world import from engine, state, types/game or audio; 48 imports of
  types/game
- git grep vi.mock|WebGLRenderer in src/world test files: only mountWorld.test.ts
- main has no docs/ directory; vite.config.ts on main is the default with the React plugin only; grep for
  kB|gzip|bundle size in docs, README.md, src/world, vite.config.ts found no size record
- Word counts in src/world: 'mobile' 0, 'fallback' 18, 'perf' 20, 'draw call' 6, 'leak' 8, 'known limitation' 1
## Not checked

- Build size of the old 3D chunk: no record found and I did not run a build (three is not installed on this branch)
- Actual frame rate, draw-call counts or memory of the old world: nothing was run; the 512 draw calls for people is 8
  meshes times the 64 cap, an upper bound from the code comments, not a measurement
- Whether the old world still compiles against the current branch's code: not tried (read-only task)
- Bodies of most large files were not read past their header comment and export list: office/props/* (6,430 lines),
  OfficeSystem.ts, OfficeStage.ts, DeskSlots.ts, AssetSlots.ts, dressing.ts, shell.ts, footprints.ts, framing.ts,
  pathfinding.ts beyond line 45, Character.ts, actor.ts, crew.ts, EmployeeSystem.ts, FxSystem.ts, particles.ts,
  bubbleIcons.ts, events.ts, names.ts, inspector.ts, InspectorPanel.tsx, WorldHud.tsx, both dev sandbox files
- Lighting.ts beyond line 75 and CameraRig.ts beyond line 120 (method list only); how exactly time of day was driven
  is taken from the lightingState.ts comment ('a full-AP morning')
- Whether any prop has period variants (old monitors, phones) usable for a 1990s look
- How the non-mock world tests (Lighting.test.ts, Character.test.ts, OfficeSystem.test.ts) build their scenes in node:
  files not opened
- Whether src/audio/worldAudio.ts still exists on the current branch (only the directory listing was checked:
  engine.ts, settings.ts, index.ts and their tests)
- Whether the new engine or view model on the current branch has any office-tier, headcount or era value to drive a 3D
  office
- The existing throwaway 3D mock (the artifact linked in the request) and how it was built: outside this question
- git history of src/world (how long it took to build, which commits fixed which problem): not read
