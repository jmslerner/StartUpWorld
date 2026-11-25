# StartUpWorld

A turn-based strategy game: you run a startup against three computer-run rivals. One turn is a quarter, and you have 20
of them to take your company public before a Blitzscaler, a Bootstrapper or the Incumbent gets there first. Built with
React, TypeScript, Zustand and Tailwind CSS.

The rules, the rulings on points the design left open and the tuning log are in
[docs/turn-based-design.md](docs/turn-based-design.md).

A second mode, the career (one company from 1990 to 2038, a turn a year), has no screens yet; its rules, rulings and
tuning log are in [docs/career-rules.md](docs/career-rules.md).

## Local setup

```bash
npm install
npm run dev
```

The game is then at http://localhost:5173. It saves itself in the browser after every change, so a refresh resumes the
quarter you were planning.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the game locally. |
| `npm test` | Runs the unit tests: rules engine, computer players, simulator, save format and the logic behind the screens. |
| `npm run sim` | Plays 1,000 seeded games without a screen and prints the balance report. |
| `npm run sim:career` | Plays 1,000 seeded careers, 1990 to 2038, without a screen and prints the career's balance report. |
| `npm run build` | Typechecks and builds for production. |
| `npm run lint` | Runs ESLint. |

## Tuning the game

Every number the game runs on is in `src/config.ts`: starting cash, salaries, prices, the event deck, how each computer
player weighs its options, and the four balance targets. The rules that use those numbers are in `src/engine`.

To change the balance:

1. Edit a number in `src/config.ts`, or try one without editing the file:

   ```bash
   npm run sim -- set=ipo.users=300000 games=300
   ```

2. Run `npm run sim`. The baseline bot plays your seat against the three computer players. The report shows the win rate
   by player type, how games end, the median length, how often companies go under, and PASS or FAIL for each balance
   target. It ends with every number that differs from the design's starting values.
3. Note the change and the reason in the Tuning log in `docs/turn-based-design.md`.

`src/config.design.ts` is a frozen copy of the starting numbers. The rules' tests run on it, so tuning `src/config.ts`
does not break them. Leave that file as it is. Two test files do read `src/config.ts`, on purpose: `src/config.test.ts`
checks its shape, and `src/ai/habits.test.ts` plays a few games on it and fails if tuning has turned a rival into a
different kind of player (a Blitzscaler that stops raising, an Incumbent that never poaches).

Other arguments: `games=200` and `seed=5001` pick a different batch, and `strict=1` makes the command fail when a target
does. An argument it does not know, or a `set=` path that is not in the config, stops the run with a message.

To add an event, add a card to `events.deck` in `src/config.ts`, built from the effects listed under `EventEffect` in
`src/engine/types.ts`. It needs no code, and `npm run sim` lists it as added.

### The career

The career's numbers are `CAREER` in `src/config.ts`, apart from the race's: the base values first, then each era's
`values`, laid over the base for that era's years, then the dated cards, the offices and the numbers of the career's own
rules (listing, rescue, replacement, moving). `CAREER_DESIGN` in `src/config.design.ts` is the career's frozen starting
numbers; leave it as it is. The career's five targets are in `CAREER.sim.targets`.

```bash
npm run sim:career                                             # 1,000 careers, 1990 to 2038
npm run sim:career -- games=300 seed=5001                      # a different batch
npm run sim:career -- set=career.eras.6.values.salary=300000   # one era's number, for this run only
npm run sim:career -- strict=1                                 # exit with code 1 if a target fails
```

The baseline bot plays the player's seat against the three computer players and the newcomers that take the seats of
rivals that go out. The same seeds are then played again by three loophole pilots and for three measures (the shifts
switched off, the final year played for the stake alone, the timeline read ahead), and the report ends with the five
targets and every number that differs from `CAREER_DESIGN`. 1,000 careers take a few minutes.

`set=` can be given more than once. A number that every era sets is set per era, not at the base:
`set=career.eras.<n>.values.<path>=<value>`, with `<n>` counted from 0 for the first era. An era may be given a number
it does not set yet. A dated card is `career.dated.<n>`, counted from 0 in the order of the cards. Note each change and
its reason in the Tuning log in `docs/career-rules.md`. A target is read on batches of 1,000 careers; whether a loophole
pilot is flagged is decided on 5,000 (`games=5000`).

## Structure

```
src/
  config.ts          every number the game runs on
  config.design.ts   the design's starting numbers, frozen
  engine/            the rules: pure functions with no UI code
  ai/                the three computer players and the simulator's baseline bot
  sim/               the headless simulator and its report
  state/             the game store and the autosave
  ui/                screens, components and the tested view model behind them
  audio/             synthesized sound effects
scripts/sim.ts       npm run sim
api/                 leaderboard functions from the earlier game (see Deployment)
docs/                the game design
```

The whole game goes through one function, `resolveTurn(state, plans, seed)` in `src/engine/resolveTurn.ts`, which returns
the next state and a log of the turn. All randomness comes from the seed, so a game is its seed plus the plans made each
turn: `replayGame` in `src/engine/replay.ts` reproduces any game exactly, and the end screen shows the seed.

## Deployment

This is a static Vite app. Deploy directly to Vercel.

The turn-based game does not post to the leaderboard. The functions in `api/` are from the earlier game; they stay
deployed, with the daily request described below, so the database is not taken away.

### Leaderboard database

The leaderboard and the graveyard (`api/`) store their data in Redis. Connect a Redis store to the Vercel project
(Storage tab) so the functions get a `REDIS_URL` or `KV_URL` variable; without a reachable database they answer 503 and the
game shows the leaderboard as offline.

A free Redis database is taken away when nothing uses it: Upstash archives one after 30 days without activity, and its
terms allow deleting one after a week without requests. To prevent that, `vercel.json` schedules one request a day to
`/api/keepalive`, which writes a timestamp to the database.

To check that the schedule is working, open `/api/keepalive` in a browser:

- `200` with `"ok": true` means a scheduled run was recorded in the last 50 hours. The schedule runs once a day between
  07:00 and 08:00 UTC, so a healthy `lastScheduledPing` is from the most recent 07:00 hour.
- `503` means no scheduled run was recorded in the last 50 hours (or ever), or the database cannot be reached. The
  `error` field says which. Check the Cron Jobs tab of the Vercel project.

`lastScheduledPing` is the time of the last request that identified itself as Vercel's scheduler. A manual run from the
dashboard updates it too, so a value from another time of day does not show that the schedule works.

For an alert when it stops, point an uptime monitor at `/api/keepalive`: it reports a non-200 answer, and its own
requests also reach the database.
