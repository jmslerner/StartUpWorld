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

Free Redis plans archive a database that sits unused (Upstash: after 30 days without activity). To prevent that,
`vercel.json` schedules one request a day to `/api/keepalive`, which writes a timestamp. Open
`/api/keepalive` in a browser to check it: `lastScheduledPing` is the last time the schedule got through.
