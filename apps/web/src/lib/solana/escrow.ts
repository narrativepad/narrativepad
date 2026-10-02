// Client for programs/narrative_escrow, shared by the browser (deposits) and the server
// (create, launch, claim, refund, sync). Hand-written from the published IDL, like the program's
// own pump CPI, so there's no Anchor client dependency. Discriminators and layouts must match
// the deployed program (D-021); scripts/devnet-e2e.ts exercises every builder against devnet.
import { Buffer } from "buffer";
import { PublicKey, SystemProgram, TransactionInstruction, type AccountMeta } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("42bwRMxcnpbfiH1K68dGuVkgEWdZoWY72fZ7VVVcbVrY");
export const PUMP_PROGRAM_ID = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
export const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");
export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const IX = {
  createEscrow: [253, 215, 165, 116, 36, 108, 68, 80],
  deposit: [242, 35, 198, 137, 82, 225, 242, 182],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  refund: [2, 96, 183, 251, 63, 208, 46, 46],
  launch: [153, 241, 93, 225, 22, 69, 74, 61],
  createTokenEscrow: [2, 244, 224, 50, 222, 248, 182, 62],
  depositToken: [11, 156, 96, 218, 39, 163, 180, 19],
  refundToken: [198, 194, 93, 209, 12, 211, 46, 174],
  claimToken: [116, 206, 27, 191, 166, 19, 0, 73],
};
const ACCOUNT = {
  escrow: [31, 213, 123, 187, 186, 22, 218, 155],
  receipt: [39, 154, 73, 106, 80, 102, 145, 153],
  holderVote: [219, 96, 222, 206, 34, 240, 57, 113],
  poolQuote: [216, 246, 97, 88, 84, 90, 118, 97],
};
const EVENT = {
  Deposited: [111, 141, 26, 45, 161, 35, 100, 57],
  Launched: [209, 127, 29, 152, 129, 212, 189, 183],
  Claimed: [217, 192, 123, 72, 108, 150, 248, 33],
  Refunded: [35, 103, 149, 246, 196, 123, 221, 99],
};

// ---- addresses ------------------------------------------------------------------------------

const enc = new TextEncoder();
const pda = (seeds: Uint8Array[], program: PublicKey) => PublicKey.findProgramAddressSync(seeds, program)[0];
const u64le = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
};

export const configPda = () => pda([enc.encode("config")], PROGRAM_ID);
export const escrowPda = (narrativeId16: Uint8Array) => pda([enc.encode("escrow"), narrativeId16], PROGRAM_ID);
export const vaultPda = (escrow: PublicKey) => pda([enc.encode("vault"), escrow.toBytes()], PROGRAM_ID);
export const receiptPda = (escrow: PublicKey, wallet: PublicKey) => pda([enc.encode("receipt"), escrow.toBytes(), wallet.toBytes()], PROGRAM_ID);
export const mintPda = (escrow: PublicKey, nonce: bigint) => pda([enc.encode("mint"), escrow.toBytes(), u64le(nonce)], PROGRAM_ID);
/** The pool's holder-rewards tally (D-022). */
export const holderVotePda = (escrow: PublicKey) => pda([enc.encode("holder_vote"), escrow.toBytes()], PROGRAM_ID);
/** pump's creator for a holder-rewards coin. */
export const holderRewardsPda = (mint: PublicKey) => pda([enc.encode("holder-rewards"), mint.toBytes()], PUMP_PROGRAM_ID);
/** A token pool's token (D-023); no account = SOL pool. Every SOL instruction passes it so the
 *  program can refuse token pools. */
