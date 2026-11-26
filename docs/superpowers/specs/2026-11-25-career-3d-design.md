# StartUpWorld: the career game, in 3D

Status: approved by the owner on 25 November 2026, as written. Steps 1 to 5 of section 15 are built; the last, step 5,
by the plan "The market view, eight era looks and sound for milestones"
(`docs/superpowers/plans/2026-11-26-career-market-looks-sound.md`). The build plans are in `docs/superpowers/plans/`.
On 26 November 2026 the owner decided that the 3D screen is for desktop browsers only and that phones keep the 2D
screens; dated notes below record it beside the text it changes, which is kept as written.

Items marked **(owner)** were decided by the owner. Items marked **(proposal)** were the implementer's calls, each
with its reason; the owner approved them with the document. Section 16 lists the ones that most needed a yes or no.

## 1. What this is, and why

Today's game is a five-year race: 20 quarters against three computer-run rivals, over when someone goes public. It is
finished, tested and balanced (`docs/turn-based-design.md`).

The owner wants the game to feel like a classic tycoon game instead: one company whose whole life you play, from a
garage to a campus, while the world around it moves through real technology history, from the early 1990s to today
(2026) and on into an imagined future. And it should be a place you look into, not a set of panels: a three.js world
is the main screen.

So this is a second, larger game built on the first one's parts:

- **A career**: one company, one game, 1990 to 2038, one turn per year.
- **A world in 3D**: your office, growing with the company and changing with the times; the four companies side by
  side; the timeline always in view.

## 2. What the owner has decided

1. Three.js is the engine for the main screen. **(owner)**
2. The timeline is **one long career**: a single game from 1990 to the 2030s with one company and a turn per year.
   Going public is a milestone, not the end. **(owner)** (The alternatives, a campaign of short races or a single
   race set in a chosen era, were offered and not chosen.)
3. The game ends after the final year, and **the founder with the most valuable stake wins** (share owned × company
   value), the rule that decides the last turn of today's race. **(owner)**
4. **One rescue, then over.** A company that goes bankrupt, or whose board fires its founder, survives the first time
   at a heavy price in ownership. The second time it is out; for the player that ends the career. **(owner)**
5. **Going public is the player's decision, and worth making.** Once a company qualifies, "Go public" appears in the
   plan. Listing brings in cash for 20% of the company and makes the company worth 25% more from then on, so the
   founder's stake does not shrink. The price: an investor joins the board and the company can no longer raise money
   privately. Rivals list as soon as they qualify. **(owner)**
6. It is an original game in the tycoon genre. No art, characters, interface, music or names are taken from Game Dev
   Tycoon or any other game. **(owner, agreed in conversation)**

## 3. Goals, non-goals, anti-goals

**Goals**

- A sitting feels like a career: you start in a garage in 1990, and the office, the team, the market and the rivals
  around you visibly change over 49 years.
- History matters to play, not only to the scenery: the 2000 crash, smartphones, the 2008 crisis, the 2020 lockdowns
  and the AI wave arrive on their dates and change what a good plan is.
- The late game is as alive as the early game. Under today's rules a 40-turn game goes flat (see section 5.3); the new
  rules exist to prevent that.
- Everything the first game got right stays right: pure rules engine, seeded and replayable, every number in the
  config file, rivals that play by the same rules on the same public information, a simulator that proves the balance.
- The game is fully playable without 3D (no WebGL, weak phone, screen reader): the existing 2D screens remain a
  complete way to play.

**Non-goals (not in this version)**

