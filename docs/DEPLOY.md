# Deploy: Railway (simulation build)

The app is one Next.js service (`apps/web`) plus Railway Postgres. `CHAIN=mock` means simulation:
votes are real wallet signatures, while deposits, launches, claims and refunds are simulated.
No real funds move.

**Live:** https://web-production-776f2.up.railway.app (D-011). First-time setup, already done:

```sh
cd C:/Users/kacpe/ai/narrativepad/apps/web
railway init --name narrativepad
railway add --database postgres
railway add --service web --variables "CHAIN=mock" --variables 'DATABASE_URL=${{Postgres.DATABASE_URL}}' --variables "NEXT_TELEMETRY_DISABLED=1"
railway domain --service web
railway up --service web --detach
```

- Keep the single quotes around the `DATABASE_URL` value. That's Railway's reference syntax, and it
  must reach Railway unexpanded (in both bash and PowerShell).
- `PUBLIC_URL` defaults to Railway's `RAILWAY_PUBLIC_DOMAIN`. Set it explicitly only for a custom domain.
- Tables are created automatically on first boot.
- The health check is `GET /api/health`.
- Redeploy after code changes with `railway up --service web --detach`, run from `apps/web`.

## Optional variables (defaults in `apps/web/.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `VOTE_DURATION_SEC` | 600 | Voting length |
| `DEPOSIT_WINDOW_SEC` | 600 | Pool deposit window |
| `LAUNCH_DELAY_SEC` | 120 | Gap between pool close and launch |
| `LAUNCH_WINDOW_SEC` | 1800 | Launch window before refunds open |
| `TRANCHE_COUNT` / `TRANCHE_INTERVAL_SEC` | 5 / 300 | Uniform vesting |
| `POOL_CAP_SOL` / `POOL_MIN_SOL` / `PER_WALLET_MAX_SOL` / `MIN_DEPOSIT_SOL` | 20 / 1 / 2 / 0.05 | Pool limits |
| `FEE_BPS` | 100 | Platform fee (1%), launch-only |
| `TEAM_WALLETS` | empty | Comma-separated; flagged in the UI |
| `MODERATION_BLOCKLIST` / `MODERATION_IMPERSONATION` | empty | Extra filtered terms |

## Local

```sh
cd apps/web && npm install && npm run dev                      # embedded PGlite in ./.data, no Postgres needed
node --test --experimental-strip-types src/lib/*.test.ts       # math unit tests
node --experimental-strip-types scripts/sim-e2e.ts http://localhost:3917   # full-flow E2E (see header for timings)
```

## Never

- No mainnet, and no real-money mode, without the owner's explicit decision (D-009).
- No secrets in git. Railway variables only.
- Never set `RATE_LIMIT_DISABLED` on Railway. It exists only for `scripts/demo-seed.ts` (local demo
  data), which must never be pointed at a deployed server.

## UI review tooling (local)

```sh
node --experimental-strip-types scripts/demo-seed.ts           # local demo DB in every stage (./.data/demo)
PGLITE_DIR=./.data/demo npx next start -p 3917
node scripts/shots.mjs http://localhost:3917 <outDir> / /create # screenshots at 1366/1920/2560/390 (Git Bash: MSYS_NO_PATHCONV=1)
```
