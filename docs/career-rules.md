# StartUpWorld: career rules

The career is StartUpWorld's second game: one company from 1990 to 2038, one turn a year. Its design is in
`docs/superpowers/specs/2026-11-25-career-3d-design.md`. This file is the record kept while the career is built. It
says in what order a year is played, how each point the design left open was settled, and which numbers tuning
changed and why. Each section fills in as the build goes on.

## Order of a year

A year is played in the race's fourteen steps (`docs/turn-based-design.md`, "Order of a turn"), with every number
read from that year's numbers: the config with its era's values laid over it (ruling 3). A line under a step says
what the career changes there; a step with no line is played as in the race.

Before planning, already part of the state a year starts from:

- The year's card is revealed and its instant effects are applied.
  - A card dated to the year is the year's card, whatever the dice say (ruling 8). The first year's card is dealt
    with the game, and hits no one company (ruling 9).
  - A platform shift's ceiling cuts every company still in the game down to it, launched or not, and its wave of new
    users replaces one still running; a shift in the first year sets its wave with the game (rulings 12 to 15). The
    year's report says how much quality the card took from each company.
  - A shift is announced in the `shiftNoticeYears` years before it, not in its own year (ruling 16).

Resolution, in this order:

1. Plans are checked. Anything illegal is fixed up or dropped at no cost, and the report says so.
   - Limits and prices are those of this year (ruling 5).
   - A plan may go public. It is dropped, with the reason, unless the company has qualified and is not yet public;
     until it qualifies the reason names what it still needs against this year's bar (rulings 18 and 19). A plan
     that both raises and goes public loses the raise (ruling 21), and a public company cannot raise privately
     (ruling 22). The resolved plan always says whether the company goes public.
   - Marketing is cut to the room the company has: its opening cash, never counted below $0, plus this year's raise
     or listing at the opening valuation (a raise the rules drop brings nothing), rounded down to the marketing step.
     When this cut applies, its note is the only marketing note (ruling 23).
   - A poach by a company whose payroll (its head count less layoffs) already fills the last office is dropped, with
     the note "Poach dropped: the campus is full." naming that office (ruling 34).
2. Layoffs.
3. The raise closes.
   - A listing closes here, in place of a raise: the company sells `listing.percent` of itself at the year's opening
     valuation, without the premium; the cash comes in before the year's work, the founder's equity shrinks by the
     same share and investors gain `listing.investorSeats` seats. No raise cooldown starts (ruling 20).
4. Work is done.
5. Product quality: gain, then decay, then the launch test.
   - In a shift's year, when its ceiling has `turns` 1, no company's quality is above the ceiling after gain and
     decay; the launch test reads the capped quality. The one-year projection caps it the same way, and expects no
     rival's quality to head higher (ruling 14).
6. Market: churn, then the pool is split by pull.
   - The year's new users follow its era's curve, counted from the era's first year (ruling 4).
   - While a wave runs, the year's new users are multiplied by it as well as by the card's one-year change
     (ruling 15).
7. Poach attempts, in hype order.
8. Hiring, one candidate at a time in hype order.
   - Candidates on the market are never fewer than none (ruling 11).
   - The hires a company wants are capped so that its payroll, plus a poach that worked, less anyone poached from it,
     plus its hires never exceed the last office's capacity; never fewer than none (ruling 34).
9. Revenue and costs.
   - A team whose head count as the year ends is over its office's capacity moves to the smallest office that holds
     it, however many sizes that skips, and pays one bill: `moving.salaryYears` of the year's salary for everyone on
     the team. The bill is the report's `costs.moving`, 0 without a move, and is counted in the year's total, so it
     counts against the profit and the cash and can bankrupt. The bill is a whole number of dollars. The one-year
     projection costs every hire the year can make, whether the planned poach works or not, and at the last office
     also the hires that rivals' poaches may make room for: one for each rival still in the game, while the team is
     large enough to be poached from. It works the move out the same way on the largest team the year can end with:
     its payroll plus the hires it wants plus the poach it plans, never more than the last office holds (rulings 31 to
     33 and 35).
