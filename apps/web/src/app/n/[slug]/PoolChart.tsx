import { formatSol } from "@/lib/math";
import type { NarrativeDetail } from "@/lib/views";

/** Cumulative pool size over the deposit window, with the minimum and cap marked. Real data only. */
export function PoolChart({ n }: { n: NarrativeDetail }) {
  const e = n.escrow!;
  const W = 800;
  const H = 220;
  const P = { l: 8, r: 8, t: 14, b: 22 };
  const start = Date.parse(e.depositStart);
  const end = Math.max(Date.parse(e.depositEnd), ...n.flow.map((f) => f.t), start + 1);
  const cap = Number(BigInt(e.poolCap)) / 1e9;
  const min = Number(BigInt(e.poolMin)) / 1e9;
  const total = Number(BigInt(e.totalDeposited)) / 1e9;
  const top = Math.max(cap, total) || 1;
  const x = (t: number) => P.l + ((t - start) / (end - start)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / top) * (H - P.t - P.b);

  const now = Math.min(Date.now(), end);
  const pts: [number, number][] = [[start, 0]];
  for (const f of n.flow) {
    const v = Number(BigInt(f.total)) / 1e9;
    pts.push([f.t, pts[pts.length - 1][1]], [f.t, v]);
  }
  pts.push([now, pts[pts.length - 1][1]]);
  const line = pts.map(([t, v], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(now).toFixed(1)},${H - P.b} L${x(start).toFixed(1)},${H - P.b} Z`;
  const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <span>Pool flow</span>
        <span className="num normal-case tracking-normal text-ink">
          {formatSol(BigInt(e.totalDeposited))} <span className="text-dim">/ {formatSol(BigInt(e.poolCap))} SOL</span>
        </span>
      </div>
      <div className="px-3 pb-2 pt-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full 2xl:h-60" preserveAspectRatio="none" role="img" aria-label="Cumulative SOL in the pool over time">
          <defs>
            <linearGradient id="flow-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="flow-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--color-accent)" />
              <stop offset="100%" stopColor="var(--color-accent-2)" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1={P.l} x2={W - P.r} y1={y(top * g)} y2={y(top * g)} stroke="rgb(255 255 255 / 0.04)" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={P.l} x2={W - P.r} y1={y(cap)} y2={y(cap)} stroke="rgb(255 255 255 / 0.18)" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
          <line x1={P.l} x2={W - P.r} y1={y(min)} y2={y(min)} stroke="var(--color-warn)" strokeOpacity="0.55" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="url(#flow-fill)" />
          <path d={line} fill="none" stroke="url(#flow-stroke)" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {n.flow.length > 0 && <circle cx={x(now)} cy={y(total)} r="4" fill="var(--color-accent)" stroke="var(--color-bg)" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="mt-1 flex items-center justify-between text-[0.7rem] text-dim">
          <span className="num">{fmtTime(start)}</span>
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t border-dashed border-white/40" /> cap
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-px w-4 border-t border-dashed border-warn/70" /> minimum to launch
            </span>
          </span>
          <span className="num">{fmtTime(end)}</span>
        </div>
      </div>
    </section>
  );
}
