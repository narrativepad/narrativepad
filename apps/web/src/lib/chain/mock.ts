// SIMULATION chain (D-009). Implements the escrow's rules (programs/narrative_escrow) against the
// database: same phase machine, caps, fee, opening-buy math, uniform vesting and refunds.
// No real funds or tokens exist. Addresses and signatures are labelled fakes.
import "server-only";
import { sha256 } from "@noble/hashes/sha2.js";
import bs58 from "bs58";
import { randomBytes } from "node:crypto";
import { big, date, q1, transaction, type Queryable } from "../db";
import { launchBreakdown, LAUNCH_RENT_RESERVE, MAX_CURVE_FILL_BPS, PUMP, proRata, unlockedTranches, vested } from "../math";
import { phaseOf } from "../phase";
import { unitOfEscrow } from "../pools";
import { curveOf } from "../units";
import { ChainError, tokenColumns, type ChainAdapter, type EscrowParams, type LaunchStatus } from "./types";

/** Rent a real launch used for the new mint, curve, ATAs and volume accumulator (devnet, 2026-10-02). */
const SIM_LAUNCH_RENT = 9_300_000n;

const fakeAddress = (kind: string, id: string) =>
  bs58.encode(sha256(new TextEncoder().encode(`narrativepad-sim:${kind}:${id}`)));
const fakeTx = () => `sim${bs58.encode(randomBytes(40))}`;

async function lockedEscrow(tx: Queryable, narrativeId: string) {
  const rows = (await tx.query(`SELECT * FROM escrows WHERE narrative_id = $1 FOR UPDATE`, [narrativeId])).rows;
  if (!rows[0]) throw new ChainError("NotFound", "Escrow not found");
  return rows[0];
}

const phaseFor = (e: any, now = Date.now()) =>
  phaseOf(
    {
      launched: Boolean(e.launched),
      depositStart: date(e.deposit_start).getTime(),
      depositEnd: date(e.deposit_end).getTime(),
      launchAfter: date(e.launch_after).getTime(),
      launchDeadline: date(e.launch_deadline).getTime(),
      totalDeposited: big(e.total_deposited),
      poolMin: big(e.pool_min),
    },
    now,
  );

