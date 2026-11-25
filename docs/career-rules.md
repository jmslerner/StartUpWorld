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

Resolution, in this order:

1. Plans are checked. Anything illegal is fixed up or dropped at no cost, and the report says so.
   - Limits and prices are those of this year (ruling 5).
2. Layoffs.
3. The raise closes.
4. Work is done.
5. Product quality: gain, then decay, then the launch test.
6. Market: churn, then the pool is split by pull.
   - The year's new users follow its era's curve, counted from the era's first year (ruling 4).
7. Poach attempts, in hype order.
8. Hiring, one candidate at a time in hype order.
9. Revenue and costs.
10. Hype.
11. IPO check.
    - No IPO check: reaching the bar with a profit ends nothing (ruling 6).
12. Bankruptcy, then the board vote. Companies that go out release their users and staff.
13. Last company standing, then the ranking at the last turn.
    - One company left, or none, ends nothing. After the last year (turn 49, 2038) the largest founder's stake among
      the companies still in the game wins; with nobody left the outcome is `wipeout` (ruling 6).
14. The funding climate ticks down and next year's card is drawn.
    - The card is drawn from next year's numbers, so a new era's deck is in play from its first year.

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

## Starting numbers

## Tuning log
