import Link from "next/link";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Market } from "@/components/Market";
import { Spotlight } from "@/components/Spotlight";
import { Ticker } from "@/components/Ticker";
import { feed, globalActivity, stats } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const [all, s, tape] = await Promise.all([feed(), stats(), globalActivity(30)]);
  const items = q ? all.filter((n) => `${n.title} ${n.ticker ?? ""} ${n.pitch}`.toLowerCase().includes(q)) : all;

  // The next coin to launch: anything already launching, otherwise the pool closing soonest.
  const featured =
    all.filter((n) => n.stage === "launching").sort((a, b) => Date.parse(a.escrow!.launchAfter) - Date.parse(b.escrow!.launchAfter))[0] ??
    all.filter((n) => n.stage === "pooling").sort((a, b) => Date.parse(a.escrow!.depositEnd) - Date.parse(b.escrow!.depositEnd))[0];

  return (
    <div className="flex flex-col">
      <LiveRefresh />

      {!q && <Hero stats={s} />}

      <section id="explore" className="flex scroll-mt-24 flex-col gap-6 pt-4">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2.1rem]">
              {q ? (
                <>
                  Results for <span className="display text-gradient pr-1">&ldquo;{q}&rdquo;</span>
                </>
              ) : (
                <span className="text-silver">Explore narratives</span>
              )}
            </h2>
            <p className="mt-1 text-[0.95rem] text-muted">
              {q ? (
                <Link href="/" className="text-ink underline decoration-white/30 underline-offset-4 hover:decoration-white">
                  Clear search
                </Link>
              ) : (
                "Vote on coins being named right now, join open pools, and follow every launch as it happens."
              )}
            </p>
          </div>
        </div>

        {!q && featured && <Spotlight n={featured} />}
        {!q && <Ticker items={tape} />}
        <Market items={items} searching={Boolean(q)} />
      </section>

      {!q && <HowItWorks />}
    </div>
  );
}
