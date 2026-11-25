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
     counts against the profit and the cash and can bankrupt. The one-year projection works the move out the same way
     on its payroll plus every hire it wants plus the poach it plans (rulings 31 to 33 and 35).
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
      salaries at the closing year's salary for the people paid during the year. The valuation, with its listing
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
14. The funding climate ticks down and next year's card is drawn.
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
    were on the payroll during the year. People who join as the year ends are not counted, so hiring on the way down
    buys nothing.
29. A company that lists and is rescued in the same year keeps its listing: both changes to its equity, seats and hype
    apply.
30. After a rescue the report's runway is worked out again from the cash the rescue leaves.
31. The office is checked once a year, on the head count as the year ends. A team that shrinks keeps its office.
32. One bill, however many sizes are skipped: `moving.salaryYears` of that year's salary for everyone who moves.
33. The bill is one of the year's costs.
34. Hires are capped so that a team never exceeds the last office, and a poach that would overfill it is dropped.
35. The projection assumes every wanted hire and the planned poach arrive.

## Starting numbers

## Tuning log
