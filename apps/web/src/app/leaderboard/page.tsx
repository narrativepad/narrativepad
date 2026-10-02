import type { Metadata } from "next";
import Link from "next/link";
import { Coin, Icon, StageBadge, Who } from "@/components/bits";
import { formatSol } from "@/lib/math";
import { formatAmount } from "@/lib/units";
import { leaderboard } from "@/lib/views";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="flex flex-1 items-center justify-center px-6 py-14 text-center text-sm text-dim">{children}</p>;
}

function Medal({ i }: { i: number }) {
  const colors = ["from-[#ffd76a] to-[#f2a93b]", "from-[#e4e9f0] to-[#9aa4b2]", "from-[#f0b38a] to-[#b8693b]"];
  if (i < 3)
    return (
      <span className={`num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[0.7rem] font-bold text-black/80 ${colors[i]}`}>{i + 1}</span>
    );
  return <span className="num w-6 shrink-0 text-center text-xs text-dim">{i + 1}</span>;
}

export default async function LeaderboardPage() {
  const b = await leaderboard();
  const maxRaised = b.creators.reduce((m, c) => (BigInt(c.raised) > m ? BigInt(c.raised) : m), 1n);
  const maxPicks = Math.max(1, ...b.voters.map((v) => v.picks));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-[2.2rem] font-semibold leading-tight tracking-[-0.04em] sm:text-[2.8rem]"><span className="text-silver">The </span><span className="display text-gradient pr-2 text-[1.06em]">leaderboard</span></h1>
          <p className="mt-1 text-[0.95rem] text-muted">The people whose narratives the crowd backs, and the voters with the best eye.</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2 lg:items-start xl:grid-cols-3">
        <section className="panel flex min-h-0 flex-col lg:max-h-[max(30rem,calc(100dvh-13rem))]">
          <div className="panel-head">
            <span className="flex items-center gap-2">
              <Icon name="coins" className="h-3.5 w-3.5" /> Biggest pools
            </span>
            <span className="num normal-case tracking-normal text-dim">{b.pools.length}</span>
          </div>
          {b.pools.length === 0 ? (
            <Empty>No pools yet.</Empty>
          ) : (
            <ol className="scroll-y min-h-0 flex-1 divide-y divide-line">
              {b.pools.map((n, i) => (
                <li key={n.id}>
                  <Link href={`/n/${n.slug}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.03]">
                    <Medal i={i} />
                    <Coin image={n.image} ticker={n.ticker} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{n.title}</span>
                      <span className="num block text-[0.7rem] text-dim">
                        ${n.ticker} · {n.escrow?.depositorCount} in pool
                      </span>
                    </span>
                    <StageBadge stage={n.stage} />
                    <span className="num w-24 text-right text-sm font-semibold text-accent">
                      {formatAmount(BigInt(n.escrow!.totalDeposited), n.escrow!.unit, 2)} <span className="text-xs font-normal text-dim">{n.escrow!.unit.symbol}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel flex min-h-0 flex-col lg:max-h-[max(30rem,calc(100dvh-13rem))]">
          <div className="panel-head">
            <span className="flex items-center gap-2">
              <Icon name="spark" className="h-3.5 w-3.5" /> Top creators
            </span>
            <span className="normal-case tracking-normal text-dim">SOL raised by their narratives</span>
          </div>
          {b.creators.length === 0 ? (
            <Empty>Start a narrative to get on the board.</Empty>
          ) : (
            <ol className="scroll-y min-h-0 flex-1 divide-y divide-line">
              {b.creators.map((c, i) => (
                <li key={c.wallet} className="relative flex items-center gap-3 px-4 py-3">
                  <span
                    className="absolute inset-y-1.5 left-1.5 rounded-lg bg-gradient-to-r from-accent/[0.09] to-transparent"
                    style={{ width: `calc(${Number((BigInt(c.raised) * 1000n) / maxRaised) / 10}% - 12px)` }}
                    aria-hidden
                  />
                  <Medal i={i} />
                  <Who address={c.wallet} size={22} className="relative flex-1 text-sm" />
                  <span className="relative text-xs text-dim">
                    {c.launches} launched · {c.narratives} started
                  </span>
                  <span className="num relative w-24 text-right text-sm font-semibold">
                    {formatSol(BigInt(c.raised), 2)} <span className="text-xs font-normal text-dim">SOL</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="panel flex min-h-0 flex-col lg:col-span-2 lg:max-h-[max(30rem,calc(100dvh-13rem))] xl:col-span-1">
          <div className="panel-head">
            <span className="flex items-center gap-2">
              <Icon name="trophy" className="h-3.5 w-3.5" /> Sharpest voters
            </span>
            <span className="normal-case tracking-normal text-dim">picks that won</span>
          </div>
          {b.voters.length === 0 ? (
            <Empty>Vote on a narrative to get on the board.</Empty>
          ) : (
            <ol className="scroll-y min-h-0 flex-1 divide-y divide-line">
              {b.voters.map((v, i) => (
                <li key={v.wallet} className="relative flex items-center gap-3 px-4 py-3">
                  <span
                    className="absolute inset-y-1.5 left-1.5 rounded-lg bg-gradient-to-r from-violet/[0.1] to-transparent"
                    style={{ width: `calc(${(v.picks / maxPicks) * 100}% - 12px)` }}
                    aria-hidden
                  />
                  <Medal i={i} />
                  <Who address={v.wallet} size={22} className="relative flex-1 text-sm" />
                  <span className="relative text-xs text-dim">{v.votes} votes</span>
                  <span className="num relative w-20 text-right text-sm font-semibold text-violet">
                    {v.picks} <span className="text-xs font-normal text-dim">won</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
