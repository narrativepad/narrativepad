# Narrativepad — Architecture (Phase 1, approved)

Status: **APPROVED 2026-10-01 (D-003)** with all §13 recommendations. Research date: 2026-10-01.
Decisions taken are logged in `DECISIONS.md` (D-001…D-008).

---

## 0. TL;DR

- **The core mechanism works on both chains.** A non-custodial escrow can pool funds, launch the coin and make the opening buy **in one instruction or call**, so nobody can buy ahead of the pool.
  - **Solana:** our program CPIs pump.fun `create_v2` + buy. The PDA-as-buyer part is verified on mainnet. The PDA-as-creator-payer part is proven only on devnet and in a local test, so it gets tested in Phase 2. There's a safe fallback (§4.3b).
  - **Robinhood Chain:** the escrow calls Uniswap's permissionless LiquidityLauncher and swaps in the same tx (§5).
- **Refunds are time-based pulls.** They need no admin, there are no loops, and they can't be blocked by us. On Robinhood Chain, the chain operator itself can censor (T19).
- **Biggest risk: pump.fun's ToS, not code.** §21(c)/(t) prohibit pooled and agent buying without written permission, and pump can hide coins in its UI. Get permission before mainnet, or use the Meteora DBC fallback (§4.7).
- **Not achievable as written:** "can't be vamped" (copies can always be launched) and "first depositors unlock first" (creates PVP). Replaced with "provably official mint" and uniform vesting (D-001).
- **Pool caps must be moderate:**
  - pump.fun mainnet: 10 SOL buys ~27% of supply, 25 SOL ~48%.
  - Robinhood/Uniswap: 1 ETH buys ~28%.
  - devnet: tiny caps (pump devnet curve is 30× smaller).
- **Dev environment blocker:** Anchor needs WSL2, which needs virtualization enabled in BIOS on this PC (§12.1).

---

## 1. Reality check: what the brief can and cannot guarantee

The brief says the coin "can't be vamped, sniped or PVP'd". Each claim, technically:

| Claim | Achievable? | How / why not |
|---|---|---|
| **Can't be sniped** (nobody buys before the pool) | ✅ Yes | Create + opening buy run atomically in one transaction (Solana: one instruction of our program that CPIs into the launchpad; EVM: one contract call). Nothing can be ordered between them. Buyers *after* the pool, even in the same block, are possible and fine; they pay a higher price. |
| **Can't be PVP'd** inside the pool | ✅ Yes | Every depositor buys at the same average price; allocation is strictly pro-rata. |
| **Can't be bundled by insiders** | ✅ Visible | The opening buy *is* a bundle, but a public one. Every depositor is listed and team wallets are flagged. We can't stop insiders from using fresh wallets, but they get the same price as everyone else. |
| **Can't be vamped** (nobody launches a copy) | ❌ **Not achievable** | During voting, every candidate name, ticker and image is public, so anyone can launch a copy on any launchpad before or after us. No chain can prevent that. **The closest safe alternative:** the official coin is *provably identifiable*. It is the mint created by the escrow, whose on-chain record stores the locked metadata hash, and the UI only ever badges that mint as official. We also shorten the gap between lock and launch (deposit window plus a 2–3 minute delay). |
| **Per-wallet max** | ⚠️ Per *wallet* only | It's enforced on-chain, but one person with 50 wallets can bypass it. Sybil resistance needs identity or attestation (optional server-signed deposit tickets, §8). |
| **"Impossible to block" refunds** | ✅ Yes, by design | Refund eligibility is a pure function of time and pool state, each depositor pulls their own refund, and nothing loops over depositors. See §3.3. |
| **"First depositors unlock first"** | ❌ Unsafe as written → **replaced** | It turns the deposit window into a speed race and lets early unlockers sell into later depositors, which is PVP again. **Decided (D-001): uniform vesting.** Everyone unlocks 1/K per tranche on the same schedule. See §7. |

---

## 2. System overview

```
             ┌──────────────── off-chain (cache + coordination) ────────────────┐
  Browser ──►│ apps/web (UI) ──► apps/server (API · SSE · scheduler · crank) ──►│ Postgres
  (wallet)   │                      ▲                   │                       │
     │       │                      │ indexer           │ builds unsigned txs   │
     │       └──────────────────────┼───────────────────┼───────────────────────┘
     │ user signs every tx          │ reads/events      │
     ▼                              │                   ▼
  ┌───────────────────────────── chain (source of truth for money) ─────────────┐
  │  Escrow program/contract (one escrow per narrative)  ──CPI/call──► Launchpad │
  │  (holds SOL/ETH, enforces caps, launches, releases, refunds)                 │
  └──────────────────────────────────────────────────────────────────────────────┘
```

- **Money lives only in the escrow.** The server never holds user funds and never signs for them.
- The server has two keys (env vars, never in git):
  1. **operator key**, which can *create* escrows for locked narratives (within hard-coded bounds) and **cannot move funds**;
  2. **crank key**, a gas-only hot wallet that calls permissionless `launch` / `claim_for`. Anyone else can call these too.
- If our server dies, users can still call `launch`, `claim` and `refund` themselves: from the UI if it's up, or from a CLI script we ship.

---

## 3. Escrow design (chain-agnostic logic)

### 3.1 Per-narrative state

```
Escrow {
  narrative_id      : [u8; 16]      // UUID from the DB
  lock_hash         : [u8; 32]      // sha256 of the canonical locked metadata (§6.3)
  name, symbol, uri : strings       // stored verbatim; launch uses these (cannot be swapped)
  creator_fee_split : [(address|DEPOSITORS, bps)]  // ⚠️ where launchpad creator fees go (§13), immutable
  fee_bps           : u16           // platform fee, ≤ MAX_FEE_BPS constant, copied at creation, immutable
  fee_recipient     : address       // copied at creation, immutable
  per_wallet_max    : u64
  pool_cap          : u64           // ≤ MAX_POOL_CAP constant (must stay below curve graduation)
  pool_min          : u64
  min_deposit       : u64           // anti-dust
  deposit_start     : i64
  deposit_end       : i64
  launch_after      : i64           // deposit_end + launch_delay (2–3 min)
  launch_deadline   : i64           // after this, never launchable → refunds
  tranche_count     : u8            // e.g. 5
  tranche_interval  : i64           // seconds
  total_deposited   : u64
  depositor_count   : u32
  next_order_index  : u32
  launched          : bool
  launched_at       : i64
  mint              : address       // set at launch
  tokens_bought     : u64           // escrow's token balance right after the buy
  base_leftover     : u64           // unspent SOL/ETH after buy + fees, returned pro-rata at claim
  claimed_total     : u64
  receipts_closed   : u32           // for dust burn
}

Receipt (one per depositor wallet per escrow) {
  wallet, amount, first_order_index, first_slot, deposit_count, claimed_tokens, base_leftover_paid, refunded
}
```

