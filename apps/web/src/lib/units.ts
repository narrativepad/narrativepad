// A pool's currency (D-023): SOL, or a token pool's token (NVDAx etc., with the mainnet launch).
// Escrow amounts are base units of that currency; these helpers show and parse them.
import { PUMP } from "./math.ts";

export interface Unit {
  symbol: string;
  decimals: number;
}

/** What a pool holds, as pages see it. */
export interface PoolUnit extends Unit {
  /** A token pool's mint and token program; null for SOL pools. */
  mint: string | null;
  tokenProgram: string | null;
  logo: string | null;
  /** pump's starting virtual reserves for curves in this currency (base units), for estimates. */
  curveReserves: string;
}

export const SOL_UNIT: PoolUnit = {
  symbol: "SOL",
  decimals: 9,
  mint: null,
  tokenProgram: null,
  logo: "/pairs/So11111111111111111111111111111111111111112.webp",
  curveReserves: PUMP.virtualQuoteReserves.toString(),
};

/** `formatSol` for any unit: thousands separators, at most `maxDecimals`, no trailing zeros. */
export function formatAmount(raw: bigint, unit: Unit, maxDecimals = 3): string {
  const scale = 10n ** BigInt(unit.decimals);
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(unit.decimals, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** An amount with its symbol: "1.5 SOL", "4 NVDAx". */
export const withUnit = (raw: bigint | string, unit: Unit, maxDecimals = 3) => `${formatAmount(BigInt(raw), unit, maxDecimals)} ${unit.symbol}`;

/** `parseSol` for any unit: "1.5" → base units, or null if it isn't a plain decimal. */
export function parseAmount(input: string, unit: Unit): bigint | null {
  const m = input.trim().match(new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${unit.decimals}}))?$`));
  if (!m) return null;
  return BigInt(m[1]) * 10n ** BigInt(unit.decimals) + BigInt((m[2] ?? "").padEnd(unit.decimals, "0"));
}

/** A base-unit amount as a float in whole units, for charts and animated numbers only. */
export const toWhole = (raw: bigint | string, unit: Unit) => Number(BigInt(raw)) / 10 ** unit.decimals;

/** Quick-pick amounts for the deposit box: SOL pools use the classic picks; token pools small whole units. */
export const quickAmounts = (unit: Unit) => (unit.symbol === "SOL" ? ["0.1", "0.25", "0.5", "1"] : ["0.5", "1", "2", "4"]);

/** The launch curve for estimates: token pools borrow the launch rent from the cranker, so the
 *  whole pool after the fee buys (D-023); SOL pools keep a rent reserve. */
export const curveOf = (unit: PoolUnit) => ({ virtualQuoteReserves: BigInt(unit.curveReserves), tokenPool: unit.mint !== null });

/** Amounts in mixed currencies, summed per currency (SOL first). No common price, so never added
 *  across currencies. Empty input gives one zero SOL total. */
export function totalsByUnit(items: { amount: bigint | string; unit: Unit }[]): { unit: Unit; total: bigint }[] {
  const by = new Map<string, { unit: Unit; total: bigint }>();
  for (const i of items) {
    const t = by.get(i.unit.symbol) ?? { unit: i.unit, total: 0n };
    t.total += BigInt(i.amount);
    by.set(i.unit.symbol, t);
  }
  const list = [...by.values()].sort((a, b) => (a.unit.symbol === "SOL" ? -1 : b.unit.symbol === "SOL" ? 1 : a.unit.symbol.localeCompare(b.unit.symbol)));
  return list.length ? list : [{ unit: SOL_UNIT, total: 0n }];
}

/** "1.5 SOL · 4 NVDAx". */
export const formatTotals = (items: { amount: bigint | string; unit: Unit }[]) => totalsByUnit(items).map((t) => withUnit(t.total, t.unit)).join(" · ");