- Research trees, product lines, named employees with skills, office purchases as decisions, multiple markets.
- Online play, accounts, leaderboards, difficulty levels (unchanged from the first design).
- A free camera or a walkable office. The camera is a fixed diorama view you can pan and zoom.
- Real company, product or person names. Real events are described generically ("a browser maker's share offering
  doubles on its first day").

**Anti-goals (would make this a failure even if it works)**

- A 3D skin that hides the numbers. Every figure the 2D screens show stays one glance or one tap away.
- A long game that is the same year 49 times.
- Losing the verified race: it stays in the product, unchanged, as a second mode.
- A copy of another game's look.

## 4. How a career plays

```
 1990 ─ dial-up ─ 1995 ─ gold rush ─ 2000 ─ bust ─ 2007 ─ phones ─ 2014 ─── [2021] ── 2027 ─ future ─ 2038
        ▲ launched 1991            ▲ rescued 2001      ▲ went public 2012   ▲ you are here   ◇ platform shift in 2023
┌───────────────────────────────────────────────────────┬──────────────────────┐
│                                                       │ Plan for 2021        │
│   your office, in 3D                                  │ Product      − 6 +   │
│   people at desks, grouped by Product, Growth,        │ Growth       − 4 +   │
│   Recruiting; the room is the size your company       │ Recruiting   − 1 +   │
│   has reached and is furnished for the year it is     │ Marketing, Price,    │
│                                                       │ Raise, Poach, Layoff │
├───────────────────────────────────────────────────────┴──────────────────────┤
│ Cash $2.1M · runway 3.4 years      ⚠ most serious warning       [ End 2021 ] │
└──────────────────────────────────────────────────────────────────────────────┘
```

1. **The year opens.** The timeline shows the year, the era and what is known to be coming. A news card may be in
   force: a dated one from history, or a random one from the deck.
2. **You plan**, with the same levers as today: people between Product, Growth and Recruiting, a marketing budget, a
   price, and optionally a raise, a poach or layoffs, plus one new choice once you qualify: going public. In the
   office you can pick a person up from one team and set them down in another; the panel beside it has every control
   as a button, as now.
3. **You end the year.** The office and the market play it out for a few seconds (skippable): hires walk in, people
   who were poached or laid off leave, users flow to the four companies. Then a short summary, with the full annual
   report one tap away.
4. **Milestones** mark the career on the timeline: launch, each office move, going public, a rescue, the arrival and
   exit of rivals.
5. **It ends after 2038**, or earlier if your company fails twice. The end screen shows the final standings by
   founder's stake and your career along the timeline.

A full career is 49 plans. Most years the plan carries over and takes a few seconds; the years after a platform shift,
a crash or a milestone take thought. Expect 30 to 45 minutes for a full career, saved automatically after every
change as today.

## 5. Rules of the career

### 5.1 What stays exactly as in the race

Team split and effective work with coordination drag; product quality (gain, decay, launch at quality 10); pull and
how each year's new users are shared out; churn; the three price tiers; hiring in hype order; poaching; layoffs;
raises of 10, 20 or 30% with a minimum number of users and a cooldown; investor board seats and the chance of being
fired after a bad year; hype; valuation; what is public about a rival; plans that break a rule are fixed up with a
note; every roll comes from the seed. A turn is simply a year instead of a quarter, with every per-turn number
retuned for that.

### 5.2 What is new

Each rule has starting numbers. As with the race: the rules are fixed once approved, the numbers get tuned by the
simulator, and every change is logged.

**C1. Time.** A career runs from 1990 to 2038: 49 turns of one year. **(owner: one turn per year, about 45 turns;
proposal: exactly 1990 to 2038)**

**C2. Eras.** The 49 years are divided into eras (section 6). An era sets the size of the market (how many new users
arrive each year), the price of things (salaries, what a user is worth to investors, the largest marketing budget),
the pool of candidates, the bar for going public, the event cards in the deck and the look of the office. That list
is the minimum: an era may give its own value to any number the config already has (how fast a product is built and
ages, churn, what marketing and Growth work buy, the terms of a raise), which is how "small teams that build fast"
or "users are won from rivals" become real. An era never changes a formula, and every value it sets is in the config
and the Tuning log. **(proposal)**

**C3. Dated events.** Some years have a fixed news card taken from history (through 2026) or invented (after). In the
other years a card is drawn at random from the era's deck, as today. Still at most one card a year. A card may carry
several effects, and the crashes and booms do: a change in valuations alone would pass straight by any company that is
not raising money that year, above all a public one. So a crash also brings fewer new users that year and more
candidates on the market, and a boom brings more new users and fewer candidates. **(proposal)**

**C4. Platform shifts.** Some eras open with a platform shift (the web, smartphones, AI, and an invented one later).
In that year no product is worth more than the new platform allows: every product's quality is cut down to a ceiling
(start: 30), and products already below it lose nothing. A leader at quality 90 and a newcomer at 35 both restart
near 30, and more new users arrive for a few years. The shift is announced on the timeline two years ahead; preparing
means having the cash and the people to put on Product when it lands. This is the main thing that keeps a 49-year game
from being decided in its first ten: a lead in quality has to be re-earned each time. (An equal percentage cut for
everyone would not do this: each company's share of new users is proportional to its quality, so the shares would
stay where they were.) Target 5 in section 9 is the test of this rule: if the simulator shows that leads are still
not overturned, the rule is brought back to the owner before the career is tuned. **(proposal)**

**C5. Going public is a decision.** A company qualifies when it closed the previous year with at least the era's bar
in users and with a profit. From then on its plan offers "Go public", once. In the year it is chosen the company sells
20% of itself at that year's opening valuation, so the plan shows the exact amount before the year is ended: the cash
arrives, the founder's share shrinks to 80% of what it was, and investors gain a board seat. Unlike a raise it takes
nobody off work and starts no cooldown. From then on the company is public: it is worth 25% more than a private
company with the same users and hype, it gains 20 hype in the year it lists, and it is marked as public everywhere it
appears. The premium is what makes listing worth it: 80% of a company worth 125% is the same stake as before, plus
the cash. The game goes on. Rivals and the simulator's baseline bot choose it in the first year they qualify.
**(owner; the numbers are starting values)**

**C6. A public company no longer raises money privately.** The raise option disappears once a company is public; that
is part of the price of listing. It also stops the Blitzscaler, which raises whenever it can, from selling itself down
to 1% over 40 years (measured). **(owner)**

**C7. One rescue.** The first time a company would go out (cash below $0 at the end of a year, or its board votes to
fire the founder), it is rescued instead: the founder's share is halved, investors take control of the board (two
more seats, or as many as it takes to outnumber the founders), hype drops by 10, and if cash was below $0 it is reset
to one year of salaries. The board does not vote on the founder in the year after a rescue. The second time, the
company is out, as today: its users return to the market and its people become candidates. This applies to all four
companies. **(owner: one rescue, then over; proposal: its price)**