export const mockAdapter: ChainAdapter = {
  kind: "mock",
  simulated: true,

  async createEscrow(p: EscrowParams) {
    const address = fakeAddress("escrow", p.narrativeId);
    const vault = fakeAddress("vault", p.narrativeId);
    const tx = fakeTx();
    await q1(
      `INSERT INTO escrows (narrative_id, chain, address, vault, create_tx, pool_cap, pool_min, per_wallet_max,
         min_deposit, fee_bps, deposit_start, deposit_end, launch_after, launch_deadline, tranche_count, tranche_interval,
         quote_symbol, quote_mint, quote_decimals, quote_program, quote_via_control, curve_reserves)
       VALUES ($1,'mock',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (narrative_id) DO NOTHING`,
      [
        p.narrativeId, address, vault, tx, p.poolCap.toString(), p.poolMin.toString(), p.perWalletMax.toString(),
        p.minDeposit.toString(), p.feeBps, p.depositStart, p.depositEnd, p.launchAfter, p.launchDeadline,
        p.trancheCount, p.trancheIntervalSec,
        ...tokenColumns(p),
      ],
    );
    return { address, vault, tx };
  },

  deposit: (narrativeId, wallet, amount, holderRewards) =>
    transaction(async (tx) => {
      const e = await lockedEscrow(tx, narrativeId);
      if (phaseFor(e) !== "pooling") throw new ChainError("NotPooling", "Deposit window is not open");
      if (amount < big(e.min_deposit)) throw new ChainError("DepositTooSmall", "Deposit is below the minimum");
      const r = (await tx.query(`SELECT * FROM receipts WHERE narrative_id = $1 AND wallet = $2`, [narrativeId, wallet])).rows[0];
      const walletTotal = big(r?.amount) + amount;
      if (walletTotal > big(e.per_wallet_max)) throw new ChainError("WalletCapExceeded", "Deposit would exceed the per-wallet maximum");
      const poolTotal = big(e.total_deposited) + amount;
      if (poolTotal > big(e.pool_cap)) throw new ChainError("PoolCapExceeded", "Deposit would exceed the pool cap");

      const orderIndex = Number(e.next_order_index);
      const sig = fakeTx();
      if (r) {
        await tx.query(`UPDATE receipts SET amount = $3, deposit_count = deposit_count + 1 WHERE narrative_id = $1 AND wallet = $2`, [
          narrativeId, wallet, walletTotal.toString(),
        ]);
      } else {
        await tx.query(
          `INSERT INTO receipts (narrative_id, wallet, amount, first_order_index, deposit_count) VALUES ($1,$2,$3,$4,1)`,
          [narrativeId, wallet, walletTotal.toString(), orderIndex],
        );
      }
      await tx.query(`INSERT INTO deposits (narrative_id, order_index, wallet, amount, tx, holder_rewards) VALUES ($1,$2,$3,$4,$5,$6)`, [
        narrativeId, orderIndex, wallet, amount.toString(), sig, holderRewards,
      ]);
      await tx.query(
        `UPDATE escrows SET total_deposited = $2, next_order_index = next_order_index + 1,
           depositor_count = depositor_count + $3,
           ${holderRewards ? "holder_votes_on = holder_votes_on" : "holder_votes_off = holder_votes_off"} + $4,
           synced_at = now() WHERE narrative_id = $1`,
        [narrativeId, poolTotal.toString(), r ? 0 : 1, amount.toString()],
      );
      return { tx: sig, orderIndex };
    }),

  launch: (narrativeId) =>
    transaction(async (tx) => {
      const e = await lockedEscrow(tx, narrativeId);
      if (phaseFor(e) !== "launchable") throw new ChainError("NotLaunchable", "Escrow is not launchable right now");
      const total = big(e.total_deposited);
      const curve = curveOf(unitOfEscrow(e));
      const b = launchBreakdown(total, Number(e.fee_bps), curve);
      if (b.budget <= 0n) throw new ChainError("PoolTooSmall", "Pool too small to cover fees and launch rent");
      if (b.tokens > (PUMP.realTokenReserves * MAX_CURVE_FILL_BPS) / 10_000n) {
        throw new ChainError("CurveOverfill", "Opening buy would fill too much of the bonding curve");
      }
      // SOL pools pay the launch rent from their reserve; token pools borrow it from the cranker.
      const leftover = curve.tokenPool ? 0n : LAUNCH_RENT_RESERVE - SIM_LAUNCH_RENT;
      const mint = fakeAddress("mint", narrativeId);
      const sig = fakeTx();
      // On-chain this becomes create_v2's `is_holder_reward` (not built in the program yet).
      const holderRewards = big(e.holder_votes_on) > big(e.holder_votes_off);
      await tx.query(
        `UPDATE escrows SET launched = TRUE, launched_at = now(), mint = $2, launch_tx = $3, platform_fee = $4,
           tokens_bought = $5, base_leftover = $6, holder_rewards = $7, synced_at = now() WHERE narrative_id = $1`,
        [narrativeId, mint, sig, b.platformFee.toString(), b.tokens.toString(), leftover.toString(), holderRewards],
      );
      return { tx: sig, mint, tokensBought: b.tokens, holderRewards };
    }),

  claim: (narrativeId, wallet) =>
    transaction(async (tx) => {
      const e = await lockedEscrow(tx, narrativeId);
      if (!e.launched) throw new ChainError("NotLaunched", "Escrow has not launched");
      const r = (await tx.query(`SELECT * FROM receipts WHERE narrative_id = $1 AND wallet = $2 FOR UPDATE`, [narrativeId, wallet])).rows[0];
      if (!r) throw new ChainError("NoReceipt", "This wallet did not deposit");

      const total = big(e.total_deposited);
      const unlocked = unlockedTranches(Date.now() / 1000, date(e.launched_at).getTime() / 1000, Number(e.tranche_interval), Number(e.tranche_count));
      const entitlement = proRata(big(e.tokens_bought), big(r.amount), total);
      const vestedNow = vested(entitlement, unlocked, Number(e.tranche_count));
      const tokens = vestedNow - big(r.tokens_claimed);
      const lamports = r.leftover_paid ? 0n : proRata(big(e.base_leftover), big(r.amount), total);
      if (tokens <= 0n && lamports <= 0n) throw new ChainError("NothingToClaim", "Nothing to claim yet");

      const sig = fakeTx();
      await tx.query(`UPDATE receipts SET tokens_claimed = $3, leftover_paid = TRUE WHERE narrative_id = $1 AND wallet = $2`, [
        narrativeId, wallet, vestedNow.toString(),
      ]);
      await tx.query(`UPDATE escrows SET tokens_claimed = tokens_claimed + $2, synced_at = now() WHERE narrative_id = $1`, [
        narrativeId, tokens.toString(),
      ]);
      await tx.query(
        `INSERT INTO claims (narrative_id, wallet, tokens, lamports, unlocked_tranches, tx) VALUES ($1,$2,$3,$4,$5,$6)`,
        [narrativeId, wallet, tokens.toString(), lamports.toString(), unlocked, sig],
      );
      return { tx: sig, tokens, lamports };
    }),

  refund: (narrativeId, wallet) =>
    transaction(async (tx) => {
      const e = await lockedEscrow(tx, narrativeId);
      if (phaseFor(e) !== "refundable") throw new ChainError("NotRefundable", "Escrow is not refundable");
      const r = (await tx.query(`SELECT * FROM receipts WHERE narrative_id = $1 AND wallet = $2 FOR UPDATE`, [narrativeId, wallet])).rows[0];
      if (!r || r.refunded) throw new ChainError("NoReceipt", "Nothing to refund for this wallet");
      const amount = big(r.amount);
      const sig = fakeTx();
      await tx.query(`UPDATE receipts SET refunded = TRUE WHERE narrative_id = $1 AND wallet = $2`, [narrativeId, wallet]);
      await tx.query(`UPDATE escrows SET total_refunded = total_refunded + $2, synced_at = now() WHERE narrative_id = $1`, [
        narrativeId, amount.toString(),
      ]);
      await tx.query(`INSERT INTO refunds (narrative_id, wallet, amount, tx) VALUES ($1,$2,$3,$4)`, [
        narrativeId, wallet, amount.toString(), sig,
      ]);
      return { tx: sig, amount };
    }),

  async getLaunchStatus(narrativeId): Promise<LaunchStatus> {
    const e = await q1<any>(`SELECT * FROM escrows WHERE narrative_id = $1`, [narrativeId]);
    return {
      launched: Boolean(e?.launched),
      holderRewards: e?.holder_rewards ?? null,
      mint: e?.mint ?? null,
      tx: e?.launch_tx ?? null,
      tokensBought: big(e?.tokens_bought),
      platformFee: big(e?.platform_fee),
      baseLeftover: big(e?.base_leftover),
      launchedAt: e?.launched_at ? date(e.launched_at) : null,
    };
  },

  explorer: { address: () => null, tx: () => null, token: () => null },
};

export { phaseFor };
