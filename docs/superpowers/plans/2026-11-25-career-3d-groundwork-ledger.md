# Ledger: career 3D groundwork

The running record of the plan `2026-11-25-career-3d-groundwork.md`: what each task did, what its review found, and
every decision taken where the plan left something open.

## Method

One fresh implementer per task, an independent reviewer after each, a whole-branch review at the end. The named
skill for this method is not installed on this machine; the method is followed by hand.

## Decisions

- This ledger lives beside the plan, on the groundwork branch, so that it survives the machine.
- A task's review runs in its own checkout while the next task is being implemented, to save time. Fixes a review
  asks for go in before the task after that starts.
- At the cap of 50, when drawn people leave and people who were counted on the sign take their places, the cast gives
  them new ids and lists them as arrived (ruling 3, as written). They were in the building all along. So in Task 7 a
  member of staff who arrives while the previous cast had people hidden is placed at the desk without a walk from
  the door, for as many arrivals as there were hidden people; and in Task 8 the "+N" and "-N" at the door are worked
  out from the head counts of the two scenes whenever either cast has hidden people, and from the cast's lists
  otherwise.
- Nothing in this plan registers a team's area as something to tap. Task 6 makes picking ready for it and tests it;
  the area itself belongs with "moving a person by touching a team's area", which the plan leaves for the wiring.
  Whoever registers it must keep the box low (about 0.1 high), or it wins the tap ahead of the figures inside it.
- People wander to the coffee machine only while the loop is kept running (the lab's switch). As Task 7 left it, a
  trip could start within 15 seconds of any new scene and the office came to rest within 90; Task 11 asks for rest
  within 15 seconds of a year's end, and the design asks for a view drawn only when something changes. So Task 9
  gates wandering behind the same switch that keeps the loop awake, off by default.
- Task 11's "fail on any console error or warning" allows one message: the graphics driver's "GPU stall due to
  ReadPixels", which headless Chromium's software renderer logs whenever the world draws. The world never reads
  pixels back. Every other warning fails the check.
- Task 11 restores a lost context through "Reload 3D view", as the plan says. Restoring in place and then unmounting
  logs driver warnings about objects of the old context; the picture is right, and the button's path is clean.
- Someone back from being away takes the first team that is short, in the order Product, Growth, Recruiting, which
  need not be the team they left (ruling 4, as written). Kept: the plan's ruling is explicit.

## Tasks

| Task | State | Commits | Review |
|---|---|---|---|
| 1 | done | a6ed44b | approved; four minor points, three fixed with Task 2 |
| 2 | done | a79793a, 2fb6113 | approved; one minor point, fixed with Task 5 |
| 3 | done | 1fecaab (merge), 996c1a0 | approved; four minor points, fixed with Task 5 |
| 4 | done | 0b2fc50 | approved; five minor points, four fixed with Task 6 |
| 5 | done | a103c6c, 5cd04ed | approved; minor points, two fixed with Task 7 |
| 6 | done | b5e5a27, 182fad9 | approved; no findings |
| 7 | done | bb811ab, aab5a0c, 9ca7013 (fixes) | approved with two important points, fixed before Task 9 |
| 8 | done | 3dbd554 | approved; three minor points, fixed with Task 9 |
| 9 | done, in review | b47bf0c, 98e73bf | pending |

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

### Task 2

Decisions the implementer took, all judged sound by the review:

- Counts that are not whole are rounded down; negative and non-numbers read as 0.
- Someone who becomes away without a team gets Product. New staff ids come before new door ids.
- The groups "away" and "leaving" may also take people from the door and then new ids, as ruling 3 says.
- A face is worked out from the scene's seed on every cast, so the seed must stay the same for a run id.
- `ended` is reported when the ending is set and differs from the one before. A first scene that already has an
  ending reports nothing, so a system reads `scene.ending` for where things stand.
- `targets.ts` is restored in this task. `types/seating.ts` is reshaped rather than restored as it was: seats are
  `"desk" | "waiting"` with an `index`, and the seating's interface has `teamOfDesk`, `waitingOccupant` and
  `hiddenCount`.
- The sound types stay in `types/system.ts`, unused, as the inventory allows. The barrel uses `export *`, because
  `TEAMS` is a value.

Tests dropped with their files: the old `events.test.ts` (replaced by `sceneEvents.test.ts`), `snapshot.test.ts`
(replaced by `cast.test.ts` and Task 3's `officeScene.test.ts`), `names.test.ts` (no replacement: people have no
names).

Review: approved. A fuzz of 400 runs of 40 scenes held every invariant: nobody invented or lost, ids never reused,
people in id order, arrivals and departures matching the difference between two casts. One minor point (a comment
on the wrong declaration in `types/handle.ts`).

### Task 3

The merge of the rules branch brought three of its commits, all in its own files, and was green on its own. The
engine had every name the plan assumed.

Decisions the implementer took:

- The office index is kept within 0 to 4 and within the config's own list of offices; a config with no offices
  gives a capacity of 0.
- An unknown company id throws the same error as a game that is not a career.
- A game that ends with no winner is `"lost"` for everyone.
- Expected hires that are not a number give 0.

For the other track (the rules):

- `Team` and `TEAMS` must stay the engine's `Department` and `DEPARTMENTS`, in the same order. A test pins it.
- The scene reads `CareerRules.offices[].capacity`, `.eras[].id`, `.firstYear`; `CompanyCareer.office`, `.founded`;
  `Company.out`; `GameState.outcome.winnerId`; and the checked plan's `allocation`, `raisePercent`, `layoffs`.
- The scene's test "the people always add up to the head count" rests on: allocation = head count - layoffs - (1 if
  raising). If a rule ever takes another person away from work, that test goes red and the scene needs a new field.