**C8. Who you play against, and how rivals come and go.** 1990 opens like the race: you and two rivals in garages
(a Blitzscaler and a Bootstrapper), and one established company with a head start (the Incumbent, with its own
starting numbers, heavier coordination drag and catch-up bonus, all retuned for a career). Two years after a rival
goes out, a new startup takes its seat: three people, no users, that era's starting cash, a new name, and one of the
three playing styles chosen by the seed. A replacement is always an ordinary startup: one that plays the Incumbent's
style poaches and builds product-first, but has no head start and none of the Incumbent's special numbers. There are
never more than four companies. The player's seat is not refilled: a second failure ends the career. **(proposal)**

**C9. Offices.** A company has an office: garage, shared office, own office, a full floor, campus. Each holds a
number of people (start: 4, 9, 22, 40, 150). A company starts in the smallest office that holds its team. When a year
ends with more people than the office holds, the company moves up, and a one-off moving bill is part of that year's
costs (start: half a year of salaries for the team that moves). The planning panel shows the bill before the year is
ended. Offices are never given up again. The campus is the last and cannot be outgrown: recruiting stops at 150
people. The office is therefore a rule, not just scenery: it is what stops team size running away (in a 40-turn test
under today's rules the player's seat reached 146 people against rivals of 7 to 24). **(proposal)**

**C10. The end.** After 2038 the game ends and the largest founder's stake among the companies still in the game
wins. "Last one standing" cannot end a career, since rivals are replaced. **(owner: final year, biggest stake)**

**C11. Marketing is paid from cash in hand.** A plan cannot budget more marketing than the cash the company starts
the year with, plus what a raise or a listing brings in that year; a larger budget is cut back with a note, like any
other plan that breaks a rule. Without this, the rescue (C7) would make one deliberate year of overspending the
cheapest money in the game: buy the largest marketing budget on credit, keep the users, and have the debt wiped. The
race does not need the rule, because there the same move ends the company. **(proposal)**

### 5.3 Why new rules and not only new numbers

