# narrativepad web

The Next.js app behind [narrativepad](../README.md): UI, API routes, the live event stream (SSE) and the stage scheduler, in one Node process ([D-010](../DECISIONS.md)).

```bash
npm install
npm run dev            # http://localhost:3000
```

Locally it uses embedded PGlite, so there's no database to install. In production it uses `DATABASE_URL` (Postgres on Railway).

| | |
|---|---|
| `src/app` | Pages and API routes. `n/[slug]` is the coin page; `api/` holds the signed actions, the live stream and the read endpoints. |
| `src/components` | UI building blocks: hero, coin cards, command palette, live alerts. |
| `src/lib/chain` | The chain adapter boundary: `mock` today, `solana` next. |
| `src/lib/math.ts` | BigInt mirror of the escrow's math. Change it together with `programs/narrative_escrow/src/math.rs`. |
| `scripts` | Demo seed, end-to-end suites, smoke test, brand asset renderer. |

Configuration names live in [`.env.example`](.env.example). Deploying: [`docs/DEPLOY.md`](../docs/DEPLOY.md).
