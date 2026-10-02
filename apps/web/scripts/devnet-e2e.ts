// End-to-end on DEVNET (D-021): a local server with CHAIN=solana, the deployed escrow program and
// pump.fun's devnet program. Two throwaway wallets are funded from a local key file (devnet SOL
// only), deposit with wallet-signed transactions, and the server opens, launches, claims and
// refunds on-chain. Everything is checked against the chain, not just the API.
//
// USDC pools (D-023) run too when the funder holds at least 3 devnet USDC (faucet.circle.com,
// "Solana Devnet"): the same flow with the pool in USDC, including the 1% fee in USDC to the
// treasury and an automatic USDC refund.
//
// Server (example):
//   CHAIN=solana OPERATOR_KEYPAIR=<json> LAUNCH_ALT=<address> VOTE_DURATION_SEC=25 DEPOSIT_WINDOW_SEC=80 \
//   LAUNCH_DELAY_SEC=5 LAUNCH_WINDOW_SEC=150 TRANCHE_COUNT=2 TRANCHE_INTERVAL_SEC=30 POOL_CAP_SOL=0.5 \
//   POOL_MIN_SOL=0.1 PER_WALLET_MAX_SOL=0.25 MIN_DEPOSIT_SOL=0.01 npx next start -p 3921
// Then: node --experimental-strip-types scripts/devnet-e2e.ts http://localhost:3921 <funder-keypair.json>
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uuidBytes } from "../src/lib/math.ts";
import { buildMessage, type Action, type Payload } from "../src/lib/messages.ts";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  ata,
  decodeEscrow,
  decodeHolderVote,
  depositIx,
  depositTokenIx,
  escrowPda,
  holderVotePda,
  PROGRAM_ID,
  programErrorName,
  PUMP_PROGRAM_ID,
  pumpHolderRewardsEnabled,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  vaultPda,
} from "../src/lib/solana/escrow.ts";

const BASE = process.argv[2] ?? "http://localhost:3921";
const FUNDER = process.argv[3];
if (!FUNDER) throw new Error("usage: devnet-e2e.ts <base-url> <funder-keypair.json>");
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SOL = BigInt(LAMPORTS_PER_SOL);
const USDC = 1_000_000n;
/** Circle's devnet USDC: pump's whitelisted quote on devnet. */
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const usdcAta = (owner: PublicKey) => ata(owner, USDC_MINT, SPL_TOKEN_PROGRAM_ID);

/** Creates `owner`'s USDC account if needed and sends it `amount` from `from` (SPL Token TransferChecked). */
function sendUsdcIxs(from: PublicKey, owner: PublicKey, amount: bigint): TransactionInstruction[] {
  const createIdempotent = new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: usdcAta(owner), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
  const data = Buffer.alloc(10);
  data[0] = 12; // TransferChecked
  data.writeBigUInt64LE(amount, 1);
  data[9] = 6;
  const transfer = new TransactionInstruction({
    programId: SPL_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: usdcAta(from), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: usdcAta(owner), isSigner: false, isWritable: true },
      { pubkey: from, isSigner: true, isWritable: false },
    ],
    data,
  });
  return [createIdempotent, transfer];
}
const usdcOf = async (owner: PublicKey) => {
  try {
    return BigInt((await conn.getTokenAccountBalance(usdcAta(owner))).value.amount);
  } catch {
    return 0n;
  }
};

class Wallet {
  seed = ed25519.utils.randomSecretKey();
  kp = Keypair.fromSeed(this.seed);
  address = this.kp.publicKey.toBase58();
  async signed<A extends Action>(path: string, action: A, payload: Payload<A>) {
    const { nonce } = await (await fetch(`${BASE}/api/auth/nonce?wallet=${this.address}`)).json();
    const issuedAt = new Date().toISOString();
    const message = buildMessage({ action, payload, wallet: this.address, nonce, issuedAt, simulation: false });
    const signature = bs58.encode(ed25519.sign(new TextEncoder().encode(message), this.seed));
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: this.address, nonce, issuedAt, signature, payload }),
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  /** What the browser does: a wallet-signed deposit carrying the holder-rewards vote. */
  async deposit(narrativeId: string, lamports: bigint, holderRewards: boolean, usdc = false) {
    const escrow = escrowPda(uuidBytes(narrativeId));
    const ix = usdc
      ? depositTokenIx(this.kp.publicKey, escrow, { mint: USDC_MINT, tokenProgram: SPL_TOKEN_PROGRAM_ID }, lamports, holderRewards)
      : depositIx(this.kp.publicKey, escrow, lamports, holderRewards);
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(conn, tx, [this.kp], { commitment: "confirmed" });
    await fetch(`${BASE}/api/narratives/${narrativeId}/sync`, { method: "POST" });
    return sig;
  }
}

