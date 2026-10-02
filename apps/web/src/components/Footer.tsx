import Link from "next/link";
import { config } from "@/lib/config";
import { Icon, Logo } from "./bits";

const LINKS = [
  { href: "/", label: "Explore" },
  { href: "/create", label: "Start a narrative" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/how-it-works", label: "How it works" },
];

export function Footer() {
  const fee = `${(config.feeBps / 100).toFixed(0)}% fee, only if it launches`;
  return (
    <footer className="mt-auto border-t border-line bg-panel/40">
      <div className="grid gap-8 px-4 py-10 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:px-8 2xl:px-10">
        <div className="max-w-sm">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={26} />
            <span className="text-[1.02rem] font-semibold tracking-tight">narrativepad</span>
          </Link>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The crowd picks the name, ticker and image, then everyone buys in together through one public escrow. Same price for all, and a full
            refund if it doesn&apos;t launch.
          </p>
        </div>
        <nav className="grid grid-cols-2 content-start gap-x-6 gap-y-2 text-sm">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <ul className="space-y-2 text-sm text-muted">
          {[
            ["shield", "Non-custodial escrow, no admin withdraw"],
            ["refund", "Refunds are always 100%"],
            ["coins", fee],
          ].map(([icon, text]) => (
            <li key={text} className="flex items-center gap-2.5">
              <Icon name={icon as "shield"} className="h-4 w-4 shrink-0 text-accent" />
              {text}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1 border-t border-line px-4 py-4 text-[0.75rem] text-dim sm:flex-row sm:justify-between sm:px-6 lg:px-8 2xl:px-10">
        <span>Memecoins are extremely risky and can go to zero. Nothing here is financial advice.</span>
        <span>{config.chain === "mock" ? "Preview build · simulated pools · Solana devnet next" : "Solana devnet"}</span>
      </div>
    </footer>
  );
}
