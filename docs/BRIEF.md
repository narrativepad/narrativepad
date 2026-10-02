# Narrativepad — original brief (verbatim, received 2026-10-01)

You are building NARRATIVEPAD — a community launchpad where the crowd designs a memecoin
together and buys it together through a PUBLIC, NON-CUSTODIAL on-chain escrow, so the
coin can't be vamped, sniped or PVP'd. Read this whole brief before writing any code.
Follow CLAUDE.md: stop and ask me before every big step. Never put private keys, seed
phrases or secrets in code, chat, logs or git. Everything goes to devnet/testnet first.

====================================================================
1. THE PROBLEM WE SOLVE
====================================================================
When a good coin idea appears, snipers and copycats (vamps) launch first, insiders
bundle, and the community that made the narrative ends up exit liquidity.
Narrativepad flips it: the community decides EVERYTHING before the coin exists, then
buys it together at launch in one transparent pool. The official coin is the one the
crowd built. There is no limit on how many coins get made — anyone can start a
"narrative" at any time.

====================================================================
2. CORE FLOW (one "Narrative" = one future coin)
====================================================================
Stage 0  PROPOSE   Anyone creates a narrative: a short pitch + a source (tweet/link/meme).
Stage 1  VOTE      Community submits and votes on: name, ticker, image, links (X, TG,
                   site), and pairing/chain where relevant. Each field is its own
                   ballot. Highest votes win when the vote timer ends. Anti-spam: one
                   vote per wallet per field (wallet signs a message, no gas), rate
                   limits, optional min wallet age/balance. Ties -> earliest submission.
Stage 2  LOCK      Winning metadata is frozen and hashed. The hash is stored on-chain in
                   the escrow so nobody (including us) can swap the image/name later.
                   The coin page shows "this is the official one" + the hash.
Stage 3  POOL      A deposit window opens (configurable, e.g. 10-30 min). Users deposit
                   SOL (Solana) or ETH (Robinhood Chain) DIRECTLY INTO THE ESCROW
                   CONTRACT — never into a wallet we control. The contract records
                   depositor address, amount, slot/block, and order index. Per-wallet
                   max deposit and total pool cap are enforced ON-CHAIN.
Stage 4  LAUNCH    ~2-3 min after the window closes, the escrow launches the coin with
                   the locked metadata and uses the pooled funds for the opening buy, in
                   the same transaction/bundle as the create so nobody can snipe ahead.
Stage 5  RELEASE   Tokens bought by the pool are distributed back to the SAME wallets
                   that deposited, pro-rata to their deposit, released in tranches in
                   deposit order (first depositors unlock first), e.g. 5 tranches over
                   N minutes. Users claim (or a permissionless crank pushes). No user-
                   entered destination addresses — tokens go to the depositing wallet.
Refund     If launch fails, the pool is under the minimum, or the launch deadline
           passes, EVERY depositor can withdraw 100% of their deposit themselves.
           No admin action needed. This must be impossible to block.

====================================================================
3. NON-NEGOTIABLE SAFETY / TRUST RULES
====================================================================
- Non-custodial: funds only ever sit in the escrow program/contract. No admin
  withdraw, no upgrade path that can move user funds. If upgradeable, upgrade
  authority must be time-locked or renounced before mainnet — ask me.
- Public pool: every narrative page shows the escrow address, live total, every
  deposit (wallet, amount, time, order), and links to the explorer.
- The opening buy must be clearly labelled on the coin page as "community pool buy",
  with the full depositor list, so traders don't read it as an insider bundle.
- Platform fee (if any) is fixed, shown before deposit, and enforced in the contract.
- Our own team wallets are marked on the page if they deposit.
- Write full tests for: deposit caps, ordering, refund paths, launch failure,
  double-claim, rounding dust, re-entrancy (EVM), signer/PDA checks (Solana).
- Before mainnet: write SECURITY.md listing every privileged action and every way
  funds can move, then STOP and tell me to get an external audit. Do not deploy to
  mainnet yourself.