10. Hype.
    - In the year it lists, a company gains `listing.hype`, added with the year's other hype before the cap at 100.
    - The valuation the year closes at carries the listing premium for a company that is public or listed this year,
      rounded to whole dollars after it (ruling 20). The one-year projection shows the listing, the equity, the
      seats, the hype and the premium exactly as the turn will play them.
11. IPO check.
    - No IPO check: reaching the bar with a profit ends nothing (ruling 6).
12. Bankruptcy, then the board vote. Companies that go out release their users and staff.
    - A company's first failure is a rescue, not the end: cash below $0 is checked first, then the board. A company
      rescued from bankruptcy is not voted on that year; one the board fires keeps the board's report. A company
      whose rescue is spent goes out as in the race (rulings 24 and 25).
    - A rescue, in this order: the founder keeps `rescue.equityKept` of their equity; investors gain
      `rescue.investorSeats` seats, or end with one more than the founders if that is more; `rescue.hype` is added
      to the year's hype once it is worked out, not below 0; cash below $0 is reset to `rescue.salaryYears` of
      salaries at the closing year's salary for the people who were on the payroll during the year and are still
      there as it ends, rounded to whole dollars. The valuation, with its listing
      premium, and the runway are then worked out again from what the rescue leaves (rulings 26 to 30).
    - In the year after a rescue the board does not vote: its report says what it saw, with `fired: false`, and the
      one-year projection puts the board's risk at 0. It does not predict a rescue (ruling 25).
13. Last company standing, then the ranking at the last turn.
    - One company left, or none, ends nothing. After the last year (turn 49, 2038) the largest founder's stake among
      the companies still in the game wins; with nobody left the outcome is `wipeout` (ruling 6).
    - Closing the books, after the endings: each company's quality as the year closes is kept, public, before next
      year's card can cut it (ruling 17).
    - Closing the books also records a listing, and marks a company qualified when the year closed with that
      year's bar in users and with revenue that covered its costs (ruling 18).
    - Closing the books also records a rescue, its turn and what it was from; a company is rescued once (ruling 24).
    - Closing the books also records a move: the company's office is the one it moved to. Offices are never given up
      (ruling 31).
    - The costs a company carries into the next year as last year's, which its opening runway reads, leave out a
      moving bill (ruling 41).
14. The funding climate ticks down and next year's card is drawn.
    - First, newcomers take their seats: every seat whose company is out, was played by a computer style and went
      out at least `replacement.afterYears` turns before the coming year gets a new startup, in seat order, with the
      startup numbers of the coming year and `founded` set to it. Its style (one of `replacement.styles`), name and
      pitch are drawn from the seat's own stream; no two companies share a name. The log's `entrants` lists the seats
      taken, an empty list when nobody enters (rulings 36 to 39).
    - A wave of new users ticks down with the funding climate, before next year's card can set a new one (ruling 15).
    - The card is drawn from next year's numbers, so a new era's deck is in play from its first year.
    - A card dated to next year replaces the draw, without a roll; its target is picked as for a random card, and when
      no company qualifies it is still in force and hits nobody (rulings 8 and 10).

## Rulings on open points

1. Career-only facts are absent from a race game, not present and empty, so the race's states and logs are unchanged.
2. A year is `firstYear + turn - 1`.
3. The numbers of a year are the config with its era's values laid over it; lists are replaced whole.
4. Each era's market curve starts again: its `newUsersTurn1` arrive in the era's first year.
5. Limits, prices and the bar for going public are those of the year in which they are checked.
6. The engine gives a career an outcome only after its last year. `turnLimit` goes to the largest founder's stake
   among the companies still in the game; ties go to the higher valuation, then the lower seat; with nobody left the
   outcome is `wipeout`.
7. As in the race, the engine plays on when the player's company is out. Ending the player's session after a second
   failure is the app's job (the screens plan); the simulator plays every career to 2038.
8. A dated card replaces the random draw of its year. `events.firstTurn` and `events.chance` govern random draws only.
9. The first year's card is dealt with the game, so it cannot be a card that hits one company.
10. A dated card whose target rule no company meets is still in force; the effects that need a target hit nobody.
11. Candidates on the market are never fewer than none.
12. A platform shift is two effects on one dated card: a ceiling on quality in its year, and a wave of new users for
    the years the card says.