async function detail(slug: string) {
  return (await fetch(`${BASE}/api/n/${slug}`)).json();
}
async function waitFor(slug: string, pred: (n: any) => boolean, label: string, timeoutMs: number) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const n = await detail(slug);
    if (pred(n)) return n;
    await sleep(3000);
  }
  throw new Error(`timeout waiting for ${label}`);
}
let step = 0;
const ok = (msg: string) => console.log(`  ✓ ${String(++step).padStart(2, "0")} ${msg}`);
const explorer = (kind: string, id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;

async function main() {
  console.log(`Devnet E2E against ${BASE}`);
  assert.equal(await conn.getGenesisHash(), "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", "devnet only");
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(FUNDER, "utf8"))));
  const [alice, bob] = [new Wallet(), new Wallet()];
  const fund = new Transaction();
  for (const w of [alice, bob]) fund.add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: w.kp.publicKey, lamports: Number(SOL / 10n) }));
  await sendAndConfirmTransaction(conn, fund, [funder], { commitment: "confirmed" });
  ok("two throwaway wallets funded with 0.1 devnet SOL each");

  // ---- vote → lock → escrow on-chain ---------------------------------------------------------
  const created = await alice.signed("/api/narratives", "create", { pitch: "Devnet E2E: a coin built by the crowd, launched on pump.fun devnet.", name: "Devnet Dog", ticker: "DVDOG", pair: "SOL" });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const { id, slug } = created.data;
  let n = await detail(slug);
  const vote = (w: Wallet, field: "name" | "ticker", value: string) =>
    w.signed(`/api/narratives/${id}/vote`, "vote", { narrativeId: id, field, submissionId: n.ballots[field].entries.find((e: any) => e.value === value).id });
  for (const w of [alice, bob]) {
    assert.equal((await vote(w, "name", "Devnet Dog")).status, 200);
    assert.equal((await vote(w, "ticker", "DVDOG")).status, 200);
  }
  ok(`narrative ${slug} created and voted`);

  n = await waitFor(slug, (x) => x.escrow?.address, "escrow on devnet", 120_000);
  const escrow = new PublicKey(n.escrow.address);
  assert.ok(escrow.equals(escrowPda(uuidBytes(id))));
  const acc = await conn.getAccountInfo(escrow);
  assert.ok(acc?.owner.equals(PROGRAM_ID), "escrow account owned by the program");
  const onchain = decodeEscrow(acc!.data);
  assert.equal(onchain.name, n.lock.name);
  assert.equal(onchain.symbol, n.lock.symbol);
  assert.equal(onchain.uri, n.lock.metadataUri);
  ok(`escrow opened on devnet with the locked name/ticker/uri: ${explorer("address", escrow.toBase58())}`);

  // ---- deposits (wallet-signed, vote in a memo) ------------------------------------------------
  try {
    await alice.deposit(id, SOL / 1000n, true);
    assert.fail("a deposit under the minimum must fail");
  } catch (e) {
    const code = /custom program error: 0x([0-9a-f]+)/i.exec(String((e as any)?.logs ?? e))?.[1];
    assert.equal(code ? programErrorName(parseInt(code, 16)) : null, "DepositTooSmall", String(e));
  }
  ok("deposit under the minimum rejected by the program (DepositTooSmall)");

  const a1 = await alice.deposit(id, (SOL * 8n) / 100n, true);
  await bob.deposit(id, (SOL * 6n) / 100n, false);
  n = await waitFor(slug, (x) => x.deposits?.length === 2, "two deposits synced", 60_000);
  assert.equal(n.escrow.totalDeposited, ((SOL * 14n) / 100n).toString());
  assert.deepEqual(n.deposits.map((d: any) => [d.orderIndex, d.wallet, d.holderRewards]), [
    [0, alice.address, true],
    [1, bob.address, false],
  ]);
  assert.equal(n.escrow.holderVotesOn, ((SOL * 8n) / 100n).toString());
  assert.equal(BigInt(await conn.getBalance(vaultPda(escrow))) >= (SOL * 14n) / 100n, true, "the SOL is in the vault");
  const tally = decodeHolderVote((await conn.getAccountInfo(holderVotePda(escrow)))!.data);
  assert.deepEqual([tally.on, tally.off], [(SOL * 8n) / 100n, (SOL * 6n) / 100n], "the escrow tallies the votes on-chain");
  ok(`0.14 SOL deposited by two wallets, in order; on-chain tally 0.08 on / 0.06 off: ${explorer("tx", a1)}`);

  // ---- launch on pump.fun devnet ---------------------------------------------------------------
  n = await waitFor(slug, (x) => x.escrow?.launched, "launch", 300_000);
  const after = decodeEscrow((await conn.getAccountInfo(escrow))!.data);
  assert.equal(after.launched, true);
  assert.ok(after.tokensBought > 0n);
  const vaultTokens = await conn.getTokenAccountBalance(ata(vaultPda(escrow), after.mint, TOKEN_2022_PROGRAM_ID));
  assert.equal(vaultTokens.value.amount, after.tokensBought.toString(), "the vault holds every token bought");
  assert.equal(n.stage, "live");
  // "On" won the vote. The escrow applies it only if pump allows holder rewards (off on devnet).
  const pumpGlobal = await conn.getAccountInfo(PublicKey.findProgramAddressSync([new TextEncoder().encode("global")], PUMP_PROGRAM_ID)[0]);
  const expected = pumpHolderRewardsEnabled(pumpGlobal!.data);
  const settled = decodeHolderVote((await conn.getAccountInfo(holderVotePda(escrow)))!.data);
  assert.equal(settled.applied, expected, "holder rewards applied iff pump allows them");
  assert.equal(n.escrow.holderRewards, expected);
  const curve = await conn.getAccountInfo(PublicKey.findProgramAddressSync([new TextEncoder().encode("bonding-curve"), after.mint.toBytes()], PUMP_PROGRAM_ID)[0]);
  const creator = new PublicKey(curve!.data.subarray(49, 81));
  assert.ok(creator.equals(expected ? PublicKey.findProgramAddressSync([new TextEncoder().encode("holder-rewards"), after.mint.toBytes()], PUMP_PROGRAM_ID)[0] : vaultPda(escrow)));
  ok(`launched on pump.fun devnet: ${after.tokensBought} base units; holder rewards ${expected ? "on" : "off (pump has them disabled on devnet)"}, creator ${creator.toBase58().slice(0, 6)}…`);
  if (n.escrow.launchTxUrl) console.log(`       launch tx: ${n.escrow.launchTxUrl}`);

  // ---- claim (server pushes; tokens land in the depositor's account) --------------------------
  const claim = await alice.signed(`/api/narratives/${id}/claim`, "claim", { narrativeId: id });
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  const aliceTokens = await conn.getTokenAccountBalance(ata(alice.kp.publicKey, after.mint, TOKEN_2022_PROGRAM_ID));
  assert.ok(BigInt(aliceTokens.value.amount) > 0n, "alice holds tokens");
  ok(`first tranche claimed into alice's wallet: ${aliceTokens.value.uiAmountString} tokens`);

  // ---- refund path (pool under the minimum) ----------------------------------------------------
  const thin = await bob.signed("/api/narratives", "create", { pitch: "Devnet E2E: a pool that never reaches its minimum, to test refunds.", name: "Thin Devnet", ticker: "THIND", pair: "SOL" });
  assert.equal(thin.status, 200, JSON.stringify(thin.data));
  const { id: id2, slug: slug2 } = thin.data;
  await waitFor(slug2, (x) => x.escrow?.address && x.stage === "pooling", "second escrow", 120_000);
  const before = BigInt(await conn.getBalance(bob.kp.publicKey));
  await bob.deposit(id2, (SOL * 2n) / 100n, true);
  const n2 = await waitFor(slug2, (x) => x.holders?.[0]?.refunded, "automatic refund", 300_000);
  assert.equal(n2.stage, "refunding");
  const back = BigInt(await conn.getBalance(bob.kp.publicKey));
  assert.ok(back > before - SOL / 100n, `bob got his 0.02 SOL back (before ${before}, after ${back})`);
  ok("under-minimum pool refunded automatically, 100% back to the depositor");

  await usdcPools(funder, alice, bob);

  console.log(`\nAll ${step} devnet checks passed.`);
}

