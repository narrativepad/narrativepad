import { config } from "@/lib/config";
import { Icon } from "./bits";

type IconName = Parameters<typeof Icon>[0]["name"];

const min = (s: number) => Math.round(s / 60);
const bar = "rounded-full bg-white/[0.08]";

// Small illustrations of each step. Decorative only: no real data in them.

function ProposeArt() {
  return (
    <div className="glass w-56 rounded-2xl p-3.5">
      <div className="flex items-center gap-2">
        <span className="h-6 w-6 rounded-full bg-[conic-gradient(from_210deg,#a98bff,#5fb4ff,#a98bff)]" />
        <span className={`h-2 w-20 ${bar}`} />
      </div>
      <div className={`mt-3 h-2 w-full ${bar}`} />
      <div className={`mt-2 h-2 w-4/5 ${bar}`} />
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2 py-1 text-[0.68rem] text-muted">
        <Icon name="link" className="h-3 w-3" /> source link
      </div>
    </div>
  );
}

function VoteArt() {
  const rows = [
    ["w-[82%]", true],
    ["w-[46%]", false],
    ["w-[24%]", false],
  ] as const;
  return (
    <div className="w-56 space-y-2.5">
      {rows.map(([w, lead], i) => (
        <div key={i} className="glass relative flex h-9 items-center overflow-hidden rounded-xl px-3">
          <span className={`absolute inset-y-0 left-0 ${w} ${lead ? "bg-violet/25" : "bg-white/[0.05]"}`} />
          <span className={`relative h-2 w-16 ${lead ? "rounded-full bg-white/50" : bar}`} />
          {lead && <Icon name="check" className="relative ml-auto h-4 w-4 text-violet" />}
        </div>
      ))}
    </div>
  );
}