====================================================================
4. CHAINS — ONE APP, PLUGGABLE CHAIN ADAPTERS
====================================================================
The app runs on ONE chain at a time, chosen by config (CHAIN=solana | robinhood).
Build a ChainAdapter interface: createEscrow, deposit, getPool, launch, claim,
refund, getLaunchStatus, explorerLinks. Everything above the adapter is chain-agnostic.

Solana adapter:
- Anchor program for the escrow (PDA per narrative holding SOL).
- RESEARCH FIRST and report to me before building: can a PDA be the creator of a
  pump.fun coin and do the opening buy via CPI in the same tx? What are pump.fun's
  current program rules on creator/dev buys and bundles? If CPI into pump.fun is not
  possible or not allowed, propose alternatives (e.g. launch via a signer that the
  program funds atomically with Jito bundle, or launching on another venue) with
  tradeoffs. Do not guess — verify from current docs/IDL and show sources.
- Use Helius RPC (HELIUS_API_KEY in env) for reads and tx sending.

Robinhood Chain adapter (EVM):
- Solidity escrow contract per narrative (or factory + clones).
- RESEARCH FIRST: which launchpad/bonding curve is standard on Robinhood Chain, and
  can a contract create + buy atomically? Report before building.
- Foundry for contracts + tests.

====================================================================
5. PRODUCT / UI
====================================================================
Pages:
- Home: live feed of narratives by stage (Voting / Pooling / Launching / Live),
  trending, "launching in 2:14" countdowns, recently launched with performance.
- Narrative page: pitch, ballots with live vote counts, locked metadata + hash,
  pool panel (escrow address, total, cap, my deposit, full deposit list in order),
  countdowns, launch status, release schedule (my tranches + claim button), refund
  button when applicable, chart after launch.
- Create narrative: pitch + source link, preview card.
- Profile: my narratives, my votes, my deposits/claims/refunds, reputation.
- Leaderboard: best narrative creators and voters (by launched coin performance).
- Wallet connect: Phantom/Solflare/Backpack (Solana) or injected EVM wallets. Users
  sign every transaction themselves. Votes are signed messages (free).
Design: premium dark trading-terminal look, smooth, mobile-first, fast. Live updates
via SSE/websocket. Shareable OG cards for each narrative for X.

Images: allow upload + optional AI image generation for image ballot entries.
Moderation: basic filter for NSFW/illegal content and impersonation of real
brands/people in names, tickers and images; report button.

====================================================================
6. BACKEND
====================================================================
- Node/TypeScript server, Postgres (or SQLite to start), indexer that watches the
  escrow program/contract and keeps the DB in sync. The chain is the source of truth
  for money; the DB is only a cache. If they disagree, the chain wins.
- Scheduler for stage transitions, but launch/refund/claim must also be callable by
  anyone (permissionless crank) so the system works even if our server is down.
- Config: vote duration, deposit window, launch delay, per-wallet max, pool cap,
  pool minimum, tranche count/interval, fee.
- Deploy target: Railway (I'll run the deploy). Env vars only, never committed.

====================================================================
7. HOW TO WORK
====================================================================
Phase 1  Research + architecture doc (chain launch mechanics, escrow design, threat
         model, data model). STOP for my approval.
Phase 2  Escrow contract/program + full tests on devnet/testnet. STOP.
Phase 3  Backend + indexer + chain adapter. STOP.
Phase 4  Frontend. STOP.
Phase 5  End-to-end dry run on devnet: create narrative -> vote -> pool -> launch ->
         release -> refund case. Show me screenshots and tx links. STOP.
Phase 6  Polish (/levelup), SECURITY.md, deploy instructions. Do NOT go to mainnet.

At every stop: summary of what changed, what's risky, what's next. Keep a
DECISIONS.md log. If something in this brief is technically impossible or unsafe,
say so and propose the closest safe alternative instead of faking it.