/** The same flow with USDC pools (D-023): wallets deposit USDC, the launch buys with USDC. */
async function usdcPools(funder: Keypair, alice: Wallet, bob: Wallet) {
  const have = await usdcOf(funder.publicKey);
  if (have < 3n * USDC) {
    console.log(`  - USDC pools skipped: the funder has ${Number(have) / 1e6} devnet USDC, needs 3 (faucet.circle.com, Solana Devnet)`);
    return;
  }
  const fund = new Transaction().add(...sendUsdcIxs(funder.publicKey, alice.kp.publicKey, 3n * USDC / 2n), ...sendUsdcIxs(funder.publicKey, bob.kp.publicKey, 3n * USDC / 2n));
  await sendAndConfirmTransaction(conn, fund, [funder], { commitment: "confirmed" });
  ok("alice and bob funded with 1.5 devnet USDC each");

  const created = await alice.signed("/api/narratives", "create", { pitch: "Devnet E2E: a coin paired with USDC, bought by a USDC pool.", name: "Dollar Dog", ticker: "DDOG", pair: "USDC" });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const { id, slug } = created.data;
  let n = await detail(slug);
  assert.equal(n.pair.symbol, "USDC");
  for (const w of [alice, bob]) {
    for (const field of ["name", "ticker"] as const) {
      const value = field === "name" ? "Dollar Dog" : "DDOG";
      const r = await w.signed(`/api/narratives/${id}/vote`, "vote", { narrativeId: id, field, submissionId: n.ballots[field].entries.find((e: any) => e.value === value).id });
      assert.equal(r.status, 200);
    }
  }
  n = await waitFor(slug, (x) => x.escrow?.address, "USDC escrow on devnet", 120_000);
  const escrow = new PublicKey(n.escrow.address);
  assert.equal(n.escrow.unit.mint, USDC_MINT.toBase58());
  assert.equal(n.lock.launch.pairMint, USDC_MINT.toBase58(), "the lock commits to devnet USDC");
  const vaultUsdc = usdcAta(vaultPda(escrow));
  assert.ok(await conn.getAccountInfo(vaultUsdc), "the escrow opened its USDC account");
  ok(`USDC escrow opened on devnet: ${explorer("address", escrow.toBase58())}`);

  const d1 = await alice.deposit(id, USDC, true, true);
  await bob.deposit(id, USDC / 2n, false, true);
  n = await waitFor(slug, (x) => x.deposits?.length === 2, "two USDC deposits synced", 60_000);
  assert.equal(n.escrow.totalDeposited, ((3n * USDC) / 2n).toString());
  assert.equal(await usdcOf(vaultPda(escrow)), (3n * USDC) / 2n, "the USDC is in the vault's token account");
  const tally = decodeHolderVote((await conn.getAccountInfo(holderVotePda(escrow)))!.data);
  assert.deepEqual([tally.on, tally.off], [USDC, USDC / 2n], "the vote counts USDC");
  ok(`1.5 USDC deposited by two wallets; on-chain tally 1 on / 0.5 off: ${explorer("tx", d1)}`);

  n = await waitFor(slug, (x) => x.escrow?.launched, "USDC launch", 300_000);
  const after = decodeEscrow((await conn.getAccountInfo(escrow))!.data);
  assert.ok(after.tokensBought > 0n);
  const curve = await conn.getAccountInfo(PublicKey.findProgramAddressSync([new TextEncoder().encode("bonding-curve"), after.mint.toBytes()], PUMP_PROGRAM_ID)[0]);
  assert.ok(curve, "pump created the bonding curve");
  const fee = await usdcOf(after.treasury);
  assert.ok(fee >= (3n * USDC) / 200n, `the treasury got its 1% in USDC (${fee})`);
  ok(`USDC pool launched on pump.fun devnet: ${after.tokensBought} base units; 1% fee paid in USDC`);
  if (n.escrow.launchTxUrl) console.log(`       launch tx: ${n.escrow.launchTxUrl}`);

  const claim = await alice.signed(`/api/narratives/${id}/claim`, "claim", { narrativeId: id });
  assert.equal(claim.status, 200, JSON.stringify(claim.data));
  const aliceTokens = await conn.getTokenAccountBalance(ata(alice.kp.publicKey, after.mint, TOKEN_2022_PROGRAM_ID));
  assert.ok(BigInt(aliceTokens.value.amount) > 0n);
  ok(`first tranche claimed from the USDC pool: ${aliceTokens.value.uiAmountString} tokens`);

  const thin = await bob.signed("/api/narratives", "create", { pitch: "Devnet E2E: a USDC pool that never reaches its minimum.", name: "Thin Dollar", ticker: "THUSD", pair: "USDC" });
  assert.equal(thin.status, 200, JSON.stringify(thin.data));
  await waitFor(thin.data.slug, (x) => x.escrow?.address && x.stage === "pooling", "thin USDC escrow", 120_000);
  const before = await usdcOf(bob.kp.publicKey);
  await bob.deposit(thin.data.id, USDC / 2n, true, true);
  assert.equal(await usdcOf(bob.kp.publicKey), before - USDC / 2n);
  await waitFor(thin.data.slug, (x) => x.holders?.[0]?.refunded, "automatic USDC refund", 300_000);
  assert.equal(await usdcOf(bob.kp.publicKey), before, "bob has every USDC back");
  ok("under-minimum USDC pool refunded automatically, 100% back in USDC");
}

main().catch((e) => {
  console.error("\nDEVNET E2E FAILED:", e);
  process.exit(1);
});
