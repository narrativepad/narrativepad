// On-chain adapter (CHAIN=solana, D-021): the escrow program on DEVNET. Deposits are signed and sent
// by the depositor's wallet in the browser; this side opens escrows (operator key), cranks the
// launch, and pushes claims and refunds, which the program allows from anyone and always pays to
// the depositor. The database is only a cache, rebuilt from accounts and transactions by `sync`.
import "server-only";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type ParsedInstruction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { randomBytes } from "node:crypto";
import { config } from "../config";
import { q, q1 } from "../db";
import { fromHex, uuidBytes } from "../math";
import {
  claimIx,
  claimTokenIx,
  createEscrowIx,
  createTokenEscrowIx,
  decodeEscrow,
  decodeHolderVote,
  escrowPda,
  holderRewardsWouldApply,
  holderVotePda,
  launchIx,
  MEMO_PROGRAM_ID,
  parseEvents,
  parseHolderVoteMemo,
  programErrorName,
  PUMP_PROGRAM_ID,
  pumpCurveReserves,
  pumpFeesFromGlobal,
  pumpHolderRewardsEnabled,
  refundIx,
  refundTokenIx,
  vaultPda,
  type HolderVoteAccount,
  type PoolToken,
} from "../solana/escrow";
import { ChainError, tokenColumns, type ChainAdapter, type EscrowParams, type LaunchStatus } from "./types";

const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const EXPLORER = "https://explorer.solana.com";
const cluster = "?cluster=devnet";

let connection: Connection | null = null;
let checkedCluster: Promise<void> | null = null;

/** Every send goes through here first: refuses to touch anything but devnet (CLAUDE.md). */
async function devnet(): Promise<Connection> {
  connection ??= new Connection(config.solana.rpcUrl, "confirmed");
  checkedCluster ??= connection.getGenesisHash().then((h) => {
    if (h !== DEVNET_GENESIS) throw new Error("CHAIN=solana is devnet-only; the RPC is not devnet");
  });
  await checkedCluster.catch((e) => {
    checkedCluster = null;
    throw e;
  });
  return connection;
}

let operatorKey: Keypair | null = null;
/** The operator signs `create_escrow` and pays for cranks. Read from OPERATOR_KEYPAIR; never logged. */
function operator(): Keypair {
  if (operatorKey) return operatorKey;
  const raw = process.env.OPERATOR_KEYPAIR;
  if (!raw) throw new Error("OPERATOR_KEYPAIR is not set");
  operatorKey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  return operatorKey;
}

const FRIENDLY: Record<string, string> = {
  NotPooling: "The deposit window is not open",
  DepositTooSmall: "Deposit is below the minimum",
  WalletCapExceeded: "Deposit would exceed the per-wallet maximum",
  PoolCapExceeded: "Deposit would exceed the pool cap",
  TokenPool: "This pool holds a token, not SOL",
  NotATokenPool: "This pool holds SOL, not a token",
  InvalidQuoteMint: "pump.fun doesn't accept this pool's token",
  NotLaunchable: "Escrow is not launchable right now",
  NotRefundable: "Escrow is not refundable",
  NotLaunched: "Escrow has not launched",
  NothingToClaim: "Nothing to claim yet",
  PoolTooSmall: "Pool too small to cover fees and launch rent",
  CurveOverfill: "Opening buy would fill too much of the bonding curve",
};

/** Program errors become ChainErrors (409, quiet retries); anything else is a real failure. */
function toChainError(e: unknown): unknown {
  const text = [e instanceof Error ? e.message : String(e), ...((e as SendTransactionError)?.logs ?? [])].join("\n");
  const m = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  const code = m ? parseInt(m[1], 16) : NaN;
  const name = code >= 6000 ? programErrorName(code) : null;
  if (name) return new ChainError(name, FRIENDLY[name] ?? name);
  if (/AccountNotFound|insufficient (funds|lamports)/i.test(text)) return new ChainError("Unfunded", "The operator is out of devnet SOL");
  return e;
}

