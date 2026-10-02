import Link from "next/link";
import { Icon } from "./bits";
import { CrowdOrbit } from "./CrowdOrbit";

/** What narrativepad is, in one screen. */
export function Hero({ stats }: { stats: { narratives: number; voters: number; launched: number } }) {
  // A lone "1 narrative" reads as empty, so the numbers only appear once there's some traction.
  const live: [number, string][] =
    stats.narratives >= 3
      ? (
          [
            [stats.narratives, "narratives"],
            [stats.voters, stats.voters === 1 ? "voter" : "voters"],
            [stats.launched, "launched"],
          ] as [number, string][]
        ).filter(([v]) => v > 0)
      : [];

  return (
    <section className="relative grid items-center gap-8 pb-4 pt-6 sm:pt-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-4 lg:pb-10 lg:pt-14 2xl:pt-16">
      <div className="relative z-10 animate-rise">
        <span className="glass inline-flex items-center gap-2 rounded-full py-1 pl-1.5 pr-3.5 text-[0.78rem] text-muted">
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[0.68rem] font-semibold text-accent">Solana</span>
          The community memecoin launchpad
        </span>
        <h1 className="mt-6 text-[2.75rem] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[3.9rem] xl:text-[4.6rem] 2xl:text-[5.1rem]">
          <span className="text-silver">The crowd builds</span>
          <br />
          <span className="text-silver">the coin.</span>
          <br />
          <span className="display text-gradient pr-3 text-[1.06em]">Then buys it together.</span>
        </h1>
        <p className="mt-6 max-w-[33rem] text-[1.06rem] leading-relaxed text-muted sm:text-[1.12rem]">
          Propose a memecoin idea, let the community vote on its name, ticker and image, then everyone buys in at launch through one
          public escrow. <span className="text-ink">Same price for all. Full refund if it doesn&apos;t launch.</span>
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link href="/create" className="btn-primary h-12 px-6 text-[0.95rem]">
            Start a narrative <Icon name="arrow" className="h-4 w-4" />
          </Link>
          <Link href="#explore" className="btn h-12 px-6 text-[0.95rem]">
            Explore coins
          </Link>
        </div>
        {live.length > 0 && (
          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-4">
            {live.map(([v, k]) => (
              <div key={k}>
                <dt className="sr-only">{k}</dt>
                <dd className="num text-[1.75rem] font-semibold leading-none tracking-tight">{v}</dd>
                <div className="mt-1.5 text-[0.8rem] text-dim">{k}</div>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="relative animate-rise [animation-delay:120ms]">
        <CrowdOrbit />
      </div>
    </section>
  );
}