export const poolQuotePda = (escrow: PublicKey) => pda([enc.encode("pool_quote"), escrow.toBytes()], PROGRAM_ID);
/** pump's list of quote mints admitted outside Global's whitelist. */
export const quoteControlPda = () => pda([enc.encode("quote-control")], PUMP_PROGRAM_ID);
export const ata = (owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey) =>
  pda([owner.toBytes(), tokenProgram.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID);

// ---- borsh ----------------------------------------------------------------------------------

class Writer {
  private parts: Uint8Array[] = [];
  bytes(b: ArrayLike<number>) {
    this.parts.push(Uint8Array.from(b));
    return this;
  }
  private num(size: number, set: (v: DataView) => void) {
    const b = new Uint8Array(size);
    set(new DataView(b.buffer));
    return this.bytes(b);
  }
  u8 = (v: number) => this.num(1, (d) => d.setUint8(0, v));
  bool = (v: boolean) => this.u8(v ? 1 : 0);
  u64 = (v: bigint) => this.num(8, (d) => d.setBigUint64(0, v, true));
  i64 = (v: bigint) => this.num(8, (d) => d.setBigInt64(0, v, true));
  str(s: string) {
    const b = enc.encode(s);
    this.num(4, (d) => d.setUint32(0, b.length, true));
    return this.bytes(b);
  }
  pubkey = (k: PublicKey) => this.bytes(k.toBytes());
  done() {
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return Buffer.from(out);
  }
}

class Reader {
  private o = 0;
  private b: Uint8Array;
  private v: DataView;
  constructor(b: Uint8Array) {
    this.b = b;
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  skip(n: number) {
    this.o += n;
    return this;
  }
  bytes(n: number) {
    const s = this.b.subarray(this.o, this.o + n);
    this.o += n;
    return s;
  }
  u8 = () => this.v.getUint8(this.o++);
  bool = () => this.u8() !== 0;
  u16 = () => {
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  };
  u32 = () => {
    const x = this.v.getUint32(this.o, true);
    this.o += 4;
    return x;
  };
  u64 = () => {
    const x = this.v.getBigUint64(this.o, true);
    this.o += 8;
    return x;
  };
  i64 = () => {
    const x = this.v.getBigInt64(this.o, true);
    this.o += 8;
    return x;
  };
  str = () => new TextDecoder().decode(this.bytes(this.u32()));
  pubkey = () => new PublicKey(this.bytes(32));
  /** Fields appended to events later (D-022) are missing from older logs. */
  more = () => this.o < this.b.length;
}

const startsWith = (b: Uint8Array, disc: number[]) => b.length >= 8 && disc.every((x, i) => b[i] === x);
const w = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const ix = (keys: AccountMeta[], data: Buffer) => new TransactionInstruction({ programId: PROGRAM_ID, keys, data });

// ---- instructions ---------------------------------------------------------------------------

export interface CreateEscrowArgs {
  narrativeId16: Uint8Array;
  name: string;
  symbol: string;
  uri: string;
  detailsHash: Uint8Array;
  lockHash: Uint8Array;
  proposer: PublicKey;
  perWalletMax: bigint;
  poolCap: bigint;
  poolMin: bigint;
  minDeposit: bigint;
  depositStart: bigint;
  depositEnd: bigint;
  launchAfter: bigint;
  launchDeadline: bigint;
  trancheCount: number;
  trancheInterval: bigint;
}

function writeCreateArgs(wr: Writer, a: CreateEscrowArgs) {
  return wr
    .bytes(a.narrativeId16)
    .str(a.name)
    .str(a.symbol)
    .str(a.uri)
    .bytes(a.detailsHash)
    .bytes(a.lockHash)
    .pubkey(a.proposer)
    .u64(a.perWalletMax)
    .u64(a.poolCap)
    .u64(a.poolMin)
    .u64(a.minDeposit)
    .i64(a.depositStart)
    .i64(a.depositEnd)
    .i64(a.launchAfter)
    .i64(a.launchDeadline)
    .u8(a.trancheCount)
    .i64(a.trancheInterval);
}

/** A pool token (D-023): the coin's pump quote mint and its token program. */
export interface PoolToken {
  mint: PublicKey;
  tokenProgram: PublicKey;
  /** pump admits the mint through quote-control (stocks, most coins) rather than Global's whitelist (USDC). */
  viaQuoteControl: boolean;
}

/** A token pool: amounts in `token.mint` base units. The operator pays every rent. */
export function createTokenEscrowIx(operator: PublicKey, a: CreateEscrowArgs, token: PoolToken) {
  const escrow = escrowPda(a.narrativeId16);
  const vault = vaultPda(escrow);
  return ix(
    [
      { pubkey: operator, isSigner: true, isWritable: true },
      r(configPda()),
      w(escrow),
      w(vault),
      r(SystemProgram.programId),
      w(holderVotePda(escrow)),
      w(poolQuotePda(escrow)),
      r(token.mint),
      w(ata(vault, token.mint, token.tokenProgram)),
      r(token.tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
    ],
    writeCreateArgs(new Writer().bytes(IX.createTokenEscrow), a).bool(token.viaQuoteControl).done(),
  );
}

/** A deposit into a token pool from the depositor's associated token account; carries the vote. */
export function depositTokenIx(depositor: PublicKey, escrow: PublicKey, token: Pick<PoolToken, "mint" | "tokenProgram">, amount: bigint, holderRewards: boolean) {
  const vault = vaultPda(escrow);
  return ix(
    [
      { pubkey: depositor, isSigner: true, isWritable: true },
      w(escrow),
      r(vault),
      w(receiptPda(escrow, depositor)),
      r(SystemProgram.programId),
      w(holderVotePda(escrow)),
      r(poolQuotePda(escrow)),
      r(token.mint),
      w(ata(depositor, token.mint, token.tokenProgram)),
      w(ata(vault, token.mint, token.tokenProgram)),
      r(token.tokenProgram),
    ],
    new Writer().bytes(IX.depositToken).u64(amount).bool(holderRewards).done(),
  );
}

/** Token-pool refund: 100% back to `wallet`'s token account (recreated at `caller`'s cost if closed). */
export function refundTokenIx(caller: PublicKey, escrow: PublicKey, wallet: PublicKey, token: Pick<PoolToken, "mint" | "tokenProgram">) {
  const vault = vaultPda(escrow);
  return ix(
    [
      { pubkey: caller, isSigner: true, isWritable: true },
      w(escrow),
      r(vault),
      w(receiptPda(escrow, wallet)),
      w(wallet),
      r(poolQuotePda(escrow)),
      r(token.mint),
      w(ata(vault, token.mint, token.tokenProgram)),
      w(ata(wallet, token.mint, token.tokenProgram)),
      r(token.tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    new Writer().bytes(IX.refundToken).done(),
  );
}

/** Token-pool claim: vested coin tokens plus the wallet's share of unspent pool tokens. */
export function claimTokenIx(caller: PublicKey, escrow: PublicKey, wallet: PublicKey, mint: PublicKey, token: Pick<PoolToken, "mint" | "tokenProgram">) {
  const vault = vaultPda(escrow);
  return ix(
    [
      { pubkey: caller, isSigner: true, isWritable: true },
      w(escrow),
      r(vault),
      w(receiptPda(escrow, wallet)),
      r(wallet),
      r(mint),
      w(ata(vault, mint, TOKEN_2022_PROGRAM_ID)),
      w(ata(wallet, mint, TOKEN_2022_PROGRAM_ID)),
      r(TOKEN_2022_PROGRAM_ID),
      w(poolQuotePda(escrow)),
      r(token.mint),
      w(ata(vault, token.mint, token.tokenProgram)),
      w(ata(wallet, token.mint, token.tokenProgram)),
      r(token.tokenProgram),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
    ],
    new Writer().bytes(IX.claimToken).done(),
  );
}

export interface PoolQuoteAccount {
  mint: PublicKey;
  tokenProgram: PublicKey;
  decimals: number;
  viaQuoteControl: boolean;
  quoteLeftover: bigint;
}

export function decodePoolQuote(data: Uint8Array): PoolQuoteAccount {
  if (!startsWith(data, ACCOUNT.poolQuote)) throw new Error("not a PoolQuote account");
  const d = new Reader(data).skip(8 + 32);
  return { mint: d.pubkey(), tokenProgram: d.pubkey(), decimals: d.u8(), viaQuoteControl: d.bool(), quoteLeftover: d.u64() };
}

export function createEscrowIx(operator: PublicKey, a: CreateEscrowArgs) {
  const escrow = escrowPda(a.narrativeId16);
  const data = new Writer()
    .bytes(IX.createEscrow)
    .bytes(a.narrativeId16)
    .str(a.name)
    .str(a.symbol)
    .str(a.uri)
    .bytes(a.detailsHash)
    .bytes(a.lockHash)
    .pubkey(a.proposer)
    .u64(a.perWalletMax)
    .u64(a.poolCap)
    .u64(a.poolMin)
    .u64(a.minDeposit)
    .i64(a.depositStart)
    .i64(a.depositEnd)
    .i64(a.launchAfter)
    .i64(a.launchDeadline)
    .u8(a.trancheCount)
    .i64(a.trancheInterval)
    .done();
  return ix(
    [
      { pubkey: operator, isSigner: true, isWritable: true },
      r(configPda()),
      w(escrow),
      w(vaultPda(escrow)),
      r(SystemProgram.programId),
      w(holderVotePda(escrow)),
    ],
    data,
  );
}

/** `holderRewards` is this deposit's vote; the program tallies it by `amount` (D-022). */
export function depositIx(depositor: PublicKey, escrow: PublicKey, amount: bigint, holderRewards: boolean) {
  return ix(
    [
      { pubkey: depositor, isSigner: true, isWritable: true },
      w(escrow),
      w(vaultPda(escrow)),
      w(receiptPda(escrow, depositor)),
      r(SystemProgram.programId),
      w(holderVotePda(escrow)),
      r(poolQuotePda(escrow)),
    ],
    new Writer().bytes(IX.deposit).u64(amount).bool(holderRewards).done(),
  );
}

/** Anyone may push a claim; tokens and SOL always go to `wallet`. */
export function claimIx(caller: PublicKey, escrow: PublicKey, wallet: PublicKey, mint: PublicKey) {
  const vault = vaultPda(escrow);
  return ix(
    [
      { pubkey: caller, isSigner: true, isWritable: true },
      w(escrow),
      w(vault),
      w(receiptPda(escrow, wallet)),
      w(wallet),
      r(mint),
      w(ata(vault, mint, TOKEN_2022_PROGRAM_ID)),
      w(ata(wallet, mint, TOKEN_2022_PROGRAM_ID)),
      r(TOKEN_2022_PROGRAM_ID),
      r(ASSOCIATED_TOKEN_PROGRAM_ID),
      r(SystemProgram.programId),
      r(poolQuotePda(escrow)),
    ],
    new Writer().bytes(IX.claim).done(),
  );
}

/** Permissionless; the full deposit goes back to `wallet` and the receipt closes to it. */
export function refundIx(escrow: PublicKey, wallet: PublicKey) {
  return ix(
    [w(escrow), w(vaultPda(escrow)), w(receiptPda(escrow, wallet)), w(wallet), r(SystemProgram.programId), r(poolQuotePda(escrow))],
    new Writer().bytes(IX.refund).done(),
  );
}

/** Before D-022 the vote travelled as a memo next to the deposit; sync still reads those. */
export const HOLDER_VOTE_MEMO = { on: "narrativepad:holder-rewards:on", off: "narrativepad:holder-rewards:off" } as const;
export const parseHolderVoteMemo = (text: string): boolean | null =>
  text === HOLDER_VOTE_MEMO.on ? true : text === HOLDER_VOTE_MEMO.off ? false : null;

/** pump.fun's fee recipients for the buy, chosen from its Global account. */
export interface PumpFees {
  feeRecipient: PublicKey;
  buybackRecipient: PublicKey;
}

/** Reads pump's Global (layout per idls/pump.json): the main fee recipient and the first buyback recipient. */
export function pumpFeesFromGlobal(data: Uint8Array): PumpFees {
  if (data.length < 997) throw new Error("unexpected pump Global layout");
  return { feeRecipient: new PublicKey(data.subarray(41, 73)), buybackRecipient: new PublicKey(data.subarray(741, 773)) };
}

/** pump's `Global.is_holder_reward_enabled` (byte 1086); off on devnet today. */
export const pumpHolderRewardsEnabled = (globalData: Uint8Array) => globalData.length > 1086 && globalData[1086] !== 0;

/** `launch`: named accounts, then pump's accounts in `pump::ra` order (programs/…/pump.rs).
 *  `holderRewards` must match what the program will decide (more SOL voted on, and pump has
 *  them enabled): pump expects the creator vault of the holder-rewards PDA in that case. */
export function launchIx(o: {
  cranker: PublicKey;
  escrow: PublicKey;
  treasury: PublicKey;
  nonce: bigint;
  fees: PumpFees;
  createPayer?: "vault" | "cranker";
  holderRewards?: boolean;
  /** A token pool's token (D-023); SOL pools pass nothing. */
  token?: PoolToken;
}) {
  const vault = vaultPda(o.escrow);
  const mint = mintPda(o.escrow, o.nonce);
  const t22 = TOKEN_2022_PROGRAM_ID;
  const quoteMint = o.token?.mint ?? WSOL_MINT;
  const quoteProgram = o.token?.tokenProgram ?? SPL_TOKEN_PROGRAM_ID;
  const wsolAta = (owner: PublicKey) => ata(owner, quoteMint, quoteProgram);
  const bondingCurve = pda([enc.encode("bonding-curve"), mint.toBytes()], PUMP_PROGRAM_ID);
  const solVault = pda([enc.encode("sol-vault")], MAYHEM_PROGRAM_ID);
  const creator = o.holderRewards ? holderRewardsPda(mint) : vault;
  const creatorVault = pda([enc.encode("creator-vault"), creator.toBytes()], PUMP_PROGRAM_ID);
  const userVolume = pda([enc.encode("user_volume_accumulator"), vault.toBytes()], PUMP_PROGRAM_ID);
  const remaining: AccountMeta[] = [
    r(pda([enc.encode("mint-authority")], PUMP_PROGRAM_ID)),
    w(bondingCurve),
    w(ata(bondingCurve, mint, t22)),
    r(pda([enc.encode("global")], PUMP_PROGRAM_ID)),
    w(MAYHEM_PROGRAM_ID),
    r(pda([enc.encode("global-params")], MAYHEM_PROGRAM_ID)),
    w(solVault),
    w(pda([enc.encode("mayhem-state"), mint.toBytes()], MAYHEM_PROGRAM_ID)),
    w(ata(solVault, mint, t22)),
    r(pda([enc.encode("__event_authority")], PUMP_PROGRAM_ID)),
    r(quoteMint),
    r(quoteProgram),
    w(o.fees.feeRecipient),
    w(wsolAta(o.fees.feeRecipient)),
    w(o.fees.buybackRecipient),
    w(wsolAta(o.fees.buybackRecipient)),
    w(wsolAta(bondingCurve)),
    w(wsolAta(vault)),
    w(creatorVault),
    w(wsolAta(creatorVault)),
    r(pda([enc.encode("sharing-config"), mint.toBytes()], PUMP_FEE_PROGRAM_ID)),
    r(pda([enc.encode("global_volume_accumulator")], PUMP_PROGRAM_ID)),
    w(userVolume),
    w(wsolAta(userVolume)),
    r(pda([enc.encode("fee_config"), PUMP_PROGRAM_ID.toBytes()], PUMP_FEE_PROGRAM_ID)),
    r(PUMP_FEE_PROGRAM_ID),
  ];
  const keys: AccountMeta[] = [
    { pubkey: o.cranker, isSigner: true, isWritable: true },
    w(o.escrow),
    w(vault),
    w(o.createPayer === "cranker" ? o.cranker : vault),
    w(mint),
    w(ata(vault, mint, t22)),
    w(o.treasury),
    r(PUMP_PROGRAM_ID),
    r(t22),
    r(ASSOCIATED_TOKEN_PROGRAM_ID),
    r(SystemProgram.programId),
    w(holderVotePda(o.escrow)),
    w(poolQuotePda(o.escrow)),
    ...remaining,
    // Token pools: the treasury's account for the fee, then pump's quote-control list if needed.
    ...(o.token ? [w(wsolAta(o.treasury)), ...(o.token.viaQuoteControl ? [r(quoteControlPda())] : [])] : []),
  ];
  return { ix: ix(keys, new Writer().bytes(IX.launch).u64(o.nonce).done()), mint };
}

/** Accounts every launch uses, for the address lookup table (scripts/devnet-create-alt.mjs). */
export function launchStaticAccounts(fees: PumpFees, treasury: PublicKey): PublicKey[] {
  const wsolAta = (owner: PublicKey) => ata(owner, WSOL_MINT, SPL_TOKEN_PROGRAM_ID);
  return [
    PUMP_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SystemProgram.programId,
    SPL_TOKEN_PROGRAM_ID,
    WSOL_MINT,
    MAYHEM_PROGRAM_ID,
    PUMP_FEE_PROGRAM_ID,
    configPda(),
    treasury,
    pda([enc.encode("mint-authority")], PUMP_PROGRAM_ID),
    pda([enc.encode("global")], PUMP_PROGRAM_ID),
    pda([enc.encode("__event_authority")], PUMP_PROGRAM_ID),
    pda([enc.encode("global_volume_accumulator")], PUMP_PROGRAM_ID),
    pda([enc.encode("global-params")], MAYHEM_PROGRAM_ID),
    pda([enc.encode("sol-vault")], MAYHEM_PROGRAM_ID),
    pda([enc.encode("fee_config"), PUMP_PROGRAM_ID.toBytes()], PUMP_FEE_PROGRAM_ID),
    fees.feeRecipient,
    wsolAta(fees.feeRecipient),
    fees.buybackRecipient,
    wsolAta(fees.buybackRecipient),
  ];
}

// ---- accounts -------------------------------------------------------------------------------

export interface EscrowAccount {
  name: string;
  symbol: string;
  uri: string;
  proposer: PublicKey;
  treasury: PublicKey;
  feeBps: number;
  perWalletMax: bigint;
  poolCap: bigint;
  poolMin: bigint;
  minDeposit: bigint;
  depositStart: bigint;
  depositEnd: bigint;
  launchAfter: bigint;
  launchDeadline: bigint;
  trancheCount: number;
  trancheInterval: bigint;
  totalDeposited: bigint;
  totalRefunded: bigint;
  depositorCount: number;
  nextOrderIndex: number;
  launched: boolean;
  launchedAt: bigint;
  mint: PublicKey;
  tokensBought: bigint;
  tokensClaimed: bigint;
  baseLeftover: bigint;
}

export function decodeEscrow(data: Uint8Array): EscrowAccount {
  if (!startsWith(data, ACCOUNT.escrow)) throw new Error("not an Escrow account");
  const d = new Reader(data).skip(8 + 16 + 32 + 32);
  const name = d.str();
  const symbol = d.str();
  const uri = d.str();
  const proposer = d.pubkey();
  const treasury = d.pubkey();
  const feeBps = d.u16();
  d.u16(); // creator_fee_proposer_bps
  d.u16(); // creator_fee_platform_bps
  return {
    name,
    symbol,
    uri,
    proposer,
    treasury,
    feeBps,
    perWalletMax: d.u64(),
    poolCap: d.u64(),
    poolMin: d.u64(),
    minDeposit: d.u64(),
    depositStart: d.i64(),
    depositEnd: d.i64(),
    launchAfter: d.i64(),
    launchDeadline: d.i64(),
    trancheCount: d.u8(),
    trancheInterval: d.i64(),
    totalDeposited: d.u64(),
    totalRefunded: d.u64(),
    depositorCount: d.u32(),
    nextOrderIndex: d.u32(),
    launched: d.bool(),
    launchedAt: d.i64(),
    mint: d.pubkey(),
    tokensBought: d.u64(),
    tokensClaimed: d.u64(),
    baseLeftover: d.u64(),
  };
}

export interface ReceiptAccount {
  wallet: PublicKey;
  amount: bigint;
  firstOrderIndex: number;
  depositCount: number;
  tokensClaimed: bigint;
  leftoverPaid: boolean;
}

export interface HolderVoteAccount {
  on: bigint;
  off: bigint;
  /** Set at launch: the coin was created with pump's holder rewards. */
  applied: boolean;
}

export function decodeHolderVote(data: Uint8Array): HolderVoteAccount {
  if (!startsWith(data, ACCOUNT.holderVote)) throw new Error("not a HolderVote account");
  const d = new Reader(data).skip(8 + 32);
  return { on: d.u64(), off: d.u64(), applied: d.bool() };
}

/** The program's rule (D-022): on only with strictly more SOL behind "on", and pump allowing it. */
export const holderRewardsWouldApply = (vote: HolderVoteAccount | null, pumpEnabled: boolean) =>
  pumpEnabled && vote !== null && vote.on > vote.off;

export function decodeReceipt(data: Uint8Array): ReceiptAccount {
  if (!startsWith(data, ACCOUNT.receipt)) throw new Error("not a Receipt account");
  const d = new Reader(data).skip(8 + 32);
  const wallet = d.pubkey();
  const amount = d.u64();
  const firstOrderIndex = d.u32();
  d.u64(); // first_slot
  return { wallet, amount, firstOrderIndex, depositCount: d.u32(), tokensClaimed: d.u64(), leftoverPaid: d.bool() };
}

// ---- events ---------------------------------------------------------------------------------

export type EscrowEvent =
  | { kind: "Deposited"; escrow: PublicKey; wallet: PublicKey; amount: bigint; orderIndex: number; timestamp: bigint; holderRewards: boolean | null }
  | { kind: "Launched"; escrow: PublicKey; mint: PublicKey; platformFee: bigint; tokensBought: bigint; baseLeftover: bigint; holderRewards: boolean | null }
  | { kind: "Claimed"; escrow: PublicKey; wallet: PublicKey; tokens: bigint; leftoverLamports: bigint; unlockedTranches: number }
  | { kind: "Refunded"; escrow: PublicKey; wallet: PublicKey; amount: bigint };

/** Our events from a transaction's logs (Anchor `emit!` writes "Program data: <base64>"). */
export function parseEvents(logs: string[]): EscrowEvent[] {
  const out: EscrowEvent[] = [];
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const b = Uint8Array.from(Buffer.from(line.slice(14), "base64"));
    const d = new Reader(b).skip(8);
    try {
      if (startsWith(b, EVENT.Deposited)) {
        const escrow = d.pubkey();
        const wallet = d.pubkey();
        const amount = d.u64();
        const orderIndex = d.u32();
        d.u64(); // slot
        const timestamp = d.i64();
        d.u64(); // wallet_total
        d.u64(); // pool_total
        out.push({ kind: "Deposited", escrow, wallet, amount, orderIndex, timestamp, holderRewards: d.more() ? d.bool() : null });
      } else if (startsWith(b, EVENT.Launched)) {
        const escrow = d.pubkey();
        const mint = d.pubkey();
        d.u64(); // pool_total
        const platformFee = d.u64();
        d.u64(); // buy_budget
        const tokensBought = d.u64();
        const baseLeftover = d.u64();
        d.i64(); // launched_at
        out.push({ kind: "Launched", escrow, mint, platformFee, tokensBought, baseLeftover, holderRewards: d.more() ? d.bool() : null });
      } else if (startsWith(b, EVENT.Claimed)) {
        const escrow = d.pubkey();
        const wallet = d.pubkey();
        const tokens = d.u64();
        const leftoverLamports = d.u64();
        d.u64(); // creator_fee_lamports
        out.push({ kind: "Claimed", escrow, wallet, tokens, leftoverLamports, unlockedTranches: d.u8() });
      } else if (startsWith(b, EVENT.Refunded)) {
        out.push({ kind: "Refunded", escrow: d.pubkey(), wallet: d.pubkey(), amount: d.u64() });
      }
    } catch {
      // Not ours, or truncated: the account sync still has the totals.
    }
  }
  return out;
}

/** The program's error name for a custom error code, for readable messages. */
const ERRORS = [
  "NotUpgradeAuthority", "FeeTooHigh", "InvalidCreatorFeeSplit", "InvalidMetadata", "LockHashMismatch", "InvalidLimits",
  "InvalidSchedule", "InvalidTranches", "NotPooling", "DepositTooSmall", "WalletCapExceeded", "PoolCapExceeded",
  "NotLaunchable", "NotRefundable", "NotLaunched", "NothingToClaim", "InvalidAccount", "InvalidProgram",
  "InvalidLaunchPayer", "InvalidBondingCurve", "CurveOverfill", "PoolTooSmall", "LaunchOverspent", "LaunchUnderfilled",
  "NothingToDistribute", "ClaimsOutstanding", "NotDust", "MathOverflow",
];
export const programErrorName = (code: number) => ERRORS[code - 6000] ?? null;
