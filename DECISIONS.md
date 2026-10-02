# Decisions log

Format: date — decision — why — alternatives considered — decided by.

---

### D-001 · 2026-10-01 · Token release uses uniform vesting (Option A)
- **Decision:** All depositors vest on the same schedule. 1/K of each wallet's pro-rata
  entitlement unlocks at launch, and another 1/K every `tranche_interval`, until K/K.
  Deposit order does **not** affect when tokens unlock. The order index is still recorded
  on-chain and shown in the UI for transparency.
- **Why:** The brief's "first depositors unlock first" creates a speed race at the open of
  the deposit window (bots win the first slot). It also lets early groups sell into later
  groups who are still locked, which reintroduces the PVP the product exists to remove.
  Uniform vesting still staggers sell pressure (only 1/K of the pool's tokens become liquid
  per step).
- **Consequence:** Top-ups within the per-wallet max are allowed. One receipt per wallet;
  every deposit is still emitted as its own event with its own order index.
- **Alternatives:** (B) order-based groups as in the brief; (C) randomised groups. Both
  rejected, see ARCHITECTURE.md §7.
- **Decided by:** owner.

### D-002 · 2026-10-01 · No Railway deploy until there is an app
- **Decision:** Don't provision or deploy anything on Railway yet. The first deploy happens
  once the Phase 3 backend exists, and the owner runs it (per brief §6).
- **Why:** Only docs exist; an idle Postgres would just bill.
- **Alternatives:** provision the project and Postgres now; ship a scaffold now. Both declined.
- **Decided by:** owner.

### D-003 · 2026-10-01 · Phase 1 architecture approved
- **Decision:** `docs/ARCHITECTURE.md` approved with all §13 recommendations (D-004…D-008).
- **Decided by:** owner.

### D-004 · 2026-10-01 · Solana venue: pump.fun on devnet, pluggable launch module
- **Decision:** Phase 2 targets pump.fun (`create_v2` + buy via CPI from one top-level
  `launch` instruction). Launch code is isolated so Meteora DBC can replace it.
- **Before mainnet:** the owner gets written permission from pump.fun (ToS §21(c)/(t)). If
  refused, switch to Meteora DBC.
- **Fallback (§4.3b):** if a PDA can't be `create_v2`'s payer on the current binary, the
  crank keypair pays the create rent (reimbursed) and the vault PDA still does the buy.
- **Decided by:** owner (recommendation accepted).

### D-005 · 2026-10-01 · Chain order: Solana first
- **Decision:** Solana escrow, backend and frontend go through the Phase 5 devnet dry run
  first. Robinhood Chain contracts (Uniswap LiquidityLauncher, Foundry fork tests) follow.
- **Decided by:** owner (recommendation accepted).

### D-006 · 2026-10-01 · Creator-fee split 50 / 30 / 20
- **Decision:** Launchpad creator fees: 50% to depositors pro-rata, 30% to the narrative
  proposer, 20% to the platform. Fixed per escrow at creation and immutable.
  `collect_creator_fees` is permissionless.
- **Decided by:** owner (recommendation accepted).

### D-007 · 2026-10-01 · Platform fee 1%, hard cap 2%
- **Decision:** `fee_bps` = 100, taken from the pool only on a successful launch. Refunds
  are always 100%. `MAX_FEE_BPS` = 200 is a compile-time constant.
- **Recipient:** a devnet placeholder for now. The owner provides the mainnet address,
  ideally a multisig.
- **Decided by:** owner (recommendation accepted).

### D-008 · 2026-10-01 · Escrow creation gated by the operator key
- **Decision:** Only the operator key can call `create_escrow`, within config bounds. The
  operator cannot move funds.
- **Dev env:** WSL2 (needs virtualization) plus a private GitHub repo for CI.
- **Decided by:** owner (recommendation accepted).

### D-009 · 2026-10-01 · Ship a simulation build to Railway now
- **Decision:** The owner asked to launch and ship to Railway before the Solana toolchain is
  available, so the app (backend + frontend) is built against a `mock` ChainAdapter.
  Votes are real wallet-signed messages. Deposits, launch, claims and refunds are simulated
  with the same math as the escrow, and no real funds move. A permanent "SIMULATION" banner
  is shown.