Every deposit also emits an event `Deposited{wallet, amount, order_index, slot/block, timestamp, new_total}`. The UI's ordered deposit list comes from these events, so every individual top-up is shown with its own order index.

### 3.2 State machine: time-based, so there's no admin step anywhere

```
now < deposit_start                         → Scheduled
deposit_start ≤ now < deposit_end           → Pooling         (deposit allowed)
deposit_end ≤ now < launch_after            → Closing         (nothing allowed; display "launching in 2:14")
launch_after ≤ now < launch_deadline
      && total ≥ pool_min && !launched      → Launchable      (anyone may call launch)
launched                                    → Releasing       (claims per schedule)
!launched && (now ≥ launch_deadline
      || (now ≥ deposit_end && total < pool_min)) → Refundable (each depositor pulls 100%)
```

**Key invariant:** `Launchable` and `Refundable` are **disjoint**, and once `Refundable` is true it stays true forever. Launch requires `now < launch_deadline && total ≥ pool_min`. A refund requires one of those to be false, and neither condition can flip back. So a launch can never happen after someone has been refunded, and a refund can never be "un-done" by a late launch.

"Launch failed" needs no special state. A failed launch transaction reverts entirely on both chains, so the escrow stays `Launchable` until a retry succeeds or the deadline passes, and then it is `Refundable`.

### 3.3 Instructions

