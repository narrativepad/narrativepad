// A pool's currency (D-023): SOL, or a token pool's token (USDC on devnet; NVDAx etc. later).
// Escrow amounts are base units of that currency; these helpers show and parse them.

export interface Unit {
  symbol: string;
  decimals: number;
}

export const SOL_UNIT: Unit = { symbol: "SOL", decimals: 9 };

/** `formatSol` for any unit: thousands separators, at most `maxDecimals`, no trailing zeros. */
export function formatAmount(raw: bigint, unit: Unit, maxDecimals = 3): string {
  const scale = 10n ** BigInt(unit.decimals);
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const whole = v / scale;
  const frac = (v % scale).toString().padStart(unit.decimals, "0").slice(0, maxDecimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}

/** `parseSol` for any unit: "1.5" → base units, or null if it isn't a plain decimal. */
export function parseAmount(input: string, unit: Unit): bigint | null {
  const m = input.trim().match(new RegExp(`^(\\d{1,12})(?:\\.(\\d{1,${unit.decimals}}))?$`));
  if (!m) return null;
  return BigInt(m[1]) * 10n ** BigInt(unit.decimals) + BigInt((m[2] ?? "").padEnd(unit.decimals, "0"));
}

/** Quick-pick amounts for the deposit box: SOL pools use the classic picks; stablecoins whole units. */
export const quickAmounts = (unit: Unit) => (unit.symbol === "SOL" ? ["0.1", "0.25", "0.5", "1"] : ["1", "2", "5", "10"]);
