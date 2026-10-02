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

### D-020 · 2026-10-02 · Devnet deploys: built by CI, deployed from the owner's PC
- **Decision:** CI builds and tests the program and publishes the passing build as the
  `devnet-build` pre-release (a public download; artifacts need a login). It is deployed from the
  owner's PC with the Solana CLI, which is already installed there (no WSL needed for this).
- **Keys:**
  - A throwaway devnet key (`~/.config/solana/narrativepad-devnet.json`, address
    `8JU2…4Wed`) pays for deploys and is the devnet upgrade authority. It was created on the
    owner's PC with `solana-keygen --silent`, so its secret was never printed, committed or
    sent anywhere.
  - The program address `42bw…bVrY` comes from the existing `target/deploy` key file
    (gitignored).
- **Why not a GitHub secret:** the key would leave the owner's machine, and the owner would
  have to paste it into GitHub. This way the owner only clicks the devnet faucet once.
- **Alternatives:** deploying from CI with a secret; building locally (needs WSL2 for Anchor).
- **Mainnet is unchanged:** different authority (multisig plus timelock), and only after an
  external audit.
- **SBPF v0:** the first deploy was refused before anything was sent ("sbpf_version … not
  enabled").
  - Agave 4.x builds SBPF v3 by default, but v3 deployment (SIMD-0161, feature `C8XZNs1b…`) is
    inactive on devnet and mainnet. The LiteSVM tests passed only because LiteSVM enables
    every feature.
  - `scripts/test-program.sh` now rebuilds both programs with `--arch v0`, fails the build
    unless the ELF header says v0, and runs the tests against that exact file.
- **Deployed:**
  - The v0 build from `b47777e` (sha256 `cc1fd504…`) is live on devnet at `42bw…bVrY`,
    upgrade authority `8JU2…4Wed`.
  - `init_config` is done: config `4Vct…nWk5`, operator `Atj9…1sH9`, treasury = deploy
    key, 1% fee, 30/20 creator split, max pool 0.5 SOL.
  - Verified by reading the program and config accounts back from devnet.

### D-021 · 2026-10-02 · The website on devnet (CHAIN=solana)
- **Decision:** a real `ChainAdapter` for the deployed escrow, plus a wallet-signed deposit in
  the browser. The instruction builders, PDAs and decoders live in `src/lib/solana/escrow.ts`,
  written by hand from the published IDL like the program's own pump CPI (no Anchor client),
  and are shared by the browser and the server.
- **Who signs what:**
  - **Deposit:** the depositor's wallet. One transaction carries a memo with the holder-rewards
    vote, then the deposit, so the vote is signed by the depositor and lives on-chain next to
    the deposit (anyone can recount it).
  - **Create escrow:** the operator key (`Atj9…1sH9`, Railway env `OPERATOR_KEYPAIR`).
  - **Launch:** the operator as cranker, as a v0 transaction with the address lookup table
    `GRiW…6yL` (`LAUNCH_ALT`); ~40 accounts don't fit a legacy transaction. pump's fee
    recipients are read from its Global at launch.
  - **Claim and refund:** pushed by the server after a signed message. The program allows
    anyone to send them and pays only the depositor. When a pool can't launch, the scheduler
    refunds every depositor automatically.
- **Chain is the source of truth:**
  - `sync` reads the escrow account (totals) and every new escrow transaction (`Deposited`,
    `Claimed`, `Refunded`, `Launched` events plus the vote memo) into the cache tables.
  - It runs from the scheduler (every 8s per open pool) and right after a browser deposit
    (`POST /api/narratives/[id]/sync`).
- **Safety:**
  - The adapter checks the RPC's genesis hash and refuses anything but devnet.
  - The RPC URL (it may carry a Helius key) and the operator key never reach the browser or
    the logs.
  - Simulated escrows keep their "preview" labels; only `chain = 'solana'` escrows show
    addresses and explorer links.
- **Devnet limits:**
  - pool cap ≤ 0.5 SOL (config), pool minimum ≥ 0.1 SOL (program).
  - pump has holder rewards switched off on devnet, so devnet coins launch with them off;
    the vote is still recorded and shown.
  - Only SOL pairs launch.
- **Alternatives:** Anchor's TS client (heavier, and it pins web3 versions); server-side
  deposits (custodial, rejected); an indexer service (overkill for devnet; `sync` is enough
  for now).

### D-022 · 2026-10-02 · Holder-rewards vote enforced by the escrow program
- **Decision:** the pool's vote is part of the program, not just recorded by the site.
- **How it works:**
  - **Deposit:** `deposit(amount, holder_rewards)`. The program adds `amount` to `on` or `off`
    in a per-escrow `HolderVote` PDA (`["holder_vote", escrow]`).
  - **Separate account:** the tally lives in its own account rather than new `Escrow` fields,
    so escrows created before the upgrade keep their layout. `create_escrow` creates the
    account (the operator pays); for older escrows the first new deposit creates it.
  - **Launch:** `is_holder_reward = on > off && pump Global.is_holder_reward_enabled`.
    - A tie is off.
    - If pump has the feature off (devnet today), the coin launches with it off instead of
      failing with `HolderRewardDisabled`.
    - The curve-creator post-check expects pump's `["holder-rewards", mint]` PDA when on.
    - The result is stored as `HolderVote.applied` and emitted in `Launched` (with the
      tally).
  - **Distribution:** with holder rewards applied, `distribute_creator_fees` gives 100% of
    vault income to depositors (no proposer or platform share). pump pays holder rewards to
    token holders, and the vault holds tokens for depositors while they vest.
  - **Can't skip the vote:** `launch` and `distribute` take the vote account at its PDA
    (seeds-checked). A missing account (older escrow, no new deposit) counts as no vote.
  - **The site:** the deposit memo is gone; the vote is the instruction argument. `sync`
    reads tally and result from `HolderVote`, and the launch predicts the outcome to pass
    pump the right creator vault.
- **Tests:** new LiteSVM cases cover:
  - the tally;
  - "on" winning by SOL against more wallets;
  - a tie or an "off" majority;
  - the fallback when pump has the feature off;
  - a launch with the wrong creator vault being rejected;
  - escrows from before the vote;
  - a swapped vote account (`ConstraintSeeds`);
  - distribution with holder rewards on.

  The mock pump now enforces the Global flag and the creator vault like pump.
- **Deployed:** upgrade from `59d65aa` (499,360 bytes; program data extended by 40,000).
  The site deployed right after, because the launch account layout changed.
- **Still open for mainnet:** pump pays holder rewards through its own off-chain distributor.
  Whether that includes the vault while tokens vest needs confirming with pump before mainnet.

### D-023 · 2026-10-02 · Non-SOL pairs: token pools, swapped by each depositor
- **Decision:** a coin paired with a token (USDC, NVDAx, WBTC…) gets a pool that holds that
  token. Each depositor's wallet swaps into it when joining; the escrow never swaps the pool.
  Chosen by Claude after the owner left the call to it ("idk what's easier better").
- **Why not swap the pool at launch:**
  - one large, predictable swap of the whole pool can be sandwiched by whoever triggers the
    launch; guarding against that needs an on-chain price oracle (stock prices freeze out of
    market hours);
  - Jupiter and xStocks don't exist on devnet, so it could never be tested before mainnet;
  - a swap route plus pump's ~40 accounts is close to the per-transaction account limit.

  Each depositor making their own small swap has none of these problems, and the launch
  stays one fair buy at one price.
- **Program (stage 1):**
  - **Pool token:** a `PoolQuote` PDA (`["pool_quote", escrow]`) records the token. No
    account means a SOL pool, so existing escrows are untouched. `create_token_escrow` (the
    operator pays all rents) also creates the vault's token account.
  - **Moving the token:** `deposit_token`, `refund_token` and `claim_token` move the token
    and share the caps, receipts, ordering and holder-rewards vote with the SOL path.
    `deposit_token` requires that the vault received exactly the amount sent.
  - **Refunds:** `refund_token` recreates a closed token account at the caller's cost, so a
    depositor closing it can't block their refund.
  - **Launch:**
    - passes pump the quote accounts (plus pump's quote-control PDA when the token isn't on
      Global's whitelist);
    - takes the 1% fee in the token to the treasury's token account;
    - buys with the whole pool after the fee;
    - borrows the SOL for rents from whoever triggers it and returns the unused part in the
      same instruction.

    The same post-checks apply, measured in the token.
  - **Units never mix:** the SOL `deposit`, `refund`, `claim` and `distribute_creator_fees`
    take the `PoolQuote` PDA and refuse token pools (`TokenPool`); the token instructions
    can't find a `PoolQuote` on SOL pools.
- **Known limits:**
  - a token-paired coin's creator fees arrive in the token and have no distribution
    instruction yet; they stay in the escrow until one is added;
  - an issuer that can pause or claw back its token (xStocks carry pausable and
    permanent-delegate extensions; USDC can freeze) could block a token pool's refunds or
    deposits. SOL pools have no such dependency, and the UI must say so on token pools.
- **Next stages:**
  - (2) the website runs USDC pools on devnet (Circle's devnet USDC is pump's devnet
    whitelisted quote);
  - (3) "pay with SOL" via Jupiter on mainnet: the wallet swaps and deposits in one
    transaction.
- **Decided by:** owner ("start devnet", "why can't it happen without my wallets") + Claude.

### D-024 · 2026-10-02 · The creator picks the pair; USDC pools on the site (D-023 stage 2)
- **Decision:**
  - Whoever starts a narrative picks its pair; there is no pair ballot.
  - The pair is part of the signed create message and stored on the narrative, then committed
    in the lock (`launch.pair`, `launch.pairMint`) as before.
  - Name, ticker and image are still voted.
- **Why:** owner ("make the guy that makes narrative still add a pair himself"). It also fits
  D-023: a token pool holds the pair token, so the pool's currency must be known before
  anyone deposits, which a vote that ends at lock time can't give.
- **Which pairs can be picked:**
  - SOL and USDC, on both the simulation and devnet (`POOL_PAIRS` in `pairs.ts`).
  - Every other pump.fun pair is listed with its logo but locked ("Mainnet"). Tokenized
    stocks and wrapped coins don't exist on devnet. On mainnet they need "pay with SOL"
    (stage 3).
  - The server rejects a locked pair, so the API can't be used to get around the UI.
- **Pair picker:**
  - A search dialog replaces the plain select box: search, All / Crypto / Stocks tabs, open
    pairs first, keyboard navigation, and a bottom sheet on phones.
  - Logos are bundled in `public/pairs/<mint>.webp` (96×96, ~186 KB for all 41), downloaded
    by `scripts/pair-logos.mjs` from each token's own metadata image (xStocks, Backpack,
    Hex Trust) or the Solana token list (SOL, USDC, WBTC, WETH).
  - Bundled logos mean no hotlinking. A pair pump.fun adds later gets its metadata image
    live, or a monogram.
  - **pump.fun's list grew from 40 to 191 pairs the same day.** It added about 20 more
    Backpack stocks, the PUMP token (D-019 said it wasn't accepted; it is now) and roughly 120
    community coins.
    - Their logos live on arbitrary hosts and some are broken (a 404 and a non-image failed CI).
    - `pairLogos.ts` now fetches each one once on the server, has sharp check that it is an
      image (https only, 5 MB cap, no private hosts) and shrinks it to the same 96×96 WebP.
      It is served from `/api/pair-logo/<mint>`.
    - The list links a logo only once it is cached, so browsers never load from third-party
      hosts and never hit a broken image. About 100 of the 151 new pairs get a logo; the rest
      get a monogram.
    - The cache lives on `globalThis`, like the database, because Next bundles pages and
      route handlers separately.
    - `sharp` is now pinned as a direct dependency; it was only a transitive one through Next.
- **USDC pools on the site:**
  - Every escrow row records its pool token (`quote_*` columns; NULL = SOL).
  - Every amount is shown in the pool's unit (`units.ts`): pool cards, panel, charts,
    holders, activity, alerts, portfolio and profile.
  - Totals are summed per currency and never added across SOL and USDC. The leaderboard's
    "raised" counts SOL pools only, and top pools rank by how full they are.
  - Devnet uses Circle's devnet USDC (`4zMMC9…DncDU`, SPL Token, 6 decimals).
  - Deposits are wallet-signed `deposit_token` from the depositor's token account. Launch,
    claim and refund use the token instructions.
  - Token pools show a warning: the issuer can freeze USDC, which would hold up deposits and
    refunds.
- **Limits (`POOL_CAP_USDC` etc.):**
  - Defaults are cap 8, minimum 1, 4 per wallet and 0.5 minimum deposit (USDC).
  - pump's devnet USDC curve starts with only 4.292 USDC of virtual reserves (mainnet:
    4,292), so the escrow's 90% fill check stops a devnet pool at about 8.5 USDC. A unit test
    pins this.
- **Fits as is:** a USDC launch is 990 bytes with the existing lookup table (limit 1232), so
  no new table is needed.
- **Also fixed:**
  - The site's program error table lacked the four D-023 errors.
  - Live alerts for on-chain deposits showed "0 SOL".
- **Order of deploys:** the site's SOL instructions now pass the `PoolQuote` account and
  launch puts it before pump's accounts. The devnet program must be upgraded to the D-023
  build (`5c6ca42`, sha256 `8f21d8c9…`) **before** this site deploys, or launches fail. The
  new build is 656,128 bytes and the program data holds 510,208, so it needs
  `solana program extend` first (DEPLOY.md).
- **Verified:**
  - `sim-e2e.ts` 23/23: USDC pick, NVDAx refused, no pair ballot, USDC limits, deposits, vote
    in USDC, launch with a 0.04 USDC fee and no reserve, and a USDC refund.
  - `ui-e2e.mjs` 68/68, with the picker driven in the browser and a USDC pool deposited and
    refunded through the UI.
  - Unit tests 13/13, typecheck and production build.
  - `devnet-e2e.ts` gained a USDC run (needs the upgraded program and 3 devnet USDC on the
    funder); not run yet.
- **Decided by:** owner (the creator picks the pair, logos in the picker, "make it premium
  like pump.fun", "do whatever you need to make it work") + Claude (design).
- **Deployed (2026-10-02, by Claude at the owner's request):**
  - Program: extended by 150,000 bytes, then upgraded to the D-023 build (sha256
    `8f21d8c9…`) in slot 506766333. Tx `biLWcsYP…3S`. The dumped program is byte-identical to
    the release build.
  - Site: Railway deployment `278ce9a4` went live right after; rollback point `9995d84b`.
  - `devnet-e2e.ts` 8/8 against the upgraded program on SOL pools: escrow, ordered deposits,
    DepositTooSmall, launch on pump devnet, claim, automatic refund. Launch tx
    `24nXiczp…ZeM`.
  - A USDC pool opened on devnet with the right `PoolQuote` (devnet USDC, 6 decimals) and
    vault token account; the site read pump's devnet curve (4.292 USDC).
  - Not yet on devnet: USDC deposits, launch, claim and refund. They need devnet USDC from
    faucet.circle.com on the funder (`8JU2…4Wed`). They are covered by the LiteSVM program
    tests and the simulation.

### D-025 · 2026-10-02 · No USD pairs
- **Decision:** narrativepad offers no USD pairs. USDC is filtered out of the pair list
  (`HIDDEN_PAIRS` in `pairs.ts`), so it can't be picked in the UI or through the API. SOL is
  the only pair open now; stocks and other coins stay listed, locked until mainnet.
- **Why:** owner ("i dont want usd pair").
- **What stays:**
  - The token-pool machinery (D-023 program, `quote_*` columns, token deposit, launch,
    claim and refund in the site, per-unit display). Tokenized stocks and other coins need it
    on mainnet.
  - USDC was only ever used as the devnet stand-in for testing it.
- **What goes:**
  - The USDC currency in `pools.ts` and the `POOL_*_USDC` settings.
  - USDC copy and the Circle faucet links.
  - The USDC parts of the simulation, browser and devnet tests.
- **Risk:** the site's token-pool path has no end-to-end test now. The program's LiteSVM
  tests cover token pools. The site path must get its own test before stocks open (stage 3);
  stocks don't exist on devnet, so that needs a mainnet fork or LiteSVM run of the site's
  instruction builders.
- **Verified:** unit 12/12, `sim-e2e.ts` 21/21 (USDC refused like any locked pair),
  `ui-e2e.mjs` 67/67 with the live 191-pair list (searching "USDC" finds nothing), smoke clean.
- **Decided by:** owner.

### D-026 · 2026-10-03 · Smaller launch reserve; coin metadata that doesn't point at the site
- **Launch reserve 0.05 → 0.02 SOL; SOL pool floor 0.1 → 0.03 SOL (program).**
  - A real devnet launch used 0.0093 SOL of rent. The 0.05 SOL reserve held back about half of
    a small pool, so a lone 0.1 SOL pool bought with only 0.049 SOL.
  - With 0.02 SOL (about 2× the measured rent), a 0.1 SOL pool buys with 0.079 SOL, and pools
    down to 0.03 SOL can launch.
  - Unused reserve still goes back to depositors on claim (non-custodial; it can't go to the
    platform).
  - Deposits can be as small as 0.01 SOL (`MIN_DEPOSIT_SOL`, already a setting).
  - A single 0.01 SOL deposit can't launch a coin on its own: the rent alone is about that
    much. The operator would have to pay it, which was offered and not chosen.
- **Coin metadata names nothing but the coin (owner: "no indication it was launched from that
  website").**
  - `createdOn` (a link to the coin page) is removed from the metadata.
  - With `PINATA_JWT` set, the winning image and the metadata JSON are pinned to IPFS and
    referenced as `https://ipfs.io/ipfs/<cid>`, like coins created on pump.fun itself.
  - Without it, the metadata is still served from `/api/metadata` (devnet, simulation).
  - A pin failure leaves the narrative in voting and retries; it never locks with the
    site's URLs.
- **Mainnet mode was requested and not built.** Switching the chain adapter from devnet-only
  to mainnet was blocked by Claude's permission settings, in line with CLAUDE.md
  ("Devnet/testnet only. Never deploy to mainnet"). The partial config change was reverted.
  Lifting that is the owner's decision.
- **Decided by:** owner (0.1 pool → "0.02 for fees, then 0.07–0.08 buy"; no link to the site)
  + Claude.
