import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { config } from "@/lib/config";
import { Icon, Logo, XIcon } from "./bits";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Start a narrative" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how-it-works", label: "How it works" },
];

export function Footer() {
  const fee = `${(config.feeBps / 100).toFixed(0)}% fee, only if it launches`;
  return (
    <footer className="relative mt-16 overflow-hidden border-t border-white/[0.06]">
      <div className="pointer-events-none absolute left-1/2 top-0 h-px w-2/3 -translate-x-1/2 bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      <div className="grid gap-10 px-5 pb-6 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] lg:px-8 2xl:px-10">
        <div className="max-w-sm">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="text-[1.05rem] font-semibold tracking-[-0.02em]">narrativepad</span>
          </Link>
          <p className="mt-4 text-[0.92rem] leading-relaxed text-muted">
            The crowd picks the name, ticker and image, then everyone buys in together through one public escrow. Same price for all, and a
            full refund if it doesn&apos;t launch.
          </p>
          <a href={BRAND.x} target="_blank" rel="noopener noreferrer" className="btn mt-5 h-10 px-4">
            <XIcon className="h-4 w-4" /> Follow {BRAND.xHandle}
          </a>
        </div>
        <nav className="grid grid-cols-2 content-start gap-x-6 gap-y-3 text-[0.9rem]">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <ul className="space-y-3 text-[0.9rem] text-muted">
          {[
            ["shield", "Non-custodial escrow, no admin withdraw"],
            ["refund", "Refunds are always 100%"],
            ["coins", fee],
          ].map(([icon, text]) => (
            <li key={text} className="flex items-center gap-3">
              <Icon name={icon as "shield"} className="h-4 w-4 shrink-0 text-accent" />
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div
        aria-hidden
        className="pointer-events-none select-none overflow-hidden px-4 pb-[0.14em] pt-6 text-center text-[17vw] font-semibold leading-none tracking-[-0.06em] text-transparent lg:text-[14vw]"
        style={{ backgroundImage: "linear-gradient(180deg, rgb(255 255 255 / 0.1), rgb(255 255 255 / 0.015) 85%)", WebkitBackgroundClip: "text", backgroundClip: "text" }}
      >
        narrativepad
      </div>

      <div className="flex flex-col gap-1 border-t border-white/[0.06] px-5 py-5 text-[0.76rem] text-dim sm:flex-row sm:justify-between sm:px-6 lg:px-8 2xl:px-10">
        <span>Memecoins are extremely risky and can go to zero. Nothing here is financial advice.</span>
        <span>{config.chain === "mock" ? "Preview build · simulated pools · Solana devnet next" : "Solana devnet"}</span>
      </div>
    </footer>
  );
}
