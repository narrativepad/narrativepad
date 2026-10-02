import assert from "node:assert/strict";
import { test } from "node:test";
import { launchBreakdown } from "./math.ts";
import { curveOf, formatAmount, formatTotals, parseAmount, SOL_UNIT, totalsByUnit, type PoolUnit } from "./units.ts";

/** A token pool (D-023), e.g. a tokenized stock: 6 decimals here. */
const TOKEN: PoolUnit = {
  symbol: "TKN",
  decimals: 6,
  mint: "NKEda5nHhNGgjrE9nDdMvaEmkmJ96qqxzBVZEcKmjSg",
  tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  logo: null,
  curveReserves: "4292000000",
};

test("amounts parse and format in the pool's decimals", () => {
  assert.equal(parseAmount("1.5", TOKEN), 1_500_000n);
  assert.equal(parseAmount("0.000001", TOKEN), 1n);
  assert.equal(parseAmount("0.0000001", TOKEN), null, "more decimals than the token has");
  assert.equal(parseAmount("1.5", SOL_UNIT), 1_500_000_000n);
  assert.equal(formatAmount(8_000_000n, TOKEN), "8");
  assert.equal(formatAmount(1_234_567_890n, TOKEN), "1,234.567");
});

test("totals never add SOL and a token together", () => {
  const sol = { symbol: "SOL", decimals: 9 };
  const tkn = { symbol: "TKN", decimals: 6 };
  const t = totalsByUnit([
    { amount: 2_000_000n, unit: tkn },
    { amount: 500_000_000n, unit: sol },
    { amount: "1000000", unit: tkn },
  ]);
  assert.deepEqual(
    t.map((x) => [x.unit.symbol, x.total]),
    [
      ["SOL", 500_000_000n],
      ["TKN", 3_000_000n],
    ],
  );
  assert.equal(formatTotals([]), "0 SOL");
});

test("token pools spend the whole pool after the fee; SOL pools keep the rent reserve", () => {
  const tok = launchBreakdown(4_000_000n, 100, curveOf(TOKEN));
  assert.equal(tok.platformFee, 40_000n);
  assert.equal(tok.budget, 3_960_000n);
  assert.equal(tok.reserve, 0n);
  const sol = launchBreakdown(1_000_000_000n, 100, curveOf(SOL_UNIT));
  assert.equal(sol.reserve, 50_000_000n);
});
