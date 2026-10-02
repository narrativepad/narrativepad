import Link from "next/link";
import { toWhole, withUnit } from "@/lib/units";
import type { NarrativeCard } from "@/lib/views";
import { AnimatedNumber } from "./AnimatedNumber";
import { Coin, coinTint, Icon, ProgressBar, STAGE } from "./bits";
import { Countdown } from "./Countdown";

/** The next coin to launch, given the full width. */
export function Spotlight({ n }: { n: NarrativeCard }) {
  const e = n.escrow!;
  const launching = n.stage === "launching";
  const s = STAGE[n.stage];
  const total = BigInt(e.totalDeposited);
  return (
    <Link href={`/n/${n.slug}`} className="card group block">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {n.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={n.image} alt="" className="absolute -left-[10%] top-1/2 h-[220%] w-[70%] -translate-y-1/2 object-cover opacity-40 blur-[70px] saturate-150" />
        ) : (
          <div className="absolute inset-y-0 left-0 w-2/3 opacity-40 blur-3xl" style={{ background: coinTint(n.ticker) }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#0e0f12]/60 to-[#0e0f12]" />
      </div>

      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center lg:gap-10 lg:p-9">
        <div className="flex min-w-0 items-center gap-5 sm:gap-6">
          <div className="rounded-[1.6rem] shadow-[0_24px_60px_-18px_rgb(0_0_0/0.9)]">
            <Coin image={n.image} ticker={n.ticker} size={112} />
          </div>
          <div className="min-w-0">
            <span className={`inline-flex items-center gap-2 text-[0.8rem] font-semibold ${s.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${s.dot} live-dot`} />
              {launching ? "Launching next" : "Pool open now"}
            </span>
            <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-3">
              <h3 className="truncate text-[1.9rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.4rem]">{n.title}</h3>
              {n.ticker && <span className="num text-[1.05rem] text-muted">${n.ticker}</span>}
            </div>
            <p className="mt-1.5 line-clamp-2 max-w-xl text-[0.95rem] leading-relaxed text-muted">{n.pitch}</p>
          </div>
        </div>

        <div className="glass rounded-2xl p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-[0.78rem] text-dim">{launching ? "Launches in" : "Pool closes in"}</div>
              <Countdown
                to={launching ? e.launchAfter : e.depositEnd}
                done={launching ? "launching…" : "closing…"}
                className="mt-1 block text-[2.4rem] font-semibold leading-none tracking-[-0.03em]"
              />
            </div>
            <div className="text-right">
              <div className="num text-[1.15rem] font-semibold">
                <AnimatedNumber value={toWhole(total, e.unit)} format="sol" />{" "}
                <span className="text-[0.8rem] font-normal text-dim">/ {withUnit(e.poolCap, e.unit)}</span>
              </div>
              <div className="text-[0.75rem] text-dim">{e.depositorCount === 0 ? "nobody in yet" : `${e.depositorCount} in the pool`}</div>
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar value={total} max={BigInt(e.poolCap)} marker={BigInt(e.poolMin)} tone={launching ? "warn" : "accent"} live={!launching} />
          </div>
          <span className="btn-accent mt-5 h-11 w-full">
            {launching ? "Watch the launch" : "Join the pool"} <Icon name="arrow" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}
