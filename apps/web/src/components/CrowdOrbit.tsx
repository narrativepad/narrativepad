import { Icon } from "./bits";

// Illustration for the hero: the crowd (wallet avatars on orbit rings) pours into one pool and
// becomes one coin. Pure CSS animation, no data, no client JS.

type IconName = Parameters<typeof Icon>[0]["name"];

const OUTER = [8, 52, 97, 140, 188, 232, 276, 320];
const INNER = [30, 105, 170, 250, 300];
const FLOW = [15, 62, 118, 160, 205, 248, 290, 335];
const HUES: [number, number][] = [
  [152, 190], [265, 300], [24, 50], [200, 240], [330, 10], [95, 140], [180, 220], [45, 85], [285, 325], [210, 170], [5, 35], [120, 160], [240, 275],
];

const at = (deg: number) => ({
  left: `${50 + 50 * Math.cos((deg * Math.PI) / 180)}%`,
  top: `${50 + 50 * Math.sin((deg * Math.PI) / 180)}%`,
});

function Dot({ deg, i, size }: { deg: number; i: number; size: string }) {
  const [a, b] = HUES[i % HUES.length];
  return (
    <span
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-bg ${size}`}
      style={{ ...at(deg), background: `conic-gradient(from 210deg, hsl(${a} 80% 62%), hsl(${b} 85% 55%), hsl(${a} 80% 62%))` }}
    />
  );
}

function Chip({ icon, title, sub, className, delay }: { icon: IconName; title: string; sub: string; className: string; delay: string }) {
  return (
    <div
      className={`absolute z-20 flex animate-float items-center gap-2.5 rounded-2xl border border-white/10 bg-[#0f1114]/90 px-3 py-2 shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_16px_40px_-16px_rgb(0_0_0/0.9)] backdrop-blur-xl ${className}`}
      style={{ animationDelay: delay }}
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand/20 text-accent">
        <Icon name={icon} className="h-3.5 w-3.5" />
      </span>
      <span className="leading-tight">
        <span className="block whitespace-nowrap text-[0.78rem] font-semibold text-ink">{title}</span>
        <span className="hidden whitespace-nowrap text-[0.7rem] text-muted @md:block">{sub}</span>
      </span>
    </div>
  );
}

export function CrowdOrbit() {
  return (
    <div className="@container relative mx-auto aspect-square w-full max-w-[34rem] select-none" aria-hidden>
      {/* light */}
      <div className="absolute inset-[22%] rounded-full bg-brand/35 blur-[80px]" />
      <div className="absolute inset-[34%] translate-x-[14%] translate-y-[10%] rounded-full bg-gold/15 blur-[60px]" />

      {/* rings */}
      <div className="absolute inset-[2%] rounded-full border border-white/[0.06]" />
      <div className="absolute inset-[16%] animate-spin-slower rounded-full border border-dashed border-white/[0.1]" />
      <div className="absolute inset-[28%] rounded-full border border-white/[0.07] bg-[radial-gradient(circle,rgb(1_107_253/0.1),transparent_70%)]" />

      {/* the crowd */}
      <div className="absolute inset-[2%] animate-spin-slow">
        {OUTER.map((d, i) => (
          <Dot key={d} deg={d} i={i} size="h-[7%] w-[7%]" />
        ))}
      </div>
      <div className="absolute inset-[16%] animate-spin-slower">
        {INNER.map((d, i) => (
          <Dot key={d} deg={d} i={i + OUTER.length} size="h-[7.5%] w-[7.5%]" />
        ))}
      </div>

      {/* deposits flowing in: little gold coins, like the ones the mascot shouts out */}
      {FLOW.map((d, i) => (
        <span key={d} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transform: `rotate(${d}deg)` }}>
          <span
            className="absolute -left-[4px] -top-[4px] block h-2 w-2 animate-inflow rounded-full bg-gold shadow-[0_0_12px_2px_rgb(255_208_50/0.55),inset_0_-1px_0_rgb(0_0_0/0.35)]"
            style={{ ["--from" as string]: "33cqw", animationDelay: `${(i * 0.41).toFixed(2)}s` }}
          />
        </span>
      ))}

      {/* the mascot at the centre of the crowd */}
      <div className="absolute inset-[31%] z-10 animate-float">
        <div className="absolute -inset-[6%] rounded-full bg-[conic-gradient(from_200deg,#016bfd,#8ec1ff,#ffd032,#016bfd)] opacity-90 blur-[1px]" />
        <div className="absolute -inset-[3%] rounded-full bg-bg" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/logo.png"
          alt=""
          className="absolute inset-0 h-full w-full rounded-full object-cover shadow-[0_40px_100px_-20px_rgb(1_107_253/0.8)]"
        />
        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-white/25" />
      </div>

      <Chip icon="vote" title="Picked by the crowd" sub="name, ticker and image" className="left-0 top-[10%]" delay="0s" />
      <Chip icon="lock" title="Locked and hashed" sub="nobody can swap it later" className="right-0 top-[30%]" delay="-1.5s" />
      <Chip icon="scale" title="One price for all" sub="created and bought together" className="bottom-[18%] left-[2%]" delay="-3s" />
      <Chip icon="refund" title="100% refundable" sub="if it doesn't launch" className="bottom-[3%] right-[6%]" delay="-4.5s" />
    </div>
  );
}
