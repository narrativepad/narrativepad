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

### D-014 · 2026-10-02 · Premium visual pass
- **Decision:**
  - Monochrome base: neutral near-black, white type, and white pill buttons for navigation
    and creation. Green is kept for money actions and live states. Panels and cards use a
    top-lit gradient hairline instead of solid borders, over a faint grain and grid with a
    soft spotlight.
  - Hero: no box around it. Large silver headline with the serif accent, and an animated
    "crowd → coin" illustration (avatars orbiting and flowing into a coin; pure CSS, no
    data). The logo is now a coin mark that matches it.
  - Explore: the four kanban columns are replaced by stage tabs plus a grid of image-first
    coin cards (blurred artwork backdrop, big coin, stage-specific footer). A spotlight
    card shows the next coin to launch, and the empty board is one designed state instead
    of four blank columns.
  - How it works on home: six illustrated tiles (decorative, no data) plus four
    guarantee tiles.
  - Coin page: larger header with a joined stats strip and a segmented progress bar.
    Deposit and claim use the green money button.
- **Why:** Owner feedback after D-013: "still very poor ui, no premium feeling at all."
- **Supersedes:** D-013's board columns and the ≥1920px home rail.
- **Decided by:** owner (request) + Claude (design).

### D-015 · 2026-10-02 · Feature pack: chat, trending, alerts, portfolio, palette
- **Decision:** the owner picked all eight proposed features. Choices made while building them:
  - **Chat:** a new `comments` table and a signed `comment` action, built like votes (nonce,
    ed25519, rebuilt message). Single line, up to 500 characters, same blocklist as pitches,
    6 per wallet per minute, and hidden after 3 reports (`report` accepts `comment`).
    Badges: creator, team, and "in pool" (has unrefunded SOL in the pool).
  - **Trending:** a momentum score over the last 15 minutes: votes + 0.5 × messages +
    3 × deposits + 2 × SOL deposited. The top three get a "Hot" badge.
  - **Live alerts:** the SSE events for deposits, new narratives and launches now carry the
    public wallet and amount, and other people's actions show as pop-ups. Muting is stored
    per browser.
  - **Reminders and watchlist:** kept in the browser's localStorage, not the DB. Reminders fire
    only while a narrativepad tab is open, and the button says so. There's no push server,
    so nothing personal is stored server-side.
  - **Portfolio:** `/api/portfolio?wallet=` returns public per-wallet positions, using the
    same position maths as the coin page. "Claim all" signs one message per coin.
  - **Bonding-curve chart:** drawn from the pump.fun constants in `math.ts`. It shows the
    pool's buy and the next buyer's price; it is not market data.
  - **Loading skeletons:** only on the home page (in the `(home)` route group) and the
    leaderboard. A loading boundary above a page that calls `notFound()` makes Next stream a
    200, which would break real 404s for coin and profile pages.
  - Overlays (palette, lightbox) render through a portal, and entry animations use fill
    `backwards`, so a finished animation or a header backdrop-filter can't trap
    position:fixed content.
- **Verified:** `sim-e2e.ts` 19/19, `ui-e2e.mjs` 61/61 with no console errors, and `smoke.mjs`
  passing with real 404s.
- **Decided by:** owner (feature list) + Claude (implementation).

### D-016 · 2026-10-02 · Live chat per narrative for coordination
- **Decision:** the coin chat becomes a live room.
  - **Limits:** text only, up to 300 words (2,000 characters) and 30 lines; line breaks
    allowed. No images, uploads, embeds or link previews, and links stay plain text.
    Control characters are rejected. The client normalises the text (CRLF, trailing spaces,
    blank-line runs) before signing, and the server rejects anything not already normalised,
    so what's stored is exactly what was signed.
  - **Live delivery:** one `ChatProvider` per coin page listens on
    `/api/stream?n=<id>&presence=1` and fetches only new messages from
    `GET /api/narratives/[id]/comments?after=`. On reconnect it catches up after the stream's
    "hello". The page no longer reloads on chat events.
  - **Presence:** connections opened with `presence=1` are counted in memory per narrative and
    the count is pushed to everyone in that room ("N here now"). This is accurate on one
    instance; it needs a shared store if the service ever scales out.
  - **Dock:** a floating "Live chat" launcher on every coin page shows the headcount and an
    unread badge. It opens as a panel on desktop and a full-screen sheet on phones. The
    Live chat tab and the dock share one state.
  - Moderation is unchanged (blocklist, 6 messages per wallet per minute, hidden after 3
    reports). Every message is still a signed action.
