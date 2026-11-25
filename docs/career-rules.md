# StartUpWorld: career rules

The career is StartUpWorld's second game: one company from 1990 to 2038, one turn a year. Its design is in
`docs/superpowers/specs/2026-11-25-career-3d-design.md`. This file is the record kept while the career is built. It
says in what order a year is played, how each point the design left open was settled, and which numbers tuning
changed and why. Each section fills in as the build goes on.

## Order of a year

## Rulings on open points

1. Career-only facts are absent from a race game, not present and empty, so the race's states and logs are unchanged.
2. A year is `firstYear + turn - 1`.
3. The numbers of a year are the config with its era's values laid over it; lists are replaced whole.
4. Each era's market curve starts again: its `newUsersTurn1` arrive in the era's first year.
5. Limits, prices and the bar for going public are those of the year in which they are checked.

## Starting numbers

## Tuning log
