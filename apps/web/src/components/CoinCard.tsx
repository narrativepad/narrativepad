import Link from "next/link";
import { formatSol, formatTokens, launchBreakdown, PUMP } from "@/lib/math";
import type { NarrativeCard } from "@/lib/views";
import { Coin, coinTint, Icon, ProgressBar, Sparkline, StageBadge, STAGE } from "./bits";
import { Countdown } from "./Countdown";

function Timer({ to, done, tone }: { to: string; done: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[0.75rem] font-medium ${tone}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />
      <Countdown to={to} done={done} />
    </span>
  );
}

/** Image-first card for one narrative. Without `href` it renders as a static preview. */
export function CoinCard({ n, href }: { n: NarrativeCard; href?: string }) {
  const e = n.escrow;
  const total = BigInt(e?.totalDeposited ?? "0");
  const body = (
    <>
      <div className="relative h-24 overflow-hidden">
        {n.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={n.image}
            alt=""
            className="absolute inset-0 h-full w-full scale-[1.6] object-cover opacity-55 blur-2xl saturate-150 transition-transform duration-700 group-hover:scale-[1.8]"
          />
        ) : (
          <div className="absolute inset-0 opacity-60" style={{ background: coinTint(n.ticker) }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0e0f12]" />
        <div className="absolute right-3 top-3">
          <StageBadge stage={n.stage} />
        </div>
      </div>

      <div className="relative -mt-11 flex flex-1 flex-col px-4 pb-4">
        <div className="w-fit rounded-2xl shadow-[0_12px_30px_-10px_rgb(0_0_0/0.9)]">
          <Coin image={n.image} ticker={n.ticker} size={64} />
        </div>
        <div className="mt-3 flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-[1.06rem] font-semibold tracking-tight">{n.title}</h3>
          {n.ticker && <span className="num shrink-0 text-[0.78rem] font-medium text-dim">${n.ticker}</span>}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.6em] text-[0.84rem] leading-snug text-muted">{n.pitch}</p>

        <div className="mt-4 border-t border-white/[0.06] pt-3.5">
          {n.stage === "voting" && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[0.82rem] text-muted">
                <span className="num font-semibold text-ink">{n.votes}</span> vote{n.votes === 1 ? "" : "s"} so far
              </span>
              <Timer to={n.voteEndsAt} done="tallying…" tone={STAGE.voting.text} />
            </div>
          )}

          {(n.stage === "pooling" || n.stage === "launching") && e && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="num text-[1.05rem] font-semibold">
                  {formatSol(total)} <span className="text-[0.78rem] font-normal text-dim">/ {formatSol(BigInt(e.poolCap))} SOL</span>
                </span>
                <Timer
                  to={n.stage === "pooling" ? e.depositEnd : e.launchAfter}
                  done={n.stage === "pooling" ? "closing…" : "launching…"}
                  tone={STAGE[n.stage].text}
                />
              </div>
              <ProgressBar value={total} max={BigInt(e.poolCap)} marker={BigInt(e.poolMin)} tone={n.stage === "pooling" ? "accent" : "warn"} />
              <div className="flex items-center justify-between text-[0.75rem] text-dim">
                <span>{e.depositorCount === 0 ? "Nobody in yet" : `${e.depositorCount} in the pool`}</span>
                <span>
                  {total > 0n ? `buys ≈ ${launchBreakdown(total, e.feeBps).pctOfSupply.toFixed(1)}% of supply` : `min ${formatSol(BigInt(e.poolMin))} SOL to launch`}
                </span>
              </div>
            </div>
          )}

          {n.stage === "live" && e && (
            <div className="flex items-end gap-3">
              {n.flow && <Sparkline values={n.flow} className="h-9 min-w-0 flex-1" />}
              <div className="shrink-0 text-right">
                <div className="num text-[0.95rem] font-semibold">{formatTokens(BigInt(e.tokensBought))}</div>
                <div className="num text-[0.72rem] text-dim">
                  {Number((BigInt(e.tokensBought) * 1000n) / PUMP.totalSupply) / 10}% of supply · {e.unlocked}/{e.trancheCount} unlocked
                </div>
              </div>
            </div>
          )}

          {(n.stage === "refunding" || n.stage === "cancelled") && (
            <p className="text-[0.8rem] text-dim">
              {n.stage === "refunding" ? "Didn't reach launch. Everyone in the pool can take 100% back." : "Voting ended without a name and ticker."}
            </p>
          )}
        </div>
      </div>
    </>
  );
  return href ? (
    <Link href={href} className="card group flex flex-col">
      {body}
    </Link>
  ) : (
    <div className="card group flex flex-col">{body}</div>
  );
}
