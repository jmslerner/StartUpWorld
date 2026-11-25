# The throwaway 3D mock: what it proved and what it did not

Research notes from taking apart the throwaway three.js mock that was shown to the owner before the design. The mock
is not the base of the build (the design restores the old 3D office instead); these are its lessons. Reference
material for the 3D plans; the approved design (`2026-11-25-career-3d-design.md`) wins where they differ.

Paths that start with `scratch:` were temporary files on the machine that did the research; they no longer exist and
are kept here only so the notes read as written. Sizes and timings marked as measured were measured on that machine in
November 2026.

## In short

The mock proved the cheap part: the unchanged engine, view model and plan-editing functions drive a three.js main
screen through whole quarters, the scene is tiny (33 draw calls for the market, 66 for the office), and "tap a person,
tap a zone" is two existing stepDepartment calls. It did not prove the tycoon feel: the office is one fixed room with
24 desks, while 300 bot games peak at a median of 36 people (max 54, up to 19 in one department), and the browser run
stopped at Q7, so office tiers, desk layout and people with identities are all new. Keep every number, the price,
raise, poach, marketing and layoff controls, the warnings and the report in the existing React panels; the scene needs
only two inputs (select a company, move a person). Put a new pure "scene model" beside viewModel.ts and let the
three.js layer only draw it and report what was picked: the mock kept real logic in drawing code, and one formula it
retyped there is already wrong. On a phone the figures are about 20 by 32 px with a hit width near 14 px, in landscape
the stage is 92 px high, focus is lost on every panel press, reduced motion is half honoured, and a failed three.js
load kills the page. The headless Chromium method works here and can become the 3D browser check, but as written it
asserts nothing: at phone size two of its three scene interactions missed and it still exited 0.

## 1. What the mock is

scratch:mock3d/page.template.html is 845 lines (CSS 1-118, DOM 120-148, script 152-845) with three.js r128 from cdnjs
and the real game bundled as a global SW from entry.ts (10 lines: CONFIG, createGame, resolveTurn, defaultPlan,
newGameSetup, choosePlans, the six view functions, eight draft functions, six formatters). PROVED: a full quarter loop
(plan, choosePlans, resolveTurn, report) runs from a 3D screen with no engine change; WebGL renders in headless
Chromium here at 1280x800, 390x844 and 844x390; moving a person by pointer and by emulated touch changes the real
plan. NOT PROVED: an office that grows, anything about eras, speed on a real device, or an art direction beyond boxes
and cylinders.

## 2. Market view: each visual and its feed

(a) Four towers: height from heightFor (l.217: 1.5 + min(1.1, users / CONFIG.ipo.users) x 10), read straight from
game.companies[id].users/.launched/.out in syncCity (l.392-401), not through rivalsView; the same fields exist on
ResourceView and RivalRow. (b) Amber ring and wire frame at the IPO height: CONFIG.ipo.users (330K, also
ResourceView.ipoUsers). (c) Tower labels (HTML): raw Company name/users/launched/out plus format.count and
format.quarter (l.558-560). (d) White halo under the selected tower: a mock-local variable `selected`. (e) Label 'The
market, N new users this quarter': formula retyped inline at l.562, a duplicate of newUsersForTurn in
src/engine/formulas.ts:94, which entry.ts did not export. (f) Plaza of 460 dots; on End quarter flow(log) (l.589-601)
sends round(460 x 0.9 x users.won / market.pool) dots to each tower from TurnLog.companies[id].users.won and
TurnLog.market.pool; it reads rivals' private CompanyReport where publicReport (src/engine/view.ts:38) carries the
same users.won. (g) Click a tower (raycast on lot, body, cap, l.713): sets `selected`, HTML card from the rivalsView
row plus planningView(...).poach.options and .cost; clicking your own tower twice opens the office. (h) Drag orbits,
wheel zooms, 200 ms fade between views. Not drawn at all: churn back to the market, users lost to events, users
released when a company goes out, hires, poaches, raises, launches.

## 3. Office view: each visual and its feed

