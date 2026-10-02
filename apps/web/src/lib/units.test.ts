import assert from "node:assert/strict";
import { test } from "node:test";
import { bpsOf, curveTokensOut, launchBreakdown, MAX_CURVE_FILL_BPS, PUMP } from "./math.ts";
import { curveOf, formatAmount, formatTotals, parseAmount, SOL_UNIT, totalsByUnit, type PoolUnit } from "./units.ts";

const USDC: PoolUnit = {
  symbol: "USDC",
  decimals: 6,
  mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  logo: null,
  curveReserves: "4292000000",
};

test("amounts parse and format in the pool's decimals", () => {
  assert.equal(parseAmount("1.5", USDC), 1_500_000n);
  assert.equal(parseAmount("0.000001", USDC), 1n);
  assert.equal(parseAmount("0.0000001", USDC), null, "more decimals than USDC has");
  assert.equal(parseAmount("1.5", SOL_UNIT), 1_500_000_000n);
  assert.equal(formatAmount(8_000_000n, USDC), "8");
  assert.equal(formatAmount(1_234_567_890n, USDC), "1,234.567");
});

test("totals never add SOL and USDC together", () => {
  const sol = { symbol: "SOL", decimals: 9 };
  const usdc = { symbol: "USDC", decimals: 6 };
  const t = totalsByUnit([
    { amount: 2_000_000n, unit: usdc },
    { amount: 500_000_000n, unit: sol },
    { amount: "1000000", unit: usdc },
  ]);
  assert.deepEqual(
    t.map((x) => [x.unit.symbol, x.total]),
    [
      ["SOL", 500_000_000n],
      ["USDC", 3_000_000n],
    ],
  );
  assert.equal(formatTotals([]), "0 SOL");
});

test("token pools spend the whole pool after the fee; SOL pools keep the rent reserve", () => {
  const tok = launchBreakdown(4_000_000n, 100, curveOf(USDC));
  assert.equal(tok.platformFee, 40_000n);
  assert.equal(tok.budget, 3_960_000n);
  assert.equal(tok.reserve, 0n);
  const sol = launchBreakdown(1_000_000_000n, 100, curveOf(SOL_UNIT));
  assert.equal(sol.reserve, 50_000_000n);
});

test("devnet USDC: an 8 USDC pool passes the escrow's 90% fill check, 9 doesn't", () => {
  // pump devnet Global.initial_virtual_quote_reserves = 4.292 USDC (config.ts default caps).
  const vq = 4_292_000n;
  const limit = bpsOf(PUMP.realTokenReserves, MAX_CURVE_FILL_BPS);
  const maxOut = (pool: bigint) => curveTokensOut(pool - bpsOf(pool, 100), PUMP.virtualTokenReserves, vq);
  assert.ok(maxOut(8_000_000n) <= limit);
  assert.ok(maxOut(9_000_000n) > limit);
});
