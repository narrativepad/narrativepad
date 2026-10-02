# Contributing to narrativepad

Thanks for helping build the launchpad where the crowd builds the coin. This project moves (or will move) other people's money, so a few rules are non-negotiable.

## Ground rules

- **Devnet and testnet only.** Nothing in this repo deploys to mainnet. Mainnet happens only after `SECURITY.md` and an external audit.
- **No secrets, ever.** No private keys, seed phrases or API keys in code, commits, issues, logs or chat. Configuration is environment variables; `.env` is git-ignored and `.env.example` holds names only.
- **Non-custodial or nothing.** No admin withdraw, and no code path that lets anyone except the depositor (refund) or the launch and claim logic move user funds. Refunds must never be blockable.
- **The chain wins.** The database is a cache. If it disagrees with the chain, the chain is right.
- **Math stays mirrored.** `apps/web/src/lib/math.ts` mirrors `programs/narrative_escrow/src/math.rs`. Change both in the same pull request.
- **Decisions are written down.** Any non-trivial choice gets an entry in [`DECISIONS.md`](DECISIONS.md): date, decision, why, alternatives, who decided.

## Development

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3000, embedded PGlite, no database to install
```

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

The end-to-end suites (`scripts/sim-e2e.ts`, `scripts/ui-e2e.mjs`, `scripts/smoke.mjs`) and the escrow program tests run in GitHub Actions on every push. To run the program tests locally you need WSL2 with `scripts/setup-wsl.sh`, then `scripts/test-program.sh`.

## Pull requests

- Keep them focused: one change, with its tests.
- Explain *why* in the description, and link the `DECISIONS.md` entry if there is one.
- UI changes: include before and after screenshots on desktop and phone.
- Escrow program changes: list every way funds can move after your change, and add tests for caps, ordering, refunds, launch failure, double-claim, rounding dust and signer/PDA checks as relevant.

## Reporting security issues

Please don't open public issues for vulnerabilities. See [`.github/SECURITY.md`](.github/SECURITY.md).
