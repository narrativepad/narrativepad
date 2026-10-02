// Presentational primitives shared by server and client components.
import Link from "next/link";
import { avatarHues, displayName } from "@/lib/names";
import type { Stage } from "@/lib/phase";

export const short = (a: string, n = 4) => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export const STAGE: Record<Stage, { label: string; text: string; bg: string; ring: string; dot: string; hex: string }> = {
  voting: { label: "Voting", text: "text-violet", bg: "bg-violet/10", ring: "ring-violet/40", dot: "bg-violet", hex: "#a98bff" },
  pooling: { label: "Pooling", text: "text-info", bg: "bg-info/10", ring: "ring-info/40", dot: "bg-info", hex: "#5fb4ff" },
  launching: { label: "Launching", text: "text-warn", bg: "bg-warn/10", ring: "ring-warn/40", dot: "bg-warn", hex: "#ffbd4a" },
  live: { label: "Live", text: "text-accent", bg: "bg-accent/10", ring: "ring-accent/40", dot: "bg-accent", hex: "#3df2a3" },
  refunding: { label: "Refunding", text: "text-danger", bg: "bg-danger/10", ring: "ring-danger/30", dot: "bg-danger", hex: "#ff5c7c" },
  cancelled: { label: "Cancelled", text: "text-dim", bg: "bg-panel-3", ring: "ring-line-2", dot: "bg-dim", hex: "#5c6676" },
};

export function StageBadge({ stage }: { stage: Stage }) {
  const s = STAGE[stage];
  const animated = stage !== "cancelled" && stage !== "refunding";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[0.72rem] font-semibold ring-1 ring-inset ${s.bg} ${s.text} ${s.ring}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${animated ? "live-dot" : ""}`} />
      {s.label}
    </span>
  );
}

export function TeamBadge() {
  return (
    <span className="rounded-md bg-warn/15 px-1.5 py-px text-[0.6rem] font-bold tracking-wide text-warn" title="Narrativepad team">
      TEAM
    </span>
  );
}

/** The mark is a coin: same metal as the hero coin. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="np-logo" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#e2fff3" />
          <stop offset="0.45" stopColor="#3df2a3" />
          <stop offset="1" stopColor="#1596c4" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="15.5" fill="url(#np-logo)" />
      <circle cx="16" cy="16" r="12.3" fill="none" stroke="#02140c" strokeOpacity="0.22" strokeWidth="1" />
      <path d="M11.6 21V11l8.8 10V11" fill="none" stroke="#02140c" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Gradient avatar derived from an address. */
export function Avatar({ address, size = 20 }: { address: string; size?: number }) {
  const [a, b] = avatarHues(address);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full ring-1 ring-white/10"
      style={{ width: size, height: size, background: `conic-gradient(from 210deg, hsl(${a} 80% 62%), hsl(${b} 85% 55%), hsl(${a} 80% 62%))` }}
    />
  );
}

/** Avatar + friendly name, linking to the profile. */
export function Who({ address, size = 18, className = "" }: { address: string; size?: number; className?: string }) {
  return (
    <Link href={`/profile/${address}`} className={`inline-flex min-w-0 items-center gap-1.5 hover:text-accent ${className}`} title={address}>
      <Avatar address={address} size={size} />
      <span className="truncate">{displayName(address)}</span>
    </Link>
  );
}

/** Background for a coin with no picture yet, derived from its ticker so it stays stable. */
export function coinTint(ticker: string | null) {
  const [a, b] = avatarHues(ticker ?? "?");
  return `radial-gradient(circle at 30% 22%, hsl(${a} 75% 62% / 0.85), transparent 58%), linear-gradient(140deg, hsl(${a} 50% 26%), hsl(${b} 55% 14%))`;
}

export function Coin({ image, ticker, size = 44, stage }: { image: string | null; ticker: string | null; size?: number; stage?: Stage }) {
  const ring = stage ? `ring-2 ${STAGE[stage].ring}` : "ring-1 ring-white/15";
  const radius = size >= 96 ? "rounded-[1.6rem]" : size >= 64 ? "rounded-2xl" : "rounded-xl";
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className={`shrink-0 object-cover ${radius} ${ring}`} style={{ width: size, height: size }} />;
  }
  return (
    <div
      className={`flex shrink-0 items-center justify-center font-semibold tracking-tight text-white/90 ${radius} ${ring}`}
      style={{ width: size, height: size, fontSize: Math.max(10, size / 3.6), background: coinTint(ticker) }}
    >
      {(ticker ?? "?").slice(0, 3)}
    </div>
  );
}

export function ProgressBar({ value, max, marker, tone = "accent" }: { value: bigint; max: bigint; marker?: bigint; tone?: "accent" | "info" | "warn" }) {
  const pct = max > 0n ? Number((value * 10_000n) / max) / 100 : 0;
  const mk = marker && max > 0n ? Number((marker * 10_000n) / max) / 100 : null;
  const fill =
    tone === "info" ? "from-info/70 to-info" : tone === "warn" ? "from-warn/70 to-warn" : "from-accent to-accent-2";
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full bg-gradient-to-r ${fill} transition-[width] duration-700`} style={{ width: `${Math.min(100, pct)}%` }} />
      {mk !== null && <div className="absolute top-0 h-full w-px bg-white/60" style={{ left: `${Math.min(100, mk)}%` }} title="Minimum to launch" />}
    </div>
  );
}

const ICONS = {
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  users: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M16 4.13a3 3 0 0 1 0 5.74",
  vote: "M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
  coins: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM18.1 10.4A6 6 0 1 1 10.4 18.1M7 6h1v4M16.7 13.9l.7.7-2.8 2.8",
  rocket: "M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2a2.1 2.1 0 0 0-3-3ZM12 15l-3-3a22 22 0 0 1 2-4A13 13 0 0 1 22 2c0 2.7-.8 7.5-6 11a22 22 0 0 1-4 2ZM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5",
  spark: "M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3Z",
  lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5V11Z",
  image: "M4 5h16v14H4V5ZM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-3.5-3.5",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5 9-10",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3",
  flame: "M12 22c4 0 7-2.7 7-7 0-3-2-5.5-3.5-7-.5 2-1.5 3-3 3.5C13 8 12 5 9 2c0 4-4 6.5-4 13 0 4.3 3 7 7 7Z",
  refund: "M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5",
  arrow: "M5 12h14M13 6l6 6-6 6",
  scale: "M12 3v18M8 21h8M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7Z",
  wallet: "M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15v-5M3 7h17v5h-4a2.5 2.5 0 0 0 0 5h4",
} as const;

export function Icon({ name, className = "h-4 w-4" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Sparkline({ values, className = "", color = "var(--color-accent)" }: { values: number[]; className?: string; color?: string }) {
  if (values.length < 2) return null;
  const W = 100;
  const H = 28;
  const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(2)},${(H - 2 - v * (H - 4)).toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={className} aria-hidden>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
