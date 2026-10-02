import { launchBreakdown, PUMP, pumpNetIn } from "@/lib/math";
import { curveOf, withUnit, type PoolUnit } from "@/lib/units";
import type { NarrativeDetail } from "@/lib/views";

// pump.fun's bonding curve, drawn from the same constants the escrow uses (math.ts). It shows
// where the community pool's single buy lands and that anyone after it pays more. No market
// data: this is the curve itself, not a price feed. Amounts are in the pool's currency (D-023).

const VT = Number(PUMP.virtualTokenReserves);
const REAL = Number(PUMP.realTokenReserves);
/** Coin tokens have 6 decimals, so 1M whole tokens is 1e12 base units. */
const PER_MILLION = 1e12;

/** The curve in a pool's currency: where it ends (the net quote that buys it out) and the
 *  marginal price after `x` net base units, in whole units per 1M tokens. */
function curveFor(unit: PoolUnit) {
  const vq = Number(unit.curveReserves);
  const scale = 10 ** unit.decimals;
  return {
    xMax: (REAL * vq) / (VT - REAL),
    price: (x: number) => (((vq + x) * (vq + x)) / (vq * VT)) * (PER_MILLION / scale),
    whole: (x: number) => x / scale,
  };
}

function poolPoint(n: NarrativeDetail) {
  const e = n.escrow!;
  const b = launchBreakdown(BigInt(e.totalDeposited), e.feeBps, curveOf(e.unit));
  const net = Number(pumpNetIn(b.budget));
  return { net, tokens: b.tokens, budget: b.budget, pct: b.pctOfSupply };
}

export function CurveMeta({ n }: { n: NarrativeDetail }) {
  const p = poolPoint(n);
  const { price } = curveFor(n.escrow!.unit);
  return <span className="num text-ink">{p.net > 0 ? `${(price(p.net) / price(0)).toFixed(2)}× start price after the pool` : "curve preview"}</span>;
}

/** Enough decimals to show a small price, few for a large one. */
const fmtPrice = (v: number) => v.toFixed(v >= 100 ? 2 : v >= 1 ? 3 : 4);

export function CurveChart({ n }: { n: NarrativeDetail }) {
  const p = poolPoint(n);
  const unit = n.escrow!.unit;
  const { xMax: X_MAX, price, whole } = curveFor(unit);
  const sym = unit.symbol;
  const launched = Boolean(n.escrow?.launched);
  const W = 800;
  const H = 220;
  const P = { l: 8, r: 8, t: 16, b: 22 };
  const top = price(X_MAX);
  const x = (v: number) => P.l + (v / X_MAX) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / top) * (H - P.t - P.b);
  const samples = Array.from({ length: 81 }, (_, i) => (i / 80) * X_MAX);
  const curve = samples.map((s, i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(price(s)).toFixed(1)}`).join(" ");
  const until = Math.min(p.net, X_MAX);
  const poolSamples = Array.from({ length: 41 }, (_, i) => (i / 40) * until);
  const poolArea =
    until > 0
      ? `${poolSamples.map((s, i) => `${i ? "L" : "M"}${x(s).toFixed(1)},${y(price(s)).toFixed(1)}`).join(" ")} L${x(until).toFixed(1)},${H - P.b} L${x(0).toFixed(1)},${H - P.b} Z`
      : "";
  const avg = p.tokens > 0n ? (Number(p.budget) / Number(p.tokens)) * (PER_MILLION / 10 ** unit.decimals) : 0;

  return (
    <div className="px-3 pb-2 pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full 2xl:h-60" preserveAspectRatio="none" role="img" aria-label="Bonding curve price, with the community pool's buy marked">
        <defs>
          <linearGradient id="curve-pool" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={P.l} x2={W - P.r} y1={y(top * g)} y2={y(top * g)} stroke="rgb(255 255 255 / 0.04)" vectorEffect="non-scaling-stroke" />
        ))}
        {poolArea && <path d={poolArea} fill="url(#curve-pool)" />}
        <path d={curve} fill="none" stroke="rgb(255 255 255 / 0.55)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
        {until > 0 && (
          <>
            <line x1={x(until)} x2={x(until)} y1={P.t} y2={H - P.b} stroke="var(--color-accent)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <circle cx={x(until)} cy={y(price(until))} r="4.5" fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      <div className="mt-1 flex items-center justify-between text-[0.7rem] text-dim">
        <span className="num">0 {sym}</span>
        <span>{sym} bought into the curve → price per token rises</span>
        <span className="num">
          {Math.round(whole(X_MAX)).toLocaleString("en-US")} {sym}
        </span>
      </div>
      <div className="mt-4 grid gap-px overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.06] sm:grid-cols-3">
        <div className="bg-[#0c0d10] px-4 py-3">
          <div className="label">{launched ? "Pool bought" : "Pool would buy"}</div>
          <div className="num mt-1 text-[1.05rem] font-semibold">{p.pct.toFixed(1)}% of supply</div>
        </div>
        <div className="bg-[#0c0d10] px-4 py-3">
          <div className="label">Everyone in the pool paid</div>
          <div className="num mt-1 text-[1.05rem] font-semibold">{avg > 0 ? `${fmtPrice(avg)} ${sym} / 1M` : "-"}</div>
        </div>
        <div className="bg-[#0c0d10] px-4 py-3">
          <div className="label">Next buyer after the pool pays</div>
          <div className="num mt-1 text-[1.05rem] font-semibold text-warn">
            {fmtPrice(price(until > 0 ? until : 0))} {sym} / 1M
          </div>
        </div>
      </div>
      <p className="mt-3 text-[0.78rem] leading-relaxed text-dim">
        The coin is created and the pool&apos;s {withUnit(p.budget, unit)} buy happens in the same transaction, so the pool gets the bottom of the
        curve (green). Anyone buying after that starts further up.
      </p>
    </div>
  );
}
