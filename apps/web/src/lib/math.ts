// BigInt mirror of programs/narrative_escrow/src/math.rs. Everything rounds DOWN, exactly as
// on-chain, so the UI and the simulation show the numbers the escrow would produce.
import { sha256 } from "@noble/hashes/sha2.js";

export const BPS = 10_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const TOKEN_DECIMALS = 6;

// pump.fun mainnet curve (ARCHITECTURE.md §4.2) and escrow launch constants (constants.rs).
export const PUMP = {
  virtualTokenReserves: 1_073_000_000_000_000n,
  virtualQuoteReserves: 30_000_000_000n,
  realTokenReserves: 793_100_000_000_000n,
  totalSupply: 1_000_000_000_000_000n,
  feeBps: 125n,
};
export const LAUNCH_RENT_RESERVE = 20_000_000n; // 0.02 SOL (constants.rs, D-026)
export const MAX_CURVE_FILL_BPS = 9_000n;

export const mulDivFloor = (a: bigint, b: bigint, c: bigint): bigint => {
  if (c === 0n) throw new Error("division by zero");
  return (a * b) / c;
};
export const bpsOf = (amount: bigint, bps: bigint | number) => mulDivFloor(amount, BigInt(bps), BPS);
export const proRata = (total: bigint, deposit: bigint, pool: bigint) =>
  pool === 0n ? 0n : mulDivFloor(total, deposit, pool);

/** Uniform vesting (D-001): 1 tranche at launch, +1 per interval, capped at count. */
export function unlockedTranches(nowSec: number, launchedAtSec: number, intervalSec: number, count: number): number {
  if (nowSec < launchedAtSec || count === 0) return 0;
  if (intervalSec <= 0) return count;
  return Math.min(count, 1 + Math.floor((nowSec - launchedAtSec) / intervalSec));
}
export const vested = (entitlement: bigint, unlocked: number, count: number) =>
  mulDivFloor(entitlement, BigInt(unlocked), BigInt(count));

export const curveTokensOut = (netIn: bigint, vt: bigint, vq: bigint) => mulDivFloor(netIn, vt, vq + netIn);

/** What pump's SDK charges: net = (gross - 1) * 10000 / 10125. */
export const pumpNetIn = (gross: bigint) => (gross <= 0n ? 0n : mulDivFloor(gross - 1n, BPS, BPS + PUMP.feeBps));

/** A launch curve: pump's starting virtual reserves in the pool's currency (SOL by default), and
 *  whether the pool is a token pool (D-023), which spends everything after the fee. */
export interface Curve {
  virtualQuoteReserves: bigint;
  tokenPool: boolean;
}
const SOL_CURVE: Curve = { virtualQuoteReserves: PUMP.virtualQuoteReserves, tokenPool: false };

export function quoteOpeningBuy(grossBudget: bigint, curve: Curve = SOL_CURVE) {
  const tokens = curveTokensOut(pumpNetIn(grossBudget), PUMP.virtualTokenReserves, curve.virtualQuoteReserves);
  const capped = tokens > PUMP.realTokenReserves ? PUMP.realTokenReserves : tokens;
  const pctOfSupply = Number((capped * 10_000n) / PUMP.totalSupply) / 100;
  const avgPriceLamportsPerToken = capped === 0n ? 0 : Number(grossBudget) / Number(capped);
  return { tokens: capped, pctOfSupply, avgPriceLamportsPerToken };
}

/** Breakdown of a pool at launch, as `launch` computes it on-chain. Token pools borrow the
 *  launch rent from the cranker, so they keep no reserve. */
export function launchBreakdown(total: bigint, feeBps: number, curve: Curve = SOL_CURVE) {
  const platformFee = bpsOf(total, feeBps);
  const afterFee = total - platformFee;
  const budget = curve.tokenPool ? afterFee : afterFee > LAUNCH_RENT_RESERVE ? afterFee - LAUNCH_RENT_RESERVE : 0n;
  return { platformFee, budget, reserve: afterFee - budget, ...quoteOpeningBuy(budget, curve) };
}

// ---- lock hash (must match math::lock_hash in the program) ----------------------------------

const enc = new TextEncoder();
const u32le = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
export const sha256Hex = (data: Uint8Array | string) => toHex(sha256(typeof data === "string" ? enc.encode(data) : data));

/** UUID → the 16-byte narrative id used in PDA seeds. */
export const uuidBytes = (uuid: string) => fromHex(uuid.replace(/-/g, ""));

export function lockHash(narrativeId16: Uint8Array, name: string, symbol: string, uri: string, detailsHash32: Uint8Array): string {
  const n = enc.encode(name);
  const s = enc.encode(symbol);
  const u = enc.encode(uri);
  return toHex(
    sha256(
      concat(enc.encode("narrativepad:lock:v1"), narrativeId16, u32le(n.length), n, u32le(s.length), s, u32le(u.length), u, detailsHash32),
    ),
  );
}

/** Deterministic JSON (sorted keys, no whitespace) for hashing: RFC 8785-style for our inputs. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Merkle root over sorted leaf hashes (hex). Empty set → sha256(""). */
export function merkleRoot(leavesHex: string[]): string {
  if (leavesHex.length === 0) return sha256Hex("");
  let level: Uint8Array[] = [...leavesHex].sort().map(fromHex);
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i];
      const b = level[i + 1] ?? level[i];
      next.push(sha256(concat(a, b)));
    }
    level = next;
  }
  return toHex(level[0]);
}

// ---- formatting ------------------------------------------------------------------------------

export function formatSol(lamports: bigint, maxDecimals = 3): string {
  const neg = lamports < 0n;
  const v = neg ? -lamports : lamports;
  const whole = v / LAMPORTS_PER_SOL;
  const frac = (v % LAMPORTS_PER_SOL).toString().padStart(9, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

export function formatTokens(base: bigint): string {
  const whole = Number(base / 1_000_000n);
  if (whole >= 1e9) return `${(whole / 1e9).toFixed(2)}B`;
  if (whole >= 1e6) return `${(whole / 1e6).toFixed(2)}M`;
  if (whole >= 1e3) return `${(whole / 1e3).toFixed(1)}K`;
  return whole.toLocaleString("en-US");
}

export function parseSol(input: string): bigint | null {
  const m = input.trim().match(/^(\d{1,9})(?:\.(\d{1,9}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * LAMPORTS_PER_SOL + BigInt((m[2] ?? "").padEnd(9, "0"));
}