- **Known trade-off:** guests sign silently, but a connected wallet is asked to sign every
  message. A per-session chat key, authorised once by the wallet, would remove that and is
  a possible follow-up.
- **Verified:** `sim-e2e.ts` 19/19, `ui-e2e.mjs` 62/62 (a second visitor's message arrives
  live, headcount, unread badge, dock), and `smoke.mjs` passes.
- **Decided by:** owner (request: "live chat … max 200–300 words, no pictures") + Claude (design).

### D-017 · 2026-10-02 · Brand: X profile, mascot logo, blue + gold palette
- **Decision:**
  - **Logo:** the @narrativepad X profile picture (megaphone mascot on electric blue),
    fetched at 400×400 through unavatar.io because x.com blocks automated browsers. It
    replaces the "N" coin mark in the header, footer, share images and the hero orbit
    centre. Assets live in `public/brand/` (`logo.png` and `logo-128.png`); the favicon and
    app icons are `src/app/favicon.ico` (48/32/16), `icon.png` (192) and `apple-icon.png` (180).
  - **Palette** (sampled from the logo): blue `#016BFD` for fills, with a lifted `#3D8BFF`
    for text and strokes on black; gold `#FFD032` for serif headlines, coins, stars, "Hot"
    badges and launching. Mint green is gone; a separate green `#3DDC97` remains only for
    the "Live" stage. Stage colours are now voting violet, pooling blue, launching gold and
    live green.
  - **X:** linked in the header (icon) and footer ("Follow @narrativepad"), with
    `twitter:site` and `twitter:creator` set to @narrativepad.
  - **Banner:** `scripts/brand-assets.mjs` renders the X header (`public/brand/x-banner.png`
    1500×500 and `x-banner@2x.png`) and the site-wide default share image
    (`src/app/opengraph-image.png`, 1200×630). The style is minimal: tagline on the left, the
    crowd orbit with gold coins on the right, and the bottom-left kept empty for X's profile
    picture.
- **Verified:** `ui-e2e.mjs` 62/62 and `smoke.mjs` passing; screenshots at 1440 and 390 px.
- **Decided by:** owner (request) + Claude (design).

### D-018 · 2026-10-02 · Launch settings on the ballot; links off; 3-minute voting
- **Decision:**
  - **Venue:** every coin launches on pump.fun. Other venues (e.g. OTC desks) were considered
    and dropped: they are not a public, atomic create-and-buy the escrow can verify.
  - **Pair ballot:** SOL, USDC or USD1. All three are seeded when a narrative is created, so
    nobody can add other values. SOL is first and wins ties. **Only SOL is real for now**:
    the escrow pools lamports, and a USDC/USD1 launch would need the escrow to hold SPL
    tokens and pass that quote mint to `create_v2`. The UI labels the other two "preview only".
  - **Creator-fee ballot:** "split" (the escrow's frozen 50% pool / 30% creator / 20%
    platform split, D-006), "holders" (pump.fun holder rewards, `is_holder_reward`), or any
    Solana wallet someone submits. Split is first and wins ties.
  - **Link ballots off:** X, Telegram and website are no longer shown, submitted or put in the
    coin metadata, and the create form's X field is gone. The code paths stay in
    `LINK_FIELDS` so they can come back. Ballots are now name, ticker, image, pair, fees.
  - **Lock:** `locks.launch = {venue, pair, fees}` is part of the hashed details, so the
    on-chain lock hash commits to it, and "Verify in browser" checks it. Older locks have
    no `launch` and still verify.
  - **Voting:** `VOTE_DURATION_SEC` default 180 (was 600).
- **Not done yet (needs the escrow program, then an audit):** `launch` currently hard-codes
  `is_holder_reward = false` and the escrow as `creator`. Honouring "holders" means setting
  that flag; honouring a voted wallet means passing it as `creator` (or forwarding from
  `distribute_creator_fees`). Both change where money goes, so they go through the program,
  its tests and the audit, not the web app.