- **Why:** The escrow program is written but can't be compiled on this PC yet (virtualization
  is off). The app layer is chain-agnostic, so it can be built and deployed now and switched
  to `CHAIN=solana` later.
- **Not decided:** real-money mode, either the escrow (recommended) or a disclosed custodial
  wallet. A custodial mode, if chosen, must say "custodial" in the UI; never "escrow".
- **Deviation:** Phase 3/4 work starts before Phase 2 is verified. Supersedes D-002.
- **Decided by:** owner.

### D-010 · 2026-10-01 · One Next.js service for v1
- **Decision:** `apps/web` holds the UI, API routes, SSE and the scheduler in one Node process.
  Data access is raw SQL that runs on Postgres (Railway) and on embedded PGlite (local, no
  install). The planned split into `apps/server` + `packages/*` waits until there's a reason.
- **Why:** One Railway service plus Postgres is the simplest thing to run and debug. The
  chain-adapter boundary (`src/lib/chain`) is kept, so `CHAIN=solana` drops in later.
- **Decided by:** Claude (implementation detail; owner can override).

### D-011 · 2026-10-01 · Simulation build deployed to Railway
- **Live:** https://web-production-776f2.up.railway.app (Railway project `narrativepad`,
  services `web` + `Postgres`, workspace "vayncs2-cloud's Projects").
- **Variables:** `CHAIN=mock`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `PUBLIC_URL`,
  `NEXT_TELEMETRY_DISABLED=1`. All timings and limits are at their defaults.
- **Redeploy:** from `apps/web`, `railway up --service web --detach`.
- **Follow-up:** Railway deprecates `railway.json` (works until 2026-12-01); migrate with
  `railway config migrate`.
- **Decided by:** owner ("deploy to railway").

### D-012 · 2026-10-01 · Full-screen terminal layout
- **Decision:** No fixed-width column.
  - Desktop uses an app shell: a fixed frame where the main area scrolls.
  - The home page is a full-height board with four stage columns plus a right rail at ≥1920px.
  - The root font size is fluid (`clamp(14px, 0.25vw + 11.5px, 18px)`), so the whole rem-based
    UI scales with the screen.
  - Narrative pages use a hero with stage stats, a ballots grid, and pool/lock/activity side
    panels (side by side at ≥1920px).
- **Why:** Owner feedback: "fix the scaling issue, everything has to be filled".
- **Verified:** Playwright screenshots at 1366, 1920, 2560 and 390 px with seeded local data.
- **Decided by:** owner (request) + Claude (design).

### D-013 · 2026-10-02 · UI redesign: explain first, then the board
- **Decision:**
  - The home page now opens with a hero that says what narrativepad is, shows the 6-step
    lifecycle with real config timings, and lists the four guarantees (non-custodial,
    same price, locked hash, 100% refunds). The live board comes after it.
  - The fixed app shell from D-012 is replaced by normal page scrolling with a sticky header
    and a footer. Pages stay full-width and keep the fluid root size. Board columns size to
    their content, up to about one viewport tall, and scroll inside.
  - D-009's simulation notice is back as a permanent top banner. Before, it had shrunk to a
    "Preview" chip that was hidden on mobile. Pool panels also say the deposit is simulated,
    and How it works has an "About this preview" section.
  - Visual language: sentence-case panel titles in place of uppercase micro-labels, numbers
    in Geist with tabular figures (monospace only for hashes), a solid accent button, and
    Instrument Serif italic for the headline accent.
  - Coin page: pool and lock in the right rail, ballots and activity on the left. On phones
    the pool comes right after the coin header.
- **Why:** Owner feedback: the site "looks weird" and isn't "reassuring of what it is".
  An empty live site showed rows of zeros and four blank full-height columns, with no
  explanation below 1920px.
- **Supersedes:** D-012's app shell and its ≥1920px home rail. The rail now shows only top
  pools and creators.
- **Verified:** Playwright screenshots at 1440, 1920 and 390 px, empty and seeded.
- **Decided by:** owner (request) + Claude (design).
