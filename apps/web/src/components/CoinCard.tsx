import Link from "next/link";
import { formatSol, formatTokens, launchBreakdown, PUMP } from "@/lib/math";
import type { NarrativeCard } from "@/lib/views";
import { AnimatedNumber } from "./AnimatedNumber";
import { Coin, coinTint, Icon, ProgressBar, Sparkline, StageBadge, STAGE } from "./bits";
import { Countdown } from "./Countdown";
import { StarButton } from "./StarButton";

function Timer({ to, done, tone }: { to: string; done: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[0.75rem] font-medium ${tone}`}>
      <Icon name="clock" className="h-3.5 w-3.5" />
      <Countdown to={to} done={done} />
    </span>
  );
}

/** Image-first card for one narrative. Without `href` it renders as a static preview. */
export function CoinCard({ n, href, hot = false, showTrend = false }: { n: NarrativeCard; href?: string; hot?: boolean; showTrend?: boolean }) {
  const e = n.escrow;
  const total = BigInt(e?.totalDeposited ?? "0");
  const t = n.trend;
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
        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {hot && (
            <span className="inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-0.5 text-[0.7rem] font-semibold text-gold ring-1 ring-inset ring-gold/30 backdrop-blur-md">
              <Icon name="flame" className="h-3 w-3" /> Hot
            </span>
          )}
          <StageBadge stage={n.stage} />
        </div>
        {href && (
          <div className="absolute left-3 top-3">
            <StarButton id={n.id} />
          </div>
        )}
      </div>

      <div className="relative -mt-11 flex flex-1 flex-col px-4 pb-4">
        <div className="w-fit rounded-2xl shadow-[0_12px_30px_-10px_rgb(0_0_0/0.9)]">
          <Coin image={n.image} ticker={n.ticker} size={64} />
        </div>
        <div className="mt-3 flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-[1.06rem] font-semibold tracking-tight">{n.title}</h3>
          {n.ticker && <span className="num shrink-0 text-[0.78rem] font-medium text-dim">${n.ticker}</span>}
          {n.pair && n.pair !== "SOL" && (
            <span className="num ml-auto shrink-0 self-center rounded-full border border-gold/30 bg-gold/[0.08] px-2 py-0.5 text-[0.66rem] font-semibold text-gold" title={`Paired with ${n.pair}`}>
              /{n.pair}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.6em] text-[0.84rem] leading-snug text-muted">{n.pitch}</p>

        {showTrend && (
          <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-dim">
            <Icon name="trend" className="h-3.5 w-3.5 text-accent" />
            <span>last 15 min:</span>
            {t.votes > 0 && <span className="text-violet">+{t.votes} votes</span>}
            {t.deposits > 0 && <span className="text-gold">+{formatSol(BigInt(t.lamports))} SOL</span>}
            {t.comments > 0 && <span className="text-accent-2">+{t.comments} msgs</span>}
          </p>
        )}

        <div className="mt-4 border-t border-white/[0.06] pt-3.5">
          {n.stage === "voting" && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3 text-[0.82rem] text-muted">
                <span>
                  <AnimatedNumber value={n.votes} className="font-semibold text-ink" /> vote{n.votes === 1 ? "" : "s"}
                </span>
                {n.comments > 0 && (
                  <span className="flex items-center gap-1 text-dim">
                    <Icon name="chat" className="h-3.5 w-3.5" />
                    {n.comments}
                  </span>
                )}
              </span>
              <Timer to={n.voteEndsAt} done="tallying…" tone={STAGE.voting.text} />
            </div>
          )}

          {(n.stage === "pooling" || n.stage === "launching") && e && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="num text-[1.05rem] font-semibold">
                  <AnimatedNumber value={Number(total) / 1e9} format="sol" />{" "}
                  <span className="text-[0.78rem] font-normal text-dim">/ {formatSol(BigInt(e.poolCap))} SOL</span>
                </span>
                <Timer
                  to={n.stage === "pooling" ? e.depositEnd : e.launchAfter}
                  done={n.stage === "pooling" ? "closing…" : "launching…"}
                  tone={STAGE[n.stage].text}
                />
              </div>
              <ProgressBar value={total} max={BigInt(e.poolCap)} marker={BigInt(e.poolMin)} tone={n.stage === "pooling" ? "accent" : "warn"} live={n.stage === "pooling"} />
              <div className="flex items-center justify-between text-[0.75rem] text-dim">
                <span>{e.depositorCount === 0 ? "Nobody in yet" : `${e.depositorCount} in the pool`}</span>
                <span>
                  {total > 0n ? `≈ ${launchBreakdown(total, e.feeBps).pctOfSupply.toFixed(1)}% of supply at launch` : `${formatSol(BigInt(e.poolMin))} SOL needed to launch`}
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
              {n.stage === "refunding" ? "Didn't launch. Refunds are open, 100% back to everyone." : "Voting ended without a winning name and ticker."}
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