function LockArt() {
  return (
    <div className="flex items-center gap-5">
      <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent ring-1 ring-accent/30">
        <span className="absolute inset-0 rounded-full bg-accent/20 blur-xl" />
        <Icon name="lock" className="relative h-7 w-7" />
      </span>
      <ul className="space-y-1.5 text-[0.78rem]">
        {["Name", "Ticker", "Image", "Links"].map((f) => (
          <li key={f} className="flex items-center gap-2 text-muted">
            <Icon name="check" className="h-3.5 w-3.5 text-accent" /> {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PoolArt() {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex h-28 w-28 items-center justify-center">
      <svg viewBox="0 0 80 80" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="how-pool" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#016bfd" />
            <stop offset="1" stopColor="#8ec1ff" />
          </linearGradient>
        </defs>
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="5" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="url(#how-pool)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${c * 0.72} ${c}`} />
      </svg>
      <span className="text-center leading-tight">
        <span className="block text-[1.05rem] font-semibold">1 price</span>
        <span className="text-[0.68rem] text-dim">for everyone</span>
      </span>
    </div>
  );
}

function LaunchArt() {
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2">
        <span className="glass rounded-full px-3.5 py-1.5 text-[0.78rem] font-medium">Create coin</span>
        <span className="text-dim">+</span>
        <span className="glass rounded-full px-3.5 py-1.5 text-[0.78rem] font-medium">Pool buys</span>
      </div>
      <div className="mt-2 h-3 w-48 rounded-b-lg border-x border-b border-gold/40" />
      <span className="mt-2 inline-flex items-center gap-1.5 text-[0.75rem] font-medium text-gold">
        <Icon name="rocket" className="h-3.5 w-3.5" /> one transaction
      </span>
    </div>
  );
}

function ReleaseArt({ count }: { count: number }) {
  const n = Math.min(Math.max(count, 3), 8);
  return (
    <div className="flex h-24 items-end gap-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5">
          <span
            className={`w-7 rounded-lg ${i < Math.ceil(n * 0.6) ? "bg-gradient-to-t from-accent/40 to-accent" : "bg-white/[0.07]"}`}
            style={{ height: `${((i + 1) / n) * 76}px` }}
          />
          <span className="num text-[0.65rem] text-dim">{i + 1}</span>
        </div>
      ))}
    </div>
  );
}

export function HowItWorks({ heading = true }: { heading?: boolean }) {
  const steps: { t: string; d: string; when: string; art: React.ReactNode; hex: string }[] = [
    { t: "Propose", d: "Anyone posts a pitch and its source: a tweet, a clip, a meme.", when: "anyone, any time", art: <ProposeArt />, hex: "#a3a8b0" },
    { t: "Vote", d: "The crowd suggests and votes on the name, ticker, image and links. One vote per person per field.", when: `${min(config.voteDurationSec)} min`, art: <VoteArt />, hex: "#a98bff" },
    { t: "Lock", d: "The winners are frozen and hashed, so nobody, including us, can swap the name or image later.", when: "instant", art: <LockArt />, hex: "#3d8bff" },
    { t: "Pool", d: "Everyone who wants in deposits into one public escrow. Every deposit is listed, in order.", when: `${min(config.depositWindowSec)} min`, art: <PoolArt />, hex: "#3d8bff" },
    { t: "Launch", d: "The coin is created and the whole pool buys in, in the same transaction. Nobody gets in first.", when: `~${min(config.launchDelaySec)} min later`, art: <LaunchArt />, hex: "#ffd032" },
    {
      t: "Release",
      d: "Tokens go back to every depositor, pro-rata, unlocking in equal steps for everyone at once.",
      when: `${config.trancheCount} × ${min(config.trancheIntervalSec)} min`,
      art: <ReleaseArt count={config.trancheCount} />,
      hex: "#ffd032",
    },
  ];
  const promises: { icon: IconName; t: string; d: string }[] = [
    { icon: "shield", t: "Non-custodial", d: "Deposits sit in an escrow program, never in a wallet anyone controls. No admin withdraw." },
    { icon: "scale", t: "Same price for all", d: "Creation and the pool's buy happen together, so nobody can buy ahead of the crowd." },
    { icon: "lock", t: "Verifiable", d: "Recompute the locked hash in your browser and download every signed vote." },
    { icon: "refund", t: "100% refunds", d: `Pool under the minimum or launch fails? Everyone takes their full deposit back. The ${(config.feeBps / 100).toFixed(0)}% fee only applies on launch.` },
  ];
  const total = min(config.voteDurationSec + config.depositWindowSec + config.launchDelaySec);

  return (
    <section id="how" className={`scroll-mt-24 ${heading ? "py-8 lg:py-14" : ""}`}>
      {heading && (
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-4 text-[2.1rem] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-[2.9rem]">
            <span className="text-silver">From a meme to a coin, </span>
            <span className="display text-gradient pr-2 text-[1.06em]">together.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[1.02rem] leading-relaxed text-muted">
            Six steps and about {total} minutes from the first vote to launch. Every step happens in public.
          </p>
        </div>
      )}

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.t} className="panel group relative flex flex-col overflow-hidden">
            <div className="relative flex h-44 items-center justify-center border-b border-white/[0.05] bg-[radial-gradient(60%_80%_at_50%_100%,rgb(255_255_255/0.035),transparent)]">
              <div className="pointer-events-none absolute bottom-0 left-1/2 h-24 w-48 -translate-x-1/2 rounded-full opacity-25 blur-3xl" style={{ background: s.hex }} />
              <div className="relative transition-transform duration-500 group-hover:-translate-y-1">{s.art}</div>
            </div>
            <div className="flex flex-1 flex-col p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex items-center gap-2.5 text-[1.05rem] font-semibold tracking-tight">
                  <span className="num flex h-6 w-6 items-center justify-center rounded-full text-[0.7rem] font-semibold" style={{ color: s.hex, background: `${s.hex}1a` }}>
                    {i + 1}
                  </span>
                  {s.t}
                </h3>
                <span className="num text-[0.75rem] text-dim">{s.when}</span>
              </div>
              <p className="mt-2 text-[0.88rem] leading-relaxed text-muted">{s.d}</p>
            </div>
          </li>
        ))}
      </ol>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {promises.map((p) => (
          <li key={p.t} className="panel flex gap-4 p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent ring-1 ring-inset ring-accent/20">
              <Icon name={p.icon} className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-[0.98rem] font-semibold">{p.t}</h3>
              <p className="mt-1 text-[0.85rem] leading-relaxed text-muted">{p.d}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