- The engine's plan check drops `Plan.goPublic`. The scene does not use it; noted in case it is not intended.
- Era ids are free strings; the world gives every id the look `"classic"`.

Review: approved. 21 of 24 mutations of the builder were caught, and a fuzz of 40 careers played to the end with
hostile drafts never broke a scene. Minor points, fixed in a small commit at the start of Task 5: two tests to add
(an office index past the fixed range under a config with six offices; a career state under a config without a
career); a config with no eras throws the builder's own error instead of the engine's; a draft is ignored for a
company that is out.

### Task 4

Eight files of the art kit and the camera came back byte for byte; `colors.ts`, `SystemRunner.ts` and `Lighting.ts`
were edited. Decisions the implementer took:

- Team colours: Product sky blue, Growth orange, Recruiting green, from the old role palette. If the game's screens
  settle on team colours, these three constants follow. The name `ROLE_COLORS` is the plan's.
- The theme table is keyed by look, then office: `themeFor(office, look)`. The old names `PHASE_THEMES`, `PHASES`,
  `phaseTier` and `PhaseTheme` are kept because later folders import them.
- The founder's and cofounder's outfits and the executive tie are gone from `colors.ts`.
- A system whose `busy()` throws counts as at rest and is reported once, so a fault cannot keep the loop awake.
- Lighting: one resting look for each office (morning, for the classic look); the old sweep is kept when a year
  advances; a year that also ends the run fades to the ending without a sweep; a glide lands exactly on its goal so
  that the lighting comes to rest; the old "setup" look is gone.

Camera framing tests held back for Task 5, where the layouts are: the five "fills the binding dimension and crops
nothing of the building" tests and "frames the building, not the ground tile". Dropped for good with the purchasable
assets: the five "with outdoor assets" framing tests and "frames owned outdoor assets but not the ones merely for
sale". Lighting tests about the day running out, the event flicker and the setup dimness are dropped with those
behaviours and replaced by tests of the resting look, the absence of a clock, the ending's fade and coming to rest.