13. The ceiling caps every company still in the game, launched or not; launch is permanent.
14. A ceiling with `turns` 1 holds through its year: Product work that year lifts a product up to the ceiling and no
    further, and rebuilding starts the year after. With `turns` 0 the cut is made once, as the year opens, and that
    year's Product work builds on it.
15. A new wave replaces one still running; it multiplies with a card's one-year change in new users, and it ticks
    down with the funding climate.
16. A shift is announced in the `shiftNoticeYears` years before it, not in its own year.
17. The quality a company closed last year with is public, and a rival's pull is carried forward from it, not from
    the quality a shift has just left it with.
18. A company qualifies when a year closes with that year's bar in users and with revenue that covered its costs.
    Once qualified it stays qualified, whatever happens later, and may list in any later year, once.
19. Until it qualifies, what a company is told it still needs is measured against the bar of the year being planned:
    users while it has fewer than that bar, a profitable year once it has them.
20. A listing closes with the raise step, at the opening valuation without the premium; the premium applies from the
    end of that year, rounded to whole dollars after it.
21. A plan that both raises and goes public loses the raise.
22. A public company cannot raise privately. A race plan that asks to go public is played as if it did not.
23. The room for marketing is the opening cash, never counted below $0, plus this year's raise or listing at the
    opening valuation, rounded down to the marketing step.
24. Every company, the Incumbent included, has one rescue. The first time it would go out it is rescued; the second
    failure is final, whenever it comes. Bankruptcy is checked first; a company rescued from it is not voted on that
    year.
25. "The year after a rescue" is the next turn only. In it the board does not vote, though its report still says what
    it saw; bankruptcy still applies.
26. The rescue's hype is taken off after the year's hype is worked out, not below 0, and the valuation follows. The
    report gives the change actually made.
27. Investors end a rescue with two more seats, or one more than the founders if that is more.
28. Cash is reset only from below $0, to a year of salaries at the salary of the year that closes, for the people who
    were on the payroll during the year and are still there as it ends: the payroll less those poached away in the
    year. People who join as the year ends, hired or poached in, are never counted, so hiring on the way down buys
    nothing. The cash is a whole number of dollars.
29. A company that lists and is rescued in the same year keeps its listing: both changes to its equity, seats and hype
    apply.
30. After a rescue the report's runway is worked out again from the cash the rescue leaves.
31. The office is checked once a year, on the head count as the year ends. A team that shrinks keeps its office.
32. One bill, however many sizes are skipped: `moving.salaryYears` of that year's salary for everyone who moves.
    The bill is a whole number of dollars.
33. The bill is one of the year's costs.
34. Hires are capped so that a team never exceeds the last office, and a poach that would overfill it is dropped.
35. The projection costs every hire the year can make and the planned poach, and works the move out on the largest
    team the year can end with, so its cash and its bill err on the careful side. It cannot know a rival's plan, so at
    the last office it costs a hire for each rival that could poach one person away and so make room for one.
36. A seat is refilled only if its company was run by a computer style; the player's seat never is.
37. Out in year Y means the newcomer plans from year Y + 2.
38. A newcomer gets the startup numbers of the year it enters, whatever style it plays.
39. Newcomers enter before the coming year's card is drawn, so a card can hit them.
40. After a year in which a ceiling held, a rival that closed it at the ceiling shows no build rate. The projection
    then assumes its whole team builds: the cautious guess, and one that does not depend on the plan in hand.
41. A moving bill is a cost of its own year only. What a company carries into the next year as last year's costs,
    which the opening runway reads, leaves the bill out, because it cannot recur.
42. New users are rounded once, to whole users, after the era's curve and every multiplier on it (the year's card and
    a wave) have been applied.
43. A wave "for N years" counts the shift's own year, as a funding climate does: it multiplies the new users of the
    shift's year and the N − 1 years after it.
