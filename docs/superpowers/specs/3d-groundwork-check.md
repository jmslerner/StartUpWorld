# The 3D groundwork, checked in a real browser

What `scripts/world-check.mjs` measured on the lab page (`/office-lab.html`) after the last task of the groundwork
plan, on 25 November 2026, with the rules branch merged in.

**This machine renders WebGL in software.** Headless Chromium draws through its software renderer on four CPUs, at
about four to fifteen frames a second. Its frame rates and its page-time durations say nothing about a phone. The
draw calls and triangles are the same on any device, and the world-time durations below are what a device that keeps
up would see. The check the design names is the owner's own phone, and it has not been made yet.

## How the offices were filled

Each office full: 4, 9, 22, 40 and 150 people, split 5 : 4 : 1 across Product, Growth and Recruiting by largest
remainder (each team gets the whole part of its share, and the people left over go to the largest fractions; a tie
goes to the earlier team):

| Office | People | Product | Growth | Recruiting |
|---|---|---|---|---|
| Garage | 4 | 2 | 2 | 0 |
| Shared office | 9 | 4 | 4 | 1 |
| Own office | 22 | 11 | 9 | 2 |
| Full floor | 40 | 20 | 16 | 4 |
| Campus | 150 | 75 | 60 | 15 |

## What one office costs to draw

Read from the renderer once the office has come to rest. Draw calls include the shadow pass.

| Office | People | Size | Draw calls | Triangles | People drawn | Counted on the sign |
|---|---|---|---|---|---|---|
| Garage | 4 | 1280×800 | 82 | 31,458 | 4 | 0 |
| Garage | 4 | 390×844 | 82 | 31,458 | 4 | 0 |
| Shared office | 9 | 1280×800 | 160 | 71,160 | 9 | 0 |
| Shared office | 9 | 390×844 | 159 | 71,080 | 9 | 0 |
| Own office | 22 | 1280×800 | 301 | 122,880 | 22 | 0 |
| Own office | 22 | 390×844 | 301 | 122,880 | 22 | 0 |
| Full floor | 40 | 1280×800 | 519 | 224,478 | 40 | 0 |
| Full floor | 40 | 390×844 | 519 | 224,478 | 40 | 0 |
| Campus | 150 | 1280×800 | 630 | 281,252 | 50 | 100 |
| Campus | 150 | 390×844 | 629 | 280,880 | 50 | 100 |

