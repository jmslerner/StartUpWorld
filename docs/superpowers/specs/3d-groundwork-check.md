# The 3D groundwork, checked in a real browser

What `scripts/world-check.mjs` measured on the lab page (`/office-lab.html`) after the last task of the groundwork
plan, on 25 November 2026, with the rules branch merged in, and measured again after the three fixes at the end of
this page (walks that hurry on a large floor, reduced motion that stands still, and the lab's era and office list).
Every number below is from that second run, which passed every check.

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
| Shared office | 9 | 390×844 | 160 | 71,160 | 9 | 0 |
| Own office | 22 | 1280×800 | 301 | 122,820 | 22 | 0 |
| Own office | 22 | 390×844 | 300 | 122,800 | 22 | 0 |
| Full floor | 40 | 1280×800 | 519 | 224,478 | 40 | 0 |
| Full floor | 40 | 390×844 | 519 | 224,478 | 40 | 0 |
| Campus | 150 | 1280×800 | 630 | 281,252 | 50 | 100 |
| Campus | 150 | 390×844 | 629 | 280,880 | 50 | 100 |

The counts move by a call or two and a few dozen triangles from one run to the next (a shadow that falls inside or
outside a frustum); the first run had 159 and 301 where this one has 160 and 300. The design's phone budget is 300
draw calls. The own office, full with 22 people, is the first to reach it (300 to 301); the
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
| Garage | 1280×800 | 2.5 | 2.7 | 7.5 (7.6) | 0.8 | 2.2 |
| Garage | 390×844 | 2.5 | 2.6 | 7.5 (7.6) | 0.9 | 2.1 |
| Shared office | 1280×800 | 2.5 | 2.8 | 9.3 (11.1) | 0.9 | 2.2 |
| Shared office | 390×844 | 2.5 | 2.6 | 9.2 (9.3) | 1.0 | 2.1 |
| Own office | 1280×800 | 2.5 | 3.4 | 11.0 (14.7) | 0.8 | 2.4 |
| Own office | 390×844 | 2.7 | 2.9 | 11.0 (11.2) | 0.8 | 2.2 |
| Full floor | 1280×800 | 2.5 | 3.6 | 11.1 (21.3) | 0.9 | 2.8 |
| Full floor | 390×844 | 2.5 | 3.4 | 11.1 (16.5) | 0.8 | 2.8 |
| Campus | 1280×800 | 10.9 | 25.3 | 11.0 (26.4) | 0.8 | 3.3 |
| Campus | 390×844 | 10.9 | 18.9 | 11.0 (21.0) | 0.8 | 2.8 |

The limits: a year's end comes to rest within 15 world seconds (the loop's quiet second included), and under reduced
motion nothing moves after 1 second. Both are met everywhere.

What the numbers say:

- In the first four offices a full office plus one person moves to the next office, so the end of the year is the
  old building sinking and the new one rising with everyone in place: 2.5 seconds, no walks. The walks of those
  years happen earlier, when the people let go and the people expected go to the door: 7.5 seconds in the garage,
  rising to 11 from the own office on (15 at the full floor before the walks hurried).
- **The campus's year comes to rest after 10.9 world seconds** (about 9.9 of movement and the one of grace), against
  18.0 and 18.1 in the first run. It has no bigger office to move to, so the end of its year is walks: the two let
  go leave through the door, and the hires take their desks, one of them crossing the whole floor from the door.
  That walk is what kept it long, not the stagger: in the first run the leavers were out by about 7 seconds and the
  last 8 seconds were that one person walking. A walk in, out or to a new desk now lasts at most 9 seconds (below).
  On this machine the page took 19 to 25 seconds, as the world runs at about half speed here.
- **Under reduced motion nothing moves after 0.8 to 1.0 world seconds** (1.3 to 1.4 in the first run). Everyone is
  placed at once; no dust rises and the camera does not shake when the office changes; the "+N" and "−N" over the
  door stand still and are gone after 0.9 seconds. The script reads 1.0 in one case because a frame on this machine
  counts up to a tenth of a second; the effects themselves are tested to be at rest within a second at frames of
  1/60 s and of 0.1 s. The loop then draws its one quiet second and rests: 2.1 to 3.3 page seconds in all.

## The rest of the checks

| Check | Result |
|---|---|
| Console clean on every page (one message allowed: the software renderer's "GPU stall due to ReadPixels") | Passed on every page, at both sizes, with and without reduced motion and at device scale 2 |
| No frame drawn in the second of two quiet seconds after opening | Passed in all ten, at scale 1 and scale 2 (after the first fix below) |
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

No z-fighting, no black or unlit surface, no missing piece in any of them. Looked at again after the fixes: the same
ten pictures, nothing changed or missing. The crop of the shared office's
neighbours' half that an earlier run saw at 900×600 does not happen at either of these sizes.

## What failed and was fixed

In the order they were found. The first three were fixed before the first full run; the two limits that run missed,
and one fault of the lab page found in review, were fixed after it.

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

- **Limit missed: the campus's year took 18.0 world seconds (18.1 at 390×844) against 15.** A walk across the largest
  floor at the usual 1.6 units a second is long: the farthest desk is 31.5 units from the door, 19.7 seconds away.
  A walk in through the door, out through it or to a new desk now goes at the usual pace raised just enough to last
  at most nine seconds, corners included (`people/actor.ts`: speed = max(1.6, length / 8.5), the half second kept
  for slowing at corners). A wander keeps the usual pace; the path follower is unchanged. Tested on the campus: the
  longest walk from any desk to the door takes 8.7 seconds, every walk in takes at most nine, a short walk keeps the
  usual pace, and the browser's year among 150 people is at rest after 9.4 seconds of movement (16.5 before), held
  to 14 by a test. **Now 10.9.**
- **Limit missed: under reduced motion things moved for 1.3 to 1.4 world seconds against 1.** Nobody walked, but the
  "+N" and "−N" at the door lived 1.4 seconds and still rose a little, and thin dust rose when the office changed (an
  earlier, tested decision, now reversed: that test now checks that none rises). Under reduced motion the effects
  (`fx/FxSystem.ts`) raise no dust and no shake on a change of office, and the numbers at the door stand where they
  appear, at their size, for 0.9 seconds. The float text layer had no way to be given a length or to stand still,
  so it takes two optional settings that leave it as it was when they are left out. **Now 0.8 to 1.0.**
- **The lab page went blank for an era cut through an emoji.** An era is cut to 40 letters; it was cut by UTF-16
  units, which can leave half an emoji, and writing the address then threw before the page was drawn. It is now cut
  by whole letters, and half a letter never reaches the address by any route (the address, an edit, or a whole scene
  handed in through the checks' `setScene`). Found with it: a count of hundreds of digits read as nobody; any number
  of digits now reads as at most the largest count. And the office list showed "Whichever fits the he…" at
  1280×800, hiding the office the head count picked: it now reads "Fits all: Own office", under its label, and shows
  whole at 1280 and at 390 wide.

Not changed: the limits. Both are met by changing what is drawn.

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
As things stand it exits with 0: "all checks passed". The first run exited with 1, for twelve failures: the
campus's year at both sizes, and the reduced motion year in all ten.
