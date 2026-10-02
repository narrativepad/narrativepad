import Link from "next/link";
import { config } from "@/lib/config";
import { Icon } from "./bits";

type IconName = Parameters<typeof Icon>[0]["name"];

const min = (s: number) => Math.round(s / 60);

/** What narrativepad is, how a coin gets made, and what protects the people who join. */
export function Hero({ stats }: { stats: { narratives: number; voters: number; launched: number } }) {
  const steps: { t: string; d: string; when: string; hex: string }[] = [
    { t: "Propose", d: "Anyone posts a pitch and its source: a tweet, a clip, a meme.", when: "anyone", hex: "#9aa3b2" },
    { t: "Vote", d: "The crowd picks the name, ticker, image and links.", when: `${min(config.voteDurationSec)} min`, hex: "#a98bff" },
    { t: "Lock", d: "The winners are frozen and hashed. Nobody can swap them, us included.", when: "instant", hex: "#3df2a3" },
    { t: "Pool", d: "Everyone who wants in deposits into one public escrow.", when: `${min(config.depositWindowSec)} min`, hex: "#5fb4ff" },
    { t: "Launch", d: "The coin is created and the whole pool buys in, in the same transaction.", when: `~${min(config.launchDelaySec)} min`, hex: "#ffbd4a" },
    {
      t: "Release",
      d: "Tokens unlock to every depositor, pro-rata, in equal steps.",
      when: `${config.trancheCount} × ${min(config.trancheIntervalSec)} min`,
      hex: "#3df2a3",
    },
  ];

  const promises: { icon: IconName; t: string; d: string }[] = [
    { icon: "shield", t: "Non-custodial", d: "Deposits sit in an escrow program. There is no admin withdraw." },
    { icon: "scale", t: "Same price for all", d: "The coin is created and bought together, so nobody gets in ahead." },
    { icon: "lock", t: "Locked and verifiable", d: "The winning name and image are hashed. Check it in your browser." },
    { icon: "refund", t: "100% refunds", d: "Pool too small or launch fails? Everyone takes their full deposit back." },
  ];

  const live = [
    stats.narratives > 0 && `${stats.narratives} narrative${stats.narratives === 1 ? "" : "s"}`,
    stats.voters > 0 && `${stats.voters} voter${stats.voters === 1 ? "" : "s"}`,
    stats.launched > 0 && `${stats.launched} launched`,
  ].filter(Boolean);

  return (
    <section className="panel relative overflow-hidden">
      <div className="pointer-events-none absolute -left-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-accent/[0.07] blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-accent-2/[0.05] blur-3xl" aria-hidden />

      <div className="relative grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center lg:gap-12 lg:p-10 2xl:p-12">
        <div className="animate-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel-2/70 px-3 py-1 text-[0.75rem] font-medium text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />
            Community memecoin launchpad on Solana
          </span>
          <h1 className="mt-5 text-[2.35rem] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[3.1rem] xl:text-[3.6rem]">
            The crowd builds the coin.
            <br />
            <span className="display text-gradient pr-2 text-[1.08em]">Then buys it together.</span>
          </h1>
          <p className="mt-5 max-w-[36rem] text-[1.02rem] leading-relaxed text-muted">
            Anyone can propose a memecoin idea. The community votes on its name, ticker and image, then everyone who wants in buys at launch
            through one public pool, at the same price.{" "}
            <span className="text-ink">No snipers, no insider bundles, and a full refund if it doesn&apos;t launch.</span>
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/create" className="btn-primary px-5 py-3 text-[0.95rem]">
              <Icon name="plus" className="h-4 w-4" /> Start a narrative
            </Link>
            <Link href="#board" className="btn px-5 py-3 text-[0.95rem]">
              Browse the board <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          {live.length > 0 && (
            <p className="num mt-5 flex flex-wrap items-center gap-x-2 text-[0.82rem] text-dim">
              {live.map((s, i) => (
                <span key={String(s)} className="flex items-center gap-2">
                  {i > 0 && <span className="text-line-2">•</span>}
                  {s}
                </span>
              ))}
            </p>
          )}
        </div>

        <div className="animate-rise rounded-2xl border border-line bg-bg/50 p-1.5 [animation-delay:80ms]">
          <div className="flex items-center justify-between px-3.5 pb-2 pt-2.5">
            <span className="text-[0.88rem] font-semibold">How a coin is born</span>
            <Link href="/how-it-works" className="text-[0.78rem] text-accent hover:underline">
              Full details
            </Link>
          </div>
          <ol className="relative">
            <span className="absolute bottom-7 left-[1.72rem] top-7 w-px bg-gradient-to-b from-line-2 via-line-2 to-transparent" aria-hidden />
            {steps.map((s, i) => (
              <li key={s.t} className="relative flex items-start gap-3.5 rounded-xl px-3.5 py-2.5 transition-colors hover:bg-white/[0.025]">
                <span
                  className="num relative z-10 mt-0.5 flex h-[1.45rem] w-[1.45rem] shrink-0 items-center justify-center rounded-full bg-bg text-[0.68rem] font-semibold"
                  style={{ color: s.hex, boxShadow: `inset 0 0 0 1.5px ${s.hex}66` }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.92rem] font-semibold">{s.t}</span>
                    <span className="num shrink-0 text-[0.72rem] text-dim">{s.when}</span>
                  </div>
                  <p className="mt-0.5 text-[0.82rem] leading-snug text-muted">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <ul className="relative grid grid-cols-2 gap-px border-t border-line bg-line xl:grid-cols-4">
        {promises.map((p) => (
          <li key={p.t} className="flex items-center gap-2.5 bg-panel px-4 py-3.5 sm:items-start sm:gap-3.5 sm:p-5 sm:px-8 lg:px-10 xl:px-8 2xl:px-10">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent sm:h-9 sm:w-9">
              <Icon name={p.icon} className="h-[1.1rem] w-[1.1rem]" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[0.85rem] font-semibold leading-tight sm:text-[0.92rem]">{p.t}</h3>
              <p className="mt-0.5 hidden text-[0.82rem] leading-snug text-muted sm:block">{p.d}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