- **Risk:** a voted fee wallet is sybil-able. Guest keys are free, so a few hundred throwaway
  keys can vote their own wallet in. Before real money, voting on fees must be weighted or
  gated (e.g. by deposit, or only depositors' votes count) or the wallet option dropped.
- **Verified:** `sim-e2e.ts` 20/20 (pair/fee validation, launch settings in the lock and
  hash, deposit → launch → claims, refund path), `ui-e2e.mjs` 65/65 with no console errors,
  and `smoke.mjs` passing.
- **Decided by:** owner ("only pump but with possibility to choose pair", "crowd votes on
  both", holder rewards or a fee wallet, 3 min) + Claude (design).
- **Superseded in part by D-019:** the pair list and the fee ballot.

### D-019 · 2026-10-02 · Pairs from pump.fun's live list; holder rewards voted by the pool
- **Pairs.** The owner meant pairs like stocks (NVDA) or other coins, not stablecoins. Read
  from mainnet today (pump.fun `Global` + `quote-control`, read-only):
  - pump.fun accepts SOL, USDC (whitelist), WBTC, WETH, HYPE, wXRP, ONDO, and about 33
    tokenized stocks and funds (xStocks such as NVDAx, TSLAx, AAPLx, SPYx, QQQx; Backpack
    Securities such as SpaceX, AMC, Intel).
  - **USD1 is not accepted** (D-018 listed it by mistake). **The PUMP token is not accepted.**
  - The pair ballot starts with SOL (wins ties). Anyone can add a pair, but only one from that
    list. `pumpPairs.ts` re-reads it hourly with keyless JSON-RPC (`PUMP_RPC_URL`, default
    public mainnet) and falls back to the snapshot in `pairs.ts`, so pump.fun adding or
    removing a pair shows up without a deploy.
  - The lock commits `{venue, pair, pairMint}`.
  - **Only SOL launches for real.** For any other pair, the plan is to keep pooling SOL and
    have the escrow swap into the pair token inside the launch transaction. Refunds then
    stay 100% SOL and unblockable, which matters because xStocks are Token-2022 mints with a
    pausable flag and a permanent delegate: if the escrow held them, the issuer could block
    refunds. The swap needs a price guard (oracle or min-out) against sandwiching. Not built.
    Tokenized stocks are also not offered to US persons.
- **Fees: holder rewards on/off, voted by the pool.**
  - The owner wants "cashback on or off". pump.fun deprecated cashback for new coins
    (`create_v2` fails with `CashbackDeprecated`; existing cashback coins keep working).
    Holder rewards (`is_holder_reward`, enabled in `Global` today) replaced it: every trade's
    creator fee goes to the coin's holders, permanently.
  - The fee ballot and the voted fee wallet are gone; that also removes the sybil-wallet risk
    from D-018.
  - Each deposit now carries a holder-rewards vote, weighted by its lamports. The escrow
    tallies it (`holder_votes_on/off`) and settles it at launch: on wins only if it holds
    more SOL, and a tie is off. Free guest keys can't sway it, because weight costs real
    money that then buys the coin; the per-wallet cap bounds any single wallet.
  - **Off** = today's escrow split (50% pool, 30% creator, 20% platform). **On** = all
    creator fees go to holders, so the creator and the platform get none (the platform keeps
    its 1% launch fee).
- **Not done yet (escrow program + audit):** storing the tally on-chain in `deposit`, setting
  `is_holder_reward` at launch, deciding how the escrow vault (a big holder while tokens vest)
  passes holder rewards through to depositors, and the swap-at-launch for non-SOL pairs.
  The simulation implements the tally and the settlement rule, so the program has a spec.
- **Verified:** `sim-e2e.ts` 20/20 (pair validation against the list, 2.5 SOL on vs 2 SOL off
  settles "on" although more wallets said off, a deposit without a vote is rejected),
  `ui-e2e.mjs` 67/67, and `smoke.mjs` passing.
- **Decided by:** owner ("pair … stocks like nvda, pump coin", "turn cashback or not", "you do
  all the thinking") + Claude (design).
