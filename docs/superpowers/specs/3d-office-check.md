# The career's 3D office, checked in a real browser

What `scripts/office-check.mjs` checked and measured on the production build, on 26 November 2026, in two runs: first
after the last task of the plan "The 3D office as the career's main screen" (step 4, further down), then after the
plan "The market view, eight era looks and sound for milestones" (step 5, the next section). Every number below is
from a run that passed every check and exited with 0. `scripts/career-check.mjs` (the same career with WebGL switched
off, in the 2D screens) also passed on the same builds.

**This machine renders WebGL in software.** Headless Chromium draws through its software renderer (SwiftShader), at
about four to fifteen frames a second. Its frame rates and its page-time durations say nothing about a real device.
The draw calls and the figures drawn are the same on any device. The check on a real desktop browser is the owner's.
By the owner's decision of 26 November 2026 the 3D screen is for desktop browsers only: phones keep the 2D screens,
and no phone check is planned.

## Step 5: the market, eight era looks and the sounds

The second run (`node scripts/office-check.mjs`, and `node scripts/career-check.mjs`, both whole) adds these steps to
the ones listed under step 4 below. The saves come from `npx tsx scripts/career-fixtures.ts`, which now has a fixture
for each of the eight eras: `nineties` (1994, dial-up), `goldRush` (1997), `noughties` (2004, bust), `phones` (2010),
`cheapMoney` (2017), `twenties` (2023, winter and AI), `agents` (2029, the full floor) and `ambient` (2035).