| Instruction | Who can call | Moves funds? | Checks |
|---|---|---|---|
| `init_config` / `update_config` | admin (multisig) | no | fee ≤ MAX_FEE_BPS, bounds. Applies **only to escrows created afterwards** |
| `create_escrow` | operator | no | params within config bounds, cap ≤ MAX_POOL_CAP, times ordered, lock_hash = sha256(canonical(name, symbol, uri, …)) |
| `deposit(amount)` | anyone, for **own** wallet | user → escrow | Pooling; amount ≥ min_deposit; receipt.amount + amount ≤ per_wallet_max; total + amount ≤ pool_cap |
| `launch` | **anyone** | escrow → launchpad (buy), escrow → fee_recipient (fee) | Launchable; launchpad program/contract address hard-coded; metadata = stored values; post-conditions: tokens received ≥ expected_min, base spent ≤ budget |
| `claim` / `claim_for(wallet)` | anyone (tokens always go to `wallet`'s own token account) | escrow → depositor | Releasing; claimable = unlocked(now) − claimed > 0 |
| `refund` / `refund_for(wallet)` | anyone (SOL/ETH always goes to `wallet`) | escrow → depositor | Refundable; !receipt.refunded; pays receipt.amount exactly; closes receipt |
| `burn_dust` | anyone | burns tokens | all receipts fully claimed; burns the remaining ≤ n base units |
| `collect_creator_fees` | anyone | launchpad creator vault → escrow → split recipients | pulls accrued creator fees, pays the immutable `creator_fee_split`; never touches pool/leftover balances |

**There is no instruction that sends escrow funds anywhere except:**
(a) the depositor's own wallet (refund / claim),
(b) the hard-coded launchpad during `launch`,
(c) `fee_recipient`, exactly `fee_bps` of the pool, only on successful launch, and
(d) creator-fee income (not depositor money) to the split fixed at creation.
That list becomes the core of SECURITY.md.

### 3.4 Fees
- Platform fee: `fee_bps` bounded by a compile-time `MAX_FEE_BPS` (proposal: 200 = 2%). It is copied into the escrow at creation, shown in the UI before deposit, and charged **only on successful launch**. Refunds are always 100%.
- Launch costs (rent for the new mint and accounts, launchpad fees) are paid from the pool and shown as an estimate before deposit.
- Crank reward: none by default (our server pays gas). ⚠️ Optional small fixed reward so third parties are incentivised to crank if we're down.

---

## 4. Solana adapter

### 4.1 Answer to the brief's research question

> *Can a PDA be the creator of a pump.fun coin and do the opening buy via CPI in the same tx?*

**Mostly yes, with one part not yet proven on today's mainnet binary.** All of this is from the IDL, docs and on-chain transactions as of 2026-10-01.

| Piece | Status | Evidence |
|---|---|---|
| PDA as **`creator`** (gets creator fees, shows as "dev") | ✅ Verified | `creator` is just an arg to `create_v2`; it doesn't sign. `collect_creator_fee` is permissionless and pays lamports to `creator` |
| PDA as **buyer** (`user` of `buy`) via CPI | ✅ Verified on mainnet + devnet | Pump's own Mayhem program CPIs `buy` with a data-less system-owned PDA as `user`. GMGN/Jupiter routers CPI `buy` daily. A devnet program CPI'd `create_v2` then `buy_v2` with a non-signing PDA user (2026-10-01) |
| **No anti-CPI checks** | ✅ Verified for buy; ⚠️ unproven for create | No instructions-sysvar account; no caller-related error codes. Pump's official `CPI_README.md` shows an Anchor CPI. CPI'd `create_v2` seen on devnet, but no CPI `create_v2` observed on mainnet (0 of 218 sampled) |
| PDA as **`create_v2` payer (`user`) and `mint`** | ⚠️ **Unproven on current mainnet binary** | Only evidence is the open-source `pumpfamily` program (PDA vault user + PDA mint, create_v2 + buy in one ix), tested on a local clone of the *pre*-2026-09-23 binary. Devnet CPI creates used keypairs |
| Create + buy in one instruction within limits | ✅ Measured | ~106k CU create + ~87k CU buy via CPI on devnet (≈360–460k CU total). CPI depth reaches 4 of 5 max, so **our `launch` must be a top-level instruction**. ~35–43 accounts, so a v0 tx + address lookup table is required |
| On-chain cap on dev/initial buy | ✅ None | Only bounded by `real_token_reserves` |

**Pump.fun's rules: the real risk is the Terms of Service, not the code.** ToS (updated 2026-09-25):
- §21(c) prohibits transacting "on behalf of, or to hold or manage Digital Assets for, other persons … unless expressly agreed by us in writing".
- §21(t) prohibits use "in connection with any … pooled investment scheme".
- §21(w) prohibits "coordinated" conduct.

A pooled escrow dev buy sits squarely inside 21(c)/(t).
- Pump can't stop on-chain trading, but its API has `is_banned` flags, so it **can hide our coins from the pump.fun UI**. It can also reassign a coin's creator via its admin `admin_cto` instruction.
- ⚠️ **Before mainnet, get written permission from pump.fun, or launch on Meteora DBC (§4.7).**
- Separately: pooling user funds to buy a token on their behalf may have regulatory implications in some jurisdictions. Get legal advice before mainnet.

**How terminals will read it.** Axiom shows "Dev Holding %", "Bundle %", "Insiders %" and "Snipers %".
- With `creator` = the escrow vault, the pool buy *is* the dev buy: one wallet, not a multi-wallet bundle. But it will show 15–50% dev holding, which traders treat as a red flag.
- Wallets that later receive vested tokens may be tagged "insiders".
- Mitigations:
  - keep pool caps moderate (§13);
  - the coin page labels it "Community pool buy" with the full depositor list;
  - the OG card explains the escrow.

### 4.2 pump.fun facts we build against (verified 2026-10-01)

- **Program IDs:**
  - Pump: `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` (same ID on devnet)
  - Fee program: `pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ`
  - PumpSwap: `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`
- **Create:** `create_v2` (Token-2022), which is what pump's own frontend uses (218 of 218 sampled). 16 accounts.
  - Args: `name` ≤32, `symbol` ≤13, `uri` ≤200, `creator`, `is_mayhem_mode` (false), optional `is_cashback_enabled` (deprecated), `creator_fee_bps`, `is_holder_reward`.
  - `mint` and `user` must sign. The "…pump" suffix is frontend-only.
  - Token-2022 metadata has **no update authority**, so it is permanent.
- **Buy:** `buy` / `buy_exact_sol_in` (16 accounts + 2 mandatory remaining accounts: `bonding_curve_v2`, buyback fee recipient), or `buy_v2` / `buy_exact_quote_in_v2` (27 accounts; pump says to migrate to v2). The paying `user` must be **system-owned with no data**, and must end with 0 or ≥ 890,880 lamports.
- **Mainnet curve:**
  - virtual reserves: 30 SOL / 1.073B tokens; 793.1M sellable, 1B supply
  - fee 1.25% (95 bps protocol + 30 bps creator)
  - the curve completes at **≈86.07 SOL gross**, then migrates to PumpSwap and the LP is burned

| Opening buy (gross) | Tokens | % of supply | Mcap after |
|---|---|---|---|
| 5 SOL | 151.7M | 15.2% | 37.9 SOL |
| 10 SOL | 265.8M | 26.6% | 49.4 SOL |
| 25 SOL | 484.4M | 48.4% | 92.9 SOL |
| 50 SOL | 667.5M | 66.8% | 195.8 SOL |

- **Devnet is different:**
  - virtual SOL reserves = **1 SOL** (1 SOL buys ~53% of supply; the curve completes at ~2.83 SOL)
  - different fee recipients
  - a different binary (deployed 2026-09-24)
  - **Consequence:** devnet pool caps must be tiny (≈0.1–0.5 SOL), and the program must read curve params from pump's `Global` rather than hard-coding them.
- **Churn:** the mainnet binary was redeployed 2026-09-23, and post-upgrade txs contain discriminators not in the IDL (issue #50). Pump is closed source, so **the IDL is not a full spec.**

### 4.3 Launch design: one top-level instruction

```
launch(mint_nonce)  — permissionless, top-level only, v0 tx + lookup table
  require  Launchable (§3.2)
  derive   vault PDA      ["vault", escrow]          system-owned, no data, holds pooled SOL
           mint PDA       ["mint", escrow, nonce]    nonce chosen at launch → not pre-griefable
           escrow ATA     Token-2022 ATA(vault, mint)
  fee      vault → fee_recipient : total × fee_bps / 10_000
  CPI #1   pump.create_v2(name, symbol, uri  ← from escrow state, never from args,
                          creator = vault PDA, is_mayhem_mode = false)
             user = vault PDA (signs via seeds) · mint = mint PDA (signs via seeds)
  CPI #2   pump.buy_exact_sol_in / buy_exact_quote_in_v2
             user = vault PDA · spendable = total − fee − rent_reserve
             min_tokens_out = computed in-program from pump Global/curve state
  post     escrow ATA balance ≥ min_tokens_out
           vault lamports spent ≤ budget; vault stays rent-exempt
  write    launched = true, launched_at, mint, tokens_bought, base_leftover
  emit     Launched{…}
```

- Pump program ID and instruction discriminators are **constants**. Accounts that pump validates itself (its PDAs, fee recipients) are passed through. Our own safety comes from the **post-conditions**, not from trusting pump's account list.
- **Fallback 4.3b:** if PDA-as-`create_v2`-`user` turns out not to work on the current mainnet binary, the cranker's keypair becomes `create_v2`'s `user`. It is an outer tx signer, so its signature flows through our CPI. The cranker pays only the ~0.02 SOL of create rent, reimbursed from the pool. **The vault PDA still does the buy** (verified pattern), and it is still one instruction. The ephemeral-signer + introspection design is strictly worse and isn't needed.
- **If pump changes its ABI:** launch reverts → timeout → everyone refunds (T11). A new program version is required, either via upgrade authority or a fresh deploy (§13).

### 4.4 Accounts

| Account | Seeds | Owner | Purpose |
|---|---|---|---|
| `Config` | `["config"]` | escrow program | admin, operator, fee bounds, launchpad constants |
| `Escrow` | `["escrow", narrative_id]` | escrow program | §3.1 state |
| `Vault` | `["vault", escrow]` | **System** (no data) | holds SOL; pump `user` + `creator`; owns the token ATA |
| `Receipt` | `["receipt", escrow, wallet]` | escrow program | per-wallet deposit/claim state; rent paid by depositor, returned on close |
| `Mint` | `["mint", escrow, nonce]` | Token-2022 (created by pump) | the coin |

### 4.5 Creator fees (⚠️ decision, §13)

The vault PDA is the pump `creator`, so creator fees (30 bps of volume) accrue to pump's `creator_vault` and are pulled into our vault by a permissionless `collect_creator_fees`. They're tracked separately from pool money and then split by fixed bps chosen at escrow creation (immutable). Pump also offers `is_holder_reward` (pump routes creator fees to holders) and a fee-sharing config (≤10 shareholders, set once).

### 4.6 RPC / infra
- **Helius:** devnet RPC, websocket and webhooks are supported. The free tier is 1M credits/month, 10 req/s, with no `transactionSubscribe`. Enough for devnet; the indexer uses `logsSubscribe` plus backfill.
- **Sending:** Helius Sender is mainnet-only. Devnet uses standard `sendTransaction`.
- **Jito:** not used. The launch is a single instruction, so no bundle is needed. Jito has no devnet anyway.

### 4.7 Fallback venues (if pump.fun CPI breaks or is disallowed)

| | **Meteora DBC** (best fallback) | Raydium LaunchLab | Heaven / Bags |
|---|---|---|---|
| Program | `dbcij3LW…qaN`, same ID on devnet (both upgraded Sep 2026) | `LanMV9sA…3uj` mainnet; `DRay6fNd…cm6` devnet | Heaven: closed source, stale devnet. Bags: requires Bags' own key as creator |
| PDA as creator + payer via CPI | ✅ Open source, no CPI guard on `initialize_virtual_pool_with_spl_token`. Mint can be our PDA. Meteora's guide rates create-via-CPI "possible, heavier" | ✅ Creator doesn't sign; payer + mint sign. Closed source, so hidden checks are unknown; published CPI crate | ❌ Not usable from a PDA |
| First buy in same ix | ✅ `swap2` (PartialFill caps at the threshold). The "first-swap min-fee" discount only applies top-level, not via CPI, so we'd use a flat fee config | ✅ `buy_exact_in` | — |
| Our own platform fee | ✅ Partner config: own curve, fee claimer, creator split, migration threshold | ✅ Platform config, up to 5% + LP share | — |
| Graduation | DAMM v2, permissionless keepers (devnet: manual) | CPMM, **requires Raydium's migration wallet signature** | — |
| Trader attention | Low–medium: generic "Meteora DBC" on DexScreener/Jupiter | Medium for bonk.fun/Stonkfun brands; low for a custom platform | — |

Market context, 30-day revenue among the three platforms compared (CoinGecko): pump.fun ~64%, Pons ~28% (Robinhood Chain), Stonkfun ~8%. Pump.fun is still where the traders are.

**Jito:** block engines exist for mainnet and testnet, **not devnet**. Our design doesn't need Jito, because the escrow's launch is a single instruction.

---

## 5. Robinhood Chain adapter (EVM)

### 5.1 Chain facts (verified on-chain 2026-10-01)

Mainnet and public testnet are both live. The research agent checked these on-chain against the public RPC (mainnet block ≈77.30M) and via Sourcify-verified source; addresses get re-checked in fork tests in Phase 2.

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| RPC (public, rate-limited; Alchemy recommended) | `rpc.mainnet.chain.robinhood.com` | `rpc.testnet.chain.robinhood.com` |
| Explorer | `robinhoodchain.blockscout.com` | `explorer.testnet.chain.robinhood.com` |

- **Stack:** Arbitrum Orbit L2 settling to Ethereum, ArbOS 61, ETH for gas. Blocks are ~0.10 s on mainnet.
- **Ordering:** a centralized Robinhood sequencer, strictly first-come-first-served. There's no priority-fee reordering, no public mempool, and no Timeboost (inferred).
  - **Consequence:** nothing can be inserted inside our atomic launch tx. Bots react off the sequencer feed and buy in the blocks after ours, about 100 ms later.
- **Deploying contracts is permissionless.** However, the chain operator can block addresses (sequencer sanctions screening, ToS of 2026-08-24). There's also an `ArbFilteredTransactionsManager` precompile that can force-fail any tx hash. L2BEAT rates the chain below Stage 0, with a 7/8 multisig able to upgrade with no delay.
  - **Honest implication:** on this chain, "refunds can't be blocked" holds against *us*, not against the chain operator.
- **EVM quirks:**
  - `block.number` is an L1 estimate, so all windows use `block.timestamp`.
  - `prevrandao` is constant, so there's no on-chain randomness.
  - Contract size limit is 96 KB.
  - Foundry is the documented toolchain. `forge script` can underestimate L1 data gas, so use `--gas-estimate-multiplier`.

### 5.2 Launch venue: **Uniswap LiquidityLauncher + InstantLaunchStrategy** (recommended)

| Venue | Contract-driven create+buy? | Opening-buy cap | Owner can change/close? | Audited? | Activity |
|---|---|---|---|---|---|
| **Uniswap LiquidityLauncher v3.2 + InstantLaunchStrategy v3.3** (`0x0000FffF…19C0`, `0x7c48…35C2`) | ✅ No `tx.origin`/EOA/allowlist checks. Contracts already create+swap in one tx on mainnet | **None.** All pooled ETH can be the opening buy | No owner | Core v1/v2 by OZ/Spearbit/ABDK; **the 3.x strategies are not covered** (bug bounty only) | ~40 launches / 17 h (pools.trade UI) |
| Pons V2 (`0x7eD5…EC7e`) | ✅ Third-party contracts used it in 4 of the last 30 launches | **~4.24 ETH hard clamp.** Excess refunded and the token auto-graduates in the same tx | **Yes.** Owner (likely a Safe) can close `launchEnabled` and retune fees/config | No (reviews "in progress") | Dominant: ~6,800 launches / 24 h |
| Bags (`0xe8Cc…Cb37`) | `createAndBuy` exists | Capped at graduation | **Upgradeable proxy** | Unknown | Not measured |
| hood.fun, Clanker, others | Unverified or "coming soon" | — | — | — | — |

**How launch works on LiquidityLauncher.** In one `launch()` call, the escrow:
1. calls `LiquidityLauncher.multicall`, which runs:
   - `createToken(UERC20Factory, name, symbol, 18, 1e27 supply, recipient = launcher)`
   - `distributeToken(InstantLaunchStrategy, 1e27, feeBeneficiary)`. This puts the full supply single-sided into a hookless native-ETH Uniswap v4 pool (0.25% fee, tick spacing 25).
2. swaps the pooled ETH through the UniversalRouter (or `PoolManager.unlock`) in the same transaction. Tokens land in the escrow.

**Opening-buy economics are much steeper than pump.fun.** The research agent's estimate: the opening price behaves like constant-product with ~2.51 ETH of virtual ETH.
- 1 ETH buys ~28% of supply.
- 10 ETH buys ~80%.
- 25 ETH buys ~91%.

So the **pool cap on Robinhood must be small (≈0.5–3 ETH)**, or the community buys almost the entire supply and there's nothing left for the market. Phase 2 fork tests will produce exact numbers.

**Creator fees:** 40% of ETH-side LP fees go to `feeBeneficiary` via a beneficiary NFT. It's pull-based through `claim()`, and a contract can hold the NFT. ⚠️ Same "who gets creator fees" decision as Solana (§13).

**Known risk: pool pre-initialization griefing.** The token address is CREATE2-derived from (name, symbol, decimals, launcher, caller). If the caller's address is predictable, an attacker can `initialize` that v4 pool first, and our launch reverts.
- **Mitigation:** `launch(bytes32 salt)` deploys a one-shot `LaunchHelper` via CREATE2 with a cranker-supplied random salt. Because there's no public mempool, nobody can learn the salt before the tx is sequenced.
- **Worst case is DoS → timeout → refunds**, never theft.

### 5.3 Contract design
- **Contracts:**
  - `NarrativeEscrowFactory`: config, bounds, operator role, and `createEscrow`. It deploys **EIP-1167 clones** with CREATE2 salt = narrative_id.
  - `NarrativeEscrow`: clone implementation with the §3 logic.
  - `LaunchHelper`: one-shot, deployed per launch.
- **Safety mechanics:**
  - `nonReentrant` on deposit/launch/claim/refund.
  - Strict checks-effects-interactions (CEI).
  - ETH is sent with `call` only to the receipt owner.
  - `receive()` only accepts ETH from WETH/router/launcher during launch, and from the fee vault on claim.
- Launchpad addresses are `immutable` in the implementation. A new launchpad means a new implementation, and existing escrows are unaffected.
- No proxy and no upgradeability. ⚠️ Confirm in §13.

### 5.4 Testing reality
LiquidityLauncher, Pons and Bags are **not deployed on Robinhood testnet** (Uniswap v4 core is).
- **Phase 2:** Foundry **mainnet-fork tests**. These only *read* mainnet state into a local fork; nothing is deployed or sent to mainnet.
- **Phase 5 (if we dry-run Robinhood):** deploy the MIT-licensed LiquidityLauncher + InstantLaunchStrategy to testnet ourselves.

---

## 6. Off-chain flow: propose → vote → lock

### 6.1 Propose
A wallet signs a "create narrative" message containing the pitch and source URL. It passes rate limits (per wallet and per IP) and the moderation filter (§10). Stage becomes `Voting` with `vote_ends_at = now + vote_duration`.

### 6.2 Vote
- Ballot fields: `name`, `ticker`, `image`, `x_url`, `tg_url`, `website`, and `pairing` where relevant. Each is its own ballot.
- **Submissions** (entries) are wallet-signed and moderated, with N per wallet per field. Images are uploaded or AI-generated, then pinned to IPFS. The CID is the canonical reference.
- **Votes** are wallet-signed messages, so there's no gas. Domain-separated message format:
  ```
  narrativepad.xyz wants you to vote
  Narrative: <uuid>  Field: ticker  Submission: <uuid>
  Wallet: <address>  Chain: solana|robinhood
  Nonce: <server nonce>  Issued At: <ISO time>
  ```
  Solana uses an ed25519 `signMessage`. EVM uses EIP-712 typed data. The server verifies the signature, nonce freshness and narrative stage. `UNIQUE(narrative, field, wallet)` gives one vote per wallet per field, and it is final.
- Anti-spam: per-wallet and per-IP rate limits. Optional min wallet age / min balance, checked via RPC at vote time and configurable per deployment.
- Ties: earliest submission wins (`submissions.created_at`, then id).
- **Auditability:** at lock time we publish every signed vote as a JSON file plus its Merkle root (`votes_root`), so anyone can re-verify signatures and recount. Honest limitation: the tally is computed off-chain, so the server could *censor* votes before they're recorded. Publishing the signed set makes that detectable, not impossible.

### 6.3 Lock
1. The scheduler closes voting at `vote_ends_at` and computes winners.
2. It builds the metadata JSON in the launchpad's format (name, symbol, description, `image: ipfs://<cid>`, twitter, telegram, website) and pins it to IPFS, giving `metadata_uri` with a CID.
3. `lock_hash = sha256(JCS-canonical-JSON({narrative_id, chain, name, symbol, metadata_uri, image_cid, links, votes_root}))`.
4. The operator calls `create_escrow(lock_hash, name, symbol, metadata_uri, params)`.
5. **Immutability chain:** on-chain escrow stores name/symbol/uri → uri is content-addressed (IPFS CID) → the JSON references the image by CID. Nobody, including us, can change what launches. The page shows the hash and a "verify" button that recomputes it client-side.

---

## 7. Release (token distribution)

Let `P` = total deposited, `T` = tokens the escrow received from the opening buy, `d_i` = wallet i's deposit, `L` = leftover base currency after buy and fee.

- Entitlement: `e_i = floor(T · d_i / P)` (u128 intermediate). Leftover share: `l_i = floor(L · d_i / P)`.
- Total dust `T − Σe_i < n` base units (n = depositor count). With 6 decimals and 1,000 depositors, that's < 0.001 token. Once every receipt is fully claimed, `burn_dust` burns it permissionlessly. It never goes to an admin.
- `claimable_i(now) = floor(e_i · unlocked_i(now) / K) − claimed_i`. This is monotonic, and at the final tranche it pays exactly `e_i` in total, so double-claims are impossible by construction.
- Tokens always go to the token account of the **depositing wallet** (created if missing, rent paid by the caller). There's no destination parameter.
- Unclaimed tokens stay claimable forever. There is no sweep.

### Tranche schedule: uniform vesting ✅ (decided, D-001)

```
unlocked_tranches(now) = min(K, 1 + floor((now − launched_at) / tranche_interval))   // 1 at launch
claimable_i(now)       = floor(e_i · unlocked_tranches(now) / K) − claimed_i
```

Everyone gets 1/K at launch, then +1/K every `tranche_interval`, on the same schedule regardless of deposit order. The order index is recorded and displayed but doesn't affect payouts, so top-ups (within the per-wallet max) are allowed.

Alternatives considered and rejected:
- **(B) Order-based groups (the brief's version):** creates a deposit-slot race, and the first group can dump on locked later groups.
- **(C) Randomised groups:** losers of the lottery can still be dumped on, and randomness is weak on Arbitrum-based chains.

---

## 8. Threat model

**Assets:** pooled SOL/ETH; bought tokens; integrity of the locked metadata; integrity of the vote; user trust/UI.

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Admin/team steals pooled funds | No instruction can move funds except §3.3 (a)(b)(c). Fee is bounded by a compile-time constant and copied immutably per escrow | **Upgrade authority** can replace the program → time-lock or renounce before mainnet (⚠️ §13) |
| T2 | Malicious cranker manipulates launch (wrong metadata, wrong mint, inserted buys, tiny min-out) | Program builds the launchpad call itself from stored metadata. Launchpad address is hard-coded. Create + buy happen inside **one** instruction/call, so nothing can interleave. Post-conditions on tokens received and base spent | None meaningful |
| T3 | Snipers buy before the pool | Atomic create+buy (T2) | Buyers right after the pool in the same block: acceptable, they pay more |
| T4 | Vamps launch copies | Can't prevent (§1). Official mint is provable via the escrow, and the UI only badges the escrow mint | Copies will exist. Education/branding problem |
| T5 | Sybil depositors bypass per-wallet max | Inherent. Optional: server-signed deposit tickets (ed25519 / EIP-712) bound to wallet + min wallet age. Trade-off: server becomes a gate for *deposits* (never refunds) | ⚠️ owner choice |
| T6 | Sybil voters | Rate limits, optional min wallet age/balance, published signed vote set | Free votes are inherently sybil-able |
| T7 | Server censors or miscounts votes | Signed votes + Merkle root published at lock; client-side recount | Censorship detectable, not preventable |
| T8 | Refund griefing / blocking | Pull-based per-depositor refund; eligibility is time-based; no loops; no global step needed; EVM uses `call` to `msg.sender`/receipt owner with CEI + `nonReentrant` (a reverting receiver only hurts itself) | None |
| T9 | Re-entrancy (EVM) | CEI ordering, `ReentrancyGuard` on all fund-moving functions, no external calls before state writes; launchpad call happens after `launched = true` | Launchpad itself could re-enter → guarded |
| T10 | Account substitution (Solana): fake receipt, fake vault, wrong token account, wrong mint | Anchor `seeds`/`bump` constraints on every PDA; `has_one`; token accounts derived as ATA of (mint, escrow authority PDA); signer checks; launchpad program ID constant | Covered by tests (§12) |
| T11 | Launchpad upgrades its program/ABI (pump.fun does this often) | Launch reverts → escrow times out → **everyone refunds automatically**. Safe failure. New escrows use a new program version | Product downtime until we ship an update |
| T12 | Opening buy exceeds curve graduation | `pool_cap ≤ MAX_POOL_CAP` constant, set well below graduation | — |
| T13 | Front-end / DNS compromise sends users to a fake escrow | Show program ID + escrow address with explorer link; wallet simulation; publish program ID out-of-band; CSP + pinned deps | Phishing remains possible (as for any dapp) |
| T14 | Clock manipulation | Solana `Clock.unix_timestamp` is a stake-weighted median (seconds of drift). EVM `block.timestamp` is set by sequencer. Windows are minutes long and boundaries don't move money unfairly | Low |
| T15 | Team wallets deposit secretly | Known team wallets are listed in config and flagged in the UI | Can't prove absence of unlisted wallets |
| T16 | Malicious content (NSFW, impersonation) gets locked on-chain | Moderation filter at submission, report button, operator refuses to `create_escrow` for flagged narratives | Moderation is off-chain and best-effort |
| T17 | Compromised operator key | It can only create escrows within bounds (no fund movement). Rotate via config | Spam/fake narratives until rotated |
| T18 | Compromised crank key | Gas-only wallet. It can only call permissionless functions, which anyone can call anyway | Loss of a little gas |
| T19 | Chain-level censorship (Robinhood Chain operator can block addresses / force-fail txs; 7/8 multisig upgrades w/o delay) | Out of our control. Disclosed in the UI and SECURITY.md | Refunds are unblockable by *us*, not by the chain operator |
| T20 | Launch griefing via pre-initialized pool (Robinhood/Uniswap v4) or pre-created accounts | Unpredictable launch-helper address (random salt), PDA-derived addresses on Solana | Worst case DoS → refund |

---

## 9. Data model (Postgres; SQLite for local dev via the same ORM)

The DB is a **cache + coordination layer**. Every money-related row is reproducible from chain data, and the indexer overwrites the DB when they disagree.

```
users            (wallet PK, chain, created_at, handle, is_team, reputation)
narratives       (id uuid PK, slug, chain, creator_wallet, pitch, source_url, source_kind,
                  stage enum[voting,locked,pooling,closing,launched,refunding,cancelled],
                  vote_ends_at, config jsonb  -- snapshot of all timing/caps/fee
                  created_at, report_count, moderation_status)
submissions      (id, narrative_id, field enum[name,ticker,image,x_url,tg_url,website,pairing],
                  value, image_cid, submitter_wallet, signature, created_at, moderation_status)
votes            (id, narrative_id, field, submission_id, voter_wallet, message, signature,
                  created_at, UNIQUE(narrative_id, field, voter_wallet))
locks            (narrative_id PK, canonical_json, lock_hash, metadata_uri, image_cid,
                  votes_root, votes_file_cid, locked_at)
escrows          (narrative_id PK, chain, program_or_contract, address, create_tx, state,
                  params jsonb, total_deposited, depositor_count, mint, launch_tx,
                  tokens_bought, base_spent, launched_at, synced_at_slot)
deposits         (escrow, wallet, amount, order_index, tx, slot_or_block, block_time,
                  UNIQUE(tx, ix_index))
claims           (escrow, wallet, amount, tranche, tx, slot_or_block, block_time)
refunds          (escrow, wallet, amount, tx, slot_or_block, block_time)
reports          (id, target_type, target_id, reporter_wallet, reason, status, created_at)
auth_nonces      (nonce PK, wallet, purpose, expires_at, used_at)
market_snapshots (mint, ts, price, mcap, volume_24h)      -- for "performance" + leaderboard
indexer_cursors  (chain, source, cursor, updated_at)
```

Reputation (first version): creator score = Σ over their launched narratives of capped log-returns at T+24h. Voter score = how often their votes picked the winner, weighted by the outcome. Both are computed from `market_snapshots`.

---

## 10. Backend, indexer, scheduler

- **Stack:** Node 22 + TypeScript, Fastify (API + SSE), Drizzle ORM (Postgres in prod, SQLite locally), Zod for validation. One process with three roles for v1: API, indexer, scheduler. They can be split later.
- **Indexer:**
  - Solana: Helius websocket/webhook for program logs, plus backfill via `getSignaturesForAddress`, decoding Anchor events.
  - EVM: `eth_getLogs` polling with a confirmations buffer.
  - Periodic **reconciliation** reads escrow and receipt accounts directly and overwrites the DB, so the chain wins.
- **Scheduler:**
  - close votes → lock → `create_escrow`
  - at `launch_after` → call `launch`, retrying with backoff until `launch_deadline`
  - at each tranche → optional `claim_for` push for all receipts (best effort; users can always pull)
  - after deadline → nothing to do; refunds are pull-based
- **Live updates:** SSE channel per narrative plus a global feed.
- **Escape hatch:** a `scripts/crank.ts` CLI (launch / claim / refund for any escrow) is documented in the README, so the system works with our server down.
- **Moderation:**
  - text: a blocklist plus a brand/celebrity list for impersonation;
  - images: an NSFW classifier (⚠️ provider choice: local `nsfwjs` vs a hosted API);
  - a report button, and a hide threshold that sends items to manual review.
- **Images:** upload → resize → moderation → IPFS pin (⚠️ provider: Pinata / Filebase). Optional AI generation (⚠️ provider + cost).
- **OG cards:** generated server-side with `satori` + `resvg`, cached.

---

## 11. Frontend

Next.js (App Router) + Tailwind, dark terminal aesthetic, mobile-first. Wallets: `@solana/wallet-adapter` (Phantom/Solflare/Backpack) or `wagmi` + `viem` (injected EVM), selected by `CHAIN`. Charts: lightweight-charts. Pages as in the brief.

The coin page shows:
- a "Community pool buy" label on the opening buy with the full ordered depositor list;
- team badges;
- the escrow address with an explorer link;
- the lock hash with a client-side verify button.

---

## 12. Testing plan (Phase 2)

| Area | Tests |
|---|---|
| Deposit caps | per-wallet max (single + top-ups), pool cap exact-fill and overflow by 1, min deposit, outside-window rejects |
| Ordering | order index monotonic under concurrent deposits; events match receipts |
| Refund paths | below-min after window; deadline passed without launch; launch reverted then deadline; refund twice rejected; refund after launch rejected; launch after any refund-eligible state rejected |
| Launch failure | launchpad reverts → state unchanged → retry works → deadline → refunds work |
| Double claim | claim same tranche twice; claim_for + claim races; final sum == entitlement exactly |
| Rounding dust | fuzz random deposits (1..n wallets) → Σclaims ≤ T, dust < n, burn_dust only when all claimed |
| Re-entrancy (EVM) | malicious receiver re-enters refund/claim/launch; malicious launchpad mock re-enters |
| Signer/PDA (Solana) | fake receipt, receipt of another wallet, wrong vault, wrong token account, wrong mint, wrong launchpad program id, non-operator create, claim to non-ATA |
| Fees | fee exactly fee_bps on launch only; 0 on refund; cannot exceed MAX_FEE_BPS |
| Property/fuzz | Foundry invariant tests (Σreceipts == total; balance ≥ owed); Rust proptest for release math |

### 12.1 Dev environment on this machine (Windows 10 Home, virtualization disabled)

Current state: Node 22 and solana-cli 2.2.0 are installed. Rust, Anchor, Foundry and Docker are not. WSL2 can't start.

Current toolchain (Sep 2026):
- Anchor **1.2.0**: repo moved to `otter-sec/anchor`; includes the "honor `is_signer` in CPI account metas" fix.
- Agave CLI **4.1.2** recommended (4.3.0 latest).
- Rust ≥ 1.89.
- Foundry **1.8.3**.

| Path | What it takes | Verdict |
|---|---|---|
| **A. Enable virtualization in BIOS → WSL2 Ubuntu** (already installed) | One reboot into BIOS/UEFI, toggle Intel VT-x / AMD-V (SVM) | ✅ **Recommended.** Officially supported by Anchor, so everything just works |
| B. Native Windows | rustup (MSVC) + VS Build Tools; Agave 4.1.2 Windows release (includes `cargo-build-sbf`); Anchor 1.2.0 `.exe`; Foundry win32 zip via Git Bash | ⚠️ Probably builds. `solana-test-validator` has a history of breaking on Windows; the `litesvm`/bankrun npm packages have no win32 binaries. Tests would be Rust LiteSVM/Mollusk (`cargo test`) + Surfpool. Unsupported |
| C. GitHub Actions (ubuntu) as build/test source of truth | A GitHub repo (private: 2,000 free min/month) | ✅ Recommended **in addition** to A or B. Also gives reproducible/verifiable builds |

Either way, devnet integration testing uses the real pump.fun / Meteora programs on devnet. EVM integration uses Foundry fork tests (§5.4).

---

## 13. ⚠️ Open decisions for the owner

Decided so far: **D-001** uniform vesting; **D-002** no Railway until there's an app (see `DECISIONS.md`).

**Needed before Phase 2 (they change program code):**

| # | Decision | Options | Recommendation |
|---|---|---|---|
| Q1 | **Solana venue** | pump.fun (max attention; ToS risk; PDA-create unproven on mainnet) · Meteora DBC (CPI-friendly, own fees, low attention) | Build for **pump.fun on devnet**, with the launch module isolated so DBC can drop in. You contact pump.fun for written permission before mainnet; if they refuse, switch to DBC |
| Q2 | **Chain order** | Solana first · Robinhood first · both in parallel | **Solana first** through the Phase 5 devnet dry run, then the Robinhood contracts (fork-tested) |
| Q3 | **Creator-fee split** (30 bps of all volume on pump.fun; 40% of ETH-side LP fees on Uniswap) | depositors pro-rata · narrative proposer · platform · pump `is_holder_reward` · a mix | **Mix, fixed per escrow:** e.g. 50% depositors / 30% proposer / 20% platform. Rewards both the crowd and the person who started the narrative |
| Q4 | **Platform fee** | 0% · 1% · up to cap | **1% of pool on successful launch only, hard cap 2%**, recipient = an address you provide (ideally a multisig) |
| Q5 | **Who can create escrows** | operator key only · anyone | **Operator key only.** It cannot move funds; it prevents fake "official" escrows and spam |
| Q6 | **Dev environment** | enable BIOS virtualization → WSL2 · native Windows (unsupported) · plus GitHub Actions CI | **WSL2 + a private GitHub repo for CI.** I need you to enable virtualization (one reboot) and tell me which GitHub account/repo |

**Can wait until Phase 3+:**
- **Q7 default parameters** (mainnet targets; devnet scaled ~30× down). Solana:
  - cap 10 SOL, min 2 SOL, per-wallet max 0.5 SOL, min deposit 0.05 SOL
  - vote 60 min, deposit window 15 min, launch delay 2 min, launch deadline 30 min after close
  - 5 tranches × 10 min

  Robinhood: cap 1 ETH, per-wallet max 0.05 ETH.
- **Q8 sybil deposit tickets** (server-signed allowlist): off for v1. Votes get min wallet age/balance checks.
- **Q9 providers:** IPFS pinning (Pinata?), image moderation (local `nsfwjs` vs hosted API), AI image generation (which provider/budget).
- **Q10 mainnet upgrade authority:** devnet uses the deployer key. For mainnet: Squads v4 2-of-3 with a 24–72h timelock during beta, then `--final` after audit. Ask again before mainnet.

---

## 14. Sources

All retrieved 2026-10-01. On-chain facts were read via public RPC on the same date.

**pump.fun**
- Program docs and IDL: https://github.com/pump-fun/pump-public-docs (HEAD `cb188ce`, 2026-09-29), `idl/pump.json`, `docs/PUMP_PROGRAM_README.md`, `docs/CPI_README.md`, `docs/instructions/COIN_CREATION.md`, `docs/instructions/BUY.md`, `docs/BREAKING_FEE_RECIPIENT.md`, `docs/FEE_RECIPIENTS.md`, `docs/instructions/COLLECT_CREATOR_FEE.md`, `docs/instructions/CREATOR_FEE_SHARING.md`
- IDL-incompleteness report: https://github.com/pump-fun/pump-public-docs/issues/50
- SDK: `@pump-fun/pump-sdk` 2.0.0 (npm)
- Fees: https://pump.fun/docs/fees · ToS: https://pump.fun/docs/terms-and-conditions
- Metadata guide: https://github.com/pump-fun/pump-fun-skills/blob/main/create-coin/references/METADATA.md
- Closest open-source example: https://github.com/pumpfamily/pumpfamily (`05419b5`)
- Mainnet PDA-user CPI buy: https://solscan.io/tx/fJMumQP4a9YcTqNjJCtHRkRPqph8qFP7XRJnFzPw7UzNVriCqHyZxiVvhcKoSg9Ri7KMFn2vxdTWw6yCuVFPYFp
- Devnet CPI create_v2 + buy_v2: https://solscan.io/tx/3m995Bq4BAewVaWZa12aLXawFm8FHz1yDP9Q3uvpQMqLrR2NggMxSRu8825CFUNTTqroEN5vPcAWqXy2TsqYmY75?cluster=devnet
- Axiom metrics: https://docs.axiom.trade/axiom/finding-tokens/pulse

**Solana alternatives & tooling**
- Meteora DBC: https://docs.meteora.ag/developer-guides/dbc/rust-integration/cpi · https://github.com/MeteoraAg/dynamic-bonding-curve · https://docs.meteora.ag/core-products/dbc/fees/overview
- Raydium LaunchLab: https://docs.raydium.io/reference/program-addresses · https://docs.raydium.io/products/launchlab/instructions · https://github.com/raydium-io/raydium-cpi
- Market share: https://www.coingecko.com/learn/memecoin-launchpad-wars-pumpfun-stonkfun-ponsfamily
- Anchor 1.2.0: https://github.com/otter-sec/anchor/releases/tag/v1.2.0 · https://www.anchor-lang.com/docs/installation
- Squads v4 timelock: https://github.com/Squads-Protocol/v4 · https://docs.squads.so/main/navigating-your-squad/developers-assets/programs
- Helius plans/webhooks: https://www.helius.dev/docs/billing/plans · https://www.helius.dev/docs/api-reference/webhooks/create-webhook
- Jito endpoints: https://docs.jito.wtf/lowlatencytxnsend/
- Instruction introspection: https://solana.com/docs/core/instructions/instruction-introspection

**Robinhood Chain**
- Chain docs: https://docs.robinhood.com/chain/connecting · https://docs.robinhood.com/chain/differences-from-ethereum · https://docs.robinhood.com/chain/protocol-contracts · https://docs.robinhood.com/chain/terms-of-service · https://docs.robinhood.com/chain/deploy-smart-contracts
- Risk rating: https://l2beat.com/layer2s/projects/robinhood
- Uniswap: https://blog.uniswap.org/robinhood-chain-is-live · https://developers.uniswap.org/docs/protocols/v4/deployments · https://github.com/Uniswap/liquidity-launcher · https://github.com/Uniswap/uerc20-factory
- Pons: https://docs.ponsfamily.com/docs/v2
- Bags: https://docs.bags.fm/robinhood/overview
- Example contract-driven launch tx: `0xa0af55150de7066057d46ec00c19e6d5b4ff520eb22c34dc9bec45fa25484da4`