async function send(ixs: TransactionInstruction[], opts: { cu?: number; alt?: AddressLookupTableAccount } = {}): Promise<{ sig: string; logs: string[] }> {
  const conn = await devnet();
  const payer = operator();
  const pre = opts.cu ? [ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu })] : [];
  try {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [...pre, ...ixs] }).compileToV0Message(
      opts.alt ? [opts.alt] : [],
    );
    const tx = new VersionedTransaction(msg);
    tx.sign([payer]);
    const sig = await conn.sendTransaction(tx, { maxRetries: 3 });
    const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (res.value.err) throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
    const done = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    return { sig, logs: done?.meta?.logMessages ?? [] };
  } catch (e) {
    throw toChainError(e);
  }
}

async function escrowRow(narrativeId: string) {
  const row = await q1<any>(`SELECT * FROM escrows WHERE narrative_id = $1`, [narrativeId]);
  if (!row || row.chain !== "solana") throw new ChainError("NotFound", "Escrow not found");
  return row;
}

const secs = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

const pumpGlobal = () => PublicKey.findProgramAddressSync([new TextEncoder().encode("global")], PUMP_PROGRAM_ID)[0];

/** A token pool's token from its escrows row (D-023); null for SOL pools. */
const poolToken = (row: any): PoolToken | null =>
  row.quote_mint
    ? { mint: new PublicKey(row.quote_mint), tokenProgram: new PublicKey(row.quote_program), viaQuoteControl: Boolean(row.quote_via_control) }
    : null;

/** The pool's on-chain holder-rewards tally; null for escrows from before D-022 with no new deposit. */
async function holderVote(conn: Connection, escrow: PublicKey): Promise<HolderVoteAccount | null> {
  const acc = await conn.getAccountInfo(holderVotePda(escrow));
  return acc && acc.data.length ? decodeHolderVote(acc.data) : null;
}

/** Rebuild this escrow's cache from the chain: account totals, then every new transaction's
 *  events (deposits with their holder-rewards memo, claims, refunds, launch). Idempotent. */
