# Narrativepad — working rules

Community memecoin launchpad: the crowd votes on a coin's metadata, then buys it together
through a public, non-custodial on-chain escrow. Full brief: `docs/BRIEF.md`.
Architecture: `docs/ARCHITECTURE.md`. Decision log: `DECISIONS.md`.

## Process
- Work in phases (see brief §7). STOP and ask the owner before every big step and at the end
  of every phase. At each stop, report what changed, what's risky, and what's next.
- Log every non-trivial decision in `DECISIONS.md` (date, decision, why, alternatives).
- If something in the brief is impossible or unsafe, say so and propose the closest safe
  alternative. Never fake it.

## Hard safety rules
- Never put private keys, seed phrases, API keys or other secrets in code, chat, logs or git.
  Secrets live only in env vars (`.env` is gitignored; `.env.example` holds names only).
- Devnet/testnet only. Never deploy to mainnet. Before mainnet: write SECURITY.md, then stop
  and tell the owner to get an external audit.
- Escrow is non-custodial: no admin withdraw, no code path that lets anyone except the
  depositor (refund) or the launch/claim logic move user funds. Refunds must never be
  blockable.
- The chain is the source of truth for money. The DB is a cache; if they disagree, the
  chain wins.
- Upgrade authority: ask the owner before deciding anything for mainnet (time-lock or
  renounce).

## Repo layout
- `programs/narrative_escrow` — Anchor program (Solana). Written, not yet compiled (needs WSL2).
- `tests/mock_pump` — TEST-ONLY pump.fun stand-in for LiteSVM. Never deploy.
- `apps/web` — Next.js app: UI + API + SSE + scheduler (D-010). `CHAIN=mock` simulation for now (D-009).
  - `src/lib/math.ts` mirrors `programs/narrative_escrow/src/math.rs`. Change both together.
  - `src/lib/chain/` is the ChainAdapter boundary (mock now, solana next).
- `contracts/` — Foundry project (Robinhood Chain), not started (D-005).
- Deploy: `docs/DEPLOY.md`. Owner runs Railway deploys.