(a) Room: floor, back wall, three zone plates (Product, Growth, Recruiting), 8 desks with screens per zone (24 fixed),
a lobby strip for unassigned people, three wall boards. (b) People: bucket counts from wanted() (l.403-409) using
draft.allocation, draft.raisePercent, draft.layoffs and company.headcount; it re-derives by hand what peopleAvailable
and unassigned (src/ui/draft.ts:10 and :14) compute, and those two are bundled but never called. syncPeople
(l.410-443) decides who changes bucket; slot() (l.313-319) places them. (c) One person stands apart while a raise is
planned; laid-off people line up outside the room. (d) Ghost figures by the door: planningView.hiring.expected capped
at 8 (l.545), with an 'Arriving next quarter' label. (e) Click a person: `picked` (ring and bob); then click a zone or
the lobby: stepDepartment(company, draft, from, -1) followed by stepDepartment(company, draft, to, 1) (l.727-740);
people raising or being laid off cannot be picked (l.723). (f) Zone labels 'Product, n' from draft.allocation, lobby
label from planningView.unassigned, boards from draft.marketing, draft.price with CONFIG.priceTiers,
draft.raisePercent. (g) End quarter: choosePlans(game, seed, CONFIG, [draft, null, null, null]), resolveTurn(game,
plans, seed, CONFIG), defaultPlan(company); the view is forced to the market, a fixed 2,600 ms passes (l.661), then
the report from reportView and endView.

## 4. What stays in HTML

Stats bar of 8 tiles (resourceView); event banner (eventView); the plan panel: steppers for the three departments,
'hire at most', marketing and layoffs, the price and raise choices with the raise's blocked text, the 'if this plan
plays out' projection and the warnings list (all planningView; edits through stepDepartment, assignEveryone,
stepHireLimit, stepMarketing, setRaise, setLayoffs); the rival card with the poach button (rivalsView plus
planningView.poach); the bottom bar (cash floor and expected cash, first non-note warning, End Qn); the report and
final standings (reportView, endView); every label in the scene (HTML divs positioned by projection, l.357-389); the
no-WebGL notice.

## 5. Why that split is probably right

These are exact figures and sentences, which need sharp text and tabular digits. The repo already has a tested React
component for each: src/ui/components/PlanningPanel.tsx (220 lines), RivalsPanel.tsx (88), ProjectionCard.tsx (63),
QuarterReport.tsx (192), ResourceBar.tsx (141), Stepper.tsx, BottomSheet.tsx, plus useDialog.ts; so the scene becomes
a new region of src/ui/screens/GameScreen.tsx (175 lines), not a rewrite. Buttons give keyboard and screen-reader
access for free. The scene needs only two input verbs (select a company, move a person) and can mirror the rest
read-only, as the wall boards do. One hole in the mock: selecting a rival, and so poaching, is reachable only by
clicking a tower; the existing RivalsPanel closes it.

## 6. A warning the mock gives about rules in drawing code

Line 515 computes the marketing-pull hint inline and reads plan.marketing.halved, a field PlanningView does not have
(its fields are amount, step, max, effect, pull), so the hint ignores the event that halves marketing;
PlanningView.marketing.pull is the right number. The page script reads CONFIG directly 10 times and game.companies or
me() 23 times. Three pieces of real logic sit untested inside the drawing script: wanted() (who is in which bucket),
syncPeople() (who moves), flow() (dots per company, which silently truncates the last company through Math.min(DOTS -
next, ...)).

## 7. Proposed scene model, market (plain JSON, no WebGL, tested in node; suggested home src/ui/sceneModel.ts with a test file, like viewModel.ts)

ipoUsers: ResourceView.ipoUsers (existing). newUsersThisQuarter: newUsersForTurn(game.turn, game.modifiers.newUsers,
config) (existing in formulas.ts:94; no view-model field exposes it for the current quarter). towers[4]: id, name, you
from resourceView and rivalsView (existing); users (existing); usersChange from ResourceView.usersChange and
RivalRow.usersChange (existing); fill = users / ipoUsers, uncapped, the drawing layer clamps (NEW; sims reach 1.32
where the mock clips at 1.1); status 'notLive', 'live' or 'out' (NEW mapping of existing launched and out); label text
(NEW composition of format.count and format.quarter); selected (NEW interface state). lastQuarter: pool, newUsers,
carriedIn, carriedOut from TurnLog.market (existing); flows per company {won, churned, lostToEvent} from
publicReport(log.companies[id]).users (existing); dots per company for a dot budget (NEW, built on the existing
splitByWeights in formulas.ts:102 so the parts add up); released users from ReportView.released (existing); beats such
as launched, raised, poached, went out, went public as data (NEW: the private movesOf at viewModel.ts:454 produces the
same facts only as sentences; sources are PublicReport.quality.launchedNow, .raise, .poach, .out and TurnLog.outcome).

## 8. Proposed scene model, office

