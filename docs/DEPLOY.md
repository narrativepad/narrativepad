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
| `VOTE_DURATION_SEC` | 180 | Voting length |
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

## Devnet escrow program (D-020)

**Live on devnet since 2026-10-02:**
- Program: [`42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY`](https://explorer.solana.com/address/42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY?cluster=devnet).
  - SBPF v0 build from commit `b47777e`, sha256 `cc1fd504…5b82f07`.
  - Deploy tx [`5Ff4…EboK`](https://explorer.solana.com/tx/5Ff4naUD3jiMX1s48dyAycRbU1zMfUMdzoBTsMrRdjci35W15CeBqvGzdBUVS6vyNMHe6nDCfizmU2zmtbFZEboK?cluster=devnet).
- Config PDA: `4VctDfP7cj6xVa2m34HR1sVyG4tT4wbuHV1UZfRAnWk5`.
  - Settings: 1% fee, creator fees 30% proposer / 20% platform, max pool 0.5 SOL.
  - [init tx](https://explorer.solana.com/tx/13mF48Sb8SNdrr9nj5iWzM2DPxKsrh968tT4nRou8FHY2KR9d3ADAthka4yw5NKwyVsK3KSsJJ5Ecf6zrG7mypa?cluster=devnet).

CI builds and tests the program, then publishes the build as the
[`devnet-build`](https://github.com/narrativepad/narrativepad/releases/tag/devnet-build) pre-release.
It is deployed from the owner's machine with the Solana CLI (Windows works; no WSL needed), so no
key ever goes to GitHub or anywhere else.

| Key file (never in git, never printed) | Public address | Role |
|---|---|---|
| `~/.config/solana/narrativepad-devnet.json` | `8JU2abVm7cNS7FQwegZyEGyC7BkaJXzdAmBATLg84Wed` | Pays for deploys; devnet upgrade authority |
| `target/deploy/narrative_escrow-keypair.json` | `42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY` | Program address (`declare_id!`) |

Devnet SOL is free: https://faucet.solana.com (the CLI `solana airdrop` is usually rate-limited).

```powershell
cd C:\Users\kacpe\ai\narrativepad
$key = "$env:USERPROFILE\.config\solana\narrativepad-devnet.json"
curl.exe -sSL -o "$env:TEMP\narrative_escrow.so" https://github.com/narrativepad/narrativepad/releases/download/devnet-build/narrative_escrow.so
curl.exe -sSL https://github.com/narrativepad/narrativepad/releases/download/devnet-build/narrative_escrow.so.sha256   # compare:
(Get-FileHash "$env:TEMP\narrative_escrow.so" -Algorithm SHA256).Hash.ToLower()
solana balance -k $key --url devnet
# Only when the new build is bigger than the program account (see "solana program show": Data
# Length). D-023's build is 656,128 bytes against 510,208, so extend once by 150,000 (~0.76 SOL).
solana program extend 42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY 150000 -k $key --url devnet
solana program deploy "$env:TEMP\narrative_escrow.so" --program-id target\deploy\narrative_escrow-keypair.json -k $key --url devnet
solana program show 42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY --url devnet
```

Then the one-time setup, signed by the upgrade authority (operator key:
`~/.config/solana/narrativepad-devnet-operator.json`, address `Atj9Fqh2Xn9ut7Jtu16jMAYmtvL3e9UFtUXaUYL61sH9`;
devnet treasury = the deploy key):

```powershell
cd apps\web
node scripts/devnet-init-config.mjs $key Atj9Fqh2Xn9ut7Jtu16jMAYmtvL3e9UFtUXaUYL61sH9 8JU2abVm7cNS7FQwegZyEGyC7BkaJXzdAmBATLg84Wed 0.5
```

Then the launch lookup table (operator key; prints `LAUNCH_ALT`). Live: `GRiWun6iNxYFuKiyBTLtK1nxR5QoREBisicRc5QXR6yL`.

```powershell
node --experimental-strip-types scripts/devnet-create-alt.ts "$env:USERPROFILE\.config\solana\narrativepad-devnet-operator.json" 8JU2abVm7cNS7FQwegZyEGyC7BkaJXzdAmBATLg84Wed
```

### The site on devnet (CHAIN=solana, D-021)

Railway variables: `CHAIN=solana`, `LAUNCH_ALT=<table>`, and the pool limits the program
allows on devnet: `POOL_CAP_SOL=0.5`, `POOL_MIN_SOL=0.1`, `PER_WALLET_MAX_SOL=0.25`,
`MIN_DEPOSIT_SOL=0.01`. `HELIUS_API_KEY` (already set) makes the server use Helius devnet.

**Order matters when the escrow's accounts change:** upgrade the devnet program first, then
deploy the site. The site from D-024 on passes the D-023 `PoolQuote` account, which the older
program doesn't expect in `launch`.

The secret operator key goes from its file straight into Railway, without being printed:

```powershell
$k = (Get-Content -Raw "$env:USERPROFILE\.config\solana\narrativepad-devnet-operator.json").Trim()
railway variables --service web --set "OPERATOR_KEYPAIR=$k" --skip-deploys *> $null; $LASTEXITCODE
```

Full on-chain check against a local server (see the script header for the env):
`node --experimental-strip-types scripts/devnet-e2e.ts http://localhost:3921 <funder-keypair.json>`.
Keep the operator topped up with devnet SOL (`solana transfer Atj9… 0.5 -k <deploy key> --url devnet`).

The same `deploy` command upgrades the program later. Mainnet uses a different authority (a
multisig with a timelock) and only after an external audit; see ARCHITECTURE.md (Q10) and CLAUDE.md.

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
