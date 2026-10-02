// node --test --experimental-strip-types src/lib/*.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  formatSol,
  launchBreakdown,
  lockHash,
  merkleRoot,
  mulDivFloor,
  parseSol,
  proRata,
  pumpNetIn,
  curveTokensOut,
  PUMP,
  unlockedTranches,
  uuidBytes,
  vested,
} from "./math.ts";
import { phaseOf } from "./phase.ts";

test("opening buy matches the research table (10 SOL → ~265.76M tokens)", () => {
  const out = curveTokensOut(pumpNetIn(10_000_000_000n), PUMP.virtualTokenReserves, PUMP.virtualQuoteReserves);
  assert.ok(out > 265_700_000_000_000n && out < 265_800_000_000_000n, String(out));
});

test("launch breakdown: 1% fee, 0.05 SOL rent reserve", () => {
  const b = launchBreakdown(10_000_000_000n, 100);
  assert.equal(b.platformFee, 100_000_000n);
  assert.equal(b.budget, 10_000_000_000n - 100_000_000n - 50_000_000n);
});

test("uniform vesting: 1 at launch, +1 per interval, capped", () => {
  assert.equal(unlockedTranches(999, 1000, 600, 5), 0);
  assert.equal(unlockedTranches(1000, 1000, 600, 5), 1);
  assert.equal(unlockedTranches(1600, 1000, 600, 5), 2);
  assert.equal(unlockedTranches(10_000_000, 1000, 600, 5), 5);
  for (const e of [0n, 1n, 7n, 123_456_789n]) assert.equal(vested(e, 5, 5), e);
});

test("pro-rata never overpays; dust < depositor count", () => {
  for (let round = 0; round < 200; round++) {
    const deposits = Array.from({ length: 1 + (round % 37) }, (_, i) => BigInt(1 + ((i * 7919 + round * 104729) % 5_000_000_000)));
    const pool = deposits.reduce((a, b) => a + b, 0n);
    const total = BigInt(round) * 1_234_567_891n + 17n;
    const paid = deposits.reduce((s, d) => s + proRata(total, d, pool), 0n);
    assert.ok(paid <= total);
    assert.ok(total - paid < BigInt(deposits.length));
  }
});

test("phase machine: refundable is permanent and disjoint from launchable", () => {
  const base = { launched: false, depositStart: 0, depositEnd: 100, launchAfter: 120, launchDeadline: 300, poolMin: 10n };
  assert.equal(phaseOf({ ...base, totalDeposited: 5n }, 50), "pooling");
  assert.equal(phaseOf({ ...base, totalDeposited: 5n }, 100), "refundable");
  assert.equal(phaseOf({ ...base, totalDeposited: 10n }, 110), "closing");
  assert.equal(phaseOf({ ...base, totalDeposited: 10n }, 120), "launchable");
  assert.equal(phaseOf({ ...base, totalDeposited: 10n }, 300), "refundable");
  assert.equal(phaseOf({ ...base, launched: true, totalDeposited: 10n }, 300), "released");
});

test("lock hash is deterministic and field-unambiguous", () => {
  const id = uuidBytes("0b9f3c2e-1a2b-4c3d-8e9f-001122334455");
  const d = new Uint8Array(32).fill(9);
  assert.equal(lockHash(id, "ab", "c", "u", d), lockHash(id, "ab", "c", "u", d));
  assert.notEqual(lockHash(id, "ab", "c", "u", d), lockHash(id, "a", "bc", "u", d));
  assert.match(lockHash(id, "ab", "c", "u", d), /^[0-9a-f]{64}$/);
});

test("canonical JSON sorts keys and drops undefined", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: undefined, c: [2, "x"] } }), '{"a":{"c":[2,"x"]},"b":1}');
});

test("merkle root is order-independent", () => {
  assert.equal(merkleRoot(["aa".repeat(32), "bb".repeat(32), "cc".repeat(32)]), merkleRoot(["cc".repeat(32), "aa".repeat(32), "bb".repeat(32)]));
});

test("SOL parsing/formatting", () => {
  assert.equal(parseSol("0.5"), 500_000_000n);
  assert.equal(parseSol("1"), 1_000_000_000n);
  assert.equal(parseSol("1.0000000001"), null);
  assert.equal(parseSol("-1"), null);
  assert.equal(formatSol(1_500_000_000n), "1.5");
  assert.equal(mulDivFloor(10n, 3n, 4n), 7n);
});