tier (garage, small office, floor and so on) and deskCapacity: NEW, a pure function of Company.headcount with
thresholds as new numbers in src/config.ts; the engine has no notion of an office today. zones[3]: department and
count from draft.allocation (existing Plan.allocation); hint numbers from PlanningView.projection.quality,
PlanningView.hiring.capacity and PlanningView.marketing.pull (existing). people[]: {id, bucket: product, growth,
recruiting, unassigned, raising or leaving, slot, movable}; the counts are existing (draft.allocation,
PlanningView.unassigned, PlanningView.available, raising = draft.raisePercent > 0, leaving =
PlanningView.layoffs.count); stable ids and the 'who moves' reconcile are NEW (the mock's syncPeople); slot to desk
position is a NEW pure layout function; movable is NEW (the rule at mock l.723). arrivals:
PlanningView.hiring.expected, .wanted, .capacity (existing). Last quarter's comings and goings for enter and leave
animations: ReportView.people {start, hired, poachedIn, poachedOut, laidOff, lostToEvent, end} (existing; the mock
does not animate them, leavers simply vanish). boards: PlanningView.marketing.amount, the selected PlanningView.prices
entry, the selected PlanningView.raise.options entry (existing). picked person id: NEW interface state. targets[]:
{kind, id, accessible name} for every pickable thing: NEW, so real buttons can mirror the scene.

## 9. Scene model, the rest

movePerson(company, plan, from, to): NEW helper for src/ui/draft.ts made of two stepDepartment calls, with tests for
unassigned as source or destination. quarterPlayback(log, reducedMotion): NEW ordered beats with durations as data and
an empty reduced-motion variant; the mock hard-codes 2,600 ms (l.661) and 1.5 s flights (l.796). framing(view,
aspect): NEW pure function replacing the hand-tuned fit() (l.349) and VIEWS table (l.343-346). An era or theme key:
NEW, nothing in the engine carries a year today. DESIGN DECISION TO RECORD: the engine stores people only as counts
per department (Allocation), so named or distinct employees are either cosmetic identities generated deterministically
in the scene model, or an engine change.

## 10. Where the line should run

Engine and viewModel.ts stay as they are. The scene model answers what exists in the picture and in what state (who,
which slot, how many, which flows, which beats, how long). The three.js layer receives that object and sends back only
'target X was picked'; it imports nothing from src/engine, src/config, src/ui/viewModel or src/ui/draft (the repo has
eslint.config.js, so an import restriction can enforce it). React owns selection, calls the draft functions and hosts
the canvas beside the existing panels. Node tests then cover: model functions, layout (no two people share a slot and
every slot lies inside its zone for every headcount up to the cap), reconcile (stable ids, fewest moves), dot split
totals, playback durations. The mock's slot() would fail the layout test: person 17 and later in one department lands
outside the zone plate on top of its label, and the 15th unassigned person sits exactly on the 1st.

## 11. What the mock lacks, office growth

The room is fixed at 24 desks. In 300 bot games (baseline bot in the player's seat) the player's peak headcount was 8
at least, 36 at the median, 43 at the 90th percentile and 54 at most; one department held up to 19 people; up to 10
people joined and up to 2 left in one quarter. The mock's browser run only played to Q7 with a team of about 3, so the
thing the tycoon feel is about, watching the place fill up and move to bigger premises, was never drawn.

## 12. What the mock lacks, phones and picking

At 390x844 the stage is 390x324 px and the panel shows 255 px of 709 px of content; a person measures 19.5-22.3 by
31.5 px, a tower 36-51 px wide, a zone plate about 105 by 82 px. Emulated touch taps on a person hit at 0 and 6 px off
centre, missed at 10 and 14 px, and at 18 and 22 px registered a pick again, consistent with landing on the
neighbouring figure about 20 px away. At 1280x800 a person is 49-57 by 75 px and taps up to 14 px off hit. At 844x390
(phone on its side) the layout stacks the panel under the scene and the stage is 844 by 92 px: people 8-9 by 12 px,
four tower labels and all three zone labels overlapping. Picking is an exact-mesh raycast with no tolerance. Camera:
one orbit plus wheel zoom, no pinch, no pan, and a second finger resets the drag (from code). A real build needs
zone-sized or desk-cluster targets (people are interchangeable, so 'take one from this zone' is enough), a
portrait-first camera fitted to the room's bounds, and a landscape layout.

## 13. What the mock lacks, labels, speed, motion

Labels: 13 HTML tags repositioned every frame with no collision handling; three helper labels are simply hidden under
860 px. Speed: the scene is 108 objects, 33 draw calls and 904 triangles (market), 66 calls and 1,712 triangles
(office), but every desk and screen has its own geometry and material (geometries go from 33 to 95 once the office is
drawn), nothing is instanced, 460 dots are rewritten on the CPU each frame and the page renders continuously even when
nothing moves. Under software rendering a frame took 91.9 ms (market) and 54.7 ms (office) at 936x626; that is not a
device figure. Reduced motion: the flow of dots and the easing are skipped (End Q1 to report 1,194 ms against 3,714
ms), but the idle dots keep moving and the picked person still bobs. Ten Math.random calls (seed, window textures,
dots) make no two runs alike.

## 14. What the mock lacks, keyboard and fallback

The canvas has an aria-label but tabIndex -1 and no role. After pressing Enter on 'Less: Product' focus drops to BODY,
because the panel's innerHTML is rebuilt on every action. The report sheet claims role=dialog but Escape does not
close it and Shift+Tab lands on the End-quarter button behind it; the real app already has `inert` on the main content
(GameScreen.tsx) and useDialog.ts. With WebGL refused, the notice shows and the panel, plan edits and report all work,
but 7 labels still float over the blank stage. With the three.js request blocked the page is dead: panel and stats are
empty and the error is 'THREE is not defined'. A real build should bundle three from npm (it is not in node_modules
today), load the scene as a lazy chunk behind the existing ErrorBoundary.tsx, and fall back to today's 2D GameScreen.

## 15. How the mock was verified

scratch:mock3d/try.mjs (89 lines) uses Playwright 1.63.0 from /opt/node-tools (found through NODE_PATH, not a project
dependency), launches Chromium with --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist
--enable-webgl, serves out/local.html on a fake origin http://mock.local/ and three.min.js from disk through
page.route, and aborts every other request. It clicks a tower by aiming 40 px under its label, switches to the office,
presses two steppers by role and name, hunts for a person with a grid of clicks until the hint text changes, drops
them 90 px above a zone label, ends Q1 to Q6, takes 7 screenshots and prints one JSON line (webgl, rivalCard,
pickedUp, before, after, turn, overflow, problems). It has 6.1 s of fixed sleeps and no assertions. build.py (24
lines) inlines the 41,827-byte game bundle into the page.

## 16. Re-run result

A copy run today took 49.3 s at 1280x800 and worked (rival card 'Morkology', allocation {2,1,0} to {1,2,0}, turn 7,
overflow 0). At 390x844 it took 27.9 s and exited 0, yet the rival card still read 'Your Startup' (the tower click
missed) and the allocation was unchanged (the drop landed past the 82 px zone plate). Every run also records one
console error, the Google Fonts stylesheet the script itself aborts, so screenshots use the fallback font. My own
script, which exposes the camera and projects each object to its screen point, hit the person and the zone at all
three sizes, touch included.

## 17. Can it become the project's 3D browser check

Yes as a base, with six changes: (1) a fixed seed through a URL parameter or test hook; (2) aim through a scene hook
that maps scene-model ids to screen points, never label offsets; (3) assertions and a non-zero exit (state after each
interaction, WebGL on, no horizontal overflow, console errors against an allow-list or with fonts served locally); (4)
wait on an 'idle' signal from the scene and make animation time steppable, since software rendering runs this scene at
11 to 22 frames a second; (5) run against the Vite build, with Playwright added as a dev dependency and a script such
as `npm run check:browser`, because Vitest here is node-only and package.json has no browser script; (6) add passes
for phone portrait with touch, WebGL refused (fallback appears) and reduced motion. It cannot measure real
performance.

## 18. First-try mistakes worth knowing (from polish1.py, polish2.py, polish3.py, 188 lines of patches)

Colours were double-gamma'd until renderer.outputEncoding was removed; lots were too far apart (14 to 11.5) and the
IPO line too high (17 to 11.5); people were too small (scaled x1.45); desks went from 12 to 8 per zone; the camera
needed a movable look-at point to keep the nearest lot in frame; phones needed a further pull-back (fit 1.45 to 1.62)
and hidden helper labels. All framing was tuned by eye from screenshots as constants, which is why it breaks at
844x390.

## Measured

- wc -l: page.template.html 845, entry.ts 10, try.mjs 89, build.py 24, polish1-3.py 106+39+43; src/ui/viewModel.ts
  645, src/ui/draft.ts 52, src/engine/types.ts 420, GameScreen.tsx 175
- grep on the mock page: 'CONFIG.' 10 times, 'game.companies' 4, 'me()' 19, 'Math.random' 10, 'setTimeout' 2, 'halved'
  1 (and 0 in src/ui)
- node try.mjs 1280 800 (copy in my scratch folder): 49.3 s, webgl true, rivalCard 'Morkology', pickedUp true,
  allocation {2,1,0} -> {1,2,0}, turn 7, overflow 0, 1 console error (aborted font request)
- node try.mjs 390 844: 27.9 s, exit 0, rivalCard 'Your Startup' (tower click missed), allocation {2,1,0} -> {2,1,0}
  (drop missed), turn 7, overflow 0
- node measure.mjs: 63 s for 7 browser contexts, exit 0, page load about 2.1-2.3 s each
- Scene size: 108 objects; market 33 draw calls, 904 triangles, 460 points, 326 line segments; office 66 calls, 1,712
  triangles; 6 shader programs, 4 textures; geometries 33 then 95
- Frame time under software GL (60-frame average): 1280x800 market 91.9 ms, office 54.7 ms; 390x844 (backing 780x662,
  pixel ratio capped at 2) 68.3 and 45.2 ms; 844x390 30.3 and 16.4 ms
- 1280x800: stage 936x626; towers 82-127 px wide; person 49-57 x 75 px; zone plate 245-275 x 194 px; lobby 908x66;
  panel 344x626 for 791 px of content; pick hits at 0/6/10/14 px off centre, misses at 18/22/30
- 390x844, dpr 3, touch: stage 390x331 (market) and 390x324 (office); towers 36-51 x 22-43 px; person 19.5-22.3 x 31.5
  px; zone 101-111 x 82 px; lobby 367x26; panel 390x255 for 709 px of content; taps hit at 0/6, miss at 10/14, hit at
  18/22, miss at 30; tap person then tap zone moved {3,0,0} -> {2,1,0}
- 844x390, dpr 3, touch: stage 844x92; person 8-9 x 12 px; towers 13-21 px wide; 4 overlapping tower-label pairs, 3
  overlapping zone-label pairs; panel 72 px high for 675 px of content
- Keyboard: canvas tabIndex -1, role null, aria-label present; focus after Enter on 'Less: Product' = BODY; Escape
  does not close the report; Shift+Tab from the report lands on #endQuarter
- Reduced motion emulated: media query matches, idle dots still moving, End Q1 to report 1,194 ms against 3,714 ms
  with motion
- WebGL refused (getContext returns null): notice shown, panel title 'Your Startup', plan edit gives {2,1,0}, report
  shown, 7 labels still visible
- three.js request aborted: panel 0 characters, stats 0 characters, page error 'THREE is not defined'
- tsx headcount.ts (300 games, 5,848 quarters, 3 s, baseline bot in seat 0): max headcount of any company 54;
  player-seat peak headcount min 8, median 36, p90 43, max 54; max 19 people in one department; max 10 joined and 2
  left in one quarter; max users 1.32 times the IPO bar; max pool share 0.69; game length 15-20 turns, median 20
- Repo: package.json scripts are dev, build, lint, sim, preview, test, test:watch, prepare; no playwright, puppeteer,
  three, jsdom or happy-dom in node_modules; grep for playwright/headless/chromium in docs and README found only the
  simulator line; git status --porcelain prints 0 lines
## Not checked

- Speed on any real phone or GPU: every frame time above is software rendering in headless Chromium
- Real touch hardware, pinch and two-finger behaviour: only emulated single taps were run; the camera gesture gaps are
  read from code
- Screen-reader behaviour of the mock or of the existing panels
- The published artifact at claude.ai: only the local build (out/local.html) was run
- Whether game.bundle.js (built 00:16) matches the current branch source, and which bundler produced it
- Whether GitHub Actions can run Chromium with software WebGL; I read only the first 40 lines of
  .github/workflows/ci.yml (install, two typechecks, lint)
- Whether three.js math classes run under this repo's Vitest node environment (three is not installed), and what three
  adds to the Vite bundle size
- Pixel-diff screenshot stability; no golden-image comparison was tried
- How the 2D game's earlier real-browser verification was done: no script for it is in the repo
- The mock's office with a large team in the browser: the overflow past 16 per department and 14 unassigned is derived
  from slot() and the simulation numbers, not rendered
- That the taps at 18 and 22 px on the phone landed on the neighbouring figure: inferred from the spacing, not
  confirmed by reading which figure was picked
- Colour contrast of scene labels and anything on origin/main