15. **The market view.** Before any year is played the market has nothing to show and "Market" is disabled, saying why on hover. Ending
    1990 on the `office` fixture: during the year's last beat the caption reads "Where the year's new users went", the
    view is the market and the switch is disabled; then one summary opens and the view is the office again. Pressed,
    "Market" shows four companies whose heights order as their users, within 60 draw calls; a click on the tallest
    rival's building opens its card with its users and its share of last year's new users; with the card open (top
    right) no building's centre is under it at 1280×800, 1440×900 or 1920×1080; Escape closes it; "Office" goes back. A person picked up is put back by a change of view, and the plan is unchanged. "Show in market" on a
    rival in the rivals panel opens the market with that rival's card; the 2D layout has neither that button nor the
    switch. During the market beat, each on a fresh page: Skip (one summary within a second, the office shown, both
    buttons enabled), a window narrowed to 900 px (one summary, the 2D screens, the year's sound heard once) and a lost
    context (one summary; after "Reload 3D view" the office, with "Market" enabled). Under reduced motion the summary
    opens at once and the market shows the year's users standing at their buildings, with nothing streaming. A race
    has no "Show in market", no switch and no office.
16. **Every era's look.** For each of the eight era fixtures: the scene's era and look are that era's, the figures drawn
    are those the scene asks for, the office comes to rest, and its draw calls are under its ceiling
    (`min(800, 80 + 14 × figures)`).
17. **The market's draw calls in every era.** Each era fixture plays its year, and the market drawn afterwards keeps
    within its ceiling of 60.
18. **Sounds.** On the `office` fixture in 3D: footsteps are heard while the year's people walk; the market beat's
    `users-trickle` is heard once, during that beat and not before it; the office move's `asset-office-upgrade` is
    heard once, as the summary opens. A reload with the summary open plays nothing. Under reduced motion the
    milestone's sound plays as the summary opens and the market beat's does not. On the `listing` fixture, going
    public plays `crowd-cheer` once.

`scripts/career-check.mjs` gained step 11, **a milestone's sound in 2D**: with WebGL off, the office fixture's year
plays `asset-office-upgrade` once as its summary opens, and nothing else; closing the summary plays nothing.

### Draw calls at 1280×800, by era look

| Era look | Office | Fixture | Figures drawn | Draw calls | Ceiling | Margin |
|---|---|---|---|---|---|---|
| Dial-up | Garage | new career, 1990 | 3 | 67 | 122 | 55 |
| Dial-up | Shared office | `office`, after its move (1991) | 5 | 123 | 150 | 27 |
| Dial-up | Shared office | `nineties`, 1994 | 4 | 114 | 136 | 22 |
| Gold rush | Shared office | `goldRush`, 1997 | 4 | 111 | 136 | 25 |
| Bust | Own office | `noughties`, 2004 | 11 | 193 | 234 | 41 |
| Phones | Own office | `phones`, 2010 | 11 | 192 | 234 | 42 |
| Cheap money | Full floor | `cheapMoney`, 2017 | 20 | 337 | 360 | 23 |
| Winter and AI | Full floor | `twenties`, 2023 | 20 | 335 to 336 | 360 | 24 to 25 |
| Agents (future set) | Full floor | `agents`, 2029 | 20 | 335 | 360 | 25 |
| Cheap money | Campus | `campus`, 2019 | 50 | 609 | 780 | 171 |
| Ambient (future set) | Campus | `ambient`, 2035 | 50 | 610 | 780 | 170 |
| The market | (every era, each fixture's next year) | all eight era fixtures and `office` | 3 to 50 | 8 | 60 | 52 |

The full floor (office 3, now the agents fixture at 2029) was 360 of its 360 in the step 4 run (the twenties look at
2023, below); merging the office's still furniture into a few meshes brought it down to 335 to 336 for the same
fixture, and with the invented future's set (agents, 2029) it measures 335 of 360. The market draws 8 calls in every era against its own ceiling of 60.

### The download

Gzipped, as `gzip -c <file> | wc -c` gives it, from this build:

| What | Files | Gzipped |
|---|---|---|
| The first load (what `dist/index.html` references) | `main-*.js` 77,088 B, `preload-helper-*.js` 61,002 B, `react-*.js` 404 B, `main-*.css` 5,615 B | 144,109 B (about 144 KB) |
| The 3D part (loaded only by a career showing its office) | `CareerOffice-*.js` 2,024 B, `WorldView-*.js` 245,150 B, `WorldShell-*.js` 601 B, `WorldShell-*.css` 754 B | 248,529 B (about 249 KB) |

Against step 4's run: the first load grew by 3 KB (the market's and the sounds' screen code), and the 3D part by about
8 KB (the market, five more era looks and the future set). Against the design's estimate (section 10.5: about 131 KB
for the 3D part on top of 111 KB) the 3D part is about 118 KB larger, almost all of it three.js and the offices in the
world's chunk; the race and a career without 3D never download it.

### What failed and was fixed

- **No footsteps were ever heard.** The sounds step found that no world system told the world's sound listener about
  a walk or a chair: the people's system did not take the listener at all, so the career's footsteps and chairs were
  wired to nothing. The people's system now reports footsteps when a walk in, out or to a new desk starts and a chair
  when a hire sits down (tested in `src/world/people/EmployeeSystem.sound.test.ts`).
- **The check sampled the market beat's sound too late.** The beat's sound is asked for in the same update that puts
  up its caption; the check now reads the caption and the sounds together.
- **Reduced motion's rest.** The world keeps drawing for a second of grace after the last movement, so "draws nothing
  within a second of the click" could not hold; the check asserts instead that nothing moves (no users stream) and that
  the world rests within the grace second and a quarter.

### Still open after step 5

- The footsteps and chairs have not been listened to for level or feel; their sound's own spacing keeps a crowd from
  stacking up.
- Office 3 (the shared full floor) keeps about 25 draw calls of margin in its busiest eras: there is little room for
  more décor there.
- Whether each era's look and sound read as intended on a real screen is the owner's to judge.

## Step 4: the 3D office as the main screen

### What each step checked

The script plays the career at 1280×800 in headless Chromium with WebGL 2, reads the office through
`window.__careerOffice`, and fails on the first assertion that does not hold, and on any console error or page error
(but the software renderer's `GPU stall due to ReadPixels`). The saves it loads come from
`npx tsx scripts/career-fixtures.ts`, which now also makes `nineties` (1994, the shared office), `noughties` (2004,
the third office) and `twenties` (2023, the fourth office), each half full with cash for ten years of its salaries.

1. **The race is unchanged.** Its on-screen text matches `scripts/race-text.snapshot.json`; it draws no canvas,
   requests neither the office's nor the world's chunk, and none of the scripts it loads holds three's renderer.
2. **The office is the main view.** On a new career (1990) and on the three era fixtures: the office runs within
   30 seconds, sits left of the plan, at least 600 px wide, wholly in the window and above the bottom bar with the page
   not scrolled; the header, the timeline (with "you are here" inside it), the status, the projection and the rivals
   are there; the figures drawn are those the scene asks for; the office comes to rest; the draw calls are under the
   ceiling (`min(800, 80 + 14 × figures)`). Three of the four pages show a news card and one (2004) does not.
3. **A year plays out, beat by beat.** With Recruiting raised, "End 1990" shows "1990 plays out" and no dialog while it
   plays. Sampled every 200 ms: while people leave or the company moves, the year's hires wait at the door; once they
   walk in, nobody waits. One summary opens (after about 6 s, as the beats add up to 5 s here); the office is in 1991,
   and once the summary is closed the people at the door are the hires the plan expects. A double click on "End 1991"
   plays one year and opens one summary; "End" cannot take the focus while the summary is open, and pressed through
   the page it changes neither the year nor the save. Skip opens the summary within a second (0.3 s measured) and the
   office rests within two (0.8 s measured).
4. **Moving a person by pointer** (on the 1994 fixture). A click on a Product person shows "Move one Product person to";
   "Growth" moves one from Product to Growth in the plan and in the scene, and once the office rests that person works
   in Growth. Clicking them again offers to move a Growth person; Escape puts them back; the same person clicked twice
   is picked up and put back; neither changes the plan. A Product person set down on a Growth person makes the same
   move as the button.
5. **An office move and the looks.** The `office` fixture's year plays out as "One person leaves", "The company moves
   to a bigger place: Shared office", "2 hires walk in", and the company is in the shared office afterwards. The three
   era fixtures have the nineties, noughties and twenties looks. The full campus draws 50 people and counts 100 on the
   sign.
6. **Taken down cleanly.** After "Save and leave", after "New game" then "Abandon", after the "3D office" switch is
   turned off, and after "Reload 3D view" following a lost context, the world taken down holds no geometry and no
   texture and draws nothing; a new office runs where one should, and once the career screen is left the hook says
   "none".
7. **A hidden tab and resizes.** Hidden during a year, the office draws nothing; visible again, the year finishes and
   the summary opens. At 1100 px and back at 1280 px, the canvas fills the office cell (inside the view's 1 px frame).
   At 1000 px the 2D screens show, with the world freed; back at 1280 px a new office runs.
8. **Reduced motion.** "End 1990" opens the summary at once, with no playback; the office settles in 0.2 to 0.3 world
   seconds.
9. **The switch.** Off, the canvas goes and the 2D grid shows; it stays off across a reload
   (`startupworld:office:v1` is `off`); on again, the office runs. The career save is untouched by either press.
10. **Fallbacks.** Without WebGL (`--disable-3d-apis`): the 2D grid from the first paint, the switch disabled with its
    reason, and no office or world element ever added. With the office's chunk blocked: the 2D grid, the switch
    disabled, the office cell added once. A context lost during a year: the summary at once, then the 2D grid with
    "Reload 3D view" in the header, which stays for five seconds; pressed, the office runs again.
11. **A reload while a year plays out.** The summary is open, no playback replays, and the save is byte-identical to
    the one read just before the reload, and to the save the same year writes with WebGL off.
12. **A whole career through the 3D screen.** Seed 1, 1990 to 2038, Skip pressed each year as soon as the bar shows;
    the header names each year, and no period word (quarter, turn and the like) is on the page while the year plays
    out or once the summary is open; the end screen follows 2038. (2038 itself does not play out: see below.)
13. **Narrow.** At 390×844 with touch: no canvas, no office cell, no sideways scroll, no error; the switch is disabled
    with the narrow-window reason.

### Draw calls per office at 1280×800

| Office | Fixture | Figures drawn | Draw calls | Ceiling |
|---|---|---|---|---|
| Garage | new career, 1990 | 3 | 76 | 122 |
| Shared office | `office`, after its move (1991) | 5 | 131 to 132 | 150 |
| Shared office | `nineties`, 1994 | 4 | 125 | 136 |
| Own office | `noughties`, 2004 | 11 | 212 | 234 |
| Full floor | `twenties`, 2023 | 20 | 360 | 360 |
| Campus | `campus`, 2019 | 50 | 631 | 780 |

The design's budget of 300 draw calls is a phone's. This plan shows the office on desktop browsers only, where every
office stays under its ceiling; the full floor and the campus are above 300, as the groundwork measured, and phones get
the 2D screens until instanced far figures are built (step 5). The full floor sits exactly on its ceiling: a single
extra draw call there fails the check. (Since then, by the owner's decision of 26 November 2026, phones keep the 2D
screens for good and instanced far figures are not built; the full floor now measures under its ceiling, with about 25 draw calls to spare, as the
step 5 section above records.)

### The download

Gzipped, as `gzip -c <file> | wc -c` gives it, from this build:

| What | Files | Gzipped |
|---|---|---|
| The first load (what `dist/index.html` references) | `main-*.js` 74,122 B, `preload-helper-*.js` 61,002 B, `react-*.js` 404 B, `main-*.css` 5,563 B | 141,091 B (about 141 KB) |
| The 3D part (loaded only by a career showing its office) | `CareerOffice-*.js` 1,300 B, `WorldView-*.js` 237,478 B, `WorldShell-*.js` 601 B, `WorldShell-*.css` 754 B | 240,133 B (about 240 KB) |

The design (section 10.5) gave about 131 KB for the 3D part on top of 111 KB. **The 3D part is larger: about 240 KB,
some 109 KB more than the design's figure**, almost all of it the world's chunk (three.js and the office, now with
three looks and their props). The first load is about 141 KB, 30 KB more than the design's 111 KB, and it carries no
three.js: the race and a career without 3D never download the world. `CareerOffice-*.js` itself is 1.3 KB; the
world's chunk is what the office brings with it.

### How long a year holds the summary

A year's beats last 1.5 s for people leaving, 2.5 s for an office move, 2.5 s for hires walking in, 1.2 s for a quiet
year, and at most 6 s in all. In 1990 with Recruiting raised (a move and two hires, 5 s of beats) the summary opened
5.6 to 6.1 s after "End" on this machine; Skip opens it within a second.

### What failed and was fixed

- **Skip left the office moving for over two seconds.** Two causes, both fixed. The screen told the world to finish
  everything before it showed the new year, so the walks that new scene started (next year's hires going to the door)
  still played out: now the new year is shown first and the world finishes after it (`finishYearPlay` in
  `src/ui/yearPlay.ts`, tested in `yearPlay.test.ts`). And settling did not finish the camera's glide to a new
  office's framing: `CameraRig.finish()` now ends a glide and a shake at once, and the world's `settle()` calls it
  (tested in `src/world/core/CameraRig.finish.test.ts`). After both, the office rests 0.6 to 0.9 s after Skip.
- **A person's projected anchor sits above their head**, where a click finds whoever stands behind them. The check
  clicks the middle of the box the person is drawn in; the hook gained a read-only `screenBounds(target)` for that
  (tested in `src/ui/officeProbe.test.ts`).

### Still open

- **The last year does not play out.** (Fixed after this run, before step 5: the last year now plays out, as its
  report is new even though the turn does not move on; see `yearPlaysOut` in `src/ui/yearPlay.ts`.) "End 2038" ends the career; the turn does not move on, so by the rule that a
  year plays out only when the turn moved on by one, the summary opens at once with no playback. (A career that ends
  early, on a second failure, still plays its last year out: the game goes on for the rivals and the turn moves on.)
  Whether 2038 should play out is the owner's call.
- **Seed 1's new career with Recruiting raised in 1990 runs out of cash in 1992.** The check moves people on the 1994
  fixture, which has years ahead of it, rather than on that career.
- The screenshots (`node scripts/office-check.mjs --shots <dir>`: 1990, the office move, 1994, 2004, 2023 and the
  campus) go to the owner with this report; they are not kept in the repository.