async function syncEscrow(narrativeId: string): Promise<void> {
  const row = await q1<any>(`SELECT * FROM escrows WHERE narrative_id = $1`, [narrativeId]);
  if (!row || row.chain !== "solana") return;
  const conn = await devnet();
  const escrowKey = new PublicKey(row.address);
  const acc = await conn.getAccountInfo(escrowKey);
  if (!acc) return;
  const e = decodeEscrow(acc.data);

  const sigs = await conn.getSignaturesForAddress(escrowKey, { until: row.sync_sig ?? undefined, limit: 200 });
  for (const s of [...sigs].reverse()) {
    if (s.err) continue;
    const tx = await conn.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx?.meta) continue;
    const memo = tx.transaction.message.instructions.find(
      (ix): ix is ParsedInstruction => ix.programId.equals(MEMO_PROGRAM_ID) && "parsed" in ix && typeof ix.parsed === "string",
    );
    const memoVote = memo ? parseHolderVoteMemo(memo.parsed as string) : null;
    for (const ev of parseEvents(tx.meta.logMessages ?? [])) {
      if (!ev.escrow.equals(escrowKey)) continue;
      if (ev.kind === "Deposited") {
        // D-022 deposits carry the vote in the event; earlier ones in a memo.
        const vote = ev.holderRewards ?? memoVote;
        await q(
          `INSERT INTO deposits (narrative_id, order_index, wallet, amount, tx, holder_rewards, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,to_timestamp($7)) ON CONFLICT (narrative_id, order_index) DO NOTHING`,
          [narrativeId, ev.orderIndex, ev.wallet.toBase58(), ev.amount.toString(), s.signature, vote, Number(ev.timestamp)],
        );
      } else if (ev.kind === "Claimed") {
        await q(
          `INSERT INTO claims (narrative_id, wallet, tokens, lamports, unlocked_tranches, tx, created_at)
           SELECT $1,$2,$3,$4,$5,$6,to_timestamp($7)
           WHERE NOT EXISTS (SELECT 1 FROM claims WHERE tx = $6 AND wallet = $2)`,
          [narrativeId, ev.wallet.toBase58(), ev.tokens.toString(), ev.leftoverLamports.toString(), ev.unlockedTranches, s.signature, s.blockTime ?? Date.now() / 1000],
        );
      } else if (ev.kind === "Refunded") {
        await q(
          `INSERT INTO refunds (narrative_id, wallet, amount, tx, created_at)
           SELECT $1,$2,$3,$4,to_timestamp($5)
           WHERE NOT EXISTS (SELECT 1 FROM refunds WHERE tx = $4 AND wallet = $2)`,
          [narrativeId, ev.wallet.toBase58(), ev.amount.toString(), s.signature, s.blockTime ?? Date.now() / 1000],
        );
      } else if (ev.kind === "Launched") {
        await q(`UPDATE escrows SET launch_tx = $2, platform_fee = $3 WHERE narrative_id = $1`, [narrativeId, s.signature, ev.platformFee.toString()]);
      }
    }
  }

  // Receipts are rebuilt from the deposits, claims and refunds just read.
  await q(
    `INSERT INTO receipts (narrative_id, wallet, amount, first_order_index, deposit_count)
     SELECT narrative_id, wallet, SUM(amount), MIN(order_index), COUNT(*) FROM deposits WHERE narrative_id = $1 GROUP BY narrative_id, wallet
     ON CONFLICT (narrative_id, wallet) DO UPDATE SET amount = EXCLUDED.amount, first_order_index = EXCLUDED.first_order_index, deposit_count = EXCLUDED.deposit_count`,
    [narrativeId],
  );
  await q(
    `UPDATE receipts r SET
       tokens_claimed = COALESCE((SELECT SUM(c.tokens) FROM claims c WHERE c.narrative_id = r.narrative_id AND c.wallet = r.wallet), 0),
       leftover_paid = EXISTS (SELECT 1 FROM claims c WHERE c.narrative_id = r.narrative_id AND c.wallet = r.wallet),
       refunded = EXISTS (SELECT 1 FROM refunds f WHERE f.narrative_id = r.narrative_id AND f.wallet = r.wallet)
     WHERE r.narrative_id = $1`,
    [narrativeId],
  );
  // Totals come from the accounts: the chain wins. The vote tally and its result come from the
  // HolderVote account (D-022); escrows from before it fall back to the deposits' memo votes.
  const vote = await holderVote(conn, escrowKey);
  await q(
    `UPDATE escrows SET total_deposited = $2::bigint, total_refunded = $3::bigint, depositor_count = $4::int, next_order_index = $5::int,
       launched = $6::boolean,
       launched_at = CASE WHEN $6::boolean THEN to_timestamp($7::double precision) ELSE NULL END,
       mint = CASE WHEN $6::boolean THEN $8::text ELSE NULL END,
       tokens_bought = $9::bigint, tokens_claimed = $10::bigint, base_leftover = $11::bigint,
       platform_fee = CASE WHEN $6::boolean THEN COALESCE(platform_fee, $2::bigint * fee_bps / 10000) ELSE NULL END,
       holder_rewards = CASE WHEN $6::boolean THEN COALESCE($13::boolean, FALSE) ELSE NULL END,
       holder_votes_on = COALESCE($14::bigint, (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE narrative_id = $1 AND holder_rewards = TRUE)),
       holder_votes_off = COALESCE($15::bigint, (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE narrative_id = $1 AND holder_rewards = FALSE)),
       sync_sig = COALESCE($12::text, sync_sig), synced_at = now()
     WHERE narrative_id = $1`,
    [
      narrativeId,
      e.totalDeposited.toString(),
      e.totalRefunded.toString(),
      e.depositorCount,
      e.nextOrderIndex,
      e.launched,
      Number(e.launchedAt),
      e.mint.toBase58(),
      e.tokensBought.toString(),
      e.tokensClaimed.toString(),
      e.baseLeftover.toString(),
      sigs[0]?.signature ?? null,
      vote ? vote.applied : null,
      vote ? vote.on.toString() : null,
      vote ? vote.off.toString() : null,
    ],
  );
}