44. A shift's notice is given in each of the `shiftNoticeYears` years before it, not only in the first of them.
45. The timeline is what is built. An era may open with its platform shift, or have it later: the 2023 shift falls in
    the second year of its era, which starts in 2022.
46. The timeline's dated cards are the 28 that are built, eight of them invented; the design's count of 30 real events
    checked is the research behind them, not a count of cards.
47. The wording of a plan note is not a rule. A note is a plain sentence that names what was changed and why; a test
    reads what it names, not its exact words (the one exception the rules fix is ruling 34's note).
48. A company that goes bankrupt, whether rescued or out, has no board result that year: the report's `board` is null.
    The board looks at a year, and the report keeps what it saw, only when the company is not bankrupt and investors
    hold more seats than the founders.
49. A newcomer's name differs from every company's name in the game as it is drawn, the company it replaces included.
50. With no move, the one-year projection shows the moving cost as 0 and `career.office` as null, as the report does.
51. A ceiling touches only companies still in the game; a company already out keeps the quality it went out with. A
    ceiling with `turns` 0 does not hold: `heldCeiling` and `datedHeldCeiling` give null for its year, the turn and the
    projection do not cap that year's Product work, and the cut as the year opens is all it does. It is still announced
    as a shift in the years before it, as any dated ceiling is.

## What the independent tests found

Three authors, each reading only the documents (the design's sections 5 and 6, this file, `src/engine/types.ts`, the
export list of `src/engine/index.ts`, `src/config.design.ts`, the two test helper files and one of the race's black-box
files as a model) and never the engine's code or its own tests, each wrote one file of black-box tests (Task 16):

| File | Rules | Tests |
|---|---|---|
| `src/engine/blackbox/career-years-and-cards.test.ts` | C1 to C4 | 77 |
| `src/engine/blackbox/career-money-and-control.test.ts` | C5 to C7, C11 | 84, and 1 added for a break (85) |
| `src/engine/blackbox/career-rivals-offices-endings.test.ts` | C8 to C10 | 80 |

**Every test agreed with the engine.** All 241 passed against it as written, so no disagreement had to be settled and
the engine was not changed. Two tests of the second author had failed at first; both were its own misreadings, which
it corrected before the files were handed in:

- An era's market curve starts again in the era's first year (ruling 4): the test had counted a later era's new users
  along a curve that did not start again.
- A team of 30 placed in the garage pays a moving bill: the office is checked on the head count as the year ends
  (ruling 31), so a team set up larger than its office moves that year and pays for it.

**Points the documents did not settle**, what the authors assumed, and the ruling that now settles each:

1. When new users are rounded around a multiplier (a wave, a card). The tests allow one user either way. Ruling 42:
   once, after every multiplier.
2. Whether a wave "for 3 years" counts the shift's own year. Assumed it does, as a funding climate does. Ruling 43.
3. Whether a shift's notice is given in each of the `shiftNoticeYears` years before it or only the first. Assumed
   each. Ruling 44.
4. C4 says "some eras open with a platform shift"; the timeline puts the 2023 shift in the second year of its era.
   The tests follow the timeline. Ruling 45: the timeline is what is built.
5. The design says 30 real events were checked; the timeline has 28 dated cards, eight of them invented. The tests
   count 28. Ruling 46.
6. The wording of plan notes. The tests look for what a note names (users, profit, marketing), not its words, except
   the poach note ruling 34 spells out. Ruling 47.
7. Whether a company rescued from bankruptcy has a board result in that year's report. The tests asked only that it
   is not voted on. The engine checks bankruptcy before the board and records no board result: ruling 48.
8. Whether a newcomer's name may repeat that of the company it replaces. Assumed not: it differs from that name as
   well as from the others. Ruling 49.
9. What the projection shows as the moving cost when there is no move. The engine shows 0 and no office move, as the
   report does: ruling 50.
10. Whether a ceiling touches a company that is already out, and what the engine says for a ceiling that does not
    hold. The engine leaves a company that is out untouched, and gives no held ceiling (null) for a ceiling with
    `turns` 0, whose cut as the year opens is all it does: ruling 51.

**Each rule broken on purpose.** Each of the 21 breaks below was made alone, as one change in one place in the engine,
the three files run, and the change undone. Twenty were caught by the authors' tests as written. The rescue's salary
was not, because the one test of it rescues a company in an era's first year, when the closing year's salary and the
next year's are the same; one test was added for it (marked *added*). A count of more than one is the number of tests
that failed; the name is one of them.

| # | Break | Caught by | Failed |
|---|---|---|---|
| 1 | The premium is not applied the year after a listing | C5 "a public company keeps the premium in later years, without the listing's hype" | 2 |
| 2 | A listing starts a raise cooldown | C5 "going public is not a raise: no raise in the report and no raise cooldown starts" | 2 |
| 3 | A public company may raise | C6 "a public company's raise is dropped with a note, and nothing is sold" | 5 |
| 4 | A qualified company loses the offer after a losing year | C5 "once qualified a company stays qualified after a losing year" | 1 |
| 5 | The market is counted from 1990, not the era's first year | C2 "starts the next era's curve again in its first year: 100,000 in 1995" | 6 |
| 6 | A second failure is rescued again | C7 "a second failure years later is final, and releases the company's users and staff" | 9 |
| 7 | The board votes in the year after a rescue | C7 "in the year after a rescue the board does not vote, though its report says what it saw" | 1 |
| 8 | A rescue resets cash that was not below $0 | C7 "a board's firing is rescued too: equity halved, seats, hype, and cash not reset" | 1 |
| 9 | The ceiling multiplies quality instead of capping it | C4 "cuts every company above the ceiling down to it as the year opens, the Incumbent included" | 10 |
| 10 | A dated card is subject to the chance roll | C3 "comes in turn 2 although random draws start at turn 3" | 32 |
| 11 | The marketing limit ignores the year's raise | C11 "a raise in the same year adds its amount to the room" | 2 |
| 12 | Candidates may go below none | C3 "never offers fewer than no candidates" | 1 |
| 13 | A newcomer enters after one year | C8 "does not refill a seat in the year its company goes out" | 4 |
| 14 | The player's seat is refilled | C8 "never refills the player's seat" | 3 |
| 15 | The moving bill is worked out on the head count at the start of the year | C9 "moves a team that ends the year over its office's capacity, and bills the whole team once" | 6 |
| 16 | Hires may pass 150 | C9 "stops hiring at 150 people" | 9 |
| 17 | A career ends when one company is left | C10 "goes on with one company left" | 8 |
| 18 | What a company still needs to qualify is read against last year's bar | C5 "what an unqualified company still needs is measured against the bar of the year being planned" | 1 |
| 19 | A rescue's cash is worked out at next year's salary | C7 "the reset in an era's last year is at that year's salary, not the next era's" (*added*) | 1 |
| 20 | A rescue's cash counts the people hired as the year ends | C7 "people hired as the year ends are not counted in the reset" | 2 |
| 21 | A ceiling with `turns` 1 lets Product work lift a product above it in its year | C4 "holds a ceiling with turns 1 through its year: Product work lifts a product to it and no further" | 3 |

## How the simulator measures the targets

`npm run sim:career` plays `sim.careers` whole careers, 1990 to 2038, with the baseline bot in the player's seat, and
plays the same seeds again for each pilot and measure (`src/sim/runCareer.ts`, `src/sim/pilots.ts`,
`src/sim/careerReport.ts`). These are its rulings.

1. A win is counted under the style the winning company plays, a newcomer's included.
2. The baseline bot's career "ends early" when its company is out at the end, which takes two failures; a second
   failure in 2038 itself counts, because the company is out when the standings are drawn.
3. It "goes public" if it lists in any year.
4. The leader of 2010 is the company not out with the largest founder's stake as 2010 closes; it "wins" if the winner
   of 2038 is that same company, same seat and same founding year; careers with no company in the game in 2010 are
   left out of the figure.
5. A loophole pilot is flagged when its win share beats the baseline bot's on the same seeds by more than
   `loopholeMargin`; a flag is reported, not counted as a failed target.
6. A range target passes on its bounds; the lead target passes only under its figure.
7. The control for the lead target is the same batch with every platform shift switched off (ceilings at 100, waves
   at 1): the difference between the two lead figures is what the shifts do.
8. Whether a pilot is flagged is decided on 5,000 careers (Task 17, Step 4): at 1,000 the difference between two win
   shares moves by one to two points from chance alone.
9. The pilot that plays the final year for its stake alone and the pilot that reads the timeline are measures, not
   loophole checks, and are never flagged.
10. The board votes at the end of the final year as in any other, so the end-game pilot never takes a plan that could
    leave it below $0.
11. A style's win share pools the company of 1990 with newcomers that play its style; the target is on the pooled
    figure, and the report shows the two parts.

## Starting numbers

The career ships with `CAREER` in `src/config.ts`; `CAREER_DESIGN` in `src/config.design.ts` holds the same numbers,
written out a second time and never tuned. Neither reads the race's numbers, so tuning one game never moves the other.
Everything is per year.

**Base values.** These are the race's tuned numbers read per year instead of per quarter, with the spec's own numbers
for the career's rules (listing, rescue, replacement, offices, moving). Every era inherits them unless it sets its
own; `salary`, `market`, `ipo`, `valuation`, `hiring.candidatesPerTurn`, `pull.maxMarketing` and the team caps are
the first era's.

```
game.maxTurns 49
archetypes.startup    cash 400K · 3 people · 0 users · quality 0 · hype 10 · equity 1 · seats 2 founder / 0 investor
                      workExponent 0.9 · catchUpMultiplier 1 · allocation 3 / 0 / 0
archetypes.incumbent  cash 1.5M · 8 people · 10K users · quality 30 · hype 20 · equity 0.6 · seats 2 / 1
                      workExponent 0.625 · catchUpMultiplier 1.5 · allocation 5 / 2 / 1
hiring     capacityPerWork 3 · fee 20K                       poach   cost 150K, the rest as the race
layoff     severance 40K · hype -10                          quality gainPerWork 9 · decay 6 · launchAt 10
pull       growthCoefficient 0.3 · marketingCoefficient 0.3 · marketingStep 50K
priceTiers budget 8 / 1.05 / -0.05 · standard 12 / 1 / 0 · premium 20 / 0.75 / 0.03      (price / pullFactor / churnDelta)
churn      base 0.30 · perQualityPoint 0.002 · min 0.05      raise   minUsers 1K · cooldownTurns 1 · options 10, 20, 30
board      fireChance 0.3 · runwayTurns 1                    hype    decay 0.4 · launch 15 · raise 10 · growth 5 · growthThreshold 0.25
projection as the race                                       events  firstTurn 2 · chance 0.5 · deck: none here,
                                                                     each era has its own (below)
cpu        as the race, except recruiters.shares 0.1, 0.2 · ipoPushLayoffs 0, 1, 2 ·
           ipo win 2 / deficit 2 / nextDeficit 1 / usersShortfall 2 and, per personality:
           blitzscaler  hireRunway 1 · horizon 3        bootstrapper  raise.runway 1 · hireRunway 2 · horizon 4
           incumbent    raise.runway 1.5 · poachRunway 1.5 · hireRunway 1.5 · horizon 3
           (layoffRunway and shortRunwayTurns stay 1: with a year as the turn, less than a year of cash is
           bankruptcy this year, and layoffs have to be among the plans weighed)
baseline   split 0.4 / 0.4 / 0.2 · standard · raisePercent 20 · raiseRunway 3 · hireRunway 3 · marketing 0
sim        careers 1000 · firstSeed 1 · leaderYear 2010 · checkpointYears 1995, 2000, 2010, 2020, 2030, 2038
           overspendYear 1993 · loopholeMargin 0.03 · targets: maxCpuWinShare 0.4 · baselineWinShare 0.15 to 0.35 ·
           baselineOutShare 0.10 to 0.30 · baselineListedShare 0.40 to 0.80 · leaderHoldsBelow 0.60
career     firstYear 1990 · shiftNoticeYears 2 · listing 20% / premium 1.25 / hype 20 / 1 investor seat ·
           rescue equityKept 0.5 / 2 investor seats / hype -10 / 1 year of salaries · replacement after 2 years, any
           of the three styles · moving 0.5 years of salary · offices Garage 4, Shared office 9, Own office 22,
           Full floor 40, Campus 150
```

**The eras.** The era table is the plan's proposal, on the spec's eight eras and their years. Each era's `values` set
these numbers for the era's years; a number set in the last column holds for that era only, and the next era goes back
to the base value unless it sets the number again.

| id | name | firstYear | market.newUsersTurn1 | growthPerTurn | salary | valuation.perUser | hiring.candidatesPerTurn | ipo.users | archetypes.startup.cash | pull.maxMarketing | teamCap blitz / boot / incumbent | also sets |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `dial-up` | Dial-up dawn | 1990 | 20K | 0.35 | 50K | 40 | 4 | 60K | 400K | 1M | 8 / 6 / 12 | `pull.marketingCoefficient` 0.2 |
| `gold-rush` | Browser gold rush | 1995 | 100K | 0.40 | 70K | 200 | 6 | 300K | 600K | 5M | 15 / 9 / 20 | `poach.baseChance` 0.6 |
| `bust` | Bust and broadband | 2000 | 380K | 0.05 | 85K | 50 | 9 | 800K | 500K | 5M | 15 / 9 / 20 | `hiring.fee` 10K |
| `phones` | Phones and cloud | 2007 | 700K | 0.10 | 100K | 80 | 8 | 1.5M | 600K | 10M | 25 / 14 / 35 | `quality.gainPerWork` 11 · `pull.growthCoefficient` 0.4 |
| `cheap-money` | Cheap money years | 2014 | 1.3M | 0.03 | 130K | 130 | 16 | 3M | 1M | 30M | 50 / 25 / 70 | `churn.base` 0.35 |
| `winter-ai` | Winter and AI | 2022 | 1.6M | 0.04 | 150K | 100 | 12 | 4M | 1M | 30M | 50 / 25 / 70 | `quality.gainPerWork` 12 · `quality.decay` 8 |
| `agents` | Agent economy | 2027 | 2.0M | 0.06 | 220K | 60 | 4 | 5M | 1.5M | 40M | 30 / 15 / 40 | `quality.gainPerWork` 18 · `churn.perQualityPoint` 0.003 · `pull.marketingCoefficient` 0.15 |
| `ambient` | Ambient age | 2033 | 3.5M | 0.10 | 280K | 80 | 16 | 8M | 2M | 60M | 60 / 30 / 90 | `pull.marketingCoefficient` 0.1 · `hype.launch` 25 |

Agent economy and Ambient age are invented (`invented: true`). Each era also deals its own deck: five to seven cards
built from the race's seven cards that do not touch funding (viral moment, burnout, press feature, security breach,
talent glut, market boom, ad prices spike), named and worded for the era, with the race's effects. No deck card sets a
funding climate, a quality ceiling or a wave: the dated cards own those.

**The dated cards.** The 28 dated cards are the spec's section 6, each in its year with exactly the effects it lists,
written as these effects (the wave's 1.3 for 3 years and the ceiling's `turns` of 1 are the plan's proposal). Their
texts follow the research notes with the fact-check's corrections; a comment beside each real card names the event.

| The spec says | Effect |
|---|---|
| valuations ×M, N years | `{ kind: "fundingClimate", multiplier: M, turns: N }` |
| new users ×M | `{ kind: "newUsers", multiplier: M }` |
| marketing works ×M | `{ kind: "marketingEffect", multiplier: M }` |
| N extra candidates / N fewer candidates | `{ kind: "candidates", extra: N }` / `extra: -N` |
| platform shift | `{ kind: "qualityCeiling", ceiling: 30, turns: 1 }` then `{ kind: "userWave", multiplier: 1.3, turns: 3 }`, listed first |
| one weak product loses F of its users and H hype | `target: { pick: "random", launched: true, qualityBelow: 50, minUsers: 1 }` (60 for 2035) with `targetUsers` F and `targetHype` −H |

## Tuning log