The design's phone budget is 300 draw calls. The own office, full with 22 people, is the first to cross it (301); the
shared office with 9 is well inside (160). One restored figure costs 8 draw calls, and 2 to 6 more in the shadow pass,
so the people are most of the bill: 22 figures are about 176 calls before their shadows, 50 are 400. The campus stays
at about 630 whatever the head count, because at most 50 staff are drawn and the rest are the "+100" on the sign.
This is where cheaper figures for the far people (the plan's "After this plan") would start paying: from the own
office on.

## How long a year takes to play out

A year with three hires and two layoffs: first the office is shown with two people marked as let go and three
expected (they walk to the door), left to come to rest; then the year ends as the lab's End-year control would end it
(the script builds the same scene: the hires join the smallest team one by one, the year goes up by one, the office
never shrinks). Only the second part, the end of the year, is timed against the plan's limits.

Two clocks. The world moves everything on by each frame's length, but never by more than a tenth of a second, so on
this machine (frames of 0.2 to 0.27 s in the larger offices) people walk at about half speed. "World" is the time the
world itself lived through, which is what a device drawing ten frames a second or more would see; "page" is what this
machine took. The loop draws on for one second after the last movement and then stops; "rest" includes that second.

| Office | Size | End of year: rest, world s | End of year: page s | Before it, layoffs and hires to the door: rest, world s (page s) | Reduced motion: moving, world s | Reduced motion: rest, page s |
|---|---|---|---|---|---|---|
| Garage | 1280×800 | 2.5 | 2.8 | 7.5 (7.7) | 1.4 | 2.7 |
| Garage | 390×844 | 2.5 | 2.6 | 7.6 (7.6) | 1.4 | 2.6 |
| Shared office | 1280×800 | 2.5 | 2.8 | 9.3 (10.6) | 1.3 | 2.7 |
| Shared office | 390×844 | 2.5 | 2.6 | 9.2 (9.4) | 1.4 | 2.6 |
| Own office | 1280×800 | 2.5 | 3.3 | 12.3 (16.2) | 1.3 | 3.5 |
| Own office | 390×844 | 2.6 | 2.9 | 12.2 (12.4) | 1.3 | 3.0 |
| Full floor | 1280×800 | 2.5 | 4.1 | 15.0 (29.4) | 1.3 | 4.4 |
| Full floor | 390×844 | 2.5 | 3.4 | 15.0 (22.7) | 1.3 | 3.7 |
| Campus | 1280×800 | **18.0** | 41.6 | 15.2 (36.2) | 1.3 | 4.3 |
| Campus | 390×844 | **18.1** | 33.3 | 15.2 (27.7) | 1.3 | 3.5 |

What the numbers say:

- In the first four offices a full office plus one person moves to the next office, so the end of the year is the
  old building sinking and the new one rising with everyone in place: 2.5 seconds, no walks. The walks of those
  years happen earlier, when the people let go and the people expected go to the door: 7.5 seconds in the garage,
  rising to 15 at the full floor.
- **The campus does not meet the 15-second limit.** It has no bigger office to move to, so the end of its year is
  walks: the two let go leave through the door and the three hires cross the floor to their desks, at 1.6 units a
  second over a much larger floor. It comes to rest after 18 world seconds (17 of movement and the one of grace), and
  after 33 to 42 seconds of page time on this machine. Left as measured: making it shorter means faster walks or
  shorter routes, which belongs with the year's beats in the next plan, not with this check.
- **Under reduced motion nobody walks, but the year does not come to rest within one second.** Everyone is placed
  at once; what still moves for 1.3 to 1.4 world seconds is the effects: the "+N" and "−N" over the door, which
  live 1.4 seconds, and, when the office changes, the thinner dust of the rise (kept under reduced motion by an
  earlier, tested decision). The loop then draws one more second before it rests. A rest within one second is not
  possible by construction (the loop always draws a second after the last movement), so the script holds the
  movement itself to one second, and that fails by 0.3 to 0.4 seconds. Meeting it would mean shorter labels at the
  door under reduced motion, which is a choice for the owner. Left as measured.

## The rest of the checks

| Check | Result |
|---|---|
| Console clean on every page (one message allowed: the software renderer's "GPU stall due to ReadPixels") | Passed on every page, at both sizes, with and without reduced motion and at device scale 2 |
| No frame drawn in the second of two quiet seconds after opening | Passed in all ten, at scale 1 and scale 2 (after the fix below) |
| People drawn plus people counted equals the head count, before and after the year | Passed in all ten |
| At most 56 figures drawn | Passed: 50 at the campus |
| Lose the graphics context, restore it through "Reload 3D view" | Passed: status went context-lost, then running, with all 22 people drawn again and nothing in the console |
| The page in a browser with WebGL switched off | Passed: status "unsupported", the shell's note shown, no page error, nothing in the console |
| Mount and unmount the view twenty times | Passed: 0 geometries and 0 textures after the first unmount and after the last; the view ran again with 22 people |

## The screenshots

At device scale 2, one office per picture, controls hidden:

- Garage, 1280×800: the whole garage framed, two people in Product blue and two in Growth orange at the desks; the
  car and the tree outside are cut by the frame's edge, the building is not.
- Garage, 390×844: the building fills the width; the tree on the left and the car on the right are cut. Much empty
  space above and below, as the phone's narrow width is the binding side.
- Shared office, 1280×800: the island of eight with four blue and four orange, one Recruiting green at the wall
  desk; the neighbours' half of the loft, with its grey empty desks, is in the frame and not cropped at this size.
- Shared office, 390×844: the same, small; nothing cropped.
- Own office, 1280×800: four groups of bench desks, blue and orange by team, two green at the corner desks;
  framed, sharp, nothing dark or overlapping.
- Own office, 390×844: the same, small; nothing cropped.
- Full floor, 1280×800: forty people on three benches and two wall desks, teams in their colours; two of the four
  Recruiting people sit at the end of an orange bench, as the seating by team order gives. Framed whole.
- Full floor, 390×844: the same, small; trees at the edges just inside the frame.
- Campus, 1280×800: fifty people on six benches in team colours, the sign by the door reads "+100", the city blocks
  behind; framed whole.
- Campus, 390×844: the same, small; the sign is there but too small to read at this size.

No z-fighting, no black or unlit surface, no missing piece in any of them. The crop of the shared office's
neighbours' half that an earlier run saw at 900×600 does not happen at either of these sizes.

## What failed and was fixed

- **The loop rested late on a slow page.** It drew for a second of world time after the last movement, and since a
  frame counts at most a tenth of a second, on this machine that second lasted up to 2.7 seconds of page time: the
  own office, the full floor and the campus still drew frames in the second quiet second after opening. The second
  before rest is now counted on the page's clock (`core/FrameLoop.ts`, with a test that failed first). Walks still
  move by at most a tenth of a second per frame.
- **The check: twenty mounts back to back.** Unmounting and mounting in one unbroken run of the page's tasks starves
  its timers, so the timers that hand each disposed context back wait until the end, and past sixteen contexts the
  browser evicts the oldest with a warning. Nobody toggles the view that fast; the script now lets one timer run
  between an unmount and the next mount, and the warning is gone. Noted, not changed: a page that creates and
  destroys views faster than its timers run would see that warning.
- **The check: what a year's time means.** Measured on the page's clock, every year on this machine runs at about
  half speed. The script times the year in world seconds, read from the page's frame clock the way the world reads
  it, and prints the page seconds beside them.

Not changed: the campus's 18-second year, and the 1.3 to 1.4 seconds of labels and dust under reduced motion, both
above.

## The rules branch

Merged in before the checks. It brought the career's offices, listing, rescue, entrants and eras, all in its own
files. No name or shape that the scene builder reads changed; the one change of behaviour near it is that the plan
check now keeps `goPublic` in a career plan (before, it dropped it). The scene does not read it. Everything was green
after the merge with nothing to fix.

## How to run it

```bash
node scripts/world-check.mjs                       # builds, serves dist on port 4179, checks, prints the table
node scripts/world-check.mjs --shots shots/        # also saves office-<n>-<width>x<height>.png at scale 2
node scripts/world-check.mjs --json check.json     # also writes every measurement
node scripts/world-check.mjs --no-build            # serves the dist that is there
```

It takes about nine minutes on this machine, exits with 1 when any check fails, and lists each failure. It uses the
machine's own Playwright and Chromium, is not part of `npm test`, and is not read by the linter or the test runner.
As things stand it exits with 1, for the twelve failures above: the campus's year at both sizes, and the reduced
motion year in all ten.