Review: approved. Every path of the lighting was shown to come to rest (a year's sweep in about 1.5 s, an ending's
fade in about 7 s, at once under reduced motion). Minor points, fixed in a small commit at the start of Task 6: a
frame time that is not a number must not keep the lighting busy for good; a frame that arrives during an ending's
fade must not cut the fade short; the dusk look's sun direction gets its assertion back; a comment loses its old
role names. Left as it is: comments in files restored byte for byte (`textures.ts`, `palette.ts`) that still say
"terminal font", "calendar week" and "per-phase". The inventory's verdict for those files is "as is", and no player
reads a comment. Task 9 must draw a frame after `setBounds` while at rest, since the lighting does not report busy
for it.

### Task 5

How each plan gets its desks: the garage has the table for two and the facing pair (the desk jammed in at an angle
is dropped), 4; the shared office has its island of 8 and one wall desk, 9; the own office has 20 bench desks and two
corner desks, 22; the full floor has benches of 14, 12 and 12 and two wall desks, 40; the campus has six benches of
8 and two corner desks, 50. The clash the inventory records was confirmed (the full floor's new pair lands on a
plant) and fixed as it says (the plant moves to 3.825, 4.5).

Decisions the implementer took:

- Waiting spots are clear floor, not obstacles, sorted nearest the door first: 4, 6, 8, 10 and 12 of them.
- `OfficeSystem` works without a seating plan (every desk free and neutral, no sign), since Task 7 supplies one.
- The office is rebuilt when the layout or the look differs, or on a reset.
- Every desk style shows its team's colour. Two styles drew no accent at all, so `parts.ts`, which the inventory
  lists as unchanged, gained an accent mat and accent pads. A desk no team has is grey.
- The stations are furniture with plain labels (Whiteboard, Marketing corner, Phone corner, Board table, Wall
  calendar, Coffee machine, Server rack, Price board). The calendar is a page with no words or numbers; the server
  rack blinks at a fixed rate.
- The sign reads "+N"; its label is "N more people work here".
- No company name reaches the world, because the scene has none. The four name signs carry fixed words ("hello",
  "welcome", "onwards", "HQ"). When the game is wired in, a company name would be a new field of the scene.
- `interaction/hitProxy.ts` and `interaction/footprint.ts` came back in this task, byte for byte, because the office
  needs them.
- While the loop rests, the coffee's steam and the server's lights stand still.

Tests dropped with their behaviour: everything about purchasable assets, founders' seats, the event beacon and
alarm, command plates, beanbags, upgraded desks, the sign's rename and the end-of-run block. Replaced by tests that
no station, door or wall writes a word, that the sign writes a plus and a number, and by the plan's own.

Noted: the built stylesheet grew by about 0.3 kB though `src/index.css` is untouched. To be explained by the
whole-branch review.