Measured with the present engine over 200 games (the research notes are kept with this project's scratch files):

- Making the game 40 turns long changes nothing by itself: every game still ends in an IPO around turn 20.
- With the IPO ending removed, the baseline bot wins 78% and the Blitzscaler 0%; quality saturates near 100 for
  everyone; the Blitzscaler sits on $109M it cannot spend; the player's team is 146 people while rivals are capped at
  7 to 24.

C4 answers saturated quality, C6 the Blitzscaler's dilution, C9 the runaway team, and the era tables (C2) the idle
cash, by letting budgets and prices grow with the times.

### 5.4 What this changes in the owner's written design

The race keeps its design document and its rules. The career is a second ruleset that departs from it here, and each
departure needs the owner's approval:

- "One turn = one quarter. A game lasts up to 20 turns." becomes one year and 49 turns.
- "A company that reaches the user bar with a profitable quarter goes public and wins" becomes C5: a choice in the
  plan, with a lasting premium on the company's value.
- "From turn 3, 50% chance each turn" for events becomes C3, with one new kind of card (C4).
- Bankruptcy and the board vote gain the rescue (C7); out companies are replaced (C8).
- The Blitzscaler's habit "raises 30% whenever eligible" ends when it goes public (C6).
- A plan's marketing budget is limited by cash in hand (C11).
- Two of the four balance targets no longer make sense (section 9).
- New rules with no counterpart: offices (C9).

## 6. The timeline

The era table and its dated cards are written in `src/config.ts` like every other number. The table below is the
starting proposal; the dates of real events are checked before they go in, and no card names a real company, product
or person. **(proposal)**

| Era | Years | What defines it | What it does to play | Dated cards (year: card, effect) |
|---|---|---|---|---|
| Dial-up dawn | 1990 to 1994 | Software is sold in boxes and people meet on dial-up services; the web appears | A tiny market that grows fast; low salaries; little money to raise | 1990 Recession (valuations ×0.7, 2 years; new users ×0.8) · 1991 A web of pages (new users ×1.25) · 1993 Free for all (new users ×1.5) · 1994 First banner adverts (marketing works ×1.5) |
| Browser gold rush | 1995 to 1999 | The browser makes the internet a mass market; investors pay for visitors, not profits | **Platform shift in 1995.** The market grows fastest of any era; valuations are high; hiring is a fight | 1995 The browser (platform shift; valuations ×1.5, 3 years) · 1998 Seven-fold debut (valuations ×1.6, 2 years; new users ×1.25; 2 fewer candidates) |
| Bust and broadband | 2000 to 2006 | The bubble bursts; always-on broadband builds the audience for the social web | Money vanishes for three years; the easiest hiring of the career; steady growth | 2000 The worst week (valuations ×0.5, 3 years; new users ×0.7; 4 extra candidates) · 2004 Broadband majority (new users ×1.5) · 2006 Video site sale (valuations ×1.4, 2 years; new users ×1.25) |
| Phones and cloud | 2007 to 2013 | The touchscreen phone and its app shop; rented servers make starting up cheap | **Platform shift in 2007.** A second audience arrives; a crisis in the second year | 2007 The touchscreen phone (platform shift) · 2008 Bank collapse (valuations ×0.5, 2 years; new users ×0.8; 4 extra candidates) · 2011 Cloud outage (one weak product loses 10% of its users and 10 hype) · 2012 Thirteen people, one billion (valuations ×1.4, 2 years; 2 fewer candidates) |
| Cheap money years | 2014 to 2021 | Near-zero interest rates; software by subscription; growth valued above profit | A huge market that grows slowly, so users are won from rivals; easy money; dear talent | 2014 Nineteen billion (valuations ×1.5, 3 years; 2 fewer candidates) · 2018 Privacy law (marketing works ×0.7) · 2019 The pulled offering (valuations ×0.7, 1 year; marketing works ×1.25) · 2020 Everyone goes home (new users ×1.5; 4 extra candidates) |
| Winter and AI | 2022 to 2026 | Rates jump and funding freezes; within months generative AI starts the next rush | **Platform shift in 2023.** A funding winter, then a boom for whoever rebuilt fastest | 2022 Rates rise (valuations ×0.6, 2 years; new users ×0.8; 4 extra candidates) · 2023 The chatbot (platform shift; 4 extra candidates) · 2025 Four trillion (valuations ×1.4, 2 years; 2 fewer candidates) |
| Agent economy (invented) | 2027 to 2032 | Software agents do routine work; a company of five can serve millions | Small, expensive teams that build fast; few candidates | 2028 Compute crunch (new users ×0.7) · 2029 Sign-off law (marketing works ×0.5) · 2030 The one-person billion (valuations ×1.6, 2 years; new users ×1.25) · 2031 Back-office layoffs (5 extra candidates) |
| Ambient age (invented) | 2033 to 2038 | Software leaves the screen for glasses, voices and home robots | **Platform shift in 2033.** A new mass market opens; trust is worth more than reach | 2033 Glasses outsell phones (platform shift) · 2035 Home-helper recall (one weak product loses 20% of its users and 15 hype) · 2036 Power rationing (new users ×0.7) · 2037 Citizen funds (valuations ×1.5, 2 years; new users ×1.25) |

Notes on the table:

- Four platform shifts (1995, 2007, 2023, 2033) and two crashes (2000, 2008) give the career its rhythm: something
  large roughly every six to eight years.
- Crash and boom cards carry more than a change in valuations (C3), so they reach every company. The second and
  third effects on those cards are this design's additions for play, not claims about history. The final year has no
  card of its own: one that multiplied every stake alike would change no ranking.
- The 30 real events behind these cards were checked against their sources; all dates are right. Card texts follow
  the checker's corrections (for example "agrees to pay", "a bloc of 28 countries"). The real-world reference for each
  card is kept in a comment beside it in the config, never in the text the player reads.
- Years without a dated card (1992, 1996, 1997, 2026 and others) draw from the random deck as today.
- Two cards rest on real hardship (the 2008 bank collapse and the 2020 lockdowns). They are worded neutrally. Leaving
  them out is the owner's call (section 16).
- Events after mid-2026 are invented and the game says so: the timeline marks where history ends.

## 7. Numbers and the config

- One config file still holds every number: `src/config.ts` gains a `CAREER` section next to today's race numbers
  (eras, C1 to C11, the career's own rival and baseline-bot numbers, the career's balance targets, and the office
  sizes the 3D world draws).
- Starting values are the tuned race numbers read per year instead of per quarter, with the era table on top. They
  are then tuned by the simulator until the career's targets pass, and each change is logged with its reason in a
  Tuning log, as for the race.
- Counts that are part of a rule stay out of the config, as today (one rescue, one event a year, four companies).

## 8. Computer players in a career

They keep their three characters and the planner that projects one turn ahead from public information. What changes:

- They choose "Go public" in the first year they qualify (C5). The race's "cut costs to list" behaviour is used only
  to reach a first profitable year at the bar, and is switched off once the company is public.
- The Blitzscaler stops raising when it is public (C6). Its other habits hold.
- Team limits and marketing limits become per-era numbers, so rivals grow with the times instead of stopping at 7 to
  14 people for 49 years.
- A rival that enters later (C8) plays one of the three styles from a garage.
- The baseline bot (the simulator's stand-in for a new player) keeps its simple policy: 40/40/20 after launch,
  Standard price, raises 20% when runway is under 3 years, hires while it keeps 3 years of runway. It goes public in
  the first year it qualifies.
- The simulator's report also runs two scripted players that look for loopholes, as a check and not as targets: one
  that never goes public, and one that overspends on purpose in an early year. If either does better than the
  baseline bot, a rule is paying for the wrong thing.

## 9. Simulator and balance targets

`npm run sim` gains a career mode: 1,000 seeded careers with the baseline bot in the player's seat, printed as a
report with PASS or FAIL per target and the list of every number that differs from its starting value.

The race's four targets were the owner's. Two carry over; two cannot (a career always runs to 2038 unless the player
is out, and going public no longer ends anything). Proposed career targets, for the owner to confirm or replace:

1. No computer player type wins more than 40% of careers. (kept)
2. The baseline bot wins 15% to 35% of careers. (kept)
3. The baseline bot's career ends early, by failing twice, in 10% to 30% of careers. (new: failure is real, but most
   careers are played to the end)
4. The baseline bot goes public in 40% to 80% of careers. (replaces "40% to 80% of games end in an IPO")
5. The company with the largest stake in 2010 is the winner in 2038 in less than 60% of careers. (new: the eras must
   be able to overturn a lead)

**(proposal)**

## 10. The 3D world

### 10.1 Approach: bring back and extend this project's own 3D office

Until this branch removed it, the app had a three.js office (still on `main`: 125 files, about 28,000 lines of source
and 13,000 of tests, three.js r187, no other 3D library). Reading it for this design showed that about two thirds is
generic and well tested: the renderer set-up, a fixed isometric camera with pan, zoom and phone framing, touch
gestures, picking with generous hit areas, lighting, a builder that makes every prop in code (there are no model or
image files), peg-style people who walk and sit, quality levels that adapt to slow devices, and careful clean-up.
It already drew five offices, from a garage with 3 desks to a public company with 48.

The 3D world is therefore built by restoring that foundation and re-pointing it at the new game, not by starting
again. What was tied to the old weekly game (its inspector cards, scripted staff reactions, command stations,
purchasable toys) is dropped. The look stays this project's own. **(proposal)**

> **Note, 26 November 2026 (owner's decision):** the 3D office and market are for desktop browsers only (a window of
> 1024 px or more, a fine pointer, WebGL 2). Phones, touch screens and narrower windows keep the 2D screens, which are
> complete. The phone framing and touch gestures of the restored foundation are not used by the career.

### 10.2 What you see

- **Office (the main view).** Your company's office at its current size (C9), furnished for the era: for example
  boxy beige computers and fax machines in the early 1990s, flat screens later, laptops and standing desks, and
  invented furniture for the future. Desks are grouped by team and colour-coded; people sit where the plan puts them;
  expected hires wait at the door; a person off raising money is visibly away. When the company outgrows the room,
  the next year opens in the next office.
- **Market.** The four companies side by side as buildings whose size follows their users, with the year's new users
  streaming to whoever won them, and the bar for going public marked. Tap a rival to see its public numbers.
- **Timeline.** Always across the top (drawn in HTML over the scene): eras, the current year, milestones, the dated
  events already seen, and the next platform shift.
- **The year playing out.** A few seconds of movement after "End year", skippable and off when the device asks for
  reduced motion.

The office and the market share one canvas: a switch changes the view, as in the mock; they are never drawn side by
side. Until the market view exists (step 5) the year plays out in the office only; after that it plays the office's
part and then cuts to the market for the flow of users.

Era looks are laid over the five office plans, not drawn as new rooms per era: furniture was the largest cost of the
old office. A look is a furniture set plus a palette, a lighting mood and two or three signature props. This version
ships four furniture sets: 1990s, 2000s to 2010s, 2020s (all three in step 4) and the invented future from 2027 (step
5). Each of the eight eras gets its own palette, lighting and signature props on top of one of those sets, so every
era can be told apart at a glance without eight sets of furniture. The palette reaches the surfaces that fill most of the picture:
each era lays its own tint over the floor, its own paint on the walls and its own finish on the desk tops, and a
test holds any two eras visibly apart (a colour distance of at least 12 in L\*a\*b\*) in at least two of those three
in every office.

**On a phone held upright** the screen is, from the top: the timeline strip; the office, fixed at about 40% of the
height; and the plan in a sheet that pulls up from the bottom, whose closed state shows the three team steppers, the
most serious warning and "End year". Moving people by touch aims at a team's area, not at a single figure (a figure
is about 20 pixels wide there). A phone on its side gets the wide layout and no tuning of its own.

