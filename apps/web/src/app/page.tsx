import Link from "next/link";
import { Board } from "@/components/Board";
import { Coin, Who } from "@/components/bits";
import { Countdown } from "@/components/Countdown";
import { Hero } from "@/components/Hero";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Ticker } from "@/components/Ticker";
import { formatSol } from "@/lib/math";
import { feed, globalActivity, leaderboard, stats } from "@/lib/views";

export const dynamic = "force-dynamic";

function Pill({ children, tone = "text-ink" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`num inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-panel-2/70 px-3 py-1 text-[0.8rem] ${tone}`}>{children}</span>;
}

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const [all, s, board, tape] = await Promise.all([feed(), stats(), leaderboard(), globalActivity(30)]);
  const items = q ? all.filter((n) => `${n.title} ${n.ticker ?? ""} ${n.pitch}`.toLowerCase().includes(q)) : all;

  const voting = all.filter((n) => n.stage === "voting").length;
  const open = all.filter((n) => n.stage === "pooling" || n.stage === "launching");
  const pooledNow = open.reduce((sum, n) => sum + BigInt(n.escrow?.totalDeposited ?? "0"), 0n);
  const nextLaunch = open.map((n) => n.escrow!.launchAfter).sort()[0];

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh />

      {!q && <Hero stats={s} />}

      <section id="board" className="flex scroll-mt-24 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-1">
          <div>
            <h2 className="text-[1.35rem] font-semibold tracking-tight">
              {q ? (
                <>
                  {items.length} result{items.length === 1 ? "" : "s"} for <span className="text-accent">&ldquo;{q}&rdquo;</span>
                </>
              ) : (
                "Live board"
              )}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {q ? (
                <Link href="/" className="text-accent hover:underline">
                  Clear search
                </Link>
              ) : (
                "Every narrative, from first vote to launch. Updates in real time."
              )}
            </p>
          </div>
          {!q && (
            <div className="flex flex-wrap items-center gap-2">
              {voting > 0 && (
                <Pill tone="text-violet">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet" /> {voting} voting
                </Pill>
              )}
              {pooledNow > 0n && (
                <Pill tone="text-info">
                  <span className="h-1.5 w-1.5 rounded-full bg-info" /> {formatSol(pooledNow, 2)} SOL pooling
                </Pill>
              )}
              {nextLaunch && (
                <Pill tone="text-warn">
                  <span className="h-1.5 w-1.5 rounded-full bg-warn live-dot" /> next launch <Countdown to={nextLaunch} done="now" />
                </Pill>
              )}
            </div>
          )}
        </div>

        <Ticker items={tape} />

        <div className="flex flex-col gap-3 3xl:flex-row 3xl:items-start">
          <div className="min-w-0 flex-1">
            <Board items={items} />
          </div>

          {board.pools.length > 0 && (
            <aside className="hidden w-[22rem] shrink-0 flex-col gap-3 3xl:flex">
              <section className="panel">
                <div className="panel-head">
                  <span>Biggest pools</span>
                  <Link href="/leaderboard" className="text-accent hover:underline">
                    Leaderboard
                  </Link>
                </div>
                <ol className="divide-y divide-line">
                  {board.pools.slice(0, 6).map((n, i) => (
                    <li key={n.id}>
                      <Link href={`/n/${n.slug}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-white/[0.03]">
                        <span className="num w-4 text-xs text-dim">{i + 1}</span>
                        <Coin image={n.image} ticker={n.ticker} size={30} />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title}</span>
                        <span className="num text-sm text-accent">{formatSol(BigInt(n.escrow!.totalDeposited), 2)} SOL</span>
                      </Link>
                    </li>
                  ))}
                </ol>
                {board.creators.length > 0 && (
                  <div className="border-t border-line px-4 py-3">
                    <div className="label mb-2">Top creators</div>
                    <ul className="space-y-1.5">
                      {board.creators.slice(0, 4).map((c) => (
                        <li key={c.wallet} className="flex items-center justify-between gap-2 text-sm">
                          <Who address={c.wallet} size={18} className="text-muted" />
                          <span className="num shrink-0 text-xs text-dim">{formatSol(BigInt(c.raised), 2)} SOL</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}