let altCache: AddressLookupTableAccount | null = null;
async function launchAlt(conn: Connection) {
  if (altCache) return altCache;
  if (!config.solana.launchAlt) throw new Error("LAUNCH_ALT is not set (scripts/devnet-create-alt.ts)");
  altCache = (await conn.getAddressLookupTable(new PublicKey(config.solana.launchAlt))).value;
  if (!altCache) throw new Error("LAUNCH_ALT does not exist on devnet");
  return altCache;
}

export const solanaAdapter: ChainAdapter = {
  kind: "solana",
  simulated: false,

  async createEscrow(p: EscrowParams) {
    const conn = await devnet();
    const escrow = escrowPda(uuidBytes(p.narrativeId));
    const vault = vaultPda(escrow);
    const u = p.pool.unit;
    const token: PoolToken | null = u.mint
      ? { mint: new PublicKey(u.mint), tokenProgram: new PublicKey(u.tokenProgram!), viaQuoteControl: p.pool.viaQuoteControl }
      : null;
    // pump's starting reserves for this currency on devnet, for the site's estimates.
    const global = await conn.getAccountInfo(pumpGlobal());
    const curveReserves = global ? pumpCurveReserves(global.data, token !== null) : null;
    // Idempotent: if an earlier attempt landed but its reply was lost, adopt the escrow.
    let tx = "existing";
    if (!(await conn.getAccountInfo(escrow))) {
      const args = {
          narrativeId16: uuidBytes(p.narrativeId),
          name: p.name,
          symbol: p.symbol,
          uri: p.uri,
          detailsHash: fromHex(p.detailsHash),
          lockHash: fromHex(p.lockHash),
          proposer: new PublicKey(p.proposer),
          perWalletMax: p.perWalletMax,
          poolCap: p.poolCap,
          poolMin: p.poolMin,
          minDeposit: p.minDeposit,
          depositStart: secs(p.depositStart),
          depositEnd: secs(p.depositEnd),
          launchAfter: secs(p.launchAfter),
          launchDeadline: secs(p.launchDeadline),
          trancheCount: p.trancheCount,
          trancheInterval: BigInt(p.trancheIntervalSec),
      };
      const op = operator().publicKey;
      ({ sig: tx } = await send([token ? createTokenEscrowIx(op, args, token) : createEscrowIx(op, args)]));
    }
    await q(
      `INSERT INTO escrows (narrative_id, chain, address, vault, create_tx, pool_cap, pool_min, per_wallet_max,
         min_deposit, fee_bps, deposit_start, deposit_end, launch_after, launch_deadline, tranche_count, tranche_interval,
         quote_symbol, quote_mint, quote_decimals, quote_program, quote_via_control, curve_reserves)
       VALUES ($1,'solana',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (narrative_id) DO NOTHING`,
      [
        p.narrativeId, escrow.toBase58(), vault.toBase58(), tx, p.poolCap.toString(), p.poolMin.toString(), p.perWalletMax.toString(),
        p.minDeposit.toString(), p.feeBps, p.depositStart, p.depositEnd, p.launchAfter, p.launchDeadline, p.trancheCount, p.trancheIntervalSec,
        ...tokenColumns(p, curveReserves),
      ],
    );
    await syncEscrow(p.narrativeId);
    return { address: escrow.toBase58(), vault: vault.toBase58(), tx };
  },

  async deposit() {
    throw new ChainError("OnChain", "Deposits are sent from your wallet");
  },

  async launch(narrativeId) {
    const row = await escrowRow(narrativeId);
    const conn = await devnet();
    const escrow = new PublicKey(row.address);
    const acc = await conn.getAccountInfo(escrow);
    if (!acc) throw new ChainError("NotFound", "Escrow not found on-chain");
    const e = decodeEscrow(acc.data);
    const global = await conn.getAccountInfo(pumpGlobal());
    if (!global) throw new Error("pump Global not found");
    // The program decides holder rewards from the tally and pump's switch (D-022); the accounts
    // passed to pump must match that decision, so predict it the same way.
    const holderRewards = holderRewardsWouldApply(await holderVote(conn, escrow), pumpHolderRewardsEnabled(global.data));
    const nonce = randomBytes(8).readBigUInt64LE();
    const { ix, mint } = launchIx({
      cranker: operator().publicKey,
      escrow,
      treasury: e.treasury,
      nonce,
      fees: pumpFeesFromGlobal(global.data),
      createPayer: config.solana.createPayer,
      holderRewards,
      token: poolToken(row) ?? undefined,
    });
    const { sig } = await send([ix], { cu: 1_000_000, alt: await launchAlt(conn) });
    await syncEscrow(narrativeId);
    await q(`UPDATE escrows SET launch_tx = COALESCE(launch_tx, $2) WHERE narrative_id = $1`, [narrativeId, sig]);
    const after = decodeEscrow((await conn.getAccountInfo(escrow))!.data);
    const applied = (await holderVote(conn, escrow))?.applied ?? false;
    return { tx: sig, mint: mint.toBase58(), tokensBought: after.tokensBought, holderRewards: applied };
  },

  async claim(narrativeId, wallet) {
    const row = await escrowRow(narrativeId);
    if (!row.launched || !row.mint) throw new ChainError("NotLaunched", "Escrow has not launched");
    const [op, escrow, owner, mint] = [operator().publicKey, new PublicKey(row.address), new PublicKey(wallet), new PublicKey(row.mint)];
    const token = poolToken(row);
    const ix = token ? claimTokenIx(op, escrow, owner, mint, token) : claimIx(op, escrow, owner, mint);
    const { sig, logs } = await send([ix], { cu: 300_000 });
    await syncEscrow(narrativeId);
    const ev = parseEvents(logs).find((x) => x.kind === "Claimed");
    return ev && ev.kind === "Claimed" ? { tx: sig, tokens: ev.tokens, lamports: ev.leftoverLamports } : { tx: sig, tokens: 0n, lamports: 0n };
  },

  async refund(narrativeId, wallet) {
    const row = await escrowRow(narrativeId);
    const [escrow, owner] = [new PublicKey(row.address), new PublicKey(wallet)];
    const token = poolToken(row);
    // Token refunds recreate a closed token account; the operator pays that rent, never the pool.
    const ix = token ? refundTokenIx(operator().publicKey, escrow, owner, token) : refundIx(escrow, owner);
    const { sig, logs } = await send([ix], { cu: token ? 200_000 : undefined });
    await syncEscrow(narrativeId);
    const ev = parseEvents(logs).find((x) => x.kind === "Refunded");
    return { tx: sig, amount: ev && ev.kind === "Refunded" ? ev.amount : 0n };
  },

  async getLaunchStatus(narrativeId): Promise<LaunchStatus> {
    const row = await escrowRow(narrativeId);
    const conn = await devnet();
    const acc = await conn.getAccountInfo(new PublicKey(row.address));
    if (!acc) throw new ChainError("NotFound", "Escrow not found on-chain");
    const e = decodeEscrow(acc.data);
    const vote = await holderVote(conn, new PublicKey(row.address));
    return {
      launched: e.launched,
      holderRewards: e.launched ? (vote?.applied ?? false) : null,
      mint: e.launched ? e.mint.toBase58() : null,
      tx: row.launch_tx ?? null,
      tokensBought: e.tokensBought,
      platformFee: e.launched ? (e.totalDeposited * BigInt(e.feeBps)) / 10_000n : 0n,
      baseLeftover: e.baseLeftover,
      launchedAt: e.launched ? new Date(Number(e.launchedAt) * 1000) : null,
    };
  },

  sync: syncEscrow,

  explorer: {
    address: (a) => `${EXPLORER}/address/${a}${cluster}`,
    tx: (s) => `${EXPLORER}/tx/${s}${cluster}`,
    token: (m) => `${EXPLORER}/address/${m}${cluster}`,
  },
};
