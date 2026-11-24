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