> **Note, 26 November 2026 (owner's decision):** the 3D office and market are for desktop browsers only (a window of
> 1024 px or more, a fine pointer, WebGL 2). Phones, touch screens and narrower windows keep the 2D screens, which are
> complete. The upright phone layout and moving people by touch described above are not built.

> **Note, 26 November 2026 (decision 9 of the step 5 plan, reading the owner's ruling):** the owner ruled that the
> timeline shows eras and announced shifts only, and that crashes stay a surprise. It is read as: no dated card of a
> future year is ever shown except the announced platform shift; past dated cards (a crash once it has happened) and
> the career's milestones stay on the timeline as history, as the list above asks. A test over every year of the
> shipped career pins it (`src/ui/careerTimeline.test.ts`).

### 10.3 What stays in HTML

Every number, the plan's controls, the projection and its warnings, the rivals' details, the annual report, the end
screen and the how-to-play: the existing, tested React components, laid over or beside the scene. The scene needs
only two actions of its own: select a company, and move a person between teams. Each is also a button.

### 10.4 The line between logic and drawing

A new pure module, the scene model, turns the game state into plain data: which office, which desks, who sits where,
who arrives and leaves, how big each company's building is, where last year's users went, which beats the year's
playback has and how long each lasts. It has no three.js in it and is unit-tested like the view model. The three.js
layer only draws that data and reports what was tapped; it imports nothing from the rules. (The throwaway mock kept
rules in drawing code and one formula it retyped there was already wrong.)

### 10.5 When 3D is not available

No WebGL 2, the 3D code fails to load, the graphics context is lost, or the player turns 3D off: the career is played
in the existing 2D screens, which are complete. The 3D code is loaded separately after the first screen appears, so
the first load stays as fast as today (the 3D part adds about 131 KB compressed, measured, on top of today's 111 KB).

> **Measured, 26 November 2026,** on the build with the market, the eight era looks and the sounds (gzipped): the first
> load is about 144 KB (144,109 B) and carries no three.js; the 3D part, loaded only by a career showing its office, is
> about 249 KB (248,529 B), some 118 KB more than the estimate above, almost all of it the world's chunk (three.js, the
> offices, the market and every era's props). The figures are in `docs/superpowers/specs/3d-office-check.md`.

### 10.6 Technology

three.js r187 (the current release, and the one the old office used), pinned to that exact version, with its type
definitions, as plain three.js mounted from one React component. No react-three-fiber or other 3D framework. WebGL,
not WebGPU (the WebGPU build is 70% larger and gains nothing here). The scene is redrawn only when something changes,
not on every frame. People are capped at 64 drawn figures; a bigger company shows the rest as a count, as the old
office did. The old figures cost eight draw calls each, which was fine for a side panel; as a main screen the office
keeps to a budget of 300 draw calls on phones, and if the restored figures exceed it the far ones are drawn as simple
instanced figures. No phone can be tested here, so the owner's own devices are the check (section 13).

> **Note, 26 November 2026 (owner's decision):** the 3D office and market are for desktop browsers only (a window of
> 1024 px or more, a fine pointer, WebGL 2). Phones, touch screens and narrower windows keep the 2D screens, which are
> complete. The 300 draw-call phone budget and instanced far figures are therefore not built. On desktop each office keeps
> to its own ceiling, `min(800, 80 + 14 × figures)`, and the market to 60; the measured figures are in
> `docs/superpowers/specs/3d-office-check.md`.

## 11. The race stays

The 20-quarter race remains in the product as a second mode ("Quick race"), with its 2D screens, its numbers, its
tests and its balance report untouched. The rules engine is shared: the career's rules are switched on by the career's
config, and the race's config leaves them off, so the race's 1,315 tests keep proving it. **(proposal)**

## 12. Saving

The career saves itself after every change, like the race, under its own key and version, so a race save and a
career save do not disturb each other. The saved game is checked field by field on load, as now; a save this build
cannot use starts a new career. The career's record (milestones by year) is part of the save.

## 13. How it will be tested

- **Rules:** unit tests for every new rule (C1 to C11), written first, on frozen starting numbers so tuning never
  breaks them; the race's tests keep running unchanged.
- **Independent check:** black-box tests of the new rules written from this document alone, as was done for the race.
- **Balance:** the simulator's career mode against the targets in section 9, on five batches of 1,000 careers.
- **Scene model and the restored world logic:** unit tests in node (camera maths, picking, seating, paths, layout:
  no two people on one seat, every seat inside its team's area, for every team size).
- **Real browser:** scripted checks with assertions at phone and desktop sizes: a full career played through the 3D
  screen, moving people by touch, the fallback when WebGL is refused, reduced motion, no console errors. These run on
  the developer's machine before each push, not in CI.
- **Limits:** speed on real phones cannot be measured here; it is managed by the adaptive quality levels and checked
  by the owner on their own devices.

> **Note, 26 November 2026 (owner's decision):** the 3D office and market are for desktop browsers only (a window of
> 1024 px or more, a fine pointer, WebGL 2). Phones, touch screens and narrower windows keep the 2D screens, which are
> complete. The browser checks run at desktop size (1280×800); at phone size (390×844 with touch) they check only that the
> 2D screens show, nothing overflows sideways and nothing throws. The machine they run on renders WebGL in software.

## 14. Approaches considered

**How the timeline meets the game** (the owner chose the second):

| | What it is | Trade-off |
|---|---|---|
| Campaign of eras | Six short races, one per era; the result carries into the next | Reuses the tested rules, but carry-over is fragile: in tests the same head start won 0% or 99% of games depending on one number |
| **One long career** | One company from 1990 to 2038, a turn a year | Closest to a tycoon game; needs new rules (section 5.2) and balance from zero |
| Pick an era | Today's race set in a chosen year | Smallest; history is a backdrop, not a journey |

**How to build the 3D world:**

| | Trade-off |
|---|---|
| **Restore this project's old 3D office and extend it** | Proven camera, touch, people, clean-up and 13,000 lines of tests; needs re-pointing at the new game and era looks |
| Start a new scene from the mock | Free of old assumptions, but repeats solved problems (phones, picking, context loss) |
| Use react-three-fiber | Tidy in React, but a second framework, a larger download, and nothing here needs it |

**How to add the career's rules:**

| | Trade-off |
|---|---|
| **One engine, with the career's rules switched on by its config** | The race stays verified by its own tests; a few branches in the turn's ending steps |
| A second engine for the career | No risk to the race's code, but two copies of every shared rule to keep in step |

## 15. Build order

Five steps, each leaving something that works and is tested. **(proposal)**

1. **Career rules, no screen.** The engine switches, eras, dated cards, platform shifts, going public as a choice
   in the plan, the rescue, replacement rivals, offices, the limit on marketing; the career config; rivals adapted;
   tests. The race still passes.
2. **Career simulator and tuning** to the targets the owner confirms.
3. **The career in the existing 2D screens**: years instead of quarters, the timeline strip, milestones, the rescue,
   the short summary and annual report, the end screen. Playable and shippable; this is also the permanent no-3D way
   to play.
4. **The 3D office as the main screen**: restore the world's foundation, the scene model, team areas, office moves,
   the year playing out, the first three era looks, the fallback, the browser checks.
5. **The market view, remaining era looks, sound for milestones, how-to-play, documents, final review.**

In size this is about as much work as everything built so far. It continues on the same branch and draft pull
request unless the owner would rather merge the finished race first.

## 16. Proposals that needed the owner's yes (all approved)

1. The new rules that are proposals: an era may set any number (C2); crashes and booms that reach every company
   (C3); a platform shift as a ceiling on quality (C4); what a rescue costs, including control of the board (C7); who
   you play against and how rivals are replaced (C8); offices as a rule, with 150 people as the largest company (C9);
   marketing paid from cash in hand (C11).
2. The five career balance targets (section 9).
3. The race stays as a second mode (section 11).
4. Restoring the old 3D office as the base of the new world, keeping its look (section 10.1); the phone layout and
   the switch between office and market (section 10.2).
5. The build order, with the career playable in 2D before it is in 3D (section 15).
6. No real company, product or person names anywhere.
7. The era table (section 6), including the two cards that rest on real hardship (2008, 2020).

## 17. Risks

- **Balance is the hard part.** A 49-turn game with shifts, rescues and replacements is tuned from zero, and the
  targets are new. If a target cannot be reached without changing a rule, work stops and the owner is asked.
- **Size.** Five steps, each large. The order is chosen so that stopping after any step still leaves a playable game.
- **3D on phones.** The old office handled phones with adaptive quality, but real devices cannot be tested here.

  > **Note, 26 November 2026 (owner's decision):** phones keep the 2D screens, so this risk does not apply; the 3D
  > screen is for desktop browsers only.
- **A long game can drag.** The summary, carried-over plans and skippable playback keep a quiet year to seconds; the
  owner's play-testing decides whether 49 years is right.

## 18. Left to the builder

- Exact starting values for the era table's market, prices and bars before tuning.
- How the office's team areas are laid out on each of the five plans, and each era look's props.
- The wording of every card, warning and report line.
- The internal shape of the scene model and of the career section of the config.
- Which of the old world's tests are restored as they are and which are rewritten for the new seam.

## 19. What the builder check changed

Three independent builders (a rules-engine engineer, a three.js front-end engineer and a tycoon-game designer) read
the first draft and reported what they would have had to guess. One question went to the owner (what going public
is, now C5 and C6). The rest were settled as proposals:

- **C4** was an equal 35% cut in quality for everyone, which would have left every company's share of new users
  where it was. It is now a ceiling, so a lead really has to be re-earned.
- **C3 and the era table:** crash and boom cards moved valuations only, so they would have done nothing to a company
  that was not raising money. They now also move new users and candidates.
- **C7 and C11:** as drafted, one deliberate year of overspending followed by the rescue was the cheapest money in
  the game, and the rescue left the board tied. Marketing is now paid from cash in hand, and a rescue hands the board
  to investors.
- **C2:** an era may set any existing number, not only the ones first listed.
- **C8:** the 1990 line-up and what a replacement rival does and does not inherit are now stated.
- **Section 10:** the phone layout, the single canvas with a switch between office and market, the number of era
  looks (four furniture sets, eight palettes) and a draw budget for phones are now stated.