Review: approved. The reviewer checked all five plans with rectangle maths of its own (no overlap, 0.9 clear behind
every seat, every seat, waiting spot and wander spot reachable from the door), read the plans' coordinates against
the old ones (nothing moved beyond the plan's six points), and showed the office system always comes to rest and
leaves nothing behind when disposed. The stylesheet's growth is the CSS framework finding the words "sticky" and
"invert" in the new source files and emitting those two unused utilities: harmless. Minor points:

- The arcade cabinet's screen, carried over from the old code, drew rows of blocky invaders, a cannon and a shot.
  That reads as a nod to one existing game, so it is replaced by an abstract picture at the start of Task 7.
- Comments in `pathfinding.ts` that still say "cushion" are reworded at the start of Task 7.
- The ticker's symbols (SUW, CASH, BURN, HYPE) stay: they read as plain words of this game, not as companies.
- With no seating plan the sign shows nothing even if the cast hides people. Left: Task 7 supplies the plan.
- The garage has four waiting spots and up to six people may wait, so two of them have no spot there (Task 7's
  ruling 4 covers it: they are not drawn).

### Task 6

Five files are byte for byte the old ones (`HighlightRing.ts`, `gestures.ts`, `picking.ts`, and `hitProxy.ts` and
`footprint.ts` from Task 5); `Interaction.ts` differs in two comments that spoke of the terminal. The test file has
36 tests, the old 34 and the plan's two. The nine station literals in the test stay as they were: the inventory
expected `station` to leave the union, and Task 2 kept it. The desk literals and the founder ids were the ones to
change.

Review: approved with no findings. Both new picking tests fail under mutation; the lighting's fade logic was probed
through ten scenarios (a reset or a new year during the fade, won then lost, an endless frame length) and came to
rest in each.

### Task 7

Part A replaced the arcade screen's picture with stars over coloured bars. The people: 169 tests in the folder, the
path follower's 14 byte for byte.

Decisions the implementer took:

- The world owns the seating plan and reconciles it before the systems get the frame, as the old world did; that is
  what lets the office see this frame's seating. The people read it from the context.
- The sign counts the cast's hidden people plus people working without a desk, not people away or at the door.
- A team's area ends at its last desk. Waiting spots are handed out afresh each time, leavers first.
- Everyone at the door stands; the floor pose and the lap laptop are gone with the beanbags.
- A face never changes with the shirt: accessories have the same odds for every team. A team shows on the shirt:
  Product a pocket, Growth a light panel, Recruiting a lanyard. Someone no team has wears grey. Someone let go keeps
  the last team's shirt and carries the box while standing at the door.
- Someone going away walks out empty-handed and walks back in on return.
- Staff who were on the sign and take a drawn place appear at the desk with a short scale-in, without a walk.
- Under reduced motion everyone is placed on every frame.
- `busy()` is movement only: waiting for a turn, walking, settling, appearing, leaving, a rolling chair. Typing and
  swaying do not count.
- Nobody reacts to an ending in this task. No sound calls.
- One figure is 8 meshes on one shared material: 8 draw calls, and 2 to 6 more in the shadow pass. 56 figures are
  448 calls, which a test pins.

Slip, reported by the implementer: `seating.ts` was drafted before its tests were run, so those tests were not seen
failing first. The review is asked to mutate `seating.ts`.

Old tests dropped with their behaviour: founders' seats and outfits, names, morale and stress, every scripted
reaction, the win and loss scenes, the floor pose, id reuse. The crew's tests are rewritten on scenes and casts.

For Task 9: the order in `setScene` is cast, layout, `seating.reconcile`, then the frame to the systems, office
before people. One `update` must run between `setScene` and the first drawn frame, or someone away shows a lit desk
for a frame. A big year can take 20 to 40 seconds to play out with the old limits (arrivals 0.4 s apart).

Review: approved, with two important points and seven minor ones, all fixed in one commit before Task 9. The
reviewer's fuzz (300 runs of 50 scenes through the cast and the seating; 150 hostile runs through the crew) broke no
invariant and always came to rest, even with the door blocked for good. The important points:

- More than 56 figures could exist for a while: people leaving kept their bodies until they reached the door while
  people from the sign's count appeared at once (60 measured at the campus). The fix holds the number of bodies at
  56 on every frame: a walk-out that would pass the cap is skipped and the body removed at once.
- The plan's claim "when one person changes team, at most two people walk" is false between Product and Recruiting:
  1/1/2 becoming 2/1/1 makes three people walk. The code follows the rulings as written, so the claim is corrected
  (two between neighbouring teams, three between Product and Recruiting) and a test pins the three-walk case. This
  is a wrong sentence in the plan, not a change to the design.

Minor: three seating tests that could not fail are strengthened; a frame time that is not a number no longer wedges
the crew; two tests return for someone who comes back while still walking out; dead fields leave `actor.ts`.

### Task 8

The particle simulation's 23 tests and the placement's 14 are among the passing ones. Five effect files and the
placement test are byte for byte the old ones.

Decisions the implementer took:

- The numbers at the door are a pure function, `doorCounts(next, prev)`, following the ledger's rule. Below the cap,
  someone expected counts as "+1" when they appear at the door and not again when hired, and a hire called off
  within the year shows as "-1": the cast's lists as they are, which is what the plan's test pins.
- The old code had no dust when the office changed; it had confetti and a camera shake. "The old dust when the
  office rises" is read as six puffs of the old dust kind across the floor while the building rises, with the old
  shake of 0.4, which reduced motion skips.
- `busy()` covers particles, bursts still waiting, float texts, bubbles, and 0.8 s after each shake it forwards.
- The shell's words live in `ui/shellWords.ts` with a test. The placeholder reads "Opening the office…"; the note
  reads "The 3D office cannot be shown on this device. The game is complete without it."
- The shell's classes are plain CSS in `world.css`, with a fallback for every page variable, so the shell looks the
  same on a page that does not load the game's stylesheet. The old card classes are not brought over: no card
  exists yet. They are at lines 117 to 162 of the old `src/index.css` for whoever writes one.
- `stage.reset()` is new: it clears the anchor and puts the store back to its first state.

Known and accepted, as the rule gives them: someone who appears at the door below the cap and is hired in a year
that takes the company past it is counted twice; a capped company that shrinks with nobody marked as leaving says
nothing; "-N" shows when the year advances, while the people take some seconds to walk out.

For Task 9: systems are registered office, people, lighting, effects; the effects need the new frame's layout
already in place when the frame is applied; the rest state must also ask the camera rig whether it is moving; the
frame time handed to the systems must be a positive, clamped number.

Review: approved. 19 mutations of the effects system were all caught; the numbers at the door came out right in
every case tried on both sides of the cap; the system always came to rest and released what it made. Until the lab
page exists nothing reaches the shell, so `world.css` is not in the build at all. Minor points, fixed in a small
commit at the start of Task 9: a frame time that is not a number, and a bubble asked to last for ever, must not
keep the effects busy for good; two comments lose old-game words.

### Task 9

Decisions the implementer took:

- `WorldView` has one optional prop besides its source, `onState`, which reports the status and the world's handle
  together. The lab needs both.
- `WorldHandle` gains `setKeepAwake(on)`, `stats()` (draw calls, triangles, geometries, textures, figures, hidden,
  frames drawn), `loseContext()` and `restoreContext()`.
- A second mount disposes the first, with a warning in the console. The old code enforced nothing.
- The teardown never throws: a failing step is logged and the rest still run.
- What could leave `World.ts` lives in two pure, tested modules: `core/FrameLoop.ts` (rest, pause, lost context,
  keep-awake, the one frame request) and `core/sceneFrames.ts` (cast, events, layout, seating, in that order).
- A frame's time is clamped to between 0.001 and 0.1 s. The first frame after a stop counts as 1/60 s.
- Busy is any system, a camera move or shake, or a camera that changed since the last frame. Highlight rings pulse
  without end, so they do not count and stand still at rest.
- Wandering reads `signals.keepAwake`; off, no trip ever starts.
- The shell's new words: "Reload 3D view"; "The 3D office stopped drawing. The game carries on without it."; and
  the canvas's label, "A 3D view of the company's office and the people who work in it. The game is complete
  without it."

The implementer's own run in headless Chromium, before Task 11's script: no frame drawn in a quiet second; a year
with three hires and two layoffs at rest 8.9 s after it advanced; the campus with 150 people at 390 by 844 drew 50
figures, counted 100 on the sign, and took 630 draw calls.

Slip, reported by the implementer: `sceneFrames.ts` was written with its test, not after it; checked by mutation
afterwards (5 of 5 caught).

To look at in Task 11's screenshots: in the shared office at 900 by 600 the neighbours' half of the loft crops at
the right edge. The camera frames the company's own floor.
