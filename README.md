# StartUpWorld

A web-based hybrid terminal + management sim built with React, TypeScript, Zustand, and TailwindCSS.

## Local setup

```bash
npm install
npm run dev
```

## Structure

```
src/
  engine/        # pure simulation logic
  ui/
    components/
    panels/
    terminal/
  state/
  types/
  styles/
```

## Deployment

This is a static Vite app. Deploy directly to Vercel.

### Leaderboard database

The leaderboard and the graveyard (`api/`) store their data in Redis. Connect a Redis store to the Vercel project
(Storage tab) so the functions get a `REDIS_URL` or `KV_URL` variable; without a reachable database they answer 503 and the
game shows the leaderboard as offline.

A free Redis database is taken away when nothing uses it: Upstash archives one after 30 days without activity, and its
terms allow deleting one after a week without requests. To prevent that, `vercel.json` schedules one request a day to
`/api/keepalive`, which writes a timestamp to the database. If the write fails, the same run tries it once more, on a
new connection when the old one had stopped answering.

To check that the schedule is working, open `/api/keepalive` in a browser:

- `200` with `"ok": true` means a scheduled run was recorded in the last 50 hours. The schedule runs once a day between
  07:00 and 08:00 UTC, so a healthy `lastScheduledPing` is from the most recent 07:00 hour.
- `503` means no scheduled run was recorded in the last 50 hours (or ever), or the database cannot be reached or does
  not answer. The `error` field says which. Check the Cron Jobs tab of the Vercel project.

`lastScheduledPing` is the time of the last request that identified itself as Vercel's scheduler. A manual run from the
dashboard updates it too, so a value from another time of day does not show that the schedule works.

For an alert when it stops, point an uptime monitor at `/api/keepalive`: it reports a non-200 answer, and its own
requests also reach the database. A monitor's request is answered within about 8 seconds even when the database does
not answer (up to 5 to connect and 3 for the reply), so give the monitor a longer timeout than that.

When the leaderboard or the graveyard answers `500`, the function's log (Logs tab of the Vercel project) has one line
that says why, for example `leaderboard: request failed: Redis did not reply within 3000 ms`. Vercel keeps these logs
for a limited time, [one hour on the Hobby plan](https://vercel.com/docs/logs/runtime), so read the line soon after the
failure.

The line is built from the error alone. A connection string in it is replaced by `[redis url]`, and neither the request
body nor a stored entry is written to it. What a Redis server quotes back of a command it does not know, a login
included, is left out (`[not logged]`). The line can name the database's host or address (`getaddrinfo ENOTFOUND …`).
Two kinds of reason need a word:

- `stored entry at index 2 is not valid JSON`: the third entry the function read could not be parsed (the index counts
  from 0). The list answers `500` for as long as that entry is among those it reads.
- `Invalid JSON`, `invalid media type` or `invalid parameter format`: the request itself could not be read. That is
  about what the caller sent, not about the database.
