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
     projection costs every hire the year can make, whether the planned poach works or not, and works the move out
     the same way on the largest team the year can end with: its payroll plus those hires plus the poach it plans,
     never more than the last office holds (rulings 31 to 33 and 35).
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
    team the year can end with, so its cash and its bill err on the careful side.
36. A seat is refilled only if its company was run by a computer style; the player's seat never is.
37. Out in year Y means the newcomer plans from year Y + 2.
38. A newcomer gets the startup numbers of the year it enters, whatever style it plays.
39. Newcomers enter before the coming year's card is drawn, so a card can hit them.
40. After a year in which a ceiling held, a rival that closed it at the ceiling shows no build rate. The projection
    then assumes its whole team builds: the cautious guess, and one that does not depend on the plan in hand.
41. A moving bill is a cost of its own year only. What a company carries into the next year as last year's costs,
    which the opening runway reads, leaves the bill out, because it cannot recur.

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
